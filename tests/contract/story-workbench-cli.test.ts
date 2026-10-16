import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "story",
    actions: [{
      name: "development-item.node.field.update",
      label: "更新故事节点字段",
      description: "更新故事节点字段",
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

function context(): any {
  return {
    resource: { type: "story" as const, id: 34 },
    version: 1,
    resourceDetails: { title: "项目管理标准", status: "IN_PROGRESS", ownerId: 2 },
    currentNode: { id: 384, key: "custom-node-2", label: "迭代计划会" },
    workflow: { nodes: [{
      id: 384,
      components: [{
        key: "story-node-workbench",
        saveContract: {
          command: "development-item.node.field.update",
          itemType: "STORY",
          itemId: 34,
          nodeId: 384,
          version: 1,
          componentKey: "story-node-workbench",
          variant: "iteration",
          fieldValuesPath: "__components.story-node-workbench",
          writableFields: ["meetingNote"],
        },
      }],
    }] },
    allowedActions: ["development-item.node.field.update"],
  };
}

function acceptanceContext() {
  const value = context();
  value.currentNode = { id: 387, key: "acceptance", label: "验收中" };
  value.workflow.nodes[0] = {
    id: 387,
    components: [{
      key: "story-node-workbench",
      saveContract: {
        command: "development-item.node.field.update",
        completionCommand: "development-item.node.complete-with-data",
        completionSupported: true,
        completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
        itemType: "STORY",
        itemId: 34,
        nodeId: 387,
        version: 1,
        componentKey: "story-node-workbench",
        variant: "acceptance",
        fieldValuesPath: "__components.story-node-workbench",
        writableFields: ["acceptanceConclusion", "acceptanceNote"],
      },
    }],
  };
  return value;
}

function deps(client: never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({ authenticated: true })),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "story-workbench-cli"),
  };
  return { dependencies, stdout, stderr };
}

describe("story workbench CLI contract", () => {
  it("routes plan with patch-json and does not require an execute idempotency key", async () => {
    const client = {
      capabilities: vi.fn(async () => catalog),
      context: vi.fn(async (_resource: unknown, options: unknown) => {
        expect(options).toEqual({ nodeId: 384, view: "focused", component: "story-node-workbench" });
        return context();
      }),
      preview: vi.fn(async () => ({
        operationId: "preview-story-1",
        command: "development-item.node.field.update",
        expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "1",
        warnings: [],
        changes: [],
        refreshScopes: ["story-detail"],
        preconditions: [],
      })),
    } as never;
    const { dependencies, stdout, stderr } = deps(client);

    await runCli([
      "scenario", "story-workbench", "plan", "34",
      "--node-id", "384", "--version", "1", "--variant", "iteration",
      "--patch-json", '{"meetingNote":"确认进入本周迭代"}',
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}").data).toMatchObject({
      phase: "plan",
      resourceId: 34,
      nodeId: 384,
      variant: "iteration",
      preview: { operationId: "preview-story-1" },
    });
  });

  it("requires an idempotency key for execute before authentication", async () => {
    const client = {} as never;
    const { dependencies, stderr } = deps(client);

    await runCli([
      "scenario", "story-workbench", "execute", "34",
      "--node-id", "384", "--version", "1", "--variant", "iteration",
      "--patch-json", '{"meetingNote":"确认进入本周迭代"}',
    ], dependencies);

    expect(dependencies.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("idempotency-key");
  });

  it("requires a preview operation id for execute before authentication", async () => {
    const client = {} as never;
    const { dependencies, stderr } = deps(client);

    await runCli([
      "scenario", "story-workbench", "execute", "34",
      "--node-id", "384", "--version", "1", "--variant", "iteration",
      "--patch-json", '{"meetingNote":"确认进入本周迭代"}',
      "--idempotency-key", "story-workbench-cli-1",
    ], dependencies);

    expect(dependencies.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("preview-operation-id");
  });

  it("passes acceptance completion metadata through the CLI plan", async () => {
    const client = {
      capabilities: vi.fn(async () => catalog),
      context: vi.fn(async () => acceptanceContext()),
      preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown> }) => {
        expect(request.operation).toBe("development-item.node.complete-with-data");
        expect(request.arguments).toMatchObject({
          ownerId: 2,
          startDate: "2026-10-10",
          endDate: "2026-10-20",
        });
        return {
          operationId: "preview-story-acceptance",
          command: request.operation,
          expiresAt: "2026-10-15T12:00:00Z",
          contextVersion: "1",
          warnings: [],
          changes: [],
          refreshScopes: ["story-detail"],
          preconditions: [],
        };
      }),
    } as never;
    const { dependencies, stdout, stderr } = deps(client);

    await runCli([
      "scenario", "story-workbench", "plan", "34",
      "--node-id", "387", "--version", "1", "--variant", "acceptance",
      "--patch-json", '{"acceptanceConclusion":"PASS","acceptanceNote":"通过"}',
      "--complete", "--owner-id", "2", "--start-date", "2026-10-10", "--end-date", "2026-10-20",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}").data).toMatchObject({
      phase: "plan",
      complete: true,
      preview: { operationId: "preview-story-acceptance" },
    });
  });
});
