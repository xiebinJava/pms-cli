import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

function deps(client: PmsClient) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    deps: {
      createRuntime: vi.fn(async () => ({ client })),
      runAuth: vi.fn(async () => ({})),
      writeStdout: (value: string) => stdout.push(value),
      writeStderr: (value: string) => stderr.push(value),
      setExitCode: vi.fn(),
      requestIdFactory: vi.fn(() => "req-orchestrator"),
    },
  };
}

describe("requirement analysis orchestrator CLI", () => {
  it("creates a conversation from a requirement resource id", async () => {
    const client = {
      createConversation: vi.fn(async (request) => ({
        conversationId: 10, resourceType: request.resourceType, resourceId: request.resourceId, status: "ACTIVE", latestPlan: null,
      })),
    } as unknown as PmsClient;
    const harness = deps(client);

    await runCli(["scenario", "requirement-analysis", "orchestrate", "create", "33"], harness.deps);

    expect(client.createConversation).toHaveBeenCalledWith({ resourceType: "requirement", resourceId: 33 });
    expect(JSON.parse(harness.stdout[0] ?? "{}").data.conversationId).toBe(10);
  });

  it("submits a structured draft and confirms by idempotency key", async () => {
    const draft = {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { analysis: "结果" },
    };
    const client = {
      appendTurn: vi.fn(async () => ({ planId: 30, turnId: 20, status: "PLAN_READY" })),
      confirmPlan: vi.fn(async (request) => ({ planId: request.planId, status: "SUCCEEDED" })),
    } as unknown as PmsClient;
    const harness = deps(client);

    await runCli([
      "scenario", "requirement-analysis", "orchestrate", "turn", "10",
      "--message", "请保存", "--draft-json", JSON.stringify(draft), "--node-id", "375", "--version", "4",
    ], harness.deps);
    await runCli([
      "scenario", "requirement-analysis", "orchestrate", "confirm", "30", "--idempotency-key", "idem-1",
    ], harness.deps);

    expect(client.appendTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 10,
      message: "请保存",
      contractVersion: "requirement-analysis/v1",
      nodeId: 375,
      contextVersion: 4,
    }));
    expect(client.confirmPlan).toHaveBeenCalledWith(expect.objectContaining({ planId: 30, idempotencyKey: "idem-1" }));
    expect(harness.stderr).toEqual([]);
  });
});
