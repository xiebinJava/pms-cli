import { describe, expect, it } from "vitest";
import type { WorkflowContext, AnalysisDraft } from "../../packages/pms-contracts/src/index.js";
import {
  runAnalysisShadowCases,
  type AnalysisShadowCase,
} from "../../apps/pms-cli/src/commands/scenarios/analysisShadow.js";
import type {
  AnalysisDraftProvider,
  AnalysisDraftProviderInput,
} from "../../apps/pms-cli/src/commands/scenarios/AnalysisDraftProvider.js";

const context: WorkflowContext = {
  resource: { type: "requirement", id: 33 },
  version: 4,
  currentNode: { id: 701, key: "receiving", label: "需求接收" },
  relations: [],
  allowedActions: ["requirement.analysis.save"],
};

const cases: AnalysisShadowCase[] = [
  {
    id: "ready",
    prompt: "分析需求，先给我草稿。",
    expectedDraftStatus: "READY_FOR_REVIEW",
    expectedWriteOutcome: "SUCCEEDED",
    qualityChecks: ["facts_have_sources"],
  },
  {
    id: "readonly",
    prompt: "只分析，不要保存。",
    expectedDraftStatus: "READY_FOR_REVIEW",
    expectedWriteOutcome: "NO_WRITE",
    qualityChecks: ["draft_only"],
  },
];

const draft: AnalysisDraft = {
  facts: [{ text: "需求目标是减少人工录入", sourceRefs: ["requirement:33"] }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { analysis: "需求目标是减少人工录入" },
};

class RecordingProvider implements AnalysisDraftProvider {
  public readonly inputs: AnalysisDraftProviderInput[] = [];

  public async generate(input: AnalysisDraftProviderInput): Promise<AnalysisDraft> {
    this.inputs.push(input);
    return draft;
  }
}

describe("analysis shadow runner", () => {
  it("generates drafts for every case without invoking a PMS write", async () => {
    const provider = new RecordingProvider();

    const report = await runAnalysisShadowCases({ cases, context, provider });

    expect(provider.inputs.map((input) => input.userMessage)).toEqual([
      "分析需求，先给我草稿。",
      "只分析，不要保存。",
    ]);
    expect(report.summary).toEqual({ total: 2, generated: 2, failed: 0, validationFailed: 0 });
    expect(report.results[0]).toMatchObject({ caseId: "ready", status: "GENERATED" });
    expect(report.results[0]?.draft).toEqual(draft);
  });

  it("records provider and draft validation failures per case instead of aborting the run", async () => {
    const provider: AnalysisDraftProvider = {
      generate: async ({ userMessage }) => {
        if (userMessage.includes("非法")) throw new Error("provider unavailable");
        return {
          ...draft,
          patch: { status: "DONE" },
        };
      },
    };
    const failingCases = cases.map((item, index) => ({
      ...item,
      prompt: index === 0 ? "非法请求" : item.prompt,
    }));

    const report = await runAnalysisShadowCases({ cases: failingCases, context, provider });

    expect(report.summary).toEqual({ total: 2, generated: 0, failed: 1, validationFailed: 1 });
    expect(report.results[0]).toMatchObject({ caseId: "ready", status: "PROVIDER_ERROR", error: "provider unavailable" });
    expect(report.results[1]).toMatchObject({ caseId: "readonly", status: "VALIDATION_ERROR" });
    expect(report.results[1]?.error).toContain("受保护字段");
  });
});
