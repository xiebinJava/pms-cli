import { describe, expect, it } from "vitest";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import { OutputWriter } from "../../apps/pms-cli/src/output/OutputWriter.js";

describe("PMS CLI client protocol", () => {
  it("reads an exact resource without falling back to a list query", async () => {
    const requests: string[] = [];
    const client = new PmsHttpClient({
      baseUrl: "http://localhost:8080/api",
      auth: new StaticTokenProvider("short-token"),
      clientId: "pms-cli",
      fetchImpl: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({
          code: 200,
          data: {
            resourceType: "topic",
            resourceId: 19,
            entityVersion: null,
            details: { title: "订单专题", storyCount: 2 },
          },
        }), { status: 200 });
      },
    });

    const result = await client.get({ type: "topic", id: 19 });

    expect(result.details).toMatchObject({ title: "订单专题", storyCount: 2 });
    expect(requests).toEqual(["http://localhost:8080/api/integration/ai/v1/resources/topic/19"]);
  });

  it("preserves resource details and workflow metadata from context", async () => {
    const client = new PmsHttpClient({
      baseUrl: "http://localhost:8080/api",
      auth: new StaticTokenProvider("short-token"),
      clientId: "pms-cli",
      fetchImpl: async () => new Response(JSON.stringify({
        code: 200,
        data: {
          resourceType: "project",
          resourceId: 7,
          version: 9,
          resourceDetails: { ownerId: 3, projectLevel: 2 },
          currentNode: null,
          workflow: { templateVersionId: 12, templateVersionNo: 4, nodes: [] },
          relations: [{ resourceType: "topic", resourceId: 19, label: "专题", readable: true }],
          allowedActions: [],
        },
      }), { status: 200 }),
    });

    const context = await client.context({ type: "project", id: 7 });

    expect(context.resourceDetails).toEqual({ ownerId: 3, projectLevel: 2 });
    expect(context.workflow?.templateVersionId).toBe(12);
    expect(context.workflow?.templateVersionNo).toBe(4);
    expect(context.relations).toEqual([{ resourceType: "topic", resourceId: 19, label: "专题", readable: true }]);
  });

  it("uses the read-only preview facade before a write", async () => {
    let requestUrl = "";
    const client = new PmsHttpClient({
      baseUrl: "http://localhost:8080/api",
      auth: new StaticTokenProvider("short-token"),
      clientId: "pms-cli",
      fetchImpl: async (input) => {
        requestUrl = String(input);
        return new Response(JSON.stringify({
          code: 200,
          data: {
            operationId: "preview-1",
            command: "project.create",
            expiresAt: "2026-09-27T15:00:00Z",
            contextVersion: "v1",
            warnings: [],
            changes: [],
            refreshScopes: [],
          },
        }), { status: 200 });
      },
    });

    const preview = await client.preview({
      operation: "project.create",
      arguments: { name: "订单中心" },
      idempotencyKey: "preview-idem",
      clientId: "pms-cli",
      requestId: "preview-req",
    });

    expect(requestUrl).toContain("/integration/ai/v1/operations/preview");
    expect(preview.operationId).toBe("preview-1");
  });

  it("sends pms-cli and idempotency headers for writes", async () => {
    let captured: RequestInit | undefined;
    const client = new PmsHttpClient({
      baseUrl: "http://localhost:8080/api",
      auth: new StaticTokenProvider("short-token"),
      clientId: "pms-cli",
      fetchImpl: async (_input, init) => {
        captured = init;
        return new Response(JSON.stringify({
          code: 200,
          data: { operationId: "op-1", status: "SUCCEEDED", data: {}, refreshScopes: [] },
        }), { status: 200 });
      },
    });

    await client.execute({
      operation: "project.create",
      arguments: { name: "订单中心" },
      idempotencyKey: "idem-1",
      clientId: "pms-cli",
      requestId: "req-1",
    });

    const headers = new Headers(captured?.headers);
    expect(headers.get("client-id")).toBe("pms-cli");
    expect(headers.get("x-client-id")).toBe("pms-cli");
    expect(headers.get("idempotency-key")).toBe("idem-1");
  });

  it("writes successful JSON to stdout and failures to stderr", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let exitCode = 0;
    const writer = new OutputWriter(
      (value) => stdout.push(value),
      (value) => stderr.push(value),
      (value) => { exitCode = value; },
    );

    writer.success({ projects: [] }, { requestId: "req-1" });
    writer.failure({ code: "FORBIDDEN", message: "无权执行", requestId: "req-2" });

    expect(JSON.parse(stdout[0]).ok).toBe(true);
    expect(JSON.parse(stderr[0]).ok).toBe(false);
    expect(exitCode).toBe(1);
  });
});
