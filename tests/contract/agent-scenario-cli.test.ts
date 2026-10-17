import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

function deps(client: never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({})),
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
    setExitCode: vi.fn(),
    requestIdFactory: () => "req-scenario-agent",
    exitProcess: vi.fn(),
  };
  return { value, stdout, stderr };
}

describe("scenario --format agent", () => {
  it("returns draft diagnostics without creating a preview or executing a write", async () => {
    const client = {
      get: vi.fn(async () => ({
        resourceType: "story", resourceId: 34, entityVersion: 7, details: { title: "项目管理标准" },
      })),
      context: vi.fn(async () => ({
        resource: { type: "story", id: 34 },
        version: 3,
        currentNode: { id: 387, key: "acceptance", label: "验收中" },
        workflow: {
          nodes: [{
            id: 387,
            key: "acceptance",
            label: "验收中",
            components: [{
              key: "story-node-workbench",
              saveContract: {
                command: "development-item.node.field.update",
                writableFields: ["testResult"],
                protectedFields: ["status"],
              },
            }],
          }],
        },
        allowedActions: ["development-item.node.field.update"],
      })),
      preview: vi.fn(),
      executePreview: vi.fn(),
    };
    const cli = deps(client as never);
    await runCli([
      "scenario", "progression", "draft", "story", "34", "--node-id", "387",
      "--intent", "UPDATE_NODE_FIELDS", "--draft-json", JSON.stringify({
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { testResult: "PASS", status: "DONE" },
        fieldSources: {
          testResult: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" },
          status: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" },
        },
      }),
    ], cli.value);

    expect(cli.stderr).toEqual([]);
    const output = JSON.parse(cli.stdout[0] ?? "{}");
    expect(output.data.diagnostics).toMatchObject({
      unknownFields: [],
      protectedFields: ["status"],
    });
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("normalizes a story-workbench plan without changing the existing command arguments", async () => {
    const context = {
      resource: { type: "story" as const, id: 34 },
      version: 1,
      currentNode: { id: 384, key: "writing", label: "编写" },
      workflow: {
        nodes: [{
          id: 384,
          key: "writing",
          label: "编写",
          position: 0,
          fields: [],
          components: [{
            key: "story-node-workbench",
            label: "故事工作台",
            fields: [],
            actions: [],
            saveContract: {
              command: "development-item.node.field.update",
              itemType: "STORY",
              itemId: 34,
              nodeId: 384,
              version: 1,
              componentKey: "story-node-workbench",
              variant: "writing",
              fieldValuesPath: "__components.story-node-workbench",
              writableFields: ["summary"],
            },
          }],
          fieldValues: {},
          version: 1,
        }],
      },
      allowedActions: [],
    };
    const client = {
      capabilities: vi.fn(async () => ({
        version: "v1",
        resources: [{
          type: "story",
          actions: [{
            name: "development-item.node.field.update",
            label: "更新故事节点",
            description: "更新故事节点",
            mode: "automatic",
            risk: "medium",
            scopes: [],
            inputSchema: {},
            requiresContext: true,
            refreshScopes: [],
          }],
        }],
        scopes: [],
        workflowTypes: [],
      })),
      context: vi.fn(async () => context),
      preview: vi.fn(async () => ({
        operationId: "preview-1",
        command: "development-item.node.field.update",
        expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "1",
        warnings: [],
        changes: [],
        refreshScopes: [],
        preconditions: [],
      })),
    };
    const cli = deps(client as never);

    await runCli([
      "scenario", "story-workbench", "plan", "34",
      "--node-id", "384", "--version", "1", "--variant", "writing",
      "--patch-json", "{\"summary\":\"草稿\"}", "--format", "agent",
    ], cli.value);

    const output = JSON.parse(cli.stdout[0] ?? "{}");
    expect(output.data.contractVersion).toBe("agent-contract/v1");
    expect(output.data.draft.scenarioDraft.contractVersion).toBe("story-workbench/v1");
    expect(output.data.preview.operationId).toBe("preview-1");
    expect(client.preview).toHaveBeenCalledOnce();
  });
});
