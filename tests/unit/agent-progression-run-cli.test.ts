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
    resourceDetails: { title: "测试故事", status: "IN_PROGRESS" },
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
    query: vi.fn(async () => ({
      resourceType: "story",
      items: [{ type: "story", id: 12, name: "测试故事", summary: {} }],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPage: 1,
      queryScope: "current-user-readable",
    })),
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
    executePreview: vi.fn(async () => {
      (context.workflow.nodes[0] as any).components[0].content = { summary: "草稿" };
      return {
        operationId: "operation-story-run",
        command: "development-item.node.field.update",
        status: "SUCCEEDED" as const,
        data: { storyId: 12 },
        warnings: [],
        refreshScopes: [],
        auditId: "audit-story-run",
      };
    }),
  } as any;
}

function projectClient() {
  const context = {
    resource: { type: "project" as const, id: 42 },
    version: 3,
    entityVersion: 3,
    currentNode: { id: 301, key: "design", label: "方案设计" },
    workflow: { nodes: [{ id: 301, key: "design", label: "方案设计" }] },
    allowedActions: ["node.field.update"],
  };
  return {
    get: vi.fn(async () => ({
      resourceType: "project" as const,
      resourceId: 42,
      entityVersion: 3,
      details: { name: "PMS 项目", status: "ACTIVE" },
    })),
    context: vi.fn(async () => context),
    query: vi.fn(async () => ({
      resourceType: "project",
      items: [{ type: "project", id: 42, name: "PMS 项目", summary: {} }],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPage: 1,
      queryScope: "current-user-readable",
    })),
    capabilities: vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "project",
        actions: [{
          name: "node.field.update",
          label: "更新项目节点",
          description: "更新项目节点",
          mode: "automatic" as const,
          risk: "medium" as const,
          scopes: [],
          inputSchema: {
            projectId: { type: "integer", label: "项目" },
            nodeId: { type: "integer", label: "节点" },
            workbench: { type: "string", label: "工作台" },
            fields: { type: "object", label: "字段" },
          },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [],
      workflowTypes: [],
    })),
    preview: vi.fn(async () => ({
      operationId: "preview-project-run",
      command: "node.field.update",
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: "3",
      warnings: [],
      changes: [{ field: "solutionPackage", to: "草稿" }],
      refreshScopes: [],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => ({
      operationId: "operation-project-run",
      command: "node.field.update",
      status: "SUCCEEDED" as const,
      data: { projectId: 42 },
      warnings: [],
      refreshScopes: [],
      auditId: "audit-project-run",
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
      userFacing: {
        resourceName: "测试故事",
        resourceStatus: "IN_PROGRESS",
        currentNode: "编写",
        operationStatus: "CONTEXT_READY",
      },
    });
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("resolves a progression run by exact resource name", async () => {
    const client = storyClient();
    const output = cli(client);
    await runCli([
      "scenario", "progression", "run", "story", "--name", "测试故事", "--intent", "READ_CONTEXT",
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data.userFacing.resourceName).toBe("测试故事");
    expect(client.query).toHaveBeenCalledOnce();
    expect(client.context).toHaveBeenCalledWith({ type: "story", id: 12 }, { view: "focused" });
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

  it("defaults progression run to plan mode and never writes implicitly", async () => {
    const client = storyClient();
    const output = cli(client);
    await runCli([
      "scenario", "progression", "run", "story", "12", "--intent", "UPDATE_NODE_FIELDS",
      "--draft-json", draftJson(),
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      contractVersion: agentProgressionRunContractVersion,
      status: "PLAN_READY",
    });
    expect(client.preview).toHaveBeenCalledOnce();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("returns a migration error when progression still receives the retired --version value", async () => {
    const output = cli(storyClient());
    await runCli([
      "scenario", "progression", "plan", "story", "12", "--intent", "READ_CONTEXT", "--version", "1",
    ], output.deps);

    expect(JSON.parse(output.stderr[0] ?? "{}").error).toMatchObject({
      code: "MIGRATION_REQUIRED",
    });
    expect(output.deps.createRuntime).not.toHaveBeenCalled();
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
      userFacing: {
        resourceName: "测试故事",
        operationStatus: "SUCCEEDED",
        actualChange: "写入已完成并通过回读验证",
      },
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

  it("allows project read runs and rejects invalid resources before authentication", async () => {
    const project = cli(projectClient());
    await runCli([
      "scenario", "progression", "run", "project", "--name", "PMS 项目", "--intent", "READ_CONTEXT",
    ], project.deps);
    expect(project.stderr).toEqual([]);
    expect(JSON.parse(project.stdout[0] ?? "{}").data).toMatchObject({
      status: "CONTEXT_READY",
      resourceType: "project",
    });
    expect(project.deps.createRuntime).toHaveBeenCalledOnce();

    const invalid = cli(storyClient());
    await runCli([
      "scenario", "progression", "run", "task", "12", "--intent", "READ_CONTEXT",
    ], invalid.deps);
    expect(JSON.parse(invalid.stderr[0] ?? "{}").error.code).toBe("CLI_USAGE");
    expect(invalid.deps.createRuntime).not.toHaveBeenCalled();
  });

  it("keeps the topic resource on the same name-based read path", async () => {
    const client = storyClient();
    client.get.mockResolvedValue({
      resourceType: "topic",
      resourceId: 19,
      entityVersion: 2,
      details: { title: "研发流程专题", status: "IN_PROGRESS" },
    });
    client.context.mockResolvedValue({
      resource: { type: "topic", id: 19 },
      version: 2,
      currentNode: { id: 301, key: "research", label: "专题调研" },
      workflow: { nodes: [] },
      allowedActions: [],
    });
    client.query.mockResolvedValue({
      resourceType: "topic",
      items: [{ type: "topic", id: 19, name: "研发流程专题", summary: {} }],
      total: 1,
      page: 1,
      pageSize: 100,
      totalPage: 1,
      queryScope: "current-user-readable",
    });
    const output = cli(client);
    await runCli([
      "scenario", "progression", "run", "topic", "--name", "研发流程专题", "--intent", "READ_CONTEXT",
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      status: "CONTEXT_READY",
      resourceType: "topic",
      userFacing: { resourceName: "研发流程专题", currentNode: "专题调研" },
    });
  });
});
