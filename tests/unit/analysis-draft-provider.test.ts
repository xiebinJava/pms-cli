import { describe, expect, it } from "vitest";
import type { WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import {
  FixedAnalysisDraftProvider,
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

});
