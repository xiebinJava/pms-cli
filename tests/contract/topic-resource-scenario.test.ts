import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import {
  resourceScenarioContractVersion,
  type ResourceScenarioSnapshot,
  type WorkflowContext,
} from "../../packages/pms-contracts/src/index.js";
import {
  createResourceScenarioRegistry,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioRegistry.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.js";
import { topicScenarioAdapter } from "../../apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.js";

const topicDetail = {
  resourceType: "topic" as const,
  resourceId: 12,
  entityVersion: null,
  details: {
    id: 12,
    title: "研发流程专题",
    projectId: 9,
    projectName: "PMS 项目",
    status: "IN_PROGRESS",
  },
};

function projectContext(status: string | number = "ACTIVE"): WorkflowContext {
  return {
    resource: { type: "project", id: 9 },
    version: 5,
    entityVersion: 5,
    resourceDetails: { status },
    currentNode: { id: 201, key: "develop", label: "研发" },
    workflow: { nodes: [{ id: 201, key: "develop", label: "研发" }] },
    relations: [],
    allowedActions: [],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-16T00:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "legacy",
      fieldValuesScope: "all-nodes",
      componentContentScope: "selected-node",
      workflowConfigured: true,
      workflowStatus: status === "ACTIVE" || status === 1 ? "ACTIVE" : String(status),
      terminalStatus: status === "ACTIVE" || status === 1 ? null : String(status),
      permissionsScope: "business-user",
      referencesScope: "readable-only",
      warnings: [],
    },
  };
}

function topicContext(options: {
  version?: number;
  projectId?: number | null;
  currentNodeId?: number;
  withSaveContract?: boolean;
} = {}): WorkflowContext {
  const version = options.version ?? 4;
  const projectId = options.projectId === undefined ? 9 : options.projectId;
  const currentNodeId = options.currentNodeId ?? 301;
  const component = {
    key: "topic-research",
    label: "专题调研",
    content: { needed: "YES", goal: "完成竞品调研" },
    contentState: "LOADED" as const,
    ...(options.withSaveContract === false ? {} : {
      saveContract: {
        command: "development-item.node.field.update",
        itemType: "TOPIC",
        itemId: 12,
        nodeId: currentNodeId,
        version,
        componentKey: "topic-research",
        fieldValuesPath: "__components.topic-research",
        sourceProjectNodeKey: "develop",
        writableFields: ["needed", "goal", "reportUrl", "skipReason"],
        protectedFields: ["status"],
      },
    }),
  };
  return {
    resource: { type: "topic", id: 12 },
    version,
    entityVersion: null,
    resourceDetails: { projectId, sourceProjectNodeKey: "develop" },
    currentNode: { id: currentNodeId, key: "research", label: "调研" },
    workflow: {
      templateVersionId: 77,
      templateVersionNo: 2,
      nodes: [{ id: currentNodeId, key: "research", label: "调研", version, components: [component] }],
    },
    relations: projectId === null ? [] : [{ resourceType: "project", resourceId: projectId, label: "所属项目", readable: true }],
    allowedActions: ["topic.update", "topic.project.link", "development-item.node.field.update"],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-16T00:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused",
      fieldValuesScope: "selected-node",
      componentContentScope: "selected-component",
      selectedNodeId: currentNodeId,
      selectedComponentKey: "topic-research",
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
  scopes: ["pms:development:write"],
  inputSchema,
  requiresContext: name !== "topic.create",
  refreshScopes: ["topic-detail", "project-detail"],
});

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "topic" as const,
    actions: [
      action("topic.create", {
        title: { type: "string", label: "标题", required: true },
        ownerId: { type: "integer", label: "负责人", required: false },
        projectId: { type: "integer", label: "项目", required: false },
        templateVersionId: { type: "integer", label: "流程模板", required: false },
      }),
      action("topic.update", {
        topicId: { type: "integer", label: "专题 ID", required: true },
        title: { type: "string", label: "标题", required: true },
        ownerId: { type: "integer", label: "负责人", required: false },
        projectId: { type: "integer", label: "项目", required: false },
      }),
      action("topic.project.link", {
        topicId: { type: "integer", label: "专题 ID", required: true },
        projectId: { type: "integer", label: "项目", required: false },
      }),
      action("development-item.node.field.update", {
        itemType: { type: "string", label: "类型", required: true },
        itemId: { type: "integer", label: "专题 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        fieldValues: { type: "object", label: "字段", required: true },
        version: { type: "integer", label: "节点版本", required: true },
      }),
    ],
  }],
  scopes: ["pms:development:write"],
  workflowTypes: [],
};

function fakeClient(options: {
  topic?: WorkflowContext;
  project?: WorkflowContext;
  afterTopic?: WorkflowContext;
  readbackFails?: boolean;
} = {}) {
  const topic = options.topic ?? topicContext();
  const afterTopic = options.afterTopic ?? topicContext({ version: 5 });
  const calls: Array<{ resource: unknown; options?: unknown }> = [];
  let getCalls = 0;
  const client = {
    capabilities: vi.fn(async () => catalog),
    context: vi.fn(async (resource: { type: string; id: number }, contextOptions?: unknown) => {
      calls.push({ resource, options: contextOptions });
      if (options.readbackFails && contextOptions === undefined && calls.length > 3) throw new Error("context unavailable");
      if (resource.type === "project") return options.project ?? projectContext();
      return contextOptions ? topic : afterTopic;
    }),
    get: vi.fn(async () => {
      getCalls += 1;
      if (options.readbackFails && getCalls > 1) throw new Error("topic detail unavailable");
      return topicDetail;
    }),
    preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown>; context?: { id: string; version: string } }) => ({
      operationId: `preview-${request.operation}`,
      command: request.operation,
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: request.context?.version ?? "v1",
      warnings: [],
      changes: [{ arguments: request.arguments }],
      refreshScopes: ["topic-detail", "project-detail"],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-topic-1",
      status: "SUCCEEDED" as const,
      data: { topicId: 12 },
      warnings: [],
      refreshScopes: ["topic-detail", "project-detail"],
    })),
    execute: vi.fn(),
    calls,
  } as unknown as PmsClient;
  return client;
}

