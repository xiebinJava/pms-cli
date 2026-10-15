import { describe, expect, it, vi } from "vitest";
import {
  executeProjectCreateScenario,
  planProjectCreateScenario,
} from "../../apps/pms-cli/src/commands/scenarios/projectCreate.js";
import {
  executeRequirementAnalysisScenario,
  planRequirementAnalysisScenario,
} from "../../apps/pms-cli/src/commands/scenarios/requirementAnalysis.js";
import type { PmsClient } from "../../packages/pms-client/src/index.js";

const catalog = {
  version: "ai-v1",
  features: { resourceGet: true, richWorkflowContext: true },
  resources: [
    {
      type: "project",
      actions: [{
        name: "project.create",
        label: "创建项目",
        description: "创建项目",
        mode: "automatic",
        risk: "medium",
        scopes: ["pms:project:write"],
        inputSchema: { name: { type: "string", label: "项目名称", required: true } },
        requiresContext: false,
        refreshScopes: ["project-list"],
      }],
    },
    {
      type: "requirement",
      actions: [{
        name: "requirement.analysis.save",
        label: "保存需求分析",
        description: "追加需求分析成果",
        mode: "automatic",
        risk: "medium",
        scopes: ["pms:requirement:write"],
        inputSchema: {
          requirementId: { type: "integer", label: "需求 ID", required: true },
          nodeId: { type: "integer", label: "节点 ID", required: true },
          version: { type: "integer", label: "版本", required: true },
          patch: { type: "object", label: "分析成果", required: true },
        },
        requiresContext: true,
        refreshScopes: ["requirement-detail"],
      }],
    },
  ],
  scopes: ["pms:project:write", "pms:requirement:write"],
  workflowTypes: [{
    projectTypeId: 3,
    processType: "PROJECT",
    label: "项目管理",
    templates: [{
      templateVersionId: 12,
      versionNo: 2,
      name: "项目流程",
      defaultTemplate: true,
      nodes: [{ id: 101, key: "start", label: "开始", position: 0, components: [] }],
    }],
  }],
};

function fakeClient(options: { advanceRequirementVersionOnExecute?: boolean } = {}) {
  const calls: string[] = [];
  let contextReads = 0;
  let requirementContextVersion = 7;
  const client = {
    capabilities: vi.fn(async () => catalog),
    preview: vi.fn(async (request: { operation: string; context?: { id: string; version: string } }) => {
      calls.push("preview:" + request.operation);
      return {
        operationId: "preview-1",
        command: request.operation,
        expiresAt: "2026-10-13T12:00:00Z",
        contextVersion: "7",
        warnings: [],
        changes: [{ action: "create", entity: request.operation }],
        refreshScopes: ["project-list"],
      };
    }),
    execute: vi.fn(async (request: { operation: string }) => {
      calls.push("execute:" + request.operation);
      if (request.operation === "requirement.analysis.save" && options.advanceRequirementVersionOnExecute) {
        requirementContextVersion = 8;
      }
      return {
        operationId: request.operation === "project.create" ? "operation-project-1" : "operation-analysis-1",
        status: "SUCCEEDED",
        data: request.operation === "project.create"
          ? { project: { id: 42, version: 9 }, workflow: { templateVersionId: 12, templateVersionNo: 2, nodeIds: [101] } }
          : { requirementId: 23, nodeId: 301, version: 8 },
        warnings: [],
        refreshScopes: ["project-list"],
        auditId: "audit-1",
      };
    }),
    executePreview: vi.fn(async (operationId: string) => {
      calls.push("execute-preview:" + operationId);
      return {
        operationId: "operation-analysis-1",
        status: "SUCCEEDED",
        data: { requirementId: 23, nodeId: 301, version: 8 },
        warnings: [],
        refreshScopes: ["requirement-detail"],
        auditId: "audit-1",
      };
    }),
    get: vi.fn(async (resource: { type: string; id: number }) => {
      calls.push("get:" + resource.type + ":" + resource.id);
      if (resource.type === "project") {
        return {
          resourceType: "project",
          resourceId: 42,
          entityVersion: 9,
          details: { id: 42, name: "AI Native PMS", workflowTemplateVersionId: 12 },
        };
      }
      return {
        resourceType: "requirement",
        resourceId: 23,
        entityVersion: contextReads > 1 ? 8 : 7,
        details: {
          id: 23,
          title: "报表导出",
          background: "原始背景",
          systemId: 9,
          status: "IN_PROGRESS",
        },
      };
    }),
    context: vi.fn(async (resource: { type: string; id: number }) => {
      calls.push("context:" + resource.type + ":" + resource.id);
      if (resource.type === "project") {
        return {
          resource: { type: "project", id: 42 },
          version: 9,
          workflow: { templateVersionId: 12, templateVersionNo: 2, nodes: [{ id: 101, key: "start" }] },
          allowedActions: ["project.create"],
        };
      }
      contextReads += 1;
      return {
        resource: { type: "requirement", id: 23 },
        version: requirementContextVersion,
        resourceDetails: { title: "报表导出" },
        currentNode: { id: 301, key: "clarification", label: "需求澄清" },
        workflow: { templateVersionId: 88, templateVersionNo: 3, nodes: [{ id: 301, key: "clarification" }] },
        allowedActions: ["requirement.analysis.save"],
      };
    }),
  } as unknown as PmsClient;
  return { client, calls, execute: (client as unknown as { execute: ReturnType<typeof vi.fn> }).execute };
}

