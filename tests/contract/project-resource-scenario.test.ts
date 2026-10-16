import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import {
  resourceScenarioContractVersion,
  type WorkflowContext,
} from "../../packages/pms-contracts/src/index.js";
import {
  createResourceScenarioRegistry,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioRegistry.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.js";
import { projectScenarioAdapter } from "../../apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.js";

const projectDetail = {
  resourceType: "project" as const,
  resourceId: 42,
  entityVersion: 9,
  details: { id: 42, name: "PMS 项目", status: "ACTIVE" },
};

function projectContext(options: {
  version?: number;
  selectedNodeId?: number;
  withSaveContract?: boolean;
} = {}): WorkflowContext {
  const version = options.version ?? 9;
  const selectedNodeId = options.selectedNodeId ?? 301;
  const component = {
    key: "solution-design",
    label: "方案设计",
    content: { solutionPackage: "现有方案" },
    contentState: "LOADED" as const,
    versions: { content: 3 },
    ...(options.withSaveContract === false ? {} : {
      saveContract: {
        command: "node.field.update",
        projectId: 42,
        nodeId: selectedNodeId,
        nodeVersion: 4,
        workbench: "solution-design",
        fieldValuesPath: "fields",
        workbenchVersion: 3,
        contractVersion: "project-node-workbench/v1",
        writableFields: ["solutionPackage", "architecture"],
        dynamicFields: false,
        protectedFields: ["projectId", "nodeId", "workbench", "status"],
      },
    }),
  };
  return {
    resource: { type: "project", id: 42 },
    version,
    entityVersion: version,
    resourceDetails: { status: "ACTIVE" },
    currentNode: { id: selectedNodeId, key: "design", label: "方案设计" },
    workflow: {
      templateVersionId: 88,
      templateVersionNo: 2,
      nodes: [{ id: selectedNodeId, key: "design", label: "方案设计", version: 4, components: [component] }],
    },
    relations: [],
    allowedActions: ["project.update", "node.field.update"],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-16T00:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused",
      fieldValuesScope: "selected-node",
      componentContentScope: "selected-component",
      workflowConfigured: true,
      workflowStatus: "ACTIVE",
      permissionsScope: "business-user",
      referencesScope: "readable-only",
      warnings: [],
    },
  };
}

const action = (name: string, inputSchema: Record<string, { type: string; label: string; required: boolean }>) => ({
  name,
  label: name,
  description: name,
  mode: "automatic" as const,
  risk: "high" as const,
  scopes: ["pms:project:write"],
  inputSchema,
  requiresContext: name !== "project.create",
  refreshScopes: ["project-detail"],
});

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "project" as const,
    actions: [
      action("project.create", { name: { type: "string", label: "名称", required: true } }),
      action("project.update", {
        projectId: { type: "integer", label: "项目 ID", required: true },
        name: { type: "string", label: "名称", required: false },
      }),
      action("node.field.update", {
        projectId: { type: "integer", label: "项目 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        workbench: { type: "string", label: "工作台", required: true },
        fields: { type: "object", label: "字段", required: true },
      }),
    ],
  }],
  scopes: ["pms:project:write"],
  workflowTypes: [],
};

function fakeClient(options: {
  context?: WorkflowContext;
  afterContext?: WorkflowContext;
  operationData?: Record<string, unknown>;
  readbackFails?: boolean;
} = {}) {
  const context = options.context ?? projectContext();
  const afterContext = options.afterContext ?? context;
  let getCalls = 0;
  const client = {
    capabilities: vi.fn(async () => catalog),
    context: vi.fn(async (_resource: { type: string; id: number }, contextOptions?: unknown) =>
      contextOptions ? context : afterContext),
    get: vi.fn(async () => {
      getCalls += 1;
      if (options.readbackFails && getCalls > 1) throw new Error("project detail unavailable");
      return projectDetail;
    }),
    preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown>; context?: { id: string; version: string } }) => ({
      operationId: `preview-${request.operation}`,
      command: request.operation,
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: request.context?.version ?? "v1",
      warnings: [],
      changes: [{ arguments: request.arguments }],
      refreshScopes: ["project-detail"],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-project-1",
      status: "SUCCEEDED" as const,
      data: options.operationData ?? { projectId: 42, document: { solutionPackage: "新方案" } },
      warnings: [],
      refreshScopes: ["project-detail"],
    })),
    execute: vi.fn(),
  } as unknown as PmsClient;
  return client;
}

describe("project resource scenario contract", () => {
  it("plans project creation against global context", async () => {
    const client = fakeClient();
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "project",
      operation: "project.create",
      arguments: { name: "AI 协作项目" },
    }, createResourceScenarioRegistry([projectScenarioAdapter]));

    expect(plan.context).toBeNull();
    expect(plan.preview.contextVersion).toBe("v1");
    expect(client.context).not.toHaveBeenCalled();
  });

  it("requires the live project entity version for updates", async () => {
    const client = fakeClient();
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "project",
      resourceId: 42,
      operation: "project.update",
      contextVersion: 9,
      arguments: { name: "新名称" },
    }, createResourceScenarioRegistry([projectScenarioAdapter]));

    expect(plan.context?.entityVersion).toBe(9);
    expect(plan.normalizedArguments).toEqual({ projectId: 42, name: "新名称" });
  });

  it("uses the focused project node saveContract for workbench fields", async () => {
    const client = fakeClient();
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "project",
      resourceId: 42,
      operation: "node.field.update",
      nodeId: 301,
      contextVersion: 9,
      arguments: { fields: { solutionPackage: "新方案" } },
    }, createResourceScenarioRegistry([projectScenarioAdapter]));

    expect(plan.normalizedArguments).toEqual({
      projectId: 42,
      nodeId: 301,
      workbench: "solution-design",
      fields: { solutionPackage: "新方案" },
    });
    expect(client.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "node.field.update",
      context: { id: "project:42", version: "9" },
    }));
  });

  it("rejects a field outside the persisted workbench contract before preview", async () => {
    const client = fakeClient();
    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "project",
      resourceId: 42,
      operation: "node.field.update",
      nodeId: 301,
      arguments: { fields: { guessedField: "不应写入" } },
    }, createResourceScenarioRegistry([projectScenarioAdapter]))).rejects.toThrow(/saveContract/);
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("reports unknown when project readback fails after a successful operation", async () => {
    const client = fakeClient({ readbackFails: true });
    const result = await executeResourceScenario(client, {
      resourceType: "project",
      resourceId: 42,
      operation: "project.update",
      previewOperationId: "preview-project.update",
      idempotencyKey: "project-update-1",
    }, createResourceScenarioRegistry([projectScenarioAdapter]));

    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(result.warnings.join(" ")).toMatch(/回读失败/);
  });
});
