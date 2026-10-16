import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import { createProjectWithReadback, projectCreate, projectUpdate } from "../../apps/pms-cli/src/commands/shortcuts/project.js";
import { requirementAnalysisSave, requirementCreate, requirementUpdate } from "../../apps/pms-cli/src/commands/shortcuts/requirement.js";
import { workflowAction } from "../../apps/pms-cli/src/commands/core/workflow.js";

function deps(client: never = {} as never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({ authenticated: true })),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "safe-write-contract"),
  };
  return { dependencies, stdout, stderr };
}

describe("safe write lifecycle CLI contract", () => {
  it.each([
    ["operation execute", ["operation", "execute", "project.create", "--arguments-json", "{}", "--idempotency-key", "idem-1"]],
    ["project create", ["project", "create", "--arguments-json", "{}", "--idempotency-key", "idem-1"]],
    ["requirement analysis save", [
      "requirement", "analysis", "save", "33", "--node-id", "2", "--version", "3",
      "--context-id", "requirement:33", "--context-version", "3", "--arguments-json", "{}",
      "--idempotency-key", "idem-1",
    ]],
    ["workflow action", [
      "workflow", "action", "story", "34", "complete", "--arguments-json", "{}", "--idempotency-key", "idem-1",
    ]],
    ["project-create scenario execute", [
      "scenario", "project-create", "execute", "--arguments-json", "{}", "--idempotency-key", "idem-1",
    ]],
  ])("rejects %s without a preview operation id before creating a runtime", async (_name, args) => {
    const { dependencies, stderr } = deps();

    await runCli(args, dependencies);

    expect(dependencies.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("preview-operation-id");
  });

  it("executes a generic operation only through the persisted preview", async () => {
    const execute = vi.fn();
    const executePreview = vi.fn(async () => ({
      operationId: "operation-1",
      status: "SUCCEEDED" as const,
      data: {},
      warnings: [],
      refreshScopes: [],
    }));
    const { dependencies, stdout, stderr } = deps({ execute, executePreview } as never);

    await runCli([
      "operation", "execute",
      "--idempotency-key", "idem-1", "--preview-operation-id", "preview-1",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(executePreview).toHaveBeenCalledWith("preview-1", "idem-1");
    expect(JSON.parse(stdout[0] ?? "{}").data.operationId).toBe("operation-1");
  });

  it("executes an explicitly authorized medium-risk operation without a second confirmation", async () => {
    const execute = vi.fn(async () => ({
      operationId: "operation-auto-1",
      status: "SUCCEEDED" as const,
      data: { saved: true },
      warnings: [],
      refreshScopes: ["story-detail"],
    }));
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "story",
          actions: [{
            name: "development-item.node.complete-with-data",
            label: "完成节点并保存详情",
            description: "保存并完成",
            mode: "automatic",
            risk: "medium",
            scopes: [],
            inputSchema: {},
            requiresContext: true,
            refreshScopes: ["story-detail"],
          }],
        }],
        scopes: [],
        workflowTypes: [],
        today: "2026-10-16",
      })),
      execute,
    };
    const { dependencies, stdout, stderr } = deps(client as never);

    await runCli([
      "operation", "auto", "development-item.node.complete-with-data",
      "--arguments-json", '{"itemType":"STORY","itemId":34,"nodeId":383,"version":4}',
      "--context-id", "story:34", "--context-version", "4",
      "--idempotency-key", "idem-auto-1",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operation: "development-item.node.complete-with-data",
      idempotencyKey: "idem-auto-1",
      context: { id: "story:34", version: "4" },
    }));
    expect(JSON.parse(stdout[0] ?? "{}").data.operationId).toBe("operation-auto-1");
  });

  it("keeps high-risk operations on the preview confirmation path", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "project",
          actions: [{
            name: "project.delete",
            label: "删除项目",
            description: "删除项目",
            mode: "automatic",
            risk: "high",
            scopes: [],
            inputSchema: {},
            requiresContext: false,
            refreshScopes: [],
          }],
        }],
        scopes: [],
        workflowTypes: [],
        today: "2026-10-16",
      })),
      execute: vi.fn(),
    };
    const { dependencies, stderr } = deps(client as never);

    await runCli([
      "operation", "auto", "project.delete", "--arguments-json", '{"projectId":1}',
      "--idempotency-key", "idem-dangerous-1",
    ], dependencies);

    expect(client.execute).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("高风险操作必须先 preview");
  });

  it("does not route read capabilities through the automatic write endpoint", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "story",
          actions: [{
            name: "story.read",
            label: "读取故事",
            description: "读取故事",
            mode: "read",
            risk: "low",
            scopes: [],
            inputSchema: {},
            requiresContext: false,
            refreshScopes: [],
          }],
        }],
        scopes: [],
        workflowTypes: [],
        today: "2026-10-16",
      })),
      execute: vi.fn(),
    };
    const { dependencies, stderr } = deps(client as never);

    await runCli([
      "operation", "auto", "story.read", "--idempotency-key", "idem-read-1",
    ], dependencies);

    expect(client.execute).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("只允许自动写入能力");
  });

  it("does not accept a second argument payload during preview execution", async () => {
    const { dependencies, stderr } = deps({ executePreview: vi.fn() } as never);

    await runCli([
      "operation", "execute", "project.create",
      "--preview-operation-id", "preview-1",
      "--idempotency-key", "idem-1",
      "--arguments-json", '{"name":"different"}',
    ], dependencies);

    expect(dependencies.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("arguments-json");
  });

  it("does not accept an operation name during preview execution", async () => {
    const { dependencies, stderr } = deps({ executePreview: vi.fn() } as never);

    await runCli([
      "operation", "execute", "project.create",
      "--preview-operation-id", "preview-1",
      "--idempotency-key", "idem-1",
    ], dependencies);

    expect(dependencies.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("operation execute");
  });

  it("binds project creation to the supplied preview operation", async () => {
    const execute = vi.fn();
    const executePreview = vi.fn(async () => ({
      operationId: "operation-project-1",
      status: "SUCCEEDED" as const,
      data: { project: { id: 42, version: 1 } },
      warnings: [],
      refreshScopes: [],
    }));
    const client = {
      execute,
      executePreview,
      get: vi.fn(async () => ({ resourceType: "project", resourceId: 42, entityVersion: 1, details: { id: 42 } })),
      context: vi.fn(async () => ({ resource: { type: "project", id: 42 }, version: 1, allowedActions: [] })),
    };
    const { dependencies, stderr } = deps(client as never);

    await runCli([
      "project", "create", "--arguments-json", '{"name":"AI PMS"}',
      "--idempotency-key", "idem-project-1", "--preview-operation-id", "preview-project-1",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
    expect(executePreview).toHaveBeenCalledWith("preview-project-1", "idem-project-1");
  });

  it("binds requirement analysis save and workflow action to the supplied preview", async () => {
    const executePreview = vi.fn(async () => ({
      operationId: "operation-1",
      status: "SUCCEEDED" as const,
      data: {},
      warnings: [],
      refreshScopes: [],
    }));
    const client = {
      executePreview,
      context: vi.fn(async () => ({
        resource: { type: "story", id: 34 },
        version: 3,
        allowedActions: ["complete"],
      })),
    };
    const first = deps(client as never);
    await runCli([
      "requirement", "analysis", "save", "33", "--node-id", "2", "--version", "3",
      "--context-id", "requirement:33", "--context-version", "3", "--arguments-json", "{}",
      "--idempotency-key", "idem-analysis-1", "--preview-operation-id", "preview-analysis-1",
    ], first.dependencies);
    const second = deps(client as never);
    await runCli([
      "workflow", "action", "story", "34", "complete", "--arguments-json", "{}",
      "--idempotency-key", "idem-workflow-1", "--preview-operation-id", "preview-workflow-1",
    ], second.dependencies);

    expect(first.stderr).toEqual([]);
    expect(second.stderr).toEqual([]);
    expect(executePreview).toHaveBeenNthCalledWith(1, "preview-analysis-1", "idem-analysis-1");
    expect(executePreview).toHaveBeenNthCalledWith(2, "preview-workflow-1", "idem-workflow-1");
  });

  it("does not expose automatic writes through exported shortcuts", async () => {
    const client = {
      capabilities: vi.fn(),
      preview: vi.fn(),
      execute: vi.fn(),
      executePreview: vi.fn(),
      context: vi.fn(async () => ({ resource: { type: "story", id: 34 }, version: 3, allowedActions: ["complete"] })),
    } as never;

    await expect(createProjectWithReadback(client, {
      arguments: { name: "AI PMS" },
      idempotencyKey: "idem-project-legacy",
    } as never)).rejects.toThrow("preview-operation-id");
    expect(() => requirementAnalysisSave(client, 33, {
      nodeId: 2,
      version: 3,
      arguments: {},
      idempotencyKey: "idem-analysis-legacy",
      previewOperationId: undefined,
    } as never)).toThrow("preview-operation-id");
    await expect(workflowAction(client, "story", 34, "complete", "idem-workflow-legacy", {})).rejects.toThrow("preview-operation-id");
    await expect(projectCreate(client, { arguments: { name: "AI PMS" }, idempotencyKey: "idem-project-create" })).rejects.toThrow("preview-operation-id");
    await expect(projectUpdate(client, { arguments: { id: 42 }, idempotencyKey: "idem-project-update" })).rejects.toThrow("preview-operation-id");
    await expect(requirementCreate(client, { arguments: { title: "需求" }, idempotencyKey: "idem-requirement-create" })).rejects.toThrow("preview-operation-id");
    await expect(requirementUpdate(client, { arguments: { id: 33 }, idempotencyKey: "idem-requirement-update" })).rejects.toThrow("preview-operation-id");

    const inspected = client as unknown as { execute: ReturnType<typeof vi.fn>; preview: ReturnType<typeof vi.fn> };
    expect(inspected.execute).not.toHaveBeenCalled();
    expect(inspected.preview).not.toHaveBeenCalled();
  });

  it("supports project-create scenario execute with a persisted preview", async () => {
    const executePreview = vi.fn(async () => ({
      operationId: "operation-scenario-project-1",
      status: "SUCCEEDED" as const,
      data: { project: { id: 77, version: 1 } },
      warnings: [],
      refreshScopes: ["project-list"],
    }));
    const client = {
      executePreview,
      get: vi.fn(async () => ({ resourceType: "project", resourceId: 77, entityVersion: 1, details: { id: 77 } })),
      context: vi.fn(async () => ({ resource: { type: "project", id: 77 }, version: 1, allowedActions: [] })),
    };
    const { dependencies, stderr } = deps(client as never);

    await runCli([
      "scenario", "project-create", "execute", "--arguments-json", '{"name":"AI PMS"}',
      "--idempotency-key", "idem-scenario-project-1", "--preview-operation-id", "preview-scenario-project-1",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(executePreview).toHaveBeenCalledWith("preview-scenario-project-1", "idem-scenario-project-1");
  });
});
