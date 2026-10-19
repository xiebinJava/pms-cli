import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import { PmsClientError } from "../../packages/pms-client/src/index.js";
import {
  executeStoryWorkbenchScenario,
  runStoryWorkbenchScenario,
  type StoryWorkbenchScenarioClient,
} from "../../apps/pms-cli/src/commands/scenarios/storyWorkbench.js";
import { storyWorkbenchContractVersion } from "../../packages/pms-contracts/src/index.js";

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "story",
    actions: [{
      name: "development-item.node.field.update",
      label: "更新研发事项节点动态字段",
      description: "更新故事节点工作台字段",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:story:write"],
      inputSchema: {
        itemType: { type: "string", label: "类型", required: true },
        itemId: { type: "integer", label: "故事 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        fieldValues: { type: "object", label: "字段", required: true },
        version: { type: "integer", label: "版本", required: true },
      },
      requiresContext: true,
      refreshScopes: ["story-detail"],
    }, {
      name: "development-item.node.complete-with-data",
      label: "保存并完成故事节点",
      description: "保存故事节点详情并推进流程",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:story:write"],
      inputSchema: {
        itemType: { type: "string", label: "类型", required: true },
        itemId: { type: "integer", label: "故事 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        fieldValues: { type: "object", label: "字段", required: true },
        version: { type: "integer", label: "版本", required: true },
        ownerId: { type: "integer", label: "负责人", required: false },
        startDate: { type: "string", label: "开始日期", required: false },
        endDate: { type: "string", label: "结束日期", required: false },
      },
      requiresContext: true,
      refreshScopes: ["story-detail"],
    }],
  }],
  scopes: ["pms:story:write"],
  workflowTypes: [],
};

function makeContext(content: Record<string, unknown>, version = 1, variant: "iteration" | "acceptance" = "iteration") {
  const acceptance = variant === "acceptance";
  return {
    resource: { type: "story" as const, id: 34 },
    version,
    resourceDetails: {
      title: "项目管理标准",
      status: "IN_PROGRESS",
      ownerId: 2,
    },
    currentNode: { id: 384, key: acceptance ? "acceptance" : "custom-node-2", label: acceptance ? "验收中" : "迭代计划会" },
    workflow: {
      templateVersionId: 49,
      templateVersionNo: 1,
      nodes: [{
        id: 384,
        key: "custom-node-2",
        label: "迭代计划会",
        components: [{
          key: "story-node-workbench",
          label: "story-node-workbench",
          config: { variant },
          content,
          contentState: "LOADED",
          versions: { node: version },
          saveContract: {
            command: "development-item.node.field.update",
            itemType: "STORY",
            itemId: 34,
            nodeId: 384,
            version,
            componentKey: "story-node-workbench",
            variant,
            fieldValuesPath: "__components.story-node-workbench",
            writableFields: acceptance
              ? ["acceptanceConclusion", "acceptanceNote"]
              : ["dependencies", "developerIds", "iterationName", "iterationPlanId", "meetingNote", "testerIds"],
            completionCommand: "development-item.node.complete-with-data",
            completionSupported: true,
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
          },
        }],
      }],
    },
    relations: [],
    allowedActions: ["development-item.node.field.update"],
  };
}

