import { describe, expect, it, vi } from "vitest";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

function makeDeps(client: never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({ authenticated: true })),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "req-analysis-cli"),
  };
  return { deps, stdout, stderr };
}

const catalog = {
  version: "ai-v1",
  resources: [{
    type: "requirement",
    actions: [{
      name: "requirement.analysis.save",
      label: "保存需求分析",
      description: "追加需求分析成果",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:requirement:write"],
      inputSchema: {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        version: { type: "integer", label: "版本", required: true },
        patch: { type: "object", label: "分析成果", required: true },
      },
      requiresContext: true,
      refreshScopes: ["requirement-detail"],
    }],
  }],
  scopes: [],
  workflowTypes: [],
};

describe("requirement analysis save CLI contract", () => {
  it("routes the exact three-word command and reuses the caller idempotency key", async () => {
    const previewExecutions: unknown[] = [];
    const client = {
      capabilities: async () => catalog,
      executePreview: async (operationId: string, idempotencyKey: string) => {
        previewExecutions.push({ operationId, idempotencyKey });
        return {
          operationId: "analysis-operation-1",
          status: "SUCCEEDED",
          data: { requirementId: 23, nodeId: 301, version: 8 },
          warnings: [],
          refreshScopes: ["requirement-detail"],
        };
      },
    } as never;
    const first = makeDeps(client);
    const args = [
      "requirement", "analysis", "save", "23",
      "--node-id", "301",
      "--version", "7",
      "--arguments-json", '{"background":"补充用户场景"}',
      "--idempotency-key", "analysis-save-23-7",
      "--preview-operation-id", "preview-analysis-1",
      "--context-id", "requirement:23",
      "--context-version", "7",
    ];

    await runCli(args, first.deps);
    const second = makeDeps(client);
    await runCli(args, second.deps);

    expect(previewExecutions).toEqual([
      { operationId: "preview-analysis-1", idempotencyKey: "analysis-save-23-7" },
      { operationId: "preview-analysis-1", idempotencyKey: "analysis-save-23-7" },
    ]);
    expect(JSON.parse(first.stdout[0] ?? "{}").data.operationId).toBe("analysis-operation-1");
    expect(first.stderr).toEqual([]);
  });

  it("fails before authentication when the node or version is missing", async () => {
    const client = {} as never;
    const { deps, stderr } = makeDeps(client);

    await runCli(["requirement", "analysis", "save", "23", "--idempotency-key", "idem-1"], deps);

    expect(deps.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("--node-id");
  });

  it("requires the concrete requirement context before authentication", async () => {
    const client = {} as never;
    const { deps, stderr } = makeDeps(client);

    await runCli([
      "requirement", "analysis", "save", "23",
      "--node-id", "301",
      "--version", "7",
      "--arguments-json", '{"background":"补充用户场景"}',
      "--idempotency-key", "idem-1",
    ], deps);

    expect(deps.createRuntime).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("--context-id");
  });
});
