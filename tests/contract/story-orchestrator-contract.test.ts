import { describe, expect, it } from "vitest";
import {
  orchestratorConversationSchema,
  orchestratorDraftSchema,
  orchestratorPlanSchema,
} from "../../packages/pms-contracts/src/index.js";

const storyDraft = {
  contractVersion: "story-workbench/v1",
  draft: {
    facts: [{ text: "当前节点是开发", sourceRefs: ["story-node:702#component:story-node-workbench"] }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch: { implementationNote: "已完成" },
  },
};

const nodeContract = {
  nodeId: 702,
  key: "development",
  label: "开发",
  version: 8,
  variant: "development",
  requiredFields: [
    { key: "implementationNote", label: "实现说明", type: "string", required: true, nullable: false, collection: false },
    { key: "selfTestResult", label: "自测结果", type: "string", required: true, nullable: false, collection: false },
  ],
  writableFields: ["implementationNote", "selfTestResult", "testCases"],
  protectedFields: ["ownerId", "status"],
  allowedActions: ["development-item.node.field.update"],
  allowedTransitions: [],
  missingInputRules: ["必填字段不能为空或只包含空白字符"],
  writeCapable: true,
};

describe("story orchestrator contract", () => {
  it("accepts story draft and needs-input plan without an operation", () => {
    expect(orchestratorDraftSchema.parse(storyDraft)).toMatchObject({ contractVersion: "story-workbench/v1" });
    const parsed = orchestratorPlanSchema.parse({
      planId: 30,
      turnId: 20,
      intent: "STORY_NODE_FIELD_UPDATE",
      status: "NEEDS_INPUT",
      resourceType: "story",
      resourceId: 34,
      nodeId: 702,
      contextVersion: 8,
      contextSnapshot: {},
      draft: storyDraft,
      preview: null,
      operation: null,
      verification: null,
      validationErrors: [],
      errorCode: "STORY_MISSING_INPUT",
      errorMessage: "缺少自测结果",
      nodeContract,
      missingFields: ["selfTestResult"],
      questions: ["请补充自测结果"],
    });
    expect(parsed.resourceType).toBe("story");
    expect("missingFields" in parsed ? parsed.missingFields : undefined).toEqual(["selfTestResult"]);
  });

  it("accepts a story conversation while keeping requirement shape valid", () => {
    expect(orchestratorConversationSchema.parse({
      conversationId: 10, resourceType: "story", resourceId: 34, status: "ACTIVE", latestPlan: null,
    }).resourceType).toBe("story");
  });
});
