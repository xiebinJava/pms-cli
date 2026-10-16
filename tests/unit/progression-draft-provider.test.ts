import { describe, expect, it } from "vitest";
import type { AgentProgressionShadowDraft, WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import {
  FixedProgressionDraftProvider,
  type ProgressionDraftProviderInput,
} from "../../apps/pms-cli/src/commands/scenarios/ProgressionDraftProvider.js";
import {
  runProgressionShadowCases,
  type ProgressionShadowCase,
} from "../../apps/pms-cli/src/commands/scenarios/progressionShadow.js";

const context: WorkflowContext = {
  resource: { type: "story", id: 34 },
  version: 4,
  currentNode: { id: 701, key: "acceptance", label: "验收中" },
  relations: [],
  allowedActions: ["development-item.node.complete-with-data"],
};

const draft: AgentProgressionShadowDraft = {
  facts: [{ text: "当前是故事验收节点", sourceRefs: ["story:34"], confidence: "high" }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  candidateResources: [{ resourceType: "story", resourceId: 34, confidence: "high" }],
  candidateNodes: [{ nodeId: 701, key: "acceptance", label: "验收中", confidence: "high" }],
  requiredFields: ["acceptanceConclusion"],
  proposedFieldValues: {},
  references: ["story:34", "story:34#node:701"],
};

const cases: ProgressionShadowCase[] = [{
  id: "acceptance", prompt: "分析验收节点", expectedDraftStatus: "READY_FOR_REVIEW",
  expectedWriteOutcome: "NO_WRITE", qualityChecks: ["current_node"],
}, { ...({
  id: "missing", prompt: "信息不足", expectedDraftStatus: "NEEDS_INPUT",
  expectedWriteOutcome: "NO_WRITE", qualityChecks: ["missing_field"],
} as ProgressionShadowCase) }];

describe("ProgressionDraftProvider and shadow runner", () => {
  it("returns an isolated clone from the fixed provider", async () => {
    const provider = new FixedProgressionDraftProvider(draft);
    const input: ProgressionDraftProviderInput = { userMessage: "分析", resourceType: "story", context };
    const first = await provider.generate(input);
    first.proposedFieldValues.changed = true;
    const second = await provider.generate(input);
    expect(second).toEqual(draft);
    expect(second).not.toBe(draft);
  });

  it("records program validation separately from model and human evaluation", async () => {
    const provider = {
      generate: async () => draft,
    };
    const report = await runProgressionShadowCases({
      cases, context, resourceType: "story", provider, providerName: "mock",
    });
    expect(report.mode).toBe("read-only-shadow");
    expect(report.evaluation).toEqual({ program: "VALIDATED", model: "NOT_EVALUATED", human: "PENDING" });
    expect(report.summary).toEqual({ total: 2, generated: 2, failed: 0, validationFailed: 0 });
    expect(report.results[0]).toMatchObject({ programValidation: "PASS", modelOutputStatus: "NOT_EVALUATED" });
  });

  it("does not abort when a provider fails or returns invalid output", async () => {
    const provider = {
      generate: async ({ userMessage }: ProgressionDraftProviderInput) => {
        if (userMessage === "信息不足") throw new Error("provider unavailable");
        return { ...draft, candidateNodes: "invalid" } as unknown as AgentProgressionShadowDraft;
      },
    };
    const report = await runProgressionShadowCases({
      cases, context, resourceType: "story", provider, providerName: "mock",
    });
    expect(report.summary).toEqual({ total: 2, generated: 0, failed: 1, validationFailed: 1 });
    expect(report.results[0]?.status).toBe("VALIDATION_ERROR");
    expect(report.results[1]?.status).toBe("PROVIDER_ERROR");
  });
});
