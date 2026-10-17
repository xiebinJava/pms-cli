import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import {
  agentProgressionContractVersion,
  agentProgressionRunContractVersion,
} from "../../packages/pms-contracts/src/index.js";

function storyClient() {
  const context = {
    resource: { type: "story" as const, id: 12 },
    version: 1,
    currentNode: { id: 384, key: "writing", label: "编写" },
    workflow: {
      nodes: [{
        id: 384,
        key: "writing",
        label: "编写",
        components: [{
          key: "story-node-workbench",
          content: { summary: "草稿" },
          saveContract: {
            command: "development-item.node.field.update",
            itemType: "STORY",
            itemId: 12,
            nodeId: 384,
            version: 1,
            componentKey: "story-node-workbench",
            variant: "writing",
            fieldValuesPath: "__components.story-node-workbench",
            writableFields: ["summary"],
            protectedFields: ["status", "ownerId"],
          },
        }],
      }],
    },
    allowedActions: ["development-item.node.field.update"],
  };
  return {
    get: vi.fn(async () => ({
      resourceType: "story" as const,
      resourceId: 12,
      entityVersion: 1,
      details: { title: "测试故事", status: "IN_PROGRESS" },
    })),
    context: vi.fn(async () => context),
    capabilities: vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "story",
        actions: [{
          name: "development-item.node.field.update",
          label: "更新故事节点",
          description: "更新故事节点",
          mode: "automatic" as const,
          risk: "medium" as const,
          scopes: [],
          inputSchema: {
            itemType: { type: "string", label: "类型" },
            itemId: { type: "integer", label: "故事" },
            nodeId: { type: "integer", label: "节点" },
            version: { type: "integer", label: "版本" },
            fieldValues: { type: "object", label: "字段" },
          },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [],
      workflowTypes: [],
    })),
    preview: vi.fn(async () => ({
      operationId: "preview-story-run",
      command: "development-item.node.field.update",
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: "1",
      warnings: [],
      changes: [{ field: "summary", to: "草稿" }],
      refreshScopes: [],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-story-run",
      command: "development-item.node.field.update",
      status: "SUCCEEDED" as const,
      data: { storyId: 12 },
      warnings: [],
      refreshScopes: [],
      auditId: "audit-story-run",
    })),
  } as any;
}

function draftJson() {
  return JSON.stringify({
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch: { summary: "草稿" },
    fieldSources: {
      summary: {
        sourceType: "conversation",
        sourceRefs: ["conversation:latest"],
        confidence: "high",
      },
    },
  });
}

function cli(client: any) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({})),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "run-cli-test"),
    exitProcess: vi.fn(),
  };
  return { deps, stdout, stderr };
}

describe("scenario progression run CLI", () => {
  it("runs a read-only context request in the stable run envelope", async () => {
    const client = storyClient();
    const output = cli(client);
    await runCli([
      "scenario", "progression", "run", "story", "12", "--intent", "READ_CONTEXT",
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "CONTEXT_READY",
      resourceType: "story",
    });
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("allows plan mode without an idempotency key", async () => {
    const output = cli(storyClient());
    await runCli([
      "scenario", "progression", "run", "story", "12", "--intent", "UPDATE_NODE_FIELDS",
      "--execute-mode", "plan", "--draft-json", draftJson(),
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      contractVersion: agentProgressionRunContractVersion,
      status: "PLAN_READY",
      plan: { preview: { operationId: "preview-story-run" } },
    });
  });

  it("passes an automatic write draft through preview and execute", async () => {
    const client = storyClient();
    const output = cli(client);
    await runCli([
      "scenario", "progression", "run", "story", "12", "--intent", "UPDATE_NODE_FIELDS",
      "--execute-mode", "auto", "--draft-json", draftJson(),
      "--idempotency-key", "story-run-1",
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      status: "SUCCEEDED",
      previewOperationId: "preview-story-run",
      operationId: "operation-story-run",
      auditId: "audit-story-run",
    });
    expect(client.executePreview).toHaveBeenCalledWith("preview-story-run", "story-run-1");
  });

  it("rejects auto/confirm without idempotency before creating a runtime", async () => {
    const output = cli(storyClient());
    await runCli([
      "scenario", "progression", "run", "story", "12", "--intent", "UPDATE_NODE_FIELDS",
      "--execute-mode", "auto", "--draft-json", draftJson(),
    ], output.deps);

    expect(JSON.parse(output.stderr[0] ?? "{}").error.code).toBe("IDEMPOTENCY_REQUIRED");
    expect(output.deps.createRuntime).not.toHaveBeenCalled();
  });

  it("rejects project run writes and invalid resources before authentication", async () => {
    const project = cli(storyClient());
    await runCli([
      "scenario", "progression", "run", "project", "12", "--intent", "READ_CONTEXT",
    ], project.deps);
    expect(JSON.parse(project.stderr[0] ?? "{}").error.code).toBe("CLI_USAGE");
    expect(project.deps.createRuntime).not.toHaveBeenCalled();

    const invalid = cli(storyClient());
    await runCli([
      "scenario", "progression", "run", "task", "12", "--intent", "READ_CONTEXT",
    ], invalid.deps);
    expect(JSON.parse(invalid.stderr[0] ?? "{}").error.code).toBe("CLI_USAGE");
    expect(invalid.deps.createRuntime).not.toHaveBeenCalled();
  });
});