describe("topic resource scenario contract", () => {
  it("plans topic creation against global context and verifies the created topic by operation data", async () => {
    const client = fakeClient();
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      operation: "topic.create",
      arguments: { title: "AI 协作专题" },
    }, createResourceScenarioRegistry([topicScenarioAdapter]));

    expect(plan.context).toBeNull();
    expect(plan.preview.contextVersion).toBe("v1");
    expect(client.context).not.toHaveBeenCalled();

    const result = await executeResourceScenario(client, {
      resourceType: "topic",
      operation: "topic.create",
      previewOperationId: plan.preview.operationId,
      idempotencyKey: "topic-create-1",
    }, createResourceScenarioRegistry([topicScenarioAdapter]));
    expect(result.resourceId).toBe(12);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.verification.patchApplied).toBe(true);
  });

  it("reads the current topic and target project before update or project link", async () => {
    const client = fakeClient();
    const registry = createResourceScenarioRegistry([topicScenarioAdapter]);
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.project.link",
      arguments: { projectId: 9 },
    }, registry);

    expect(plan.normalizedArguments).toEqual({ topicId: 12, projectId: 9 });
    expect(client.context).toHaveBeenNthCalledWith(1, { type: "topic", id: 12 }, undefined);
    expect(client.context).toHaveBeenNthCalledWith(2, { type: "project", id: 9 });
  });

  it("rejects unreadable, completed, and terminated target projects before preview", async () => {
    const registry = createResourceScenarioRegistry([topicScenarioAdapter]);
    const completed = fakeClient({ project: projectContext("COMPLETED") });
    await expect(planResourceScenario(completed, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.project.link",
      arguments: { projectId: 9 },
    }, registry)).rejects.toThrow(/进行中|完成|终止/);
    expect(completed.preview).not.toHaveBeenCalled();

    const unreadable = fakeClient({ project: undefined });
    unreadable.context = vi.fn(async (resource: { type: string; id: number }) => {
      if (resource.type === "project") throw new Error("project forbidden");
      return topicContext();
    }) as never;
    await expect(planResourceScenario(unreadable, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.project.link",
      arguments: { projectId: 9 },
    }, registry)).rejects.toThrow(/project forbidden/);
    expect(unreadable.preview).not.toHaveBeenCalled();
  });

  it("uses the persisted topic saveContract and source project node key for node fields", async () => {
    const client = fakeClient();
    const registry = createResourceScenarioRegistry([topicScenarioAdapter]);
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "development-item.node.field.update",
      nodeId: 301,
      contextVersion: "4",
      draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { goal: "完成竞品调研" },
      },
    }, registry);

    expect(plan.normalizedArguments).toMatchObject({
      itemType: "TOPIC",
      itemId: 12,
      nodeId: 301,
      version: 4,
      fieldValues: { __components: { "topic-research": { goal: "完成竞品调研" } } },
    });

    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "development-item.node.field.update",
      nodeId: 301,
      contextVersion: "4",
      arguments: { fieldValues: { unknownField: "不能写" } },
    }, registry)).rejects.toThrow(/writableFields/);
    expect(client.preview).toHaveBeenCalledTimes(1);
  });

  it("marks a successful topic write unknown when topic detail or context readback fails", async () => {
    const result = await executeResourceScenario(fakeClient({ readbackFails: true }), {
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
      previewOperationId: "preview-topic.update",
      idempotencyKey: "topic-update-readback-unknown",
    }, createResourceScenarioRegistry([topicScenarioAdapter]));
    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
  });

  it("uses the workflow context projection when the topic readback omits protected fields", () => {
    const beforeContext = topicContext();
    beforeContext.resourceDetails = {
      ...beforeContext.resourceDetails,
      status: "IN_PROGRESS",
      deleted: false,
    };
    const afterContext = topicContext({ version: 5 });
    afterContext.resourceDetails = {
      ...beforeContext.resourceDetails,
    };
    const before: ResourceScenarioSnapshot = {
      resource: {
        ...topicDetail,
        details: {
          ...topicDetail.details,
          deleted: false,
        },
      },
      context: beforeContext,
    };
    const after: ResourceScenarioSnapshot = {
      resource: {
        ...topicDetail,
        details: {
          id: 12,
          title: "研发流程专题",
          projectId: 9,
          projectName: "PMS 项目",
          status: "IN_PROGRESS",
        },
      },
      context: afterContext,
    };

    const verification = topicScenarioAdapter.verifyReadback(
      before,
      after,
      { topicId: 12 },
      {
        operationId: "operation-topic-1",
        status: "SUCCEEDED",
        data: { topicId: 12 },
        warnings: [],
        refreshScopes: [],
      },
    );

    expect(verification.protectedFieldsUnchanged).toBe(true);
  });
});
