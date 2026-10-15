import type { AnalysisDraft, WorkflowContext } from "../../../../../packages/pms-contracts/src/index.js";
import { analysisDraftSchema } from "../../../../../packages/pms-contracts/src/index.js";

export interface AnalysisDraftProviderInput {
  userMessage: string;
  context: WorkflowContext;
}

/**
 * Generates a structured draft only. A provider never previews or writes to PMS.
 * The caller remains responsible for context validation and user approval.
 */
export interface AnalysisDraftProvider {
  generate(input: AnalysisDraftProviderInput): Promise<AnalysisDraft>;
}

export class FixedAnalysisDraftProvider implements AnalysisDraftProvider {
  public constructor(private readonly draft: AnalysisDraft) {}

  public async generate(_input: AnalysisDraftProviderInput): Promise<AnalysisDraft> {
    return cloneDraft(this.draft);
  }
}

export interface OpenAICompatibleAnalysisDraftProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint and validates the
 * response before it can enter the PMS scenario flow.
 */
export class OpenAICompatibleAnalysisDraftProvider implements AnalysisDraftProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  public constructor(private readonly options: OpenAICompatibleAnalysisDraftProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.endpoint = chatCompletionsEndpoint(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000 || this.timeoutMs > 120_000) {
      throw new Error("模型请求超时时间必须在 1000 到 120000 毫秒之间");
    }
  }

  public async generate(input: AnalysisDraftProviderInput): Promise<AnalysisDraft> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`外部模型请求失败（HTTP ${response.status}）`);
    }

    const payload = await response.json() as OpenAIChatResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("外部模型没有返回可解析的需求分析草稿");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFence(content));
    } catch {
      throw new Error("外部模型返回的需求分析草稿不是有效 JSON");
    }
    const result = analysisDraftSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`外部模型返回的内容不符合 AnalysisDraft：${result.error.message}`);
    }
    return result.data;
  }
}

const SYSTEM_PROMPT = [
  "你是 PMS 需求分析助手。只生成结构化 AnalysisDraft，不执行任何 PMS 写入。",
  "只能把 workflowContext 中可读的内容放入 facts；推断必须放入 inferences；缺失信息放入 assumptions 或 unresolvedDecisions。",
  "sourceRefs 必须使用当前资源或可读关联资源的 resourceType:id 格式。",
  "patch 只能包含需求分析成果字段，不得修改 ownerId、status、startDate、endDate、systemId、targetType、targetId。",
  "只输出 JSON，不要 Markdown，不要解释文字。JSON 必须包含 facts、inferences、assumptions、unresolvedDecisions、patch 五个字段。",
].join("\n");

function buildUserPrompt(input: AnalysisDraftProviderInput): string {
  return [
    `用户请求：${input.userMessage}`,
    "",
    "PMS 工作流上下文（只读）：",
    JSON.stringify(input.context),
  ].join("\n");
}

function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("外部模型 baseUrl 不能为空");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function cloneDraft(draft: AnalysisDraft): AnalysisDraft {
  return JSON.parse(JSON.stringify(draft)) as AnalysisDraft;
}

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}
