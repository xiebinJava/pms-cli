import { describe, expect, it } from "vitest";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";

const envelope = (data: unknown) => new Response(
  JSON.stringify({ code: 200, msg: "操作成功", data, requestId: "session-server-1" }),
  { status: 200, headers: { "content-type": "application/json" } },
);

describe("AI orchestrator session contract", () => {
  it("combines the durable conversation and incremental events without local state", async () => {
    const requests: string[] = [];
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (input, init) => {
        requests.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}${new URL(String(input)).search}`);
        return envelope({
          sessionId: 10,
          conversation: {
            conversationId: 10,
            resourceType: "requirement",
            resourceId: 33,
            status: "WAITING_CONFIRMATION",
            latestPlan: null,
          },
          latestPlan: {
            planId: 30,
            turnId: 20,
            intent: "REQUIREMENT_ANALYSIS_SAVE",
            status: "SUCCEEDED",
            resourceType: "requirement",
            resourceId: 33,
            nodeId: 375,
            contextVersion: 5,
            contextSnapshot: { resourceType: "requirement", resourceId: 33, version: 5 },
            draft: {
              contractVersion: "requirement-analysis/v1",
              draft: {
                facts: [],
                inferences: [],
                assumptions: [],
                unresolvedDecisions: [],
                patch: { analysis: "已保存" },
              },
            },
            preview: {
              operationId: "op-1",
              command: "requirement.analysis.save",
              expiresAt: "2026-10-16T12:00:00Z",
              contextVersion: "5",
              warnings: [],
              changes: [],
              refreshScopes: [],
              preconditions: [],
            },
            operation: {
              operationId: "op-1",
              status: "SUCCEEDED",
              message: "已保存",
              data: {},
              refreshScopes: [],
            },
            verification: {
              resourceReadback: true,
              contextReadback: true,
              protectedFieldsUnchanged: true,
              patchApplied: true,
              status: "SUCCEEDED",
              message: "写入并回读验证成功",
            },
            validationErrors: [],
            errorCode: null,
            errorMessage: null,
            idempotencyKey: "idem-1",
            confirmedAt: "2026-10-16T11:00:00",
            executedAt: "2026-10-16T11:00:01",
          },
          events: [{
            sequenceNo: 5,
            eventType: "WAITING_CONFIRMATION",
            operationId: null,
            detail: { planId: 30 },
            createdAt: null,
          }],
          afterSequence: 4,
          nextSequence: 6,
        });
      },
    });

    const session = await client.getOrchestratorSession(10, 4);

    expect(session.sessionId).toBe(10);
    expect(session.conversation.status).toBe("WAITING_CONFIRMATION");
    expect(session.latestPlan?.operation?.operationId).toBe("op-1");
    expect(session.latestPlan?.verification?.status).toBe("SUCCEEDED");
    expect(session.latestPlan?.idempotencyKey).toBe("idem-1");
    expect(session.events[0]?.sequenceNo).toBe(5);
    expect(session.afterSequence).toBe(4);
    expect(session.nextSequence).toBe(6);
    expect(requests).toEqual([
      "GET /integration/ai/v1/orchestrator/conversations/10/session?afterSequence=4",
    ]);
  });
});
