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
    exitProcess: vi.fn(),
    requestIdFactory: () => "story-turn-request",
  };
  return { value, stdout, stderr };
}

describe("story-orchestrator CLI", () => {
  it("submits a story draft turn with outer node positioning", async () => {
    const appendTurn = vi.fn(async () => ({
      planId: 30,
      turnId: 20,
      intent: "STORY_NODE_FIELD_UPDATE",
      status: "NEEDS_INPUT",
      resourceType: "story",
      resourceId: 34,
      nodeId: 702,
      contextVersion: 8,
      contextSnapshot: {},
      draft: { contractVersion: "story-workbench/v1", draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { implementationNote: "完成" },
      } },
      validationErrors: [],
      missingFields: ["selfTestResult"],
      questions: ["请补充自测结果"],
    }));
    const agent = deps({ appendTurn } as never);

    await runCli([
      "scenario", "story-orchestrator", "turn", "10",
      "--message", "补充开发信息", "--node-id", "702", "--version", "8",
      "--draft-json", JSON.stringify({
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { implementationNote: "完成" },
      }),
    ], agent.value);

    expect(appendTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 10,
      contractVersion: "story-workbench/v1",
      nodeId: 702,
      contextVersion: 8,
      draft: expect.objectContaining({ contractVersion: "story-workbench/v1" }),
    }));
    expect(JSON.parse(agent.stdout[0] ?? "{}").data.status).toBe("NEEDS_INPUT");
    expect(agent.stderr).toEqual([]);
  });
});
