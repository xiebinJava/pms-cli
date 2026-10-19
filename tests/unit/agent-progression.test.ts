import { describe, expect, it, vi } from "vitest";
import {
  validateAgentProgressionDraft,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgression.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";

function client() {
  return {
    get: vi.fn(async () => ({
      resourceType: "story",
      resourceId: 34,
      entityVersion: 7,
      details: { title: "项目管理标准" },
    })),
    context: vi.fn(async () => ({
      resource: { type: "story", id: 34 },
      version: 3,
      currentNode: { id: 387, key: "acceptance", label: "验收中" },
      workflow: {
        nodes: [{
          id: 387,
          key: "acceptance",
          label: "验收中",
          components: [{
            key: "story-node-workbench",
            saveContract: {
              command: "development-item.node.field.update",
              itemType: "STORY",
              itemId: 34,
              nodeId: 387,
              version: 3,
              writableFields: ["testResult", "buildVersion"],
              protectedFields: ["status", "ownerId"],
              completionSupported: true,
              completionCommand: "development-item.node.complete-with-data",
            },
          }],
        }],
      },
      allowedActions: ["development-item.node.field.update"],
    })),
  } as any;
}

function baseDraft(patch: Record<string, unknown>, fieldSources: Record<string, unknown> = {}) {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
    fieldSources,
  };
}

describe("agent progression draft validation", () => {
  it("returns field-level diagnostics without creating a preview", async () => {
    const pms = client();
    const result = await validateAgentProgressionDraft(pms, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 34,
      nodeId: 387,
      intent: "COMPLETE_NODE",
      draft: baseDraft(
        { testResult: "PASS", status: "DONE", unknownField: "x" },
        {
          testResult: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" },
          status: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" },
          unknownField: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" },
        },
      ),
    });

    expect(result.diagnostics.unknownFields).toEqual(["unknownField"]);
    expect(result.diagnostics.protectedFields).toEqual(["status"]);
    expect(result.diagnostics.missingSources).toEqual([]);
    expect(result.diagnostics.unsafePayloadKeys).toEqual([]);
    expect(pms.get).toHaveBeenCalledOnce();
    expect(pms.context).toHaveBeenCalledOnce();
  });

  it("reports missing sources and low-confidence inferred conclusions, while allowing an empty read-only patch", async () => {
    const pms = client();
    const result = await validateAgentProgressionDraft(pms, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 34,
      nodeId: 387,
      intent: "UPDATE_NODE_FIELDS",
      draft: baseDraft(
        { testResult: "PASS", buildVersion: "1.0.0" },
        { testResult: { sourceType: "inference", sourceRefs: ["conversation:latest"], confidence: "low" } },
      ),
    });

    expect(result.diagnostics.missingSources).toEqual(["buildVersion"]);
    expect(result.diagnostics.unresolvedDecisions).toContain(
      "testResult: 低置信度推断不能自动写入高风险业务结论",
    );

    const evidence = await validateAgentProgressionDraft(pms, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 34,
      nodeId: 387,
      intent: "UPDATE_NODE_FIELDS",
      draft: {
        ...baseDraft({}),
        facts: [{ text: "事实缺少来源", sourceRefs: [] }],
        inferences: [{ text: "推断缺少来源", sourceRefs: [] }],
        assumptions: [{ text: "需要用户确认的假设", sourceRefs: [] }],
      },
    });
    expect(evidence.diagnostics.missingSources).toEqual(["facts[0]", "inferences[0]"]);
    expect(evidence.diagnostics.unresolvedDecisions).toContain(
      "假设需要确认后才能继续写入：需要用户确认的假设",
    );

    const empty = await validateAgentProgressionDraft(pms, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 34,
      nodeId: 387,
      intent: "UPDATE_NODE_FIELDS",
      draft: baseDraft({}),
    });
    expect(empty.diagnostics).toEqual({
      unknownFields: [],
      protectedFields: [],
      missingSources: [],
      unsafePayloadKeys: [],
      unresolvedDecisions: [],
    });
  });
});
