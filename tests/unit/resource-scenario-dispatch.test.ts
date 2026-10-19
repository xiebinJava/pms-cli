import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import {
  createResourceScenarioRegistry,
  ResourceScenarioError,
  resourceScenarioRegistry,
  type ResourceScenarioAdapter,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioRegistry.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.js";
import { resourceScenarioContractVersion } from "../../packages/pms-contracts/src/index.js";

const adapter: ResourceScenarioAdapter = {
  resourceType: "topic",
  supports: (operation) => operation === "topic.update",
  loadContext: vi.fn(async () => ({ id: "topic:12", version: "4", entityVersion: 9 })),
  normalizeArguments: vi.fn(async (input) => input.arguments ?? {}),
  validate: vi.fn(),
  resolveReadbackId: vi.fn(() => 12),
  verifyReadback: vi.fn(() => ({
    resourceReadback: true,
    contextReadback: true,
    patchApplied: true,
    protectedFieldsUnchanged: true,
  })),
};

function clientFor() {
  const client = {
    capabilities: vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "topic",
        actions: [{
          name: "topic.update",
          label: "更新专题",
          description: "更新专题",
          mode: "automatic",
          risk: "medium",
          scopes: ["pms:development:write"],
          inputSchema: {
            topicId: { type: "integer", label: "专题 ID", required: true },
            title: { type: "string", label: "名称", required: true },
          },
          requiresContext: true,
          refreshScopes: ["topic-detail"],
        }],
      }],
      scopes: ["pms:development:write"],
      workflowTypes: [],
    })),
    preview: vi.fn(async (request: { operation: string; context?: { id: string; version: string } }) => ({
      operationId: "preview-1",
      command: request.operation,
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: request.context?.version ?? "v1",
      warnings: [],
      changes: [],
      refreshScopes: ["topic-detail"],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-1",
      status: "SUCCEEDED" as const,
      data: { topicId: 12 },
      warnings: [],
      refreshScopes: ["topic-detail"],
    })),
    get: vi.fn(async () => ({
      resourceType: "topic" as const,
      resourceId: 12,
      entityVersion: 10,
      details: { id: 12, title: "新的专题名称" },
    })),
    context: vi.fn(async () => ({
      resource: { type: "topic" as const, id: 12 },
      version: 5,
      entityVersion: 10,
      allowedActions: ["topic.update"],
    })),
  } as unknown as PmsClient;
  return client;
}

describe("resource scenario adapter dispatch", () => {
  it("finds an adapter by resource type and operation", () => {
    const registry = createResourceScenarioRegistry([adapter]);

    expect(registry.find("topic", "topic.update")).toBe(adapter);
    expect(() => registry.find("project", "topic.update")).toThrowError(ResourceScenarioError);
    expect(() => registry.find("project", "topic.update")).toThrow(/CAPABILITY_UNAVAILABLE/);
  });

  it("plans without calling execute and executes only through the persisted preview", async () => {
    const client = clientFor();
    const registry = createResourceScenarioRegistry([adapter]);
    const input = {
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic" as const,
      resourceId: 12,
      operation: "topic.update",
      arguments: { topicId: 12, title: "新的专题名称" },
    };

    const plan = await planResourceScenario(client, input, registry);
    expect(plan.preview.operationId).toBe("preview-1");
    expect(client.executePreview).not.toHaveBeenCalled();
    expect(client.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "topic.update",
      context: { id: "topic:12", version: "4" },
    }));

    const result = await executeResourceScenario(client, {
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
      expectedPatch: { title: "新的专题名称" },
      previewOperationId: "preview-1",
      idempotencyKey: "topic-update-1",
    }, registry);
    expect(client.executePreview).toHaveBeenCalledWith("preview-1", "topic-update-1");
    expect(result.status).toBe("SUCCEEDED");
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });
  });

  it("rejects execute before touching the client when preview or idempotency is missing", async () => {
    const client = clientFor();
    const registry = createResourceScenarioRegistry([adapter]);

    await expect(executeResourceScenario(client, {
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
    } as never, registry)).rejects.toThrow(/previewOperationId|idempotencyKey/);
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("uses the node/component focused context for before and after readback", async () => {
    const client = clientFor();
    const registry = createResourceScenarioRegistry([adapter]);

    const result = await executeResourceScenario(client, {
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
      nodeId: 301,
      componentKey: "topic-node-workbench",
      expectedPatch: { title: "新的专题名称" },
      previewOperationId: "preview-1",
      idempotencyKey: "topic-update-focused-1",
    }, registry);

    expect(result.status).toBe("SUCCEEDED");
    expect(client.context).toHaveBeenNthCalledWith(1,
      { type: "topic", id: 12 },
      { nodeId: 301, view: "focused", component: "topic-node-workbench" },
    );
    expect(client.context).toHaveBeenNthCalledWith(2,
      { type: "topic", id: 12 },
      { nodeId: 301, view: "focused", component: "topic-node-workbench" },
    );
  });

  it("downgrades legacy execute without expectedPatch to an unknown write result", async () => {
    const client = clientFor();
    const registry = createResourceScenarioRegistry([adapter]);

    const result = await executeResourceScenario(client, {
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
      previewOperationId: "preview-1",
      idempotencyKey: "topic-update-legacy-1",
    }, registry);

    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(result.verification.patchApplied).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("expectedPatch"))).toBe(true);
  });

  it("routes the new CLI resource plan command to the shared executor", async () => {
    resourceScenarioRegistry.register(adapter);
    const client = clientFor();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies: CliDependencies = {
      createRuntime: vi.fn(async () => ({ client })),
      runAuth: vi.fn(async () => ({})),
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      setExitCode: vi.fn(),
      requestIdFactory: () => "resource-scenario-cli-1",
    };

    await runCli([
      "scenario", "resource", "plan", "topic", "topic.update", "12",
      "--arguments-json", JSON.stringify({ topicId: 12, title: "新的专题名称" }),
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}").data).toMatchObject({
      scenario: "resource-scenario",
      phase: "plan",
      resourceType: "topic",
      operation: "topic.update",
    });
  });

  it("parses focused execute options through the CLI resource command", async () => {
    resourceScenarioRegistry.register(adapter);
    const client = clientFor();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const dependencies: CliDependencies = {
      createRuntime: vi.fn(async () => ({ client })),
      runAuth: vi.fn(async () => ({})),
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
      setExitCode: vi.fn(),
      requestIdFactory: () => "resource-scenario-cli-focused-1",
    };

    await runCli([
      "scenario", "resource", "execute", "topic", "topic.update", "12",
      "--node-id", "301",
      "--component", "topic-node-workbench",
      "--expected-patch-json", JSON.stringify({ title: "新的专题名称" }),
      "--preview-operation-id", "preview-1",
      "--idempotency-key", "topic-cli-focused-1",
    ], dependencies);

    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout[0] ?? "{}").data).toMatchObject({
      phase: "execute",
      status: "SUCCEEDED",
      verification: { patchApplied: true },
    });
    expect(client.context).toHaveBeenNthCalledWith(1,
      { type: "topic", id: 12 },
      { nodeId: 301, view: "focused", component: "topic-node-workbench" },
    );
  });
});
