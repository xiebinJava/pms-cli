import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

const context = {
  resource: { type: "story", id: 34 },
  version: 2,
  entityVersion: 7,
  currentNode: { id: 383, key: "writing", label: "编写" },
  workflow: {
    templateVersionId: 88,
    templateVersionNo: 3,
    nodes: [{
      id: 383,
      key: "writing",
      label: "编写",
      position: 0,
      fields: [],
      components: [{
        key: "story-node-workbench",
        label: "故事工作台",
        fields: [],
        actions: ["development-item.node.field.update"],
        saveContract: {
          command: "development-item.node.field.update",
          writableFields: ["summary"],
          nodeId: 383,
          version: 2,
        },
      }],
      fieldValues: {},
      version: 2,
    }],
  },
  relations: [],
  allowedActions: ["development-item.node.field.update"],
  meta: {
    formatVersion: 2,
    pureRead: true,
    loadedAt: "2026-10-15T08:00:00Z",
    businessTimezone: "Asia/Shanghai",
    view: "focused",
    fieldValuesScope: "selected-node",
    componentContentScope: "selected-component",
    selectedNodeId: 383,
    selectedComponentKey: "story-node-workbench",
    workflowConfigured: true,
    workflowStatus: "IN_PROGRESS",
    workflowInstanceVersion: 3,
    permissionsScope: "business-user",
    referencesScope: "readable-only",
    contextVersion: "story:34:entity:7",
    warnings: [],
  },
};

function deps(client: never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({})),
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
    setExitCode: vi.fn(),
    requestIdFactory: () => "req-agent-context",
    exitProcess: vi.fn(),
  };
  return { value, stdout, stderr };
}

describe("pms context --format agent", () => {
  it("returns an AgentWorkSession and preserves raw JSON as the default format", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "v1",
        resources: [],
        scopes: [],
        features: { readonlyWorkflowContext: true, focusedWorkflowContext: true },
        workflowTypes: [],
        agentContractVersion: "agent-contract/v1",
      })),
      context: vi.fn(async () => context),
    };
    const agent = deps(client as never);

    await runCli(["context", "story", "34", "--format", "agent", "--view", "focused", "--node-id", "383", "--component", "story-node-workbench"], agent.value);

    const output = JSON.parse(agent.stdout[0] ?? "{}");
    expect(output.data.contractVersion).toBe("agent-contract/v1");
    expect(output.data.nodeContract.writableFields).toEqual(["summary"]);
    expect(client.capabilities).toHaveBeenCalledOnce();
    expect(client.context).toHaveBeenCalledWith(
      { type: "story", id: 34 },
      { view: "focused", nodeId: 383, component: "story-node-workbench" },
    );

    const raw = deps({ context: vi.fn(async () => context) } as never);
    await runCli(["context", "story", "34"], raw.value);
    const rawOutput = JSON.parse(raw.stdout[0] ?? "{}");
    expect(rawOutput.data.meta.contextVersion).toBe("story:34:entity:7");
  });

  it("fails with a structured capability error when agent context is unavailable", async () => {
    const agent = deps({
      capabilities: vi.fn(async () => ({
        version: "v1",
        resources: [],
        scopes: [],
        features: {},
        workflowTypes: [],
        agentContractVersion: "agent-contract/v1",
      })),
      context: vi.fn(),
    } as never);

    await runCli(["context", "story", "34", "--format", "agent"], agent.value);

    expect(agent.stderr[0]).toContain("AGENT_CONTEXT_UNAVAILABLE");
    expect((agent.value.createRuntime as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("fails before context mapping when the server advertises an incompatible Agent contract", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "v1",
        resources: [],
        scopes: [],
        features: { readonlyWorkflowContext: true },
        workflowTypes: [],
        agentContractVersion: "agent-contract/v2",
      })),
      context: vi.fn(),
    };
    const agent = deps(client as never);

    await runCli(["context", "story", "34", "--format", "agent"], agent.value);

    expect(agent.stderr[0]).toContain("AGENT_CONTRACT_VERSION_UNSUPPORTED");
    expect((agent.value.createRuntime as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(client.context).not.toHaveBeenCalled();
  });

  it("rejects an unknown format before authentication", async () => {
    const agent = deps({ context: vi.fn() } as never);

    await runCli(["context", "story", "34", "--format", "yaml"], agent.value);

    expect(agent.stderr[0]).toContain("仅支持 json 或 agent");
    expect(agent.value.createRuntime).not.toHaveBeenCalled();
  });
});
