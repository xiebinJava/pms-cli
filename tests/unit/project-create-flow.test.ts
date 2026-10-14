import { describe, expect, it } from "vitest";
import { createProjectWithReadback } from "../../apps/pms-cli/src/commands/shortcuts/project.js";

const catalog = {
  version: "ai-v1",
  features: { resourceGet: true, richWorkflowContext: true },
  resources: [{
    type: "project",
    actions: [{
      name: "project.create",
      label: "创建项目",
      description: "创建项目",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:project:write"],
      inputSchema: {},
      requiresContext: false,
      refreshScopes: ["project-list"],
    }],
  }],
  scopes: ["pms:project:write"],
  workflowTypes: [],
};

describe("project creation readback", () => {
  it("previews, executes, and reads back the exact created project", async () => {
    const calls: string[] = [];
    const client = {
      capabilities: async () => catalog,
      preview: async (request: { context?: { id: string; version: string } }) => {
        calls.push("preview");
        expect(request.context).toEqual({ id: "global:pms", version: "v1" });
        return {
          operationId: "preview-1",
          command: "project.create",
          expiresAt: "2026-10-10T00:00:00Z",
          contextVersion: "1",
          warnings: [],
          changes: [],
          refreshScopes: [],
        };
      },
      execute: async () => {
        calls.push("execute");
        return {
          operationId: "operation-1",
          status: "SUCCEEDED",
          data: { project: { id: 42, version: 9 }, workflow: { templateVersionId: 12, templateVersionNo: 2, nodeIds: [101] } },
          warnings: [],
          refreshScopes: [],
        };
      },
      get: async (resource: { type: string; id: number }) => {
        calls.push("get:" + resource.id);
        return {
          resourceType: "project",
          resourceId: resource.id,
          entityVersion: 9,
          details: { id: 42, name: "订单中心", workflowTemplateVersionId: 12 },
        };
      },
      context: async (resource: { type: string; id: number }) => {
        calls.push("context:" + resource.id);
        return {
          resource: resource as never,
          version: 9,
          resourceDetails: { id: 42 },
          workflow: { templateVersionId: 12, templateVersionNo: 2, nodes: [] },
          allowedActions: [],
        };
      },
    } as never;

    const readback = await createProjectWithReadback(client, {
      arguments: { name: "订单中心", workflowTemplateVersionId: 12 },
      idempotencyKey: "project-create-1",
    });

    expect(calls).toEqual(["preview", "execute", "get:42", "context:42"]);
    expect(readback.result.data.project).toEqual({ id: 42, version: 9 });
    expect(readback.result.data.workflow).toEqual({ templateVersionId: 12, templateVersionNo: 2, nodeIds: [101] });
    expect(readback.resource?.details).toMatchObject({ id: 42, workflowTemplateVersionId: 12 });
    expect(readback.context?.workflow?.templateVersionNo).toBe(2);
    expect(readback.warnings).toEqual([]);
  });

  it("keeps a successful create result when exact readback fails", async () => {
    const client = {
      capabilities: async () => catalog,
      preview: async () => ({
        operationId: "preview-1",
        command: "project.create",
        expiresAt: "2026-10-10T00:00:00Z",
        contextVersion: "1",
        warnings: [],
        changes: [],
        refreshScopes: [],
      }),
      execute: async () => ({
        operationId: "operation-2",
        status: "SUCCEEDED",
        data: { project: { id: 43, version: 9 }, workflow: { templateVersionId: null, templateVersionNo: null, nodeIds: [] } },
        warnings: [],
        refreshScopes: [],
      }),
      get: async () => { throw new Error("read timeout"); },
      context: async () => { throw new Error("should not be called"); },
    } as never;

    const readback = await createProjectWithReadback(client, {
      arguments: { name: "回读失败项目" },
      idempotencyKey: "project-create-2",
    });

    expect(readback.result.operationId).toBe("operation-2");
    expect(readback.result.status).toBe("SUCCEEDED");
    expect(readback.result.data.workflow).toEqual({ templateVersionId: null, templateVersionNo: null, nodeIds: [] });
    expect(readback.resource).toBeNull();
    expect(readback.context).toBeNull();
    expect(readback.warnings[0]).toContain("回读失败");
  });
});
