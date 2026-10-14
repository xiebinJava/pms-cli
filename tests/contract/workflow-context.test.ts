import { describe, expect, it } from "vitest";
import {
  PmsClientError,
  PmsHttpClient,
  StaticTokenProvider,
} from "../../packages/pms-client/src/index.js";
import {
  workflowContextMetaSchema,
  type ContextReadOptions,
} from "../../packages/pms-contracts/src/index.js";

const response = (data: unknown, code = 200, status = 200, msg = "操作成功") =>
  new Response(JSON.stringify({ code, msg, data, requestId: "server-request" }), {
    status,
    headers: { "content-type": "application/json" },
  });

const interactiveMeta = workflowContextMetaSchema.parse({
  formatVersion: 2,
  pureRead: true,
  loadedAt: "2026-10-14T08:00:00Z",
  businessTimezone: "Asia/Shanghai",
  view: "focused",
  fieldValuesScope: "selected-node",
  componentContentScope: "selected-component",
  selectedNodeId: 299,
  selectedComponentKey: "solution-design",
  workflowConfigured: true,
  workflowStatus: "IN_PROGRESS",
  terminalStatus: null,
  workflowInstanceVersion: 5,
  permissionsScope: "business-user",
  referencesScope: "readable-only",
  warnings: [],
});

const interactiveNode = {
  id: 299,
  key: "design",
  label: "方案设计",
  position: 1,
  status: 1,
  components: [
    {
      key: "solution-design",
      label: "solution-design",
      fields: [],
      actions: [],
      contentState: "LOADED",
      versions: { content: 0 },
    },
  ],
  fields: [],
  fieldValues: { "design.summary": "方案写入完成" } as unknown,
  version: 2,
  fieldValuesState: "LOADED",
  taskSummary: { total: 3, done: 1, incomplete: 2 },
};

const interactivePayload = {
  resourceType: "project",
  resourceId: 7,
  version: 9,
  entityVersion: 9,
  currentNode: { id: 299, key: "design", label: "方案设计" },
  workflow: { templateVersionId: 88, templateVersionNo: 4, nodes: [interactiveNode] },
  meta: interactiveMeta,
  allowedActions: [],
};

const legacyNodePayload = {
  resourceType: "project",
  resourceId: 88,
  version: 0,
  currentNode: null,
  workflow: {
    templateVersionId: 12,
    templateVersionNo: 1,
    // 旧服务端可能返回任意节点数组（unknown[]），legacy schema 必须继续接受。
    nodes: [
      { whatever: "n/a" },
      {
        id: null,
        key: "kickoff",
        label: "启动",
        position: 0,
        status: 1,
        components: [],
        fields: [],
        fieldValues: {},
      },
    ],
  },
  allowedActions: [],
};

const clientFor = (data: Promise<Response>) =>
  new PmsHttpClient({
    baseUrl: "https://pms.example.test/api",
    auth: new StaticTokenProvider("token"),
    clientId: "pms-cli",
    requestIdFactory: () => "request-1",
    fetchImpl: () => data,
  });

describe("workflow context contract", () => {
  it("maps explicit context options onto the HTTP URL and verifies the receipt", async () => {
    let requestUrl: string | undefined;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test/api",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      requestIdFactory: () => "request-1",
      fetchImpl: async (input) => {
        requestUrl = String(input);
        return response(interactivePayload);
      },
    });
    const options: ContextReadOptions = {
      nodeId: 299,
      view: "focused",
      component: "solution-design",
    };

    const context = await client.context({ type: "project", id: 7 }, options);

    expect(requestUrl).toBe(
      "https://pms.example.test/api/integration/ai/v1/context/project/7?nodeId=299&view=focused&componentKey=solution-design",
    );
    expect(context.meta?.selectedNodeId).toBe(299);
    expect(context.meta?.selectedComponentKey).toBe("solution-design");
    expect(context.meta?.view).toBe("focused");
    expect(context.meta?.formatVersion).toBe(2);
    const contractNode = context.workflow?.nodes[0] as {
      taskSummary?: unknown;
      fieldValuesState?: unknown;
    };
    expect(contractNode.taskSummary).toEqual({ total: 3, done: 1, incomplete: 2 });
    expect(contractNode.fieldValuesState).toBe("LOADED");
  });

  it("rejects type mismatches before any retry", async () => {
    const client = clientFor(Promise.resolve(response({
      ...interactivePayload,
      resourceId: 99,
    })));

    await expect(client.context({ type: "project", id: 7 })).rejects.toMatchObject({
      kind: "validation",
    });
  });

  it("rejects explicit options when the server ignores them (no meta)", async () => {
    const { meta: _ignored, ...noMetaPayload } = interactivePayload;
    const client = clientFor(Promise.resolve(response(noMetaPayload)));

    await expect(
      client.context({ type: "project", id: 7 }, { nodeId: 299 }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("rejects a receipt whose selected node differs from the request", async () => {
    const client = clientFor(Promise.resolve(response({
      ...interactivePayload,
      meta: { ...interactiveMeta, selectedNodeId: 999 },
    })));

    await expect(
      client.context({ type: "project", id: 7 }, { view: "focused", nodeId: 299 }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("rejects a receipt whose component differs from the request", async () => {
    const client = clientFor(Promise.resolve(response({
      ...interactivePayload,
      meta: { ...interactiveMeta, selectedComponentKey: "requirement-scope" },
    })));

    await expect(
      client.context(
        { type: "project", id: 7 },
        { view: "focused", nodeId: 299, component: "solution-design" },
      ),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("keeps the legacy contract for old servers without meta", async () => {
    const client = clientFor(Promise.resolve(response(legacyNodePayload)));

    const context = await client.context({ type: "project", id: 88 });

    expect(context.version).toBe(0);
    expect(context.meta).toBeUndefined();
    expect((context.workflow?.nodes[1] as { fieldValues?: unknown }).fieldValues ?? {}).toEqual({});
    expect(context.workflow?.nodes[0]).toEqual({ whatever: "n/a" });
  });

  it("rejects illegal options before authentication and network", async () => {
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test/api",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async () => {
        throw new Error("network should not happen");
      },
    });

    await expect(
      client.context({ type: "project", id: 7 },
        { nodeId: Number.MAX_SAFE_INTEGER + 1, view: "legacy" }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.context({ type: "project", id: 7 }, { view: "bold" as "legacy" | "focused" }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.context({ type: "project", id: 7 }, { view: "legacy", component: "x" }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("rejects unknown format version instead of guessing", async () => {
    const client = clientFor(Promise.resolve(response({
      ...interactivePayload,
      meta: { ...interactiveMeta, formatVersion: 3 },
    })));

    await expect(client.context({ type: "project", id: 7 })).rejects.toMatchObject({
      kind: "validation",
    });
  });
});
