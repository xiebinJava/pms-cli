import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import {
  FixedAnalysisDraftProvider,
  OpenAICompatibleAnalysisDraftProvider,
  type AnalysisDraftProviderInput,
} from "../../apps/pms-cli/src/commands/scenarios/AnalysisDraftProvider.js";
import type { AnalysisDraft } from "../../packages/pms-contracts/src/index.js";

const context: WorkflowContext = {
  resource: { type: "requirement", id: 33 },
  version: 4,
  currentNode: { id: 701, key: "receiving", label: "需求接收" },
  relations: [],
  allowedActions: ["requirement.analysis.save"],
};

const draft: AnalysisDraft = {
  facts: [{ text: "需求目标是减少人工录入", sourceRefs: ["requirement:33"], confidence: "high" }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { analysis: "需求目标是减少人工录入" },
};

const input: AnalysisDraftProviderInput = {
  userMessage: "分析这条需求，先给我草稿，不要保存。",
  context,
};

describe("AnalysisDraftProvider", () => {
  it("returns a deterministic copy from the fixed provider", async () => {
    const provider = new FixedAnalysisDraftProvider(draft);

    const first = await provider.generate(input);
    first.patch.analysis = "caller mutation";
    const second = await provider.generate(input);

    expect(second).toEqual(draft);
    expect(second).not.toBe(draft);
  });

  it("sends context and user message to an OpenAI-compatible endpoint", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("test-model");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages[1].content).toContain(input.userMessage);
      expect(body.messages[1].content).toContain('"id":33');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(draft) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new OpenAICompatibleAnalysisDraftProvider({
      baseUrl: "https://model.example/v1",
      apiKey: "secret",
      model: "test-model",
      fetchImpl,
    });

    await expect(provider.generate(input)).resolves.toEqual(draft);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer secret",
      "content-type": "application/json",
    });
  });

  it("accepts fenced JSON but rejects an invalid model draft", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "```json\n{\"facts\": []}\n```" } }],
    }), { status: 200 }));
    const provider = new OpenAICompatibleAnalysisDraftProvider({
      baseUrl: "https://model.example/v1",
      apiKey: "secret",
      model: "test-model",
      fetchImpl,
    });

    await expect(provider.generate(input)).rejects.toThrow("AnalysisDraft");
  });

  it("surfaces an HTTP error without leaking the API key", async () => {
    const fetchImpl = vi.fn(async () => new Response("provider failed", { status: 502 }));
    const provider = new OpenAICompatibleAnalysisDraftProvider({
      baseUrl: "https://model.example/v1",
      apiKey: "secret-value",
      model: "test-model",
      fetchImpl,
    });

    await expect(provider.generate(input)).rejects.toThrow(/HTTP 502/);
    await expect(provider.generate(input)).rejects.not.toThrow("secret-value");
  });
});
