import { describe, expect, it } from "vitest";
import { PmsClientError, PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";

describe("AI orchestrator client safety", () => {
  it("retries event reads but never retries preview or confirm", async () => {
    let eventAttempts = 0;
    const eventClient = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        eventAttempts += 1;
        return eventAttempts === 1
          ? new Response(JSON.stringify({ code: 500, msg: "暂时不可用", data: null }), { status: 500 })
          : new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 });
      },
    });
    await eventClient.listConversationEvents(10);
    expect(eventAttempts).toBe(2);

    let previewAttempts = 0;
    const previewClient = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 3,
      retryDelayMs: 0,
      fetchImpl: async () => {
        previewAttempts += 1;
        return new Response(JSON.stringify({ code: 500, msg: "失败", data: null }), { status: 500 });
      },
    });
    await expect(previewClient.previewPlan(30)).rejects.toBeDefined();
    expect(previewAttempts).toBe(1);
  });

  it("classifies malformed orchestrator responses as validation without retrying", async () => {
    let attempts = 0;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 2,
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        return new Response(JSON.stringify({
          code: 200,
          data: { conversationId: "not-a-number" },
        }), { status: 200 });
      },
    });

    const error = await client.getConversation(10).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PmsClientError);
    expect((error as PmsClientError).kind).toBe("validation");
    expect(attempts).toBe(1);
  });
});