function fakeClient(
  readbackContent: Record<string, unknown> = { meetingNote: "已确认进入本周迭代" },
  variant: "iteration" | "acceptance" = "iteration",
  completion = false,
  options: {
    beforeContextDetails?: Record<string, unknown>;
    readbackContextDetails?: Record<string, unknown>;
    readbackResourceDetails?: Record<string, unknown>;
  } = {},
) {
  const calls: string[] = [];
  let saved = false;
  const client = {
    capabilities: vi.fn(async () => catalog),
    context: vi.fn(async () => {
      calls.push("context");
      const context = makeContext(saved ? readbackContent : {}, 1, variant);
      if (saved && options.readbackContextDetails) {
        context.resourceDetails = options.readbackContextDetails as typeof context.resourceDetails;
      } else if (!saved && options.beforeContextDetails) {
        context.resourceDetails = options.beforeContextDetails as typeof context.resourceDetails;
      }
      return context;
    }),
    get: vi.fn(async () => {
      calls.push("get");
      return {
        resourceType: "story",
        resourceId: 34,
        entityVersion: null,
        details: options.readbackResourceDetails ?? {
          id: 34,
          title: "项目管理标准",
          status: "IN_PROGRESS",
          ownerId: 2,
        },
      };
    }),
    preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown> }) => {
      calls.push("preview");
      expect(request.operation).toBe(
        completion || variant === "acceptance"
          ? "development-item.node.complete-with-data"
          : "development-item.node.field.update",
      );
      expect(request.arguments).toMatchObject({
        itemType: "STORY",
        itemId: 34,
        nodeId: 384,
        version: 1,
        fieldValues: {
          __components: {
            "story-node-workbench": variant === "acceptance"
              ? { acceptanceConclusion: "PASS", acceptanceNote: "验收通过" }
              : { meetingNote: "已确认进入本周迭代" },
          },
        },
      });
      return {
        operationId: "preview-1",
        command: "development-item.node.field.update",
        expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "1",
        warnings: [],
        changes: [],
        refreshScopes: ["story-detail"],
        preconditions: [],
      };
    }),
    execute: vi.fn(async () => {
      calls.push("execute");
      saved = true;
      return {
        operationId: "operation-1",
        status: "SUCCEEDED",
        data: {},
        warnings: [],
        refreshScopes: ["story-detail"],
      };
    }),
    executePreview: vi.fn(async (operationId: string, idempotencyKey: string) => {
      calls.push("execute-preview");
      expect(operationId).toBe("preview-1");
      expect(idempotencyKey).toBeTruthy();
      saved = true;
      return {
        operationId: "operation-1",
        status: "SUCCEEDED",
        data: { saved: true },
        warnings: ["服务端已记录"],
        refreshScopes: ["story-detail"],
        auditId: "audit-story-1",
      };
    }),
  } as unknown as PmsClient;
  return { client: client as StoryWorkbenchScenarioClient, calls };
}

const input = {
  contractVersion: storyWorkbenchContractVersion,
  resourceType: "story" as const,
  resourceId: 34,
  nodeId: 384,
  version: 1,
  variant: "iteration" as const,
  patch: { meetingNote: "已确认进入本周迭代" },
  save: true,
  idempotencyKey: "story-34-node-384-v1",
};

