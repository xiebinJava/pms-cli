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
          latestPlan: null,
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
    expect(session.events[0]?.sequenceNo).toBe(5);
    expect(session.afterSequence).toBe(4);
    expect(session.nextSequence).toBe(6);
    expect(requests).toEqual([
      "GET /integration/ai/v1/orchestrator/conversations/10/session?afterSequence=4",
    ]);
  });
});
