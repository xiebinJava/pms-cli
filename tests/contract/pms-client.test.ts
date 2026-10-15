import { describe, expect, it } from "vitest";
import {
  PmsClientError,
  PmsHttpClient,
  StaticTokenProvider,
} from "../../packages/pms-client/src/index.js";

const capabilityPayload = {
  version: "ai-v1",
  resources: [{ type: "topic", actions: [] }],
  scopes: ["pms:query:read"],
  workflowTypes: [],
  today: "2026-09-27",
};

const response = (data: unknown, code = 200, status = 200, msg = "操作成功") =>
  new Response(JSON.stringify({ code, msg, data, requestId: "server-request" }), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("PMS HTTP client", () => {
  it("sends the user token and trace headers, then unwraps the PMS response", async () => {
    let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test/",
      auth: new StaticTokenProvider("short-lived-token"),
      clientId: "pms-cli",
      requestIdFactory: () => "request-1",
      traceHeaders: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
      },
      fetchImpl: async (input, init) => {
        captured = { input, init };
        return response(capabilityPayload);
      },
    });

    const catalog = await client.capabilities();

    expect(catalog.version).toBe("ai-v1");
    expect(String(captured?.input)).toBe("https://pms.example.test/integration/ai/v1/capabilities");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer short-lived-token");
    expect(headers.get("x-request-id")).toBe("request-1");
    expect(headers.get("x-client-id")).toBe("pms-cli");
    expect(headers.get("traceparent")).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(headers.get("tracestate")).toBe("vendor=value");
  });

  it("maps the connector operation request to the PMS command contract", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response({
          operationId: "op-1",
          status: "SUCCEEDED",
          message: "专题已创建",
          data: { topicId: 7 },
          refreshScopes: ["topic-list"],
        });
      },
    });

    const result = await client.execute({
      operation: "topic.create",
      arguments: { title: "订单中心" },
      context: { id: "topic:new", version: "1" },
      contract: { id: "pms-agent", version: "v1" },
      idempotencyKey: "idem-1",
      clientId: "pms-cli",
      requestId: "request-2",
    });

    expect(body).toEqual({
      command: "topic.create",
      arguments: { title: "订单中心" },
      contextId: "topic:new",
      contextVersion: "1",
      contractId: "pms-agent",
      contractVersion: "v1",
      idempotencyKey: "idem-1",
      clientId: "pms-cli",
      requestId: "request-2",
    });
    expect(result).toMatchObject({
      operationId: "op-1",
      status: "SUCCEEDED",
      message: "专题已创建",
      data: { topicId: 7 },
      refreshScopes: ["topic-list"],
    });
  });

  it("executes an existing preview operation through the confirmed route", async () => {
    let captured: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (input, init) => {
        captured = { input, init };
        return response({
          operationId: "preview-1",
          status: "SUCCEEDED",
          data: { saved: true },
          refreshScopes: ["story-detail"],
        });
      },
    });

    const result = await client.executePreview("preview-1", "idem-preview-1");

    expect(String(captured?.input)).toBe(
      "https://pms.example.test/ai/operations/preview-1/execute",
    );
    expect(new Headers(captured?.init?.headers).get("idempotency-key")).toBe("idem-preview-1");
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ idempotencyKey: "idem-preview-1" });
    expect(result).toMatchObject({ operationId: "preview-1", status: "SUCCEEDED", data: { saved: true } });
  });

  it("normalizes a project context whose current node has no numeric id", async () => {
    let requestedUrl = "";
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return response({
          resourceType: "project",
          resourceId: 78,
          version: 3,
          currentNode: { id: null, key: "development", label: "开发与迭代控制" },
          workflow: null,
          allowedActions: ["project.update"],
        });
      },
    });

    const context = await client.context({ type: "project", id: 78 });

    expect(requestedUrl).toContain("/integration/ai/v1/context/project/78");
    expect(context).toEqual({
      resource: { type: "project", id: 78 },
      version: 3,
      currentNode: { id: null, key: "development", label: "开发与迭代控制" },
      workflow: undefined,
      allowedActions: ["project.update"],
    });
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [409, "conflict"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "server"],
  ] as const)("classifies PMS business error %s as %s", async (code, kind) => {
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 0,
      fetchImpl: async () => response(null, code),
    });

    const error = await client.capabilities().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PmsClientError);
    expect((error as PmsClientError).kind).toBe(kind);
    expect((error as Error).message).not.toContain("token");
  });

  it("classifies HTTP errors even when the upstream body is not JSON", async () => {
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 0,
      fetchImpl: async () => new Response("upstream failure", { status: 503 }),
    });

    const error = await client.capabilities().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PmsClientError);
    expect((error as PmsClientError).kind).toBe("server");
    expect((error as PmsClientError).status).toBe(503);
    expect((error as Error).message).not.toContain("upstream failure");
  });

  it("classifies capability schema drift as validation with issue paths", async () => {
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      requestIdFactory: () => "capability-request",
      maxRetries: 0,
      fetchImpl: async () => response({
        version: "ai-v1",
        resources: [{
          type: "topic",
          actions: [{
            name: "topic.create",
            label: "创建专题",
            description: "创建专题",
            mode: "automatic",
            risk: "low",
            scopes: [],
            inputSchema: { title: { required: true } },
            requiresContext: false,
            refreshScopes: [],
          }],
        }],
        scopes: [],
        workflowTypes: [],
      }),
    });

    const error = await client.capabilities().catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PmsClientError);
    expect((error as PmsClientError).kind).toBe("validation");
    expect((error as PmsClientError).requestId).toBe("capability-request");
    expect((error as PmsClientError).details).toMatchObject({
      fields: [expect.objectContaining({ path: "resources.0.actions.0.inputSchema.title.type" })],
    });
  });

  it("retries safe reads but never retries automatic writes", async () => {
    let readAttempts = 0;
    const readClient = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        readAttempts += 1;
        return readAttempts === 1 ? response(null, 500) : response(capabilityPayload);
      },
    });
    await readClient.capabilities();
    expect(readAttempts).toBe(2);

    let writeAttempts = 0;
    const writeClient = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 3,
      retryDelayMs: 0,
      fetchImpl: async () => {
        writeAttempts += 1;
        return response(null, 500);
      },
    });
    await expect(writeClient.execute({
      operation: "topic.create",
      arguments: { title: "订单中心" },
      idempotencyKey: "idem-2",
      clientId: "pms-cli",
      requestId: "request-3",
    })).rejects.toBeInstanceOf(PmsClientError);
    expect(writeAttempts).toBe(1);
  });
});
