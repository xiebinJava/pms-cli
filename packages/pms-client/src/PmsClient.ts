import { z } from "zod";
import {
  automaticOperationRequestSchema,
  parseCapabilityCatalog,
  operationResultSchema,
  operationPreviewSchema,
  queryRequestSchema,
  queryResultSchema,
  resourceDetailSchema,
  resourceRefSchema,
  workflowContextResponseSchema,
  type AutomaticOperationRequest,
  type CapabilityCatalog,
  type OperationResult,
  type OperationPreview,
  type QueryRequest,
  type QueryResult,
  type ResourceDetail,
  type ResourceRef,
  type WorkflowContext,
} from "../../pms-contracts/src/index.js";
import { AuthProviderError } from "./AuthProvider.js";
import type { AuthProvider } from "./AuthProvider.js";
import { classifyPmsStatus, PmsClientError, safeErrorMessage } from "./Errors.js";
import { createRequestContext } from "./RequestContext.js";
import type { PmsClientId } from "./RequestContext.js";

export interface PmsClient {
  capabilities(): Promise<CapabilityCatalog>;
  query(request: QueryRequest): Promise<QueryResult>;
  get(resource: ResourceRef): Promise<ResourceDetail>;
  context(resource: ResourceRef): Promise<WorkflowContext>;
  preview(request: AutomaticOperationRequest): Promise<OperationPreview>;
  execute(request: AutomaticOperationRequest): Promise<OperationResult>;
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

  async context(resource: ResourceRef): Promise<WorkflowContext> {
    const parsed = resourceRefSchema.extend({
      id: z.number().int().positive(),
    }).parse(resource);
    const data = await this.requestData(
      `integration/ai/v1/context/${encodeURIComponent(parsed.type)}/${parsed.id}`,
      { method: "GET" },
      true,
    );
    const raw = workflowContextResponseSchema.parse(data);
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
