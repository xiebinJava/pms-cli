import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";
import { deriveResourceOrchestratorNextAction } from "../../apps/pms-cli/src/commands/scenarios/resourceOrchestrator.js";

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

  it("resumes a resource session read-only and maps missing input to the next action", async () => {
    const client = {
      getOrchestratorSession: vi.fn(async () => ({
        sessionId: 40,
        conversation: {
          conversationId: 40,
          resourceType: "project",
          resourceId: 42,
          status: "NEEDS_INPUT",
          latestPlan: null,
        },
        latestPlan: { status: "NEEDS_INPUT" },
        events: [],
        afterSequence: 3,
        nextSequence: 4,
      })),
      appendTurn: vi.fn(),
      previewPlan: vi.fn(),
      confirmPlan: vi.fn(),
    } as unknown as PmsClient;
    const test = harness(client);

    await runCli([
      "scenario", "resource-orchestrator", "resume", "40", "--after-sequence", "3",
    ], test.deps);

    const output = JSON.parse(test.stdout[0] ?? "{}").data;
    expect(client.getOrchestratorSession).toHaveBeenCalledWith(40, 3);
    expect(output.nextAction).toBe("PROVIDE_INPUT");
    expect(client.appendTurn).not.toHaveBeenCalled();
    expect(client.previewPlan).not.toHaveBeenCalled();
    expect(client.confirmPlan).not.toHaveBeenCalled();
    expect(test.stderr).toEqual([]);
  });

  it("projects confirmation, unknown-write and terminal statuses without adding a write", () => {
    const session = (status: string, preview = false) => ({
      conversation: { status },
      latestPlan: { status, preview: preview ? {} : null },
    }) as never;

    expect(deriveResourceOrchestratorNextAction(session("WAITING_CONFIRMATION"))).toBe("CONFIRM");
    expect(deriveResourceOrchestratorNextAction(session("WRITE_RESULT_UNKNOWN"))).toBe("RETRY_SAME_IDEMPOTENCY");
    expect(deriveResourceOrchestratorNextAction(session("PLAN_READY"))).toBe("PREVIEW");
    expect(deriveResourceOrchestratorNextAction(session("PREVIEWED", true))).toBe("CONFIRM");
    expect(deriveResourceOrchestratorNextAction(session("SUCCEEDED"))).toBe("NO_ACTION");
  });
});
