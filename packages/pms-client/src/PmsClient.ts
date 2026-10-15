import { z } from "zod";

import {
  automaticOperationRequestSchema,
  workflowContextMetaSchema,
  workflowContextV2ResponseSchema,
  parseCapabilityCatalog,
  operationResultSchema,
  operationPreviewSchema,
  queryRequestSchema,
  queryResultSchema,
  resourceDetailSchema,
  resourceRefSchema,
  workflowContextResponseSchema,
  orchestratorConversationSchema,
  orchestratorEventSchema,
  orchestratorPlanSchema,
  type AutomaticOperationRequest,
  type CapabilityCatalog,
  type OperationResult,
  type OperationPreview,
  type QueryRequest,
  type QueryResult,
  type ResourceDetail,
  type ResourceRef,
  type ContextReadOptions,
  type ContextMeta,
  type WorkflowContext,
  type OrchestratorConversation,
  type OrchestratorEvent,
  type OrchestratorPlan,
} from "../../pms-contracts/src/index.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
import { AuthProviderError } from "./AuthProvider.js";
import type { AuthProvider } from "./AuthProvider.js";
import { classifyPmsStatus, PmsClientError, safeErrorMessage } from "./Errors.js";
import { createRequestContext } from "./RequestContext.js";
import type { PmsClientId } from "./RequestContext.js";
import type {
  AppendTurnRequest,
  ConfirmPlanRequest,
  CreateConversationRequest,
} from "./OrchestratorClientTypes.js";

export interface PmsClient {
  capabilities(): Promise<CapabilityCatalog>;
  query(request: QueryRequest): Promise<QueryResult>;
  get(resource: ResourceRef): Promise<ResourceDetail>;
  context(resource: ResourceRef, options?: ContextReadOptions): Promise<WorkflowContext>;
  preview(request: AutomaticOperationRequest): Promise<OperationPreview>;
  execute(request: AutomaticOperationRequest): Promise<OperationResult>;
  createConversation(request: CreateConversationRequest): Promise<OrchestratorConversation>;
  appendTurn(request: AppendTurnRequest): Promise<OrchestratorPlan>;
  previewPlan(planId: number, requestId?: string): Promise<OrchestratorPlan>;
  confirmPlan(request: ConfirmPlanRequest): Promise<OrchestratorPlan>;
  getConversation(conversationId: number): Promise<OrchestratorConversation>;
  listConversationEvents(conversationId: number, afterSequence?: number): Promise<OrchestratorEvent[]>;
}

export interface PmsHttpClientOptions {
  baseUrl: string;
  auth: AuthProvider;
  clientId: PmsClientId;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  requestIdFactory?: () => string;
  traceHeaders?: Readonly<Record<string, string>>;
}

const responseEnvelopeSchema = z.object({
  code: z.number().int(),
  msg: z.string().optional(),
  data: z.unknown().optional(),
  requestId: z.string().optional(),
});

const operationWireResultSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(["SUCCEEDED", "REJECTED", "CONFLICT"]),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  refreshScopes: z.array(z.string()).nullable().optional(),
  auditId: z.string().optional(),
});

