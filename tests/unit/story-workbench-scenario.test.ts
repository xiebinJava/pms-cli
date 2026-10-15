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
    }],
  }],
  scopes: ["pms:story:write"],
  workflowTypes: [],
};

function makeContext(content: Record<string, unknown>, version = 1) {
  return {
    resource: { type: "story" as const, id: 34 },
    version,
    resourceDetails: {
      title: "项目管理标准",
      status: "IN_PROGRESS",
      ownerId: 2,
    },
    currentNode: { id: 384, key: "custom-node-2", label: "迭代计划会" },
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
          config: { variant: "iteration" },
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
            variant: "iteration",
            fieldValuesPath: "__components.story-node-workbench",
            writableFields: ["dependencies", "developerIds", "iterationName", "iterationPlanId", "meetingNote", "testerIds"],
          },
        }],
      }],
    },
    relations: [],
    allowedActions: ["development-item.node.field.update"],
  };
}

function fakeClient(readbackContent: Record<string, unknown> = { meetingNote: "已确认进入本周迭代" }) {
  const calls: string[] = [];
  let saved = false;
  const client = {
    capabilities: vi.fn(async () => catalog),
    context: vi.fn(async () => {
      calls.push("context");
      return makeContext(saved ? readbackContent : {});
    }),
    get: vi.fn(async () => {
      calls.push("get");
      return {
        resourceType: "story",
        resourceId: 34,
        entityVersion: null,
        details: { id: 34, title: "项目管理标准", status: "IN_PROGRESS", ownerId: 2 },
      };
    }),
    preview: vi.fn(async (request: { arguments: Record<string, unknown> }) => {
      calls.push("preview");
      expect(request.arguments).toMatchObject({
        itemType: "STORY",
        itemId: 34,
        nodeId: 384,
        version: 1,
        fieldValues: {
          __components: {
            "story-node-workbench": { meetingNote: "已确认进入本周迭代" },
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
    expect(calls).toEqual(["context", "preview", "execute-preview", "get", "context"]);
  });
});
