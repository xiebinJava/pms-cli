import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import {
  executeAgentProgression,
  planAgentProgression,
  validateAgentProgressionDraft,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgression.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";

function readClient(): any {
  return {
    get: vi.fn(async (ref: { type: string; id: number }) => ({
      resourceType: ref.type,
      resourceId: ref.id,
      entityVersion: 1,
      details: { id: ref.id, title: "PMS" },
    })),
    context: vi.fn(async (ref: { type: string; id: number }) => ({
      resource: { type: ref.type, id: ref.id },
      version: 1,
      entityVersion: 1,
      allowedActions: [],
    })),
  };
}

function dependencies(client: any) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({})),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "progression-test-1"),
  };
  return { deps, stdout, stderr };
}

describe("agent progression dispatch", () => {
  it.each(["project", "requirement", "topic", "story"] as const)(
    "reads context through the same entry for %s",
    async (resourceType) => {
      const client = readClient();
      const plan = await planAgentProgression(client, {
        contractVersion: agentProgressionContractVersion,
        resourceType,
        resourceId: 12,
        intent: "READ_CONTEXT",
      });

      expect(plan.resourceType).toBe(resourceType);
      expect(plan.executionMode).toBe("read");
      expect(plan.preview).toBeNull();
      expect(client.get).toHaveBeenCalledTimes(1);
      expect(client.context).toHaveBeenCalledTimes(1);
    },
  );

  it("does not register COMPLETE_NODE for non-story resources", async () => {
    await expect(planAgentProgression(readClient(), {
      contractVersion: agentProgressionContractVersion,
      resourceType: "requirement",
      resourceId: 12,
      intent: "COMPLETE_NODE",
      draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: {}, requestedCompletion: true,
      },
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("resolves a project node write from context and capability instead of model operation text", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "project",
          actions: [{
            name: "node.field.update", label: "更新项目节点", description: "更新项目节点",
            mode: "automatic", risk: "medium", scopes: [],
            inputSchema: {
              projectId: { type: "integer", label: "项目", required: true },
              nodeId: { type: "integer", label: "节点", required: true },
              workbench: { type: "string", label: "工作台", required: true },
              fields: { type: "object", label: "字段", required: true },
            }, requiresContext: true, refreshScopes: [],
          }],
        }], scopes: [], workflowTypes: [],
      })),
      context: vi.fn(async () => ({
        resource: { type: "project", id: 12 }, version: 9, entityVersion: 9,
        resourceDetails: { status: "ACTIVE" }, currentNode: { id: 301, key: "design", label: "设计" },
        workflow: { nodes: [{ id: 301, key: "design", label: "设计", version: 4, components: [{
          key: "solution-design", label: "方案设计", fields: [],
          saveContract: {
            command: "node.field.update", projectId: 12, nodeId: 301, nodeVersion: 4,
            workbench: "solution-design", writableFields: ["architecture"],
            protectedFields: [], dynamicFields: false, fieldValuesPath: "fields",
          },
        }] }] },
        relations: [], allowedActions: ["node.field.update"],
      })),
      preview: vi.fn(async (request: { operation: string; arguments: Record<string, unknown> }) => ({
        operationId: "preview-project-node", command: request.operation,
        expiresAt: "2099-01-01T00:00:00Z", contextVersion: "9", warnings: [], changes: [],
        refreshScopes: [], preconditions: [],
      })),
    } as any;

    const plan = await planAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 12,
      nodeId: 301,
      intent: "UPDATE_NODE_FIELDS",
      draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { architecture: "模块化" } },
      executeMode: "auto",
    });
    expect(plan.operation).toBe("node.field.update");
    expect(plan.executionMode).toBe("automatic");
    expect(plan.normalizedArguments).toMatchObject({
      projectId: 12, nodeId: 301, workbench: "solution-design", fields: { architecture: "模块化" },
    });
  });

  it("maps story COMPLETE_NODE to the server-declared completion command", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "story",
          actions: [
            {
              name: "development-item.node.field.update", label: "保存", description: "保存",
              mode: "automatic", risk: "medium", scopes: [], inputSchema: {
                itemType: { type: "string", label: "类型", required: true }, itemId: { type: "integer", label: "故事", required: true },
                nodeId: { type: "integer", label: "节点", required: true }, version: { type: "integer", label: "版本", required: true },
                fieldValues: { type: "object", label: "字段", required: true },
              }, requiresContext: true, refreshScopes: [],
            },
            {
              name: "development-item.node.complete-with-data", label: "保存并完成", description: "保存并完成",
              mode: "automatic", risk: "medium", scopes: [], inputSchema: {
                itemType: { type: "string", label: "类型", required: true }, itemId: { type: "integer", label: "故事", required: true },
                nodeId: { type: "integer", label: "节点", required: true }, version: { type: "integer", label: "版本", required: true },
                fieldValues: { type: "object", label: "字段", required: true }, ownerId: { type: "integer", label: "负责人", required: false },
                startDate: { type: "string", label: "开始", required: false }, endDate: { type: "string", label: "结束", required: false },
              }, requiresContext: true, refreshScopes: [],
            },
          ],
        }], scopes: [], workflowTypes: [],
      })),
      context: vi.fn(async () => ({
        resource: { type: "story", id: 12 }, version: 1, currentNode: { id: 384, key: "acceptance", label: "验收中" },
        workflow: { nodes: [{ id: 384, key: "acceptance", label: "验收中", components: [{
          key: "story-node-workbench", label: "故事工作台", fields: [], saveContract: {
            command: "development-item.node.field.update", completionCommand: "development-item.node.complete-with-data",
            completionSupported: true, itemType: "STORY", itemId: 12, nodeId: 384, version: 1,
            componentKey: "story-node-workbench", variant: "acceptance", fieldValuesPath: "__components.story-node-workbench",
            writableFields: ["acceptanceConclusion"],
          },
        }] }] }, allowedActions: [],
      })),
      preview: vi.fn(async (request: { operation: string }) => ({
        operationId: "preview-story-complete", command: request.operation,
        expiresAt: "2099-01-01T00:00:00Z", contextVersion: "1", warnings: [], changes: [],
        refreshScopes: [], preconditions: [],
      })),
    } as any;

    const plan = await planAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story", resourceId: 12, nodeId: 384, contextVersion: 1,
      intent: "COMPLETE_NODE", executeMode: "auto",
      draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { acceptanceConclusion: "PASS" }, ownerId: 2 },
    });
    expect(plan.operation).toBe("development-item.node.complete-with-data");
    expect(plan.executionMode).toBe("automatic");
  });

  it("returns WAITING_CONFIRMATION before any write for a high-risk auto request", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "project",
          actions: [{
            name: "node.field.update", label: "更新节点", description: "更新节点",
            mode: "automatic", risk: "high", scopes: [], inputSchema: {},
            requiresContext: true, refreshScopes: [],
          }],
        }],
        scopes: [], workflowTypes: [],
      })),
      executePreview: vi.fn(),
    } as any;
    const result = await executeAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      executeMode: "auto",
      previewOperationId: "preview-1",
      idempotencyKey: "idem-1",
    });

    expect(result.status).toBe("WAITING_CONFIRMATION");
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("rejects a story write when the requested node is not the focused current node", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "story",
          actions: [{
            name: "development-item.node.field.update", label: "保存", description: "保存",
            mode: "automatic", risk: "medium", scopes: [], inputSchema: {},
            requiresContext: true, refreshScopes: [],
          }],
        }],
        scopes: [], workflowTypes: [],
      })),
      context: vi.fn(async () => ({
        resource: { type: "story", id: 12 },
        version: 1,
        currentNode: { id: 383, key: "writing", label: "编写" },
        workflow: { nodes: [{
          id: 384,
          key: "acceptance",
          label: "验收中",
          components: [{
            key: "story-node-workbench",
            saveContract: {
              command: "development-item.node.field.update",
              itemType: "STORY",
              itemId: 12,
              nodeId: 384,
              version: 1,
              componentKey: "story-node-workbench",
              variant: "acceptance",
              fieldValuesPath: "__components.story-node-workbench",
              writableFields: ["summary"],
            },
          }],
        }] },
        allowedActions: ["development-item.node.field.update"],
      })),
      preview: vi.fn(),
    } as any;

    await expect(planAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 12,
      nodeId: 384,
      intent: "UPDATE_NODE_FIELDS",
      draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { summary: "已分析" } },
    })).rejects.toMatchObject({ code: "CONTEXT_CONFLICT" });
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("rejects a read-only capability before creating a write preview", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{
          type: "project",
          actions: [{
            name: "node.field.update", label: "读取节点", description: "读取节点",
            mode: "read", risk: "low", scopes: [], inputSchema: {},
            requiresContext: true, refreshScopes: [],
          }],
        }],
        scopes: [], workflowTypes: [],
      })),
      preview: vi.fn(),
    } as any;

    await expect(planAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: {} },
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("exposes the unified CLI plan entry and rejects unknown resources", async () => {
    const client = readClient();
    const output = dependencies(client);
    await runCli([
      "scenario", "progression", "plan", "story", "12", "--intent", "READ_CONTEXT",
    ], output.deps);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      phase: "plan", resourceType: "story", intent: "READ_CONTEXT",
    });

    const unknown = dependencies(client);
    await runCli([
      "scenario", "progression", "plan", "task", "12", "--intent", "READ_CONTEXT",
    ], unknown.deps);
    expect(JSON.parse(unknown.stderr[0] ?? "{}").error.code).toBe("CLI_USAGE");
    expect(unknown.deps.createRuntime).not.toHaveBeenCalled();
  });

  it("runs the shadow command with the fixed provider and never needs write methods", async () => {
    const client = readClient();
    const output = dependencies(client);
    await runCli([
      "scenario", "progression", "shadow", "story", "12",
      "--cases-file", "tests/fixtures/progression-shadow-cases.json", "--provider", "mock",
    ], output.deps);
    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      mode: "read-only-shadow", provider: "mock", summary: { total: 12, generated: 12 },
    });
  });

  it("validates an external Agent draft against a fresh context without preview or execute", async () => {
    const context = readClient();
    const result = await validateAgentProgressionDraft(context, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { summary: "已分析" } },
    });

    expect(result.phase).toBe("draft");
    expect(result.contextVersion).toBe("1");
    expect(context.context).toHaveBeenCalledTimes(1);
  });

  it("exposes progression draft validation through the CLI without preview", async () => {
    const client = readClient();
    const output = dependencies(client);
    await runCli([
      "scenario", "progression", "draft", "story", "12", "--intent", "UPDATE_NODE_FIELDS",
      "--draft-json", JSON.stringify({ facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: {} }),
    ], output.deps);

    expect(output.stderr).toEqual([]);
    expect(JSON.parse(output.stdout[0] ?? "{}").data).toMatchObject({
      phase: "draft", resourceType: "story", resourceId: 12,
    });
  });

  it("rejects credential-shaped fields before a progression draft reaches PMS", async () => {
    await expect(validateAgentProgressionDraft(readClient(), {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { apiKey: "should-not-leave-the-agent" },
      },
    })).rejects.toThrow(/凭据|credential|apiKey/i);
  });
});
