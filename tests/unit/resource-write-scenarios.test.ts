import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import {
  executeResourceWriteScenario,
  planResourceWriteScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceWrite.js";

const catalog = {
  resources: [
    {
      type: "topic",
      actions: [{
        name: "topic.create",
        label: "创建专题",
        description: "创建专题",
        mode: "automatic",
        risk: "medium",
        scopes: ["pms:topic:write"],
        inputSchema: { title: { type: "string", label: "标题", required: true } },
        refreshScopes: ["topic-list", "topic-detail"],
      }],
    },
    {
      type: "story",
      actions: [{
        name: "story.update",
        label: "更新故事",
        description: "更新故事",
        mode: "automatic",
        risk: "medium",
        scopes: ["pms:story:write"],
        inputSchema: { storyId: { type: "integer", label: "故事 ID", required: true } },
        refreshScopes: ["story-list", "story-detail"],
      }],
    },
  ],
  scopes: ["pms:topic:write", "pms:story:write"],
  workflowTypes: [],
  viewer: { id: 1 },
  agentContractVersion: "pms-agent/v1",
  features: {},
} as never;

function fakeClient() {
  const calls: string[] = [];
  const client = {
    capabilities: vi.fn(async () => catalog),
    preview: vi.fn(async (request: any) => {
      calls.push(`preview:${request.operation}`);
      return {
        operationId: "preview-1",
        command: request.operation,
        expiresAt: "2099-01-01T00:00:00Z",
        contextVersion: request.context?.version ?? "v1",
        warnings: [],
        changes: [],
        refreshScopes: ["story-detail"],
        preconditions: [],
      };
    }),
    executePreview: vi.fn(async (operationId: string, idempotencyKey: string) => {
      calls.push(`execute:${operationId}:${idempotencyKey}`);
      return {
        operationId: "operation-1",
        status: "SUCCEEDED" as const,
        data: { storyId: 34 },
        warnings: [],
        refreshScopes: ["story-detail"],
      };
    }),
    get: vi.fn(async () => ({
      resourceType: "story" as const,
      resourceId: 34,
      entityVersion: 3,
      details: { id: 34, title: "已更新故事" },
    })),
    context: vi.fn(async () => ({
      resource: { type: "story" as const, id: 34 },
      version: 4,
      allowedActions: [],
    })),
    calls,
  };
  return { client: client as unknown as PmsClient, raw: client };
}

describe("resource write scenarios", () => {
  it("plans topic creation with a global context and never executes", async () => {
    const { client, raw } = fakeClient();
    const plan = await planResourceWriteScenario(client, {
      resourceType: "topic",
      operation: "topic.create",
      arguments: { title: "AI 协作专题" },
      requestId: "topic-plan-1",
    });

    expect(plan.scenario).toBe("resource-write");
    expect(plan.phase).toBe("plan");
    expect(plan.preview.operationId).toBe("preview-1");
    expect(raw.executePreview).not.toHaveBeenCalled();
    expect(raw.calls).toEqual(["preview:topic.create"]);
  });

  it("executes a story update only through the preview and verifies readback", async () => {
    const { client, raw } = fakeClient();
    const result = await executeResourceWriteScenario(client, {
      resourceType: "story",
      operation: "story.update",
      idempotencyKey: "story-update-1",
      previewOperationId: "preview-1",
      requestId: "story-update-1",
    });

    expect(raw.preview).not.toHaveBeenCalled();
    expect(raw.executePreview).toHaveBeenCalledWith("preview-1", "story-update-1");
    expect(raw.get).toHaveBeenCalledWith({ type: "story", id: 34 });
    expect(raw.context).toHaveBeenCalledWith({ type: "story", id: 34 });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.previewOperationId).toBe("preview-1");
    expect(result.verification).toEqual({ resourceReadback: true, contextReadback: true });
  });

  it("rejects an execute request without a persisted preview", async () => {
    const { client, raw } = fakeClient();
    await expect(executeResourceWriteScenario(client, {
      resourceType: "story",
      operation: "story.update",
      arguments: { storyId: 34 },
      idempotencyKey: "story-update-2",
    } as never)).rejects.toThrow("preview-operation-id");
    expect(raw.executePreview).not.toHaveBeenCalled();
  });

  it("does not let execute arguments override the persisted preview target", async () => {
    const { client, raw } = fakeClient();
    await expect(executeResourceWriteScenario(client, {
      resourceType: "story",
      operation: "story.update",
      arguments: { storyId: 35 },
      idempotencyKey: "story-update-mismatch",
      previewOperationId: "preview-1",
      requestId: "story-update-mismatch",
    })).rejects.toThrow("不接受 arguments");
    expect(raw.executePreview).not.toHaveBeenCalled();
  });

  it("rejects an operation whose capability belongs to another resource", async () => {
    const { client } = fakeClient();
    await expect(planResourceWriteScenario(client, {
      resourceType: "topic",
      operation: "story.update",
      arguments: { storyId: 34 },
      requestId: "wrong-resource-1",
    })).rejects.toThrow("不能用于 topic");
  });

  it("routes the agent-friendly story alias through plan and preview-bound execute", async () => {
    const { client, raw } = fakeClient();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const deps: CliDependencies = {
      createRuntime: vi.fn(async () => ({ client })),
      runAuth: vi.fn(async () => ({})),
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      setExitCode: vi.fn(),
      requestIdFactory: vi.fn(() => "cli-resource-write-1"),
    };

    await runCli([
      "scenario", "story-update", "plan",
      "--arguments-json", JSON.stringify({ storyId: 34, title: "代理更新" }),
    ], deps);
    const planOutput = JSON.parse(stdout.pop() ?? "{}");
    expect(planOutput.ok).toBe(true);
    expect(planOutput.data.resourceType).toBe("story");
    expect(planOutput.data.operation).toBe("story.update");

    await runCli([
      "scenario", "story-update", "execute",
      "--preview-operation-id", "preview-1",
      "--idempotency-key", "story-update-cli-1",
    ], deps);
    const executeOutput = JSON.parse(stdout.pop() ?? "{}");
    expect(executeOutput.ok).toBe(true);
    expect(executeOutput.data.previewOperationId).toBe("preview-1");
    expect(raw.executePreview).toHaveBeenCalledWith("preview-1", "story-update-cli-1");
    expect(stderr).toHaveLength(0);
  });
});
