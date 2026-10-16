import { readFile } from "node:fs/promises";
import {
  agentProgressionShadowDraftSchema,
  type AgentProgressionShadowDraft,
  type WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import type {
  ProgressionDraftProvider,
  ProgressionDraftProviderInput,
} from "./ProgressionDraftProvider.js";

export interface ProgressionShadowCase {
  id: string;
  prompt: string;
  expectedDraftStatus: string;
  expectedWriteOutcome: string;
  qualityChecks: string[];
}

export interface ProgressionShadowRunOptions {
  cases: ProgressionShadowCase[];
  context: WorkflowContext;
  resourceType: "project" | "requirement" | "topic" | "story";
  provider: ProgressionDraftProvider;
  providerName: "mock";
}

export type ProgressionShadowCaseStatus = "GENERATED" | "PROVIDER_ERROR" | "VALIDATION_ERROR";

export interface ProgressionShadowCaseResult {
  caseId: string;
  prompt: string;
  expectedDraftStatus: string;
  expectedWriteOutcome: string;
  qualityChecks: string[];
  status: ProgressionShadowCaseStatus;
  programValidation: "PASS" | "FAIL";
  modelOutputStatus: "NOT_EVALUATED";
  humanReviewStatus: "PENDING";
  durationMs: number;
  draft?: AgentProgressionShadowDraft;
  error?: string;
}

export interface ProgressionShadowReport {
  mode: "read-only-shadow";
  provider: "mock";
  resource: WorkflowContext["resource"];
  generatedAt: string;
  evaluation: {
    program: "VALIDATED";
    model: "NOT_EVALUATED";
    human: "PENDING";
  };
  summary: {
    total: number;
    generated: number;
    failed: number;
    validationFailed: number;
  };
  results: ProgressionShadowCaseResult[];
}

export async function readProgressionShadowCases(path: string): Promise<ProgressionShadowCase[]> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`推进影子用例文件不是有效 JSON：${path}`);
  }
  if (!Array.isArray(parsed)) throw new Error("推进影子用例文件必须是数组");
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

export function fixedProgressionDraftForContext(context: WorkflowContext): AgentProgressionShadowDraft {
  const sourceRef = `${context.resource.type}:${context.resource.id}`;
  const currentNode = context.currentNode;
  const resourceType = context.resource.type === "project" || context.resource.type === "requirement"
    || context.resource.type === "topic" || context.resource.type === "story"
    ? context.resource.type : "story";
  return {
    facts: [{ text: `固定 Mock：当前资源为 ${sourceRef}`, sourceRefs: [sourceRef], confidence: "high" }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    candidateResources: [{ resourceType, resourceId: context.resource.id, confidence: "high" }],
    candidateNodes: currentNode && typeof currentNode.id === "number"
      ? [{ nodeId: currentNode.id, key: currentNode.key, label: currentNode.label, confidence: "high" }]
      : [],
    requiredFields: [],
    proposedFieldValues: {},
    references: [sourceRef],
  };
}

/** Runs draft generation and local schema validation only; it never calls a PMS write API. */
export async function runProgressionShadowCases(
  options: ProgressionShadowRunOptions,
): Promise<ProgressionShadowReport> {
  const results: ProgressionShadowCaseResult[] = [];
  for (const shadowCase of options.cases) {
    results.push(await runOneCase(shadowCase, options));
  }
  return {
    mode: "read-only-shadow",
    provider: options.providerName,
    resource: options.context.resource,
    generatedAt: new Date().toISOString(),
    evaluation: { program: "VALIDATED", model: "NOT_EVALUATED", human: "PENDING" },
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
  shadowCase: ProgressionShadowCase,
  options: ProgressionShadowRunOptions,
): Promise<ProgressionShadowCaseResult> {
  const base = {
    caseId: shadowCase.id,
    prompt: shadowCase.prompt,
    expectedDraftStatus: shadowCase.expectedDraftStatus,
    expectedWriteOutcome: shadowCase.expectedWriteOutcome,
    qualityChecks: shadowCase.qualityChecks,
    modelOutputStatus: "NOT_EVALUATED" as const,
    humanReviewStatus: "PENDING" as const,
  };
  const startedAt = Date.now();
  let draft: AgentProgressionShadowDraft;
  try {
    const input: ProgressionDraftProviderInput = {
      userMessage: shadowCase.prompt,
      resourceType: options.resourceType,
      context: options.context,
    };
    draft = await options.provider.generate(input);
  } catch (error) {
    return {
      ...base,
      status: "PROVIDER_ERROR",
      programValidation: "FAIL",
      durationMs: Date.now() - startedAt,
      error: safeError(error),
    };
  }
  const parsed = agentProgressionShadowDraftSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      ...base,
      status: "VALIDATION_ERROR",
      programValidation: "FAIL",
      durationMs: Date.now() - startedAt,
      draft,
      error: parsed.error.message,
    };
  }
  return {
    ...base,
    status: "GENERATED",
    programValidation: "PASS",
    durationMs: Date.now() - startedAt,
    draft: parsed.data,
  };
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
