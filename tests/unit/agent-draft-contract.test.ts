import { describe, expect, it } from "vitest";
import {
  buildChildAgentTask,
  parseAgentDraftJson,
  validateAgentDraft,
} from "../../apps/pms-cli/src/commands/scenarios/AgentDraftContract.js";
import type { WorkflowContext } from "../../packages/pms-contracts/src/index.js";

const context: WorkflowContext = {
  resource: { type: "requirement", id: 33 },
  version: 4,
  currentNode: { id: 701, key: "receiving", label: "需求接收" },
  relations: [],
  allowedActions: ["requirement.analysis.save"],
};

const validDraft = {
  facts: [{ text: "需求目标是减少人工录入", sourceRefs: ["requirement:33"] }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { analysis: "需求目标是减少人工录入" },
};

describe("Agent Draft Contract", () => {
  it("parses the structured draft JSON", () => {
    expect(parseAgentDraftJson(JSON.stringify(validDraft))).toEqual(validDraft);
  });

  it("rejects malformed JSON and incomplete drafts", () => {
    expect(() => parseAgentDraftJson("{bad"),).toThrow(/JSON/);
    expect(() => parseAgentDraftJson(JSON.stringify({ facts: [] }))).toThrow(/AnalysisDraft/);
  });

  it("validates sources and protected fields against PMS context", () => {
    expect(validateAgentDraft(parseAgentDraftJson(JSON.stringify(validDraft)), context)).toEqual(validDraft);
    expect(() => validateAgentDraft({
      ...validDraft,
      facts: [{ text: "越权", sourceRefs: ["project:999"] }],
    }, context)).toThrow(/未授权/);
    expect(() => validateAgentDraft({
      ...validDraft,
      patch: { status: "DONE" },
    }, context)).toThrow(/受保护字段/);
  });

  it("always creates a read-only child task", () => {
    const child = buildChildAgentTask({
      parentTaskId: "parent-1",
      taskId: "child-1",
      role: "事实核验",
      objective: "整理上下文事实",
      snapshot: {
        snapshotId: "requirement:33@requirement:33:entity:4",
        resource: { type: "requirement", id: 33 },
        contextVersion: "requirement:33:entity:4",
        capturedAt: "2026-10-15T08:00:00Z",
        currentNode: { id: 701, key: "receiving", label: "需求接收" },
        workflowNodes: [],
        relations: [],
        allowedActions: ["requirement.analysis.save"],
        sourceRefs: ["requirement:33"],
        warnings: [],
      },
    });

    expect(child.permissionMode).toBe("read-only");
  });
});