describe("AI lifecycle scenarios", () => {
  it("plans project creation from live capabilities without writing", async () => {
    const { client, calls, execute } = fakeClient();
    const plan = await planProjectCreateScenario(client, {
      arguments: { name: "AI Native PMS", projectTypeId: 3, workflowTemplateVersionId: 12 },
      requestId: "req-project-plan",
    });

    expect(calls).toEqual(["preview:project.create"]);
    expect(execute).not.toHaveBeenCalled();
    expect(plan.capabilitiesSummary.workflowTypes[0].templates[0].templateVersionId).toBe(12);
    expect(plan.preview.operationId).toBe("preview-1");
    expect(plan.trace.requestId).toBe("req-project-plan");
    expect((client as unknown as { preview: ReturnType<typeof vi.fn> }).preview.mock.calls[0][0].context).toEqual({
      id: "global:pms",
      version: "v1",
    });
  });

  it("executes project creation and returns exact detail/context readback", async () => {
    const { client, calls } = fakeClient();
    const scenario = await executeProjectCreateScenario(client, {
      arguments: { name: "AI Native PMS", workflowTemplateVersionId: 12 },
      idempotencyKey: "project-create-1",
      requestId: "req-project-execute",
    });

    expect(calls).toEqual([
      "preview:project.create",
      "execute:project.create",
      "get:project:42",
      "context:project:42",
    ]);
    expect(scenario.result.operationId).toBe("operation-project-1");
    expect(scenario.trace.auditId).toBe("audit-1");
    expect(scenario.trace.operationId).toBe("operation-project-1");
    expect(scenario.readback.resource?.resourceId).toBe(42);
    expect(scenario.readback.context?.workflow?.templateVersionId).toBe(12);
  });

  it("plans requirement analysis with live node/context facts", async () => {
    const { client, calls } = fakeClient();
    const plan = await planRequirementAnalysisScenario(client, 23, {
      nodeId: 301,
      version: 7,
      arguments: { background: "补充用户场景" },
      requestId: "req-analysis-plan",
    });

    expect(calls).toEqual([
      "get:requirement:23",
      "context:requirement:23",
      "preview:requirement.analysis.save",
    ]);
    expect(plan.facts.currentNode.id).toBe(301);
    expect(plan.facts.workflow.templateVersionId).toBe(88);
    expect(plan.declaredFields).toContain("patch");
    expect(plan.inferences).toEqual([]);
    expect(plan.assumptions).toEqual([]);
  });

  it("rechecks requirement context before saving and reads the saved result back", async () => {
    const { client, calls } = fakeClient();
    const scenario = await executeRequirementAnalysisScenario(client, 23, {
      nodeId: 301,
      version: 7,
      arguments: { background: "补充用户场景", acceptanceCriteria: "支持导出" },
      idempotencyKey: "analysis-save-23-7",
      previewOperationId: "preview-1",
      requestId: "req-analysis-execute",
    });

    expect(calls).toEqual([
      "get:requirement:23",
      "context:requirement:23",
      "execute-preview:preview-1",
      "get:requirement:23",
      "context:requirement:23",
    ]);
    expect(scenario.result.status).toBe("SUCCEEDED");
    expect(scenario.trace.operationId).toBe("operation-analysis-1");
    expect(scenario.trace.auditId).toBe("audit-1");
    expect(scenario.readback.resource?.details.systemId).toBe(9);
    expect(scenario.protectedFieldsUnchanged.systemId).toBe(true);
  });

  it("replays the same idempotent analysis request after the node version advances", async () => {
    const { client } = fakeClient({ advanceRequirementVersionOnExecute: true });
    const options = {
      nodeId: 301,
      version: 7,
      arguments: { background: "同一请求重放" },
      idempotencyKey: "analysis-save-replay",
      previewOperationId: "preview-1",
    } as const;

    const first = await executeRequirementAnalysisScenario(client, 23, options);
    const replay = await executeRequirementAnalysisScenario(client, 23, options);

    expect(first.result.status).toBe("SUCCEEDED");
    expect(replay.result.status).toBe("SUCCEEDED");
    expect(replay.result.operationId).toBe(first.result.operationId);
  });

  it("rejects a stale or different current node before executing", async () => {
    const { client, execute } = fakeClient();
    await expect(executeRequirementAnalysisScenario(client, 23, {
      nodeId: 999,
      version: 7,
      arguments: { background: "不能保存" },
      idempotencyKey: "analysis-save-invalid",
      previewOperationId: "preview-1",
    })).rejects.toThrow("当前节点");
    expect(execute).not.toHaveBeenCalled();
  });
});