describe("story workbench write scenario", () => {
  it("reads context and returns a draft without preview or execute when save is false", async () => {
    const { client, calls } = fakeClient();
    const result = await runStoryWorkbenchScenario(client, { ...input, save: false }, async () => true);

    expect(result.status).toBe("DRAFT");
    expect(calls).toEqual(["context"]);
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("rejects a field outside saveContract before preview", async () => {
    const { client, calls } = fakeClient();

    await expect(runStoryWorkbenchScenario(client, {
      ...input,
      patch: { serverOnlyField: "不能写" },
    }, async () => true)).rejects.toThrow(/writableFields/);
    expect(calls).toEqual(["context"]);
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("previews before approval and executes only after approval, then verifies readback", async () => {
    const { client, calls } = fakeClient();
    const result = await runStoryWorkbenchScenario(client, input, async () => true);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.operationId).toBe("operation-1");
    expect(result.operation).toMatchObject({
      operationId: "operation-1",
      data: { saved: true },
      refreshScopes: ["story-detail"],
      auditId: "audit-story-1",
    });
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });
    expect(calls).toEqual(["context", "preview", "execute-preview", "get", "context"]);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("does not execute after approval is rejected", async () => {
    const { client, calls } = fakeClient();
    const result = await runStoryWorkbenchScenario(client, input, async () => false);

    expect(result.status).toBe("REJECTED");
    expect(result.operationId).toBe("preview-1");
    expect(calls).toEqual(["context", "preview"]);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("returns an unknown result when the successful write does not match readback", async () => {
    const { client, calls } = fakeClient({ meetingNote: "服务端没有保存预期内容" });
    const result = await runStoryWorkbenchScenario(client, input, async () => true);

    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(result.verification?.contextReadback).toBe(true);
    expect(result.verification?.patchApplied).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("未完全匹配"))).toBe(true);
    expect(calls).toEqual(["context", "preview", "execute-preview", "get", "context"]);
  });

  it("does not treat omitted fields in the resource projection as protected-field changes", async () => {
    const { client } = fakeClient(
      { meetingNote: "已确认进入本周迭代" },
      "iteration",
      true,
      {
        beforeContextDetails: {
          title: "项目管理标准",
          status: "IN_PROGRESS",
          ownerId: 2,
          startDate: "2026-10-15",
          dueDate: "2026-10-22",
        },
        readbackContextDetails: {
          title: "项目管理标准",
          status: "IN_PROGRESS",
          ownerId: 2,
          startDate: "2026-10-15",
          dueDate: "2026-10-22",
        },
        readbackResourceDetails: {
          id: 34,
          title: "项目管理标准",
          status: "IN_PROGRESS",
          ownerId: 2,
        },
      },
    );
    const result = await executeStoryWorkbenchScenario(client, {
      ...input,
      complete: true,
      ownerId: 2,
      startDate: "2026-10-15",
      endDate: "2026-10-22",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.verification?.protectedFieldsUnchanged).toBe(true);
  });

  it("rejects a stale requested version before preview", async () => {
    const { client, calls } = fakeClient();

    await expect(runStoryWorkbenchScenario(client, {
      ...input,
      version: 2,
      save: false,
      idempotencyKey: undefined,
    }, async () => true)).rejects.toThrow(/版本/);
    expect(calls).toEqual(["context"]);
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("replays the same idempotent write when the current node version is newer", async () => {
    const { client, calls } = fakeClient();
    client.preview = vi.fn(async () => {
      calls.push("preview");
      throw new PmsClientError("conflict", "流程节点已被其他人修改", { status: 409 });
    });

    const result = await executeStoryWorkbenchScenario(client, {
      ...input,
      version: 0,
      previewOperationId: "preview-1",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.operationId).toBe("operation-1");
    expect(calls).toEqual(["context", "execute-preview", "get", "context"]);
  });

  it("uses the server completion command for acceptance and returns readback current node", async () => {
    const { client, calls } = fakeClient(
      { acceptanceConclusion: "PASS", acceptanceNote: "验收通过" },
      "acceptance",
    );
    const result = await executeStoryWorkbenchScenario(client, {
      ...input,
      variant: "acceptance",
      patch: { acceptanceConclusion: "PASS", acceptanceNote: "验收通过" },
      complete: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.complete).toBe(true);
    expect(result.currentNode).toMatchObject({ id: 384, key: "acceptance" });
    expect(result.readback?.resource).toBeTruthy();
    expect((client.preview as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      operation: "development-item.node.complete-with-data",
      arguments: {
        ownerId: 2,
        startDate: "2026-10-10",
        endDate: "2026-10-20",
        fieldValues: {
          __components: {
            "story-node-workbench": { acceptanceConclusion: "PASS", acceptanceNote: "验收通过" },
          },
        },
      },
    });
    expect(calls).toEqual(["context", "preview", "execute-preview", "get", "context"]);
  });

  it("uses the server completion command for a non-acceptance variant", async () => {
    const { client, calls } = fakeClient(
      { meetingNote: "已确认进入本周迭代" },
      "iteration",
      true,
    );
    const result = await executeStoryWorkbenchScenario(client, {
      ...input,
      complete: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.complete).toBe(true);
    expect((client.preview as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
      operation: "development-item.node.complete-with-data",
      arguments: {
        ownerId: 2,
        startDate: "2026-10-10",
        endDate: "2026-10-20",
      },
    });
    expect(calls).toEqual(["context", "preview", "execute-preview", "get", "context"]);
  });

  it("rejects protected or unknown acceptance fields before preview", async () => {
    const { client, calls } = fakeClient({}, "acceptance");

    await expect(executeStoryWorkbenchScenario(client, {
      ...input,
      variant: "acceptance",
      patch: { title: "不得修改" },
      complete: true,
    })).rejects.toThrow(/writableFields/);
    expect(calls).toEqual(["context"]);
    expect(client.preview).not.toHaveBeenCalled();
  });
});
