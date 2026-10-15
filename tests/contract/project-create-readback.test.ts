import { describe, expect, it } from "vitest";
import { createProjectWithAutomaticWrite } from "../../apps/pms-cli/src/commands/shortcuts/project.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";

const envelope = (data: unknown) => new Response(JSON.stringify({ code: 200, data }), { status: 200 });

describe("project creation protocol readback", () => {
  it("round-trips the workflow snapshot without changing the project entity version", async () => {
    const client = new PmsHttpClient({
      baseUrl: "http://localhost:8080/api",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/capabilities")) {
          return envelope({
            version: "ai-v1",
            features: { resourceGet: true },
            resources: [{
              type: "project",
              actions: [{
                name: "project.create",
                label: "创建项目",
                description: "创建项目",
                mode: "automatic",
                risk: "medium",
                scopes: [],
                inputSchema: {},
                requiresContext: false,
                refreshScopes: [],
              }],
            }],
            scopes: [],
            workflowTypes: [],
          });
        }
        if (path.endsWith("/operations/preview")) {
          return envelope({
            operationId: "preview-1",
            command: "project.create",
            expiresAt: "2026-10-10T00:00:00Z",
            contextVersion: "1",
            warnings: [],
            changes: [],
            refreshScopes: [],
          });
        }
        if (path.endsWith("/operations/execute")) {
          return envelope({
            operationId: "operation-1",
            status: "SUCCEEDED",
            data: {
              project: { id: 42, version: 9 },
              workflow: { templateVersionId: 42, templateVersionNo: 2, nodeIds: [101, 102] },
            },
            refreshScopes: [],
          });
        }
        if (path.endsWith("/resources/project/42")) {
          return envelope({
            resourceType: "project",
            resourceId: 42,
            entityVersion: 9,
            details: { id: 42, workflowTemplateVersionId: 42 },
          });
        }
        if (path.endsWith("/context/project/42")) {
          return envelope({
            resourceType: "project",
            resourceId: 42,
            version: 9,
            resourceDetails: { id: 42 },
            workflow: { templateVersionId: 42, templateVersionNo: 2, nodes: [{ id: 101 }, { id: 102 }] },
            allowedActions: [],
          });
        }
        throw new Error("unexpected request " + path);
      },
    });

    const readback = await createProjectWithAutomaticWrite(client, {
      arguments: { name: "订单中心" },
      idempotencyKey: "project-create-1",
    });

    expect(readback.result.data.project).toEqual({ id: 42, version: 9 });
    expect(readback.result.data.workflow).toEqual({
      templateVersionId: 42,
      templateVersionNo: 2,
      nodeIds: [101, 102],
    });
    expect(readback.context?.workflow).toMatchObject({ templateVersionId: 42, templateVersionNo: 2 });
  });
});
