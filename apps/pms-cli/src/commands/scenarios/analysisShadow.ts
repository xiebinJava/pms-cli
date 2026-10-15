import { readFile } from "node:fs/promises";
import type { AnalysisDraft, WorkflowContext } from "../../../../../packages/pms-contracts/src/index.js";
import { AnalysisDraftValidator } from "./AnalysisDraftValidator.js";
import type {
  AnalysisDraftProvider,
  AnalysisDraftProviderInput,
} from "./AnalysisDraftProvider.js";

export interface AnalysisShadowCase {
  id: string;
  prompt: string;
  expectedDraftStatus: string;
  expectedWriteOutcome: string;
  qualityChecks: string[];
}

export interface AnalysisShadowRunOptions {
  cases: AnalysisShadowCase[];
  context: WorkflowContext;
  provider: AnalysisDraftProvider;
}

export type AnalysisShadowResultStatus = "GENERATED" | "PROVIDER_ERROR" | "VALIDATION_ERROR";

export interface AnalysisShadowCaseResult {
  caseId: string;
  prompt: string;
  expectedDraftStatus: string;
  expectedWriteOutcome: string;
  qualityChecks: string[];
  status: AnalysisShadowResultStatus;
  durationMs: number;
  draft?: AnalysisDraft;
  error?: string;
}

export interface AnalysisShadowReport {
  mode: "read-only";
  resource: WorkflowContext["resource"];
  generatedAt: string;
  summary: {
    total: number;
    generated: number;
    failed: number;
    validationFailed: number;
  };
  results: AnalysisShadowCaseResult[];
}

export async function readAnalysisShadowCases(path: string): Promise<AnalysisShadowCase[]> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`影子用例文件不是有效 JSON：${path}`);
  }
  if (!Array.isArray(parsed)) throw new Error("影子用例文件必须是数组");
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`影子用例 ${index + 1} 不是对象`);
    const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.prompt !== "string") {
      throw new Error(`影子用例 ${index + 1} 缺少 id 或 prompt`);
    }
    if (typeof item.expectedDraftStatus !== "string" || typeof item.expectedWriteOutcome !== "string") {
      throw new Error(`影子用例 ${item.id} 缺少预期结果`);
    }
    if (!Array.isArray(item.qualityChecks) || !item.qualityChecks.every((check) => typeof check === "string")) {
      throw new Error(`影子用例 ${item.id} 的 qualityChecks 必须是字符串数组`);
    }
    return {
      id: item.id,
      prompt: item.prompt,
      expectedDraftStatus: item.expectedDraftStatus,
      expectedWriteOutcome: item.expectedWriteOutcome,
      qualityChecks: item.qualityChecks,
    };
  });
}

export function fixedMockDraftForContext(context: WorkflowContext): AnalysisDraft {
  const sourceRef = `${context.resource.type}:${context.resource.id}`;
  return {
    facts: [{
      text: `固定 Mock：当前资源为 ${sourceRef}`,
      sourceRefs: [sourceRef],
      confidence: "high",
    }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch: { analysis: "固定 Mock 草稿，仅用于验证影子评估链路" },
  };
}

/**
 * Runs model generation and local draft validation only. It deliberately does
 * not call operation preview or execute, so the shadow experiment cannot write
 * to PMS even if a prompt asks it to save.
 */
export async function runAnalysisShadowCases(options: AnalysisShadowRunOptions): Promise<AnalysisShadowReport> {
  const results: AnalysisShadowCaseResult[] = [];
  for (const shadowCase of options.cases) {
    results.push(await runOneCase(shadowCase, options.context, options.provider));
  }

  return {
    mode: "read-only",
    resource: options.context.resource,
    generatedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      generated: results.filter((result) => result.status === "GENERATED").length,
      failed: results.filter((result) => result.status === "PROVIDER_ERROR").length,
      validationFailed: results.filter((result) => result.status === "VALIDATION_ERROR").length,
    },
    results,
  };
}

async function runOneCase(
  shadowCase: AnalysisShadowCase,
  context: WorkflowContext,
  provider: AnalysisDraftProvider,
): Promise<AnalysisShadowCaseResult> {
  const startedAt = Date.now();
  const base = {
    caseId: shadowCase.id,
    prompt: shadowCase.prompt,
    expectedDraftStatus: shadowCase.expectedDraftStatus,
    expectedWriteOutcome: shadowCase.expectedWriteOutcome,
    qualityChecks: shadowCase.qualityChecks,
  };
  let draft: AnalysisDraft;
  try {
    const input: AnalysisDraftProviderInput = { userMessage: shadowCase.prompt, context };
    draft = await provider.generate(input);
  } catch (error) {
    return {
      ...base,
      status: "PROVIDER_ERROR",
      durationMs: Date.now() - startedAt,
      error: safeError(error),
    };
  }

  try {
    AnalysisDraftValidator.validate(draft, context);
  } catch (error) {
    return {
      ...base,
      status: "VALIDATION_ERROR",
      durationMs: Date.now() - startedAt,
      draft,
      error: safeError(error),
    };
  }

  return {
    ...base,
    status: "GENERATED",
    durationMs: Date.now() - startedAt,
    draft,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
