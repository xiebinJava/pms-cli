import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
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
import { requirementScenarioAdapter } from "../../apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.js";

const requirementDetail = {
  resourceType: "requirement" as const,
  resourceId: 42,
  entityVersion: 8,
  details: {
    id: 42,
    title: "统一项目管理标准",
    status: "IN_PROGRESS",
    ownerId: 7,
  },
};

function makeContext(options: {
  version?: number;
  entityVersion?: number;
  focused?: boolean;
  patch?: Record<string, unknown>;
} = {}): WorkflowContext {
  const version = options.version ?? 3;
  const entityVersion = options.entityVersion ?? 8;
  const patch = options.patch ?? {};
  const node = {
    id: 101,
    key: "requirement-analysis",
    label: "需求分析",
    version,
    components: [{
      key: "requirement-node-form",
      label: "需求节点表单",
      content: { ...patch },
      saveContract: {
        command: "development-item.node.field.update",
        itemType: "REQUIREMENT",
        itemId: 42,
        nodeId: 101,
        version,
        componentKey: "requirement-node-form",
        fieldValuesPath: "__components.requirement-node-form",
        writableFields: ["acceptanceCriteria", "analysisNote"],
        protectedFields: ["status", "ownerId"],
      },
    }],
  };
  return {
    resource: { type: "requirement", id: 42 },
    version,
    entityVersion,
    resourceDetails: requirementDetail.details,
    currentNode: { id: 101, key: "requirement-analysis", label: "需求分析" },
    workflow: { nodes: [node] },
    relations: [{ resourceType: "project", resourceId: 9, label: "所属项目", readable: true }],
    allowedActions: [
      "requirement.update",
      "requirement.analysis.save",
      "requirement.execution-target.link",
      "requirement.execution-target.change",
      "requirement.execution-target.unlink",
      "development-item.node.field.update",
    ],
    ...(options.focused ? { meta: {
      formatVersion: 2 as const,
      pureRead: true as const,
      loadedAt: "2026-10-16T00:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused" as const,
      fieldValuesScope: "selected-node" as const,
      componentContentScope: "selected-component" as const,
      selectedNodeId: 101,
      selectedComponentKey: "requirement-node-form",
      workflowConfigured: true,
      workflowStatus: "IN_PROGRESS",
      permissionsScope: "requirement:42",
      referencesScope: "requirement:42",
      warnings: [],
    } } : {}),
  };
}

function makeDirectCompletionContext(): WorkflowContext {
  const context = makeContext();
  return {
    ...context,
    workflow: {
      nodes: [{
        id: 101,
        key: "requirement-release",
        label: "需求上线",
        version: 3,
        components: [],
        fields: [],
        completionContract: {
          contractVersion: "node-completion/v1",
          command: "development-item.node.complete",
          itemType: "REQUIREMENT",
          itemId: 42,
          nodeId: 101,
          version: 3,
          completionSupported: true,
          completionCommand: "development-item.node.complete",
          writableFields: [],
          effectiveWritableFields: [],
          protectedFields: ["status"],
        },
      }],
    },
    allowedActions: ["development-item.node.complete"],
  };
}

function withDirectCompletionStatus(context: WorkflowContext, status: number): WorkflowContext {
  const node = context.workflow?.nodes?.[0];
  return {
    ...context,
    workflow: {
      nodes: [{
        ...(node ?? {}),
        status,
      }],
    },
  };
}

const action = (name: string, inputSchema: Record<string, { type: string; label: string; required: boolean; options?: string[] }>) => ({
  name,
  label: name,
  description: name,
  mode: "automatic" as const,
  risk: "medium" as const,
  scopes: ["pms:development:write"],
  inputSchema,
  requiresContext: true,
  refreshScopes: ["requirement-detail"],
});

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "requirement" as const,
    actions: [
      action("requirement.update", {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        version: { type: "integer", label: "版本", required: true },
        title: { type: "string", label: "标题", required: true },
        description: { type: "string", label: "描述", required: false },
      }),
      action("requirement.analysis.save", {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        version: { type: "integer", label: "节点版本", required: true },
        patch: { type: "object", label: "分析补丁", required: true },
      }),
      action("requirement.execution-target.link", {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        requirementVersion: { type: "integer", label: "需求版本", required: true },
        targetType: { type: "string", label: "目标类型", required: true, options: ["PROJECT", "TOPIC", "STORY"] },
        targetId: { type: "integer", label: "目标 ID", required: true },
      }),
      action("requirement.execution-target.change", {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        requirementVersion: { type: "integer", label: "需求版本", required: true },
        targetType: { type: "string", label: "目标类型", required: true, options: ["PROJECT", "TOPIC", "STORY"] },
        targetId: { type: "integer", label: "目标 ID", required: true },
      }),
      action("requirement.execution-target.unlink", {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        requirementVersion: { type: "integer", label: "需求版本", required: true },
      }),
      action("development-item.node.field.update", {
        itemType: { type: "string", label: "类型", required: true },
        itemId: { type: "integer", label: "需求 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        fieldValues: { type: "object", label: "字段", required: true },
        version: { type: "integer", label: "节点版本", required: true },
      }),
      action("development-item.node.complete", {
        itemType: { type: "string", label: "类型", required: true },
        itemId: { type: "integer", label: "需求 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        version: { type: "integer", label: "节点版本", required: true },
      }),
    ],
  }],
  scopes: ["pms:development:write"],
  workflowTypes: [],
};

