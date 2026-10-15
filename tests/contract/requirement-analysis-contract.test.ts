import { describe, expect, it } from "vitest";
import {
  analysisDraftSchema,
  requirementAnalysisInputSchema,
  requirementAnalysisResultSchema,
} from "../../packages/pms-contracts/src/index.js";

describe("requirement analysis scenario contract", () => {
  const draft = {
    facts: [{ text: "需求属于订单域", sourceRefs: ["requirement:42"], confidence: "high" as const }],
    inferences: [{ text: "可能需要补充异常流程", sourceRefs: ["requirement:42"], confidence: "medium" as const }],
    assumptions: [{ text: "当前负责人仍然有效", sourceRefs: [], confidence: "low" as const }],
    unresolvedDecisions: [{ text: "是否支持批量导入", sourceRefs: ["requirement:42"] }],
    patch: { analysis: "结构化分析结果" },
  };

  it("accepts a typed draft and requirement analysis input", () => {
    const parsed = requirementAnalysisInputSchema.parse({
      resourceType: "requirement",
      resourceId: 42,
      nodeId: 7,
      contextVersion: 3,
      draft,
      save: true,
      idempotencyKey: "analysis-contract-1",
    });

    expect(parsed.resourceId).toBe(42);
    expect(parsed.draft.facts[0]?.confidence).toBe("high");
  });

  it("rejects string identifiers and unknown draft fields", () => {
    expect(requirementAnalysisInputSchema.safeParse({
      resourceType: "requirement",
      resourceId: "42",
      nodeId: 7,
      contextVersion: 3,
      draft,
      save: false,
    }).success).toBe(false);

    expect(analysisDraftSchema.safeParse({ ...draft, unsupported: "guess" }).success).toBe(false);

    expect(requirementAnalysisInputSchema.safeParse({
      resourceType: "requirement",
      resourceId: 42,
      nodeId: 7,
      contextVersion: 3,
      draft,
      save: true,
    }).success).toBe(false);
  });

  it("rejects an analysis result with an unknown status", () => {
    expect(requirementAnalysisResultSchema.safeParse({
      status: "RUNNING",
      draft,
    }).success).toBe(false);
  });

  it("keeps optional idempotency and confidence fields optional", () => {
    const parsed = analysisDraftSchema.parse({
      facts: [{ text: "事实", sourceRefs: [] }],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      patch: {},
    });
    expect(parsed.facts[0]?.confidence).toBeUndefined();
  });
});