export class PmsHttpClient implements PmsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly requestIdFactory: () => string;

  constructor(private readonly options: PmsHttpClientOptions) {
    if (!options.baseUrl.trim()) throw new Error("PMS baseUrl 不能为空");
    if (!options.auth) throw new Error("PMS auth provider 不能为空");
    this.baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 100);
    this.requestIdFactory = options.requestIdFactory ?? (() => createRequestContext(options.clientId).requestId);
  }

  async capabilities(): Promise<CapabilityCatalog> {
    return this.requestData<CapabilityCatalog>(
      "integration/ai/v1/capabilities",
      { method: "GET" },
      true,
      undefined,
      (data, requestId) => parseCapabilityCatalogForClient(data, requestId),
    );
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    const normalized = queryRequestSchema.parse(request);
    const data = await this.requestData("integration/ai/v1/query", {
      method: "POST",
      body: JSON.stringify(normalized),
    }, true);
    return queryResultSchema.parse(data);
  }

  async get(resource: ResourceRef): Promise<ResourceDetail> {
    const parsed = resourceRefSchema.extend({
      id: z.number().int().positive(),
    }).parse(resource);
    const data = await this.requestData(
      `integration/ai/v1/resources/${encodeURIComponent(parsed.type)}/${parsed.id}`,
      { method: "GET" },
      true,
    );
    return resourceDetailSchema.parse(data);
  }

  async context(resource: ResourceRef, options?: ContextReadOptions): Promise<WorkflowContext> {
    const parsed = resourceRefSchema.extend({
      id: z.number().int().positive(),
    }).parse(resource);
    const requested = parseContextReadOptions(options);
    let query = "";
    if (requested.nodeId !== undefined) query += `&nodeId=${requested.nodeId}`;
    if (requested.view !== undefined) query += `&view=${requested.view}`;
    if (requested.component !== undefined) query += `&componentKey=${encodeURIComponent(requested.component)}`;
    const data = await this.requestData(
      `integration/ai/v1/context/${encodeURIComponent(parsed.type)}/${parsed.id}${query ? `?${query.slice(1)}` : ""}`,
      { method: "GET" },
      true,
    );
    const raw = parseWorkflowContextEnvelope(data);
    verifyContextReceipt(parsed.type, parsed.id, raw.resourceType, raw.resourceId, requested,
      readContextMeta(raw as unknown as Record<string, unknown>));
    if (raw.meta === undefined) {
      return {
        resource: { type: raw.resourceType, id: raw.resourceId },
        version: raw.version,
        ...(raw.entityVersion !== undefined ? { entityVersion: raw.entityVersion } : {}),
        ...(raw.resourceDetails !== undefined ? { resourceDetails: raw.resourceDetails } : {}),
        currentNode: raw.currentNode ?? undefined,
        workflow: raw.workflow
          ? {
            templateVersionId: raw.workflow.templateVersionId ?? undefined,
            templateVersionNo: raw.workflow.templateVersionNo ?? undefined,
            nodes: raw.workflow.nodes,
          }
          : undefined,
        ...(raw.relations !== undefined ? { relations: raw.relations } : {}),
        allowedActions: raw.allowedActions,
      };
    }
    ensureWorkflowContextV2Parsing(data);
    const v2 = workflowContextV2ResponseSchema.parse(data);
    return {
      resource: { type: v2.resourceType, id: v2.resourceId },
      version: v2.version,
      ...(v2.entityVersion !== undefined ? { entityVersion: v2.entityVersion } : {}),
      ...(v2.resourceDetails !== undefined ? { resourceDetails: v2.resourceDetails } : {}),
      currentNode: v2.currentNode ?? undefined,
      workflow: v2.workflow
        ? {
          templateVersionId: v2.workflow.templateVersionId ?? undefined,
          templateVersionNo: v2.workflow.templateVersionNo ?? undefined,
          nodes: v2.workflow.nodes,
        }
        : undefined,
      ...(v2.relations !== undefined ? { relations: v2.relations } : {}),
      allowedActions: v2.allowedActions,
      meta: v2.meta,
    };
  }

  async execute(request: AutomaticOperationRequest): Promise<OperationResult> {
    const normalized = automaticOperationRequestSchema.parse(request);
    if (normalized.clientId !== this.options.clientId) {
      throw new PmsClientError("validation", "clientId 与 Client 配置不一致");
    }
    const body = {
      command: normalized.operation,
      arguments: normalized.arguments,
      contextId: normalized.context?.id,
      contextVersion: normalized.context?.version,
      contractId: normalized.contract?.id,
      contractVersion: normalized.contract?.version,
      idempotencyKey: normalized.idempotencyKey,
      clientId: normalized.clientId,
      requestId: normalized.requestId,
    };
    const data = await this.requestData("integration/ai/v1/operations/execute", {
      method: "POST",
      headers: { "idempotency-key": normalized.idempotencyKey },
      body: JSON.stringify(body),
    }, false, normalized.requestId);
    const raw = operationWireResultSchema.parse(data);
    return operationResultSchema.parse({
      operationId: raw.operationId,
      status: raw.status,
      message: raw.message,
      data: raw.data ?? {},
      warnings: raw.status === "SUCCEEDED" || !raw.message ? [] : [raw.message],
      refreshScopes: raw.refreshScopes ?? [],
      auditId: raw.auditId,
    });
  }

  async createConversation(request: CreateConversationRequest): Promise<OrchestratorConversation> {
    const normalized = z.object({
      resourceType: z.literal("requirement"),
      resourceId: z.number().int().positive(),
    }).strict().parse(request);
    return this.requestData(
      "integration/ai/v1/orchestrator/conversations",
      { method: "POST", body: JSON.stringify(normalized) },
      false,
      undefined,
      (data) => orchestratorConversationSchema.parse(data),
    );
  }

  async appendTurn(request: AppendTurnRequest): Promise<OrchestratorPlan> {
    const normalized = z.object({
      conversationId: z.number().int().positive(),
      message: z.string().trim().min(1),
      contractVersion: z.literal("requirement-analysis/v1"),
      draft: z.unknown(),
      nodeId: z.number().int().positive().optional(),
      contextVersion: z.number().int().nonnegative().optional(),
      requestId: z.string().trim().min(1).max(160).optional(),
    }).strict().parse(request);
    const body = {
      message: normalized.message,
      contractVersion: normalized.contractVersion,
      draft: normalized.draft,
      ...(normalized.nodeId === undefined ? {} : { nodeId: normalized.nodeId }),
      ...(normalized.contextVersion === undefined ? {} : { contextVersion: normalized.contextVersion }),
      ...(normalized.requestId === undefined ? {} : { requestId: normalized.requestId }),
    };
    return this.requestData(
      `integration/ai/v1/orchestrator/conversations/${normalized.conversationId}/turns`,
      { method: "POST", body: JSON.stringify(body) },
      false,
      normalized.requestId,
      (data) => orchestratorPlanSchema.parse(data),
    );
  }

  async previewPlan(planId: number, requestId?: string): Promise<OrchestratorPlan> {
    const normalizedId = z.number().int().positive().parse(planId);
    return this.requestData(
      `integration/ai/v1/orchestrator/plans/${normalizedId}/preview`,
      { method: "POST" },
      false,
      requestId,
      (data) => orchestratorPlanSchema.parse(data),
    );
  }

  async confirmPlan(request: ConfirmPlanRequest): Promise<OrchestratorPlan> {
    const normalized = z.object({
      planId: z.number().int().positive(),
      idempotencyKey: z.string().trim().min(1).max(160),
      requestId: z.string().trim().min(1).max(160).optional(),
    }).strict().parse(request);
    return this.requestData(
      `integration/ai/v1/orchestrator/plans/${normalized.planId}/confirm`,
      {
        method: "POST",
        headers: { "idempotency-key": normalized.idempotencyKey },
        body: JSON.stringify({ idempotencyKey: normalized.idempotencyKey }),
      },
      false,
      normalized.requestId,
      (data) => orchestratorPlanSchema.parse(data),
    );
  }

  async getConversation(conversationId: number): Promise<OrchestratorConversation> {
    const normalizedId = z.number().int().positive().parse(conversationId);
    return this.requestData(
      `integration/ai/v1/orchestrator/conversations/${normalizedId}`,
      { method: "GET" },
      true,
      undefined,
      (data) => orchestratorConversationSchema.parse(data),
    );
  }

  async listConversationEvents(conversationId: number, afterSequence = 0): Promise<OrchestratorEvent[]> {
    const normalizedId = z.number().int().positive().parse(conversationId);
    const cursor = z.number().int().nonnegative().parse(afterSequence);
    return this.requestData(
      `integration/ai/v1/orchestrator/conversations/${normalizedId}/events?afterSequence=${cursor}`,
      { method: "GET" },
      true,
      undefined,
      (data) => z.array(orchestratorEventSchema).parse(data),
    );
  }

  async preview(request: AutomaticOperationRequest): Promise<OperationPreview> {
    const normalized = automaticOperationRequestSchema.parse(request);
    if (normalized.clientId !== this.options.clientId) {
      throw new PmsClientError("validation", "clientId 与 Client 配置不一致");
    }
    const data = await this.requestData("integration/ai/v1/operations/preview", {
      method: "POST",
      body: JSON.stringify({
        command: normalized.operation,
        arguments: normalized.arguments,
        contextId: normalized.context?.id,
        contextVersion: normalized.context?.version,
        contractId: normalized.contract?.id,
        contractVersion: normalized.contract?.version,
        clientId: normalized.clientId,
        requestId: normalized.requestId,
      }),
    }, false, normalized.requestId);
    return operationPreviewSchema.parse(data);
  }

  private async requestData<T = unknown>(
    path: string,
    init: RequestInit,
    retrySafe: boolean,
    requestIdOverride?: string,
    transform?: (data: unknown, requestId: string) => T,
  ): Promise<T> {
    const requestId = requestIdOverride ?? this.requestIdFactory();
    const token = await this.getToken(requestId);
    const attempts = retrySafe ? this.maxRetries + 1 : 1;
    let attempt = 0;

    while (attempt < attempts) {
      attempt += 1;
      try {
        const response = await this.fetchWithTimeout(path, init, token, requestId);
        const payload = await this.readPayload(response, requestId);
        const status = response.ok ? payload.code : response.status;
        if (status !== 200) {
          throw classifyPmsStatus(status, payload.msg, payload.requestId ?? requestId);
        }
        return transform ? transform(payload.data, requestId) : payload.data as T;
      } catch (error) {
        const clientError = this.toClientError(error, requestId);
        if (retrySafe && clientError.retryable && attempt < attempts) {
          await this.delay(this.retryDelayMs * attempt);
          continue;
        }
        throw clientError;
      }
    }
    throw new PmsClientError("network", "PMS 请求失败", { requestId });
  }

  private async getToken(requestId: string): Promise<string> {
    try {
      const token = (await this.options.auth.getToken()).trim();
      if (!token) throw new AuthProviderError("认证 Token 不能为空");
      return token;
    } catch (error) {
      if (error instanceof AuthProviderError) {
        throw new PmsClientError("unauthorized", "PMS 认证不可用", { requestId });
      }
      throw new PmsClientError("unauthorized", "PMS 认证不可用", { requestId });
    }
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
    token: string,
    requestId: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("authorization", `Bearer ${token}`);
    headers.set("x-request-id", requestId);
    headers.set("client-id", this.options.clientId);
    headers.set("x-client-id", this.options.clientId);
    for (const [name, value] of Object.entries(this.options.traceHeaders ?? {})) {
      if (["traceparent", "tracestate", "baggage"].includes(name) && value) {
        headers.set(name, value);
      }
    }
    if (init.body !== undefined) headers.set("content-type", "application/json");
    try {
      return await this.fetchImpl(new URL(path, this.baseUrl), {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new PmsClientError("timeout", "PMS 请求超时", { requestId, retryable: true });
      }
      throw new PmsClientError("network", "无法连接 PMS 服务", { requestId, retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readPayload(response: Response, requestId: string): Promise<z.infer<typeof responseEnvelopeSchema>> {
    const text = await response.text();
    let raw: unknown;
    try {
      raw = text ? JSON.parse(text) : undefined;
    } catch {
      if (!response.ok) throw classifyPmsStatus(response.status, undefined, requestId);
      throw new PmsClientError("server", "PMS 返回了无效响应", { status: response.status, requestId });
    }
    const parsed = responseEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      if (!response.ok) throw classifyPmsStatus(response.status, undefined, requestId);
      throw new PmsClientError("server", "PMS 返回结构无效", { status: response.status, requestId });
    }
    return parsed.data;
  }

  private toClientError(error: unknown, requestId: string): PmsClientError {
    if (error instanceof PmsClientError) return error;
    return new PmsClientError("network", "PMS 请求失败", { requestId, retryable: true });
  }

  private async delay(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

function parseCapabilityCatalogForClient(input: unknown, requestId: string): CapabilityCatalog {
  try {
    return parseCapabilityCatalog(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new PmsClientError("validation", "PMS 能力目录格式不兼容", {
        requestId,
        details: {
          issueCount: error.issues.length,
          fields: error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.map(String).join("."),
            message: safeErrorMessage(issue.message, "字段校验失败"),
          })),
        },
      });
    }
    throw error;
  }
}

function readContextMeta(data: Record<string, unknown>): ContextMeta | undefined {
  if (data === null || typeof data !== "object" || data.meta === undefined || data.meta === null) {
    return undefined;
  }
  try {
    return workflowContextMetaSchema.parse(data.meta);
  } catch (schemaFailure) {
    throw new PmsClientError("validation", "服务端返回未知的 context 格式，无法按 formatVersion 解析");
  }
}

function parseContextReadOptions(
  options?: ContextReadOptions,
): { nodeId?: number; view?: "legacy" | "focused"; component?: string } {
  if (options === undefined) return {};
  if (typeof options !== "object") throw new PmsClientError("validation", "context options 必须为对象");
  if (options.nodeId !== undefined) {
    if (!Number.isInteger(options.nodeId) || options.nodeId <= 0
        || options.nodeId > MAX_SAFE_INTEGER) {
      throw new PmsClientError("validation", "nodeId 必须为安全范围内的正整数");
    }
  }
  if (options.view !== undefined && options.view !== "legacy" && options.view !== "focused") {
    throw new PmsClientError("validation", "view 仅支持 legacy 或 focused");
  }
  if (options.component !== undefined) {
    if (!options.component.trim()) {
      throw new PmsClientError("validation", "component 不能为空白");
    }
    if (options.view !== "focused") {
      throw new PmsClientError("validation", "component 仅允许在 focused 视图下使用");
    }
  }
  return options;
}

function verifyContextReceipt(
  requestedType: string,
  requestedId: number,
  responseResourceType: string,
  responseResourceId: number,
  requested: { nodeId?: number; view?: "legacy" | "focused"; component?: string },
  meta?: ContextMeta,
): void {
  if (responseResourceType !== requestedType || responseResourceId !== requestedId) {
    throw new PmsClientError("validation",
      `context 响应定位不一致: 请求 ${requestedType}/${requestedId}，响应 ${responseResourceType}/${responseResourceId}`);
  }
  const requestedSelection = requested.nodeId !== undefined || requested.view !== undefined
    || requested.component !== undefined;
  if (requestedSelection && meta === undefined) {
    throw new PmsClientError("validation",
      "服务端没有返回 meta；无法证明显式定位参数被应用（旧服务端或路由错误）");
  }
  if (meta === undefined) return;
  if (requested.nodeId !== undefined && meta.selectedNodeId !== requested.nodeId) {
    throw new PmsClientError("validation",
      `context 响应 selectedNodeId=${meta.selectedNodeId ?? null} 与请求 nodeId=${requested.nodeId} 不一致`);
  }
  if (requested.view !== undefined && meta.view !== requested.view) {
    throw new PmsClientError("validation",
      `context 响应 view=${meta.view} 与请求 view=${requested.view} 不一致`);
  }
  if (requested.component !== undefined && meta.selectedComponentKey !== requested.component) {
    throw new PmsClientError("validation",
      `context 响应 selectedComponentKey=${meta.selectedComponentKey ?? null} 与请求 component=${requested.component} 不一致`);
  }
}

function parseWorkflowContextEnvelope(data: unknown) {
  try {
    return workflowContextResponseSchema.parse(data);
  } catch (legacyParseFailure) {
    throw new PmsClientError("validation",
      legacyParseFailure instanceof z.ZodError
        ? `context 响应结构不合法: ${legacyParseFailure.issues[0]?.message ?? "未知 schema 失败"}`
        : "context 响应结构不合法");
  }
}

function ensureWorkflowContextV2Parsing(data: unknown): void {
  try {
    workflowContextV2ResponseSchema.parse(data);
  } catch (strictParseFailure) {
    throw new PmsClientError("validation",
      strictParseFailure instanceof z.ZodError
        ? `context v2 响应结构不合法: ${strictParseFailure.issues[0]?.message ?? "未知 schema 失败"}`
        : "context v2 响应结构不合法");
  }
}