function fakeClient(options: {
  context?: WorkflowContext;
  afterContext?: WorkflowContext;
  afterFocusedContext?: WorkflowContext;
  readbackFails?: boolean;
} = {}) {
  const context = options.context ?? makeContext();
  const afterContext = options.afterContext ?? makeContext({ version: 4, patch: { analysisNote: "已保存" } });
  let getCalls = 0;
  let contextCalls = 0;
  let focusedContextCalls = 0;
  const client = {
    capabilities: vi.fn(async () => catalog),
    context: vi.fn(async (_resource: unknown, contextOptions?: { view?: string; nodeId?: number }) => {
      contextCalls += 1;
      if (options.readbackFails && contextOptions === undefined && contextCalls > 1) throw new Error("context service unavailable");
      if (contextOptions?.view === "focused") {
        focusedContextCalls += 1;
        return options.afterFocusedContext && focusedContextCalls > 1
          ? options.afterFocusedContext
          : context;
      }
      return afterContext;
    }),
    get: vi.fn(async () => {
      getCalls += 1;
      if (options.readbackFails && getCalls > 1) throw new Error("resource service unavailable");
      return requirementDetail;
    }),
    preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown>; context?: { id: string; version: string } }) => ({
      operationId: `preview-${request.operation}`,
      command: request.operation,
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: request.context?.version ?? "v1",
      warnings: [],
      changes: [{ arguments: request.arguments }],
      refreshScopes: ["requirement-detail"],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-requirement-1",
      status: "SUCCEEDED" as const,
      data: { requirementId: 42 },
      warnings: [],
      refreshScopes: ["requirement-detail"],
    })),
    execute: vi.fn(),
  } as unknown as PmsClient;
  return client;
}

