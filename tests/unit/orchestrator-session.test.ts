import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

function harness(client: PmsClient) {
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
      requestIdFactory: vi.fn(() => "session-request-1"),
    },
  };
}

describe("orchestrator session CLI", () => {
  it("loads a durable session snapshot with an event cursor", async () => {
    const client = {
      getOrchestratorSession: vi.fn(async (conversationId: number, afterSequence: number) => ({
        sessionId: conversationId,
        conversation: {
          conversationId,
          resourceType: "requirement",
          resourceId: 33,
          status: "WAITING_CONFIRMATION",
          latestPlan: null,
        },
        latestPlan: null,
        events: [{
          sequenceNo: afterSequence + 1,
          eventType: "WAITING_CONFIRMATION",
          operationId: null,
          detail: {},
          createdAt: null,
        }],
        afterSequence,
        nextSequence: afterSequence + 2,
      })),
    } as unknown as PmsClient;
    const test = harness(client);

    await runCli([
      "scenario", "requirement-analysis", "orchestrate", "session", "10",
      "--after-sequence", "4",
    ], test.deps);

    expect(client.getOrchestratorSession).toHaveBeenCalledWith(10, 4);
    expect(JSON.parse(test.stdout[0] ?? "{}").data.nextSequence).toBe(6);
    expect(test.stderr).toEqual([]);
  });
});
