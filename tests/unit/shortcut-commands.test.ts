import { describe, expect, it } from "vitest";
import { projectList, projectCreate } from "../../apps/pms-cli/src/commands/shortcuts/project.js";

describe("PMS resource shortcuts", () => {
  it("maps project list to the shared query facade", async () => {
    const calls: unknown[] = [];
    const client = {
      query: async (request: unknown) => { calls.push(request); return { resourceType: "project", items: [] }; },
    } as never;

    await projectList(client, { status: "1", page: 2 });

    expect(calls[0]).toMatchObject({ resourceType: "project", page: 2, filters: { status: "1" } });
  });

  it("maps dry-run and execute to preview/execute without duplicating business logic", async () => {
    const calls: string[] = [];
    const client = {
      capabilities: async () => ({
        version: "v1", scopes: [], workflowTypes: [],
        resources: [{ type: "project", actions: [{
          name: "project.create", label: "创建项目", description: "创建项目", mode: "automatic", risk: "medium",
          scopes: [], inputSchema: { name: { type: "string", label: "名称", required: true } },
          requiresContext: false, refreshScopes: [],
        }] }],
      }),
      preview: async () => { calls.push("preview"); return { operationId: "preview" }; },
      executePreview: async () => { calls.push("execute"); return { operationId: "execute" }; },
    } as never;

    await projectCreate(client, { arguments: { name: "订单中心" }, dryRun: true });
    await projectCreate(client, {
      arguments: { name: "订单中心" },
      idempotencyKey: "idem-1",
      previewOperationId: "preview-1",
    });

    expect(calls).toEqual(["preview", "execute"]);
  });
});