describe("requirement resource scenario contract", () => {
  it("registers all requirement write scenarios and plans a basic update from the current context", async () => {
    expect(requirementScenarioAdapter.resourceType).toBe("requirement");
    for (const operation of [
      "requirement.update",
      "requirement.analysis.save",
      "requirement.execution-target.link",
      "requirement.execution-target.change",
      "requirement.execution-target.unlink",
      "development-item.node.field.update",
      "development-item.node.complete",
    ]) {
      expect(requirementScenarioAdapter.supports(operation)).toBe(true);
    }

    const plan = await planResourceScenario(fakeClient(), {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.update",
      arguments: { title: "统一项目管理标准 v2" },
    }, createResourceScenarioRegistry([requirementScenarioAdapter]));

    expect(plan.normalizedArguments).toMatchObject({
      requirementId: 42,
      version: 8,
      title: "统一项目管理标准 v2",
    });
    expect(plan.preview.command).toBe("requirement.update");

    await expect(planResourceScenario(fakeClient(), {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.update",
      arguments: { title: "标题", unknownField: "不允许" },
    }, createResourceScenarioRegistry([requirementScenarioAdapter]))).rejects.toThrow(/inputSchema/);

    await expect(planResourceScenario(fakeClient(), {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.update",
      arguments: { title: "标题", version: 7 },
    }, createResourceScenarioRegistry([requirementScenarioAdapter]))).rejects.toThrow(/上下文/);
  });

  it("plans direct completion for a node with no fields or components", async () => {
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    const client = fakeClient({ context: makeDirectCompletionContext() });
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "development-item.node.complete",
      nodeId: 101,
      contextVersion: "3",
      arguments: {},
    }, registry);

    expect(plan.normalizedArguments).toEqual({
      itemType: "REQUIREMENT",
      itemId: 42,
      nodeId: 101,
      version: 3,
    });
    expect(plan.preview.command).toBe("development-item.node.complete");
  });

  it("only reports direct completion as verified when the node is actually completed", async () => {
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    const beforeContext = makeDirectCompletionContext();
    const completedContext = withDirectCompletionStatus(makeDirectCompletionContext(), 2);
    const client = fakeClient({
      context: beforeContext,
      afterContext: completedContext,
      afterFocusedContext: completedContext,
    });
    const input = {
      resourceType: "requirement" as const,
      resourceId: 42,
      operation: "development-item.node.complete",
      nodeId: 101,
      expectedPatch: {},
      previewOperationId: "preview-development-item.node.complete",
      idempotencyKey: "requirement-42-complete-v1",
    };

    const result = await executeResourceScenario(client, input, registry);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.verification.patchApplied).toBe(true);

    const unchangedContext = makeDirectCompletionContext();
    const failedResult = await executeResourceScenario(
      fakeClient({
        context: unchangedContext,
        afterContext: unchangedContext,
        afterFocusedContext: unchangedContext,
      }),
      { ...input, idempotencyKey: "requirement-42-complete-v2" },
      registry,
    );
    expect(failedResult.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(failedResult.verification.patchApplied).toBe(false);
  });

  it("uses the focused saveContract for node fields and rejects unknown or protected fields before preview", async () => {
    const client = fakeClient();
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    const plan = await planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "development-item.node.field.update",
      nodeId: 101,
      contextVersion: "3",
      draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { analysisNote: "已完成范围澄清" },
      },
    }, registry);

    expect(client.context).toHaveBeenCalledWith(
      { type: "requirement", id: 42 },
      { nodeId: 101, view: "focused" },
    );
    expect(plan.normalizedArguments).toMatchObject({
      itemType: "REQUIREMENT",
      itemId: 42,
      nodeId: 101,
      version: 3,
      fieldValues: { __components: { "requirement-node-form": { analysisNote: "已完成范围澄清" } } },
    });

    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "development-item.node.field.update",
      nodeId: 101,
      contextVersion: "3",
      arguments: { fieldValues: { unknownField: "不能写" } },
    }, registry)).rejects.toThrow(/writableFields/);
    expect(client.preview).toHaveBeenCalledTimes(1);
  });

  it("validates analysis node and context versions before preview and validates draft evidence", async () => {
    const client = fakeClient();
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.analysis.save",
      nodeId: 999,
      contextVersion: "3",
      arguments: { patch: { analysisNote: "x" } },
    }, registry)).rejects.toThrow(/节点/);
    expect(client.preview).not.toHaveBeenCalled();

    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.analysis.save",
      nodeId: 101,
      contextVersion: "3",
      draft: {
        facts: [{ text: "外部事实", sourceRefs: ["story:99"] }],
        inferences: [], assumptions: [], unresolvedDecisions: [], patch: {},
      },
    }, registry)).rejects.toThrow(/未授权或不存在的引用/);
  });

  it("executes only the persisted preview, verifies readback, and reports unknown when readback fails", async () => {
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    const client = fakeClient();
    const result = await executeResourceScenario(client, {
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.update",
      expectedPatch: { title: "统一项目管理标准" },
      previewOperationId: "preview-requirement.update",
      idempotencyKey: "requirement-42-update-v1",
    }, registry);
    expect(client.execute).not.toHaveBeenCalled();
    expect(client.executePreview).toHaveBeenCalledWith("preview-requirement.update", "requirement-42-update-v1");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });

    const failed = await executeResourceScenario(fakeClient({ readbackFails: true }), {
      resourceType: "requirement",
      resourceId: 42,
      operation: "requirement.update",
      previewOperationId: "preview-requirement.update",
      idempotencyKey: "requirement-42-update-v2",
    }, registry);
    expect(failed.status).toBe("WRITE_RESULT_UNKNOWN");
  });

  it("uses the workflow context projection when the resource readback omits protected fields", () => {
    const beforeContext = makeContext();
    beforeContext.resourceDetails = {
      ...requirementDetail.details,
      startDate: "2026-10-15",
      endDate: "2026-10-22",
    };
    const afterContext = makeContext({ version: 4 });
    afterContext.resourceDetails = {
      ...beforeContext.resourceDetails,
    };
    const before: ResourceScenarioSnapshot = {
      resource: {
        ...requirementDetail,
        details: {
          ...beforeContext.resourceDetails,
        },
      },
      context: beforeContext,
    };
    const after: ResourceScenarioSnapshot = {
      resource: {
        ...requirementDetail,
        details: {
          id: 42,
          title: "统一项目管理标准",
          status: "IN_PROGRESS",
          ownerId: 7,
        },
      },
      context: afterContext,
    };

    const verification = requirementScenarioAdapter.verifyReadback(
      before,
      after,
      { requirementId: 42 },
      {
        operationId: "operation-requirement-1",
        status: "SUCCEEDED",
        data: { requirementId: 42 },
        warnings: [],
        refreshScopes: [],
      },
    );

    expect(verification.protectedFieldsUnchanged).toBe(true);
  });

  it("replays with the same idempotency key through the same preview operation", async () => {
    const client = fakeClient();
    const registry = createResourceScenarioRegistry([requirementScenarioAdapter]);
    const input = {
      resourceType: "requirement" as const,
      resourceId: 42,
      operation: "requirement.update",
      previewOperationId: "preview-requirement.update",
      idempotencyKey: "requirement-42-replay",
    };
    const first = await executeResourceScenario(client, input, registry);
    const second = await executeResourceScenario(client, input, registry);
    expect(first.operation.operationId).toBe(second.operation.operationId);
    expect(client.executePreview).toHaveBeenCalledTimes(2);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("routes the requirement scenario through the production CLI entry point", async () => {
    const client = fakeClient();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies: CliDependencies = {
      createRuntime: vi.fn(async () => ({ client })),
      runAuth: vi.fn(async () => ({})),
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      setExitCode: vi.fn(),
      requestIdFactory: () => "requirement-scenario-cli-1",
    };

    await runCli([
      "scenario", "resource", "plan", "requirement", "requirement.update", "42",
      "--arguments-json", JSON.stringify({ title: "CLI 更新需求" }),
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}").data).toMatchObject({
      scenario: "resource-scenario",
      phase: "plan",
      resourceType: "requirement",
      operation: "requirement.update",
    });
  });
});
