import { describe, expect, it } from "vitest";
import {
  agentProgressionContractVersion,
  agentProgressionDraftResultSchema,
  agentProgressionInputSchema,
  agentProgressionPlanSchema,
  agentProgressionResultSchema,
  agentProgressionShadowDraftSchema,
} from "../../packages/pms-contracts/src/index.js";

const draft = {
  facts: [],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { acceptanceConclusion: "PASS" },
  ownerId: 2,
  startDate: "2026-10-10",
  endDate: "2026-10-20",
};

describe("agent progression contract", () => {
  it("accepts one input shape for all four resources and three intents", () => {
    for (const resourceType of ["project", "requirement", "topic", "story"] as const) {
      for (const intent of ["READ_CONTEXT", "UPDATE_NODE_FIELDS", "COMPLETE_NODE"] as const) {
        expect(agentProgressionInputSchema.parse({
          contractVersion: agentProgressionContractVersion,
          resourceType,
          resourceId: 12,
          componentKey: "story-node-workbench",
          nodeVersion: 4,
          intent,
          draft,
          executeMode: "auto",
        })).toMatchObject({ resourceType, intent, executeMode: "auto" });
      }
    }
  });

  it("rejects the retired v1 input contract and exposes the v2 version axes", () => {
    expect(agentProgressionContractVersion).toBe("agent-progression/v2");
    expect(agentProgressionInputSchema.safeParse({
      contractVersion: "agent-progression/v1",
      resourceType: "story",
      resourceId: 12,
      intent: "READ_CONTEXT",
    }).success).toBe(false);

    const parsed = agentProgressionInputSchema.parse({
      contractVersion: agentProgressionContractVersion,
      resourceType: "story",
      resourceId: 12,
      nodeVersion: 4,
      contextVersion: "conversation:42",
      componentKey: "story-node-workbench",
      intent: "READ_CONTEXT",
    });
    expect(parsed).toMatchObject({
      nodeVersion: 4,
      contextVersion: "conversation:42",
      componentKey: "story-node-workbench",
    });
  });

  it("keeps plan policy machine-readable", () => {
    const plan = agentProgressionPlanSchema.parse({
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: "story",
      resourceId: 12,
      intent: "COMPLETE_NODE",
      componentKey: "story-node-workbench",
      nodeVersion: 4,
      entityVersion: 7,
      workflowInstanceVersion: 2,
      rejectionReason: "COMPLETION_NOT_REQUESTED",
      operation: "development-item.node.complete-with-data",
      context: {},
      normalizedArguments: {},
      capability: { name: "development-item.node.complete-with-data", mode: "automatic", risk: "medium" },
      preview: null,
      requiresConfirmation: false,
      executionMode: "automatic",
      warnings: [],
    });
    expect(plan.requiresConfirmation).toBe(false);
  });

  it("returns a unified result with operation, readback and verification slots", () => {
    const result = agentProgressionResultSchema.parse({
      contractVersion: agentProgressionContractVersion,
      phase: "execute",
      status: "WAITING_CONFIRMATION",
      resourceType: "project",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      plan: null,
      operation: null,
      readback: null,
      verification: null,
      warnings: ["需要确认"],
    });
    expect(result.status).toBe("WAITING_CONFIRMATION");
  });

  it("keeps shadow output separate from executable progression input", () => {
    const shadow = agentProgressionShadowDraftSchema.parse({
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      candidateResources: [{ resourceType: "story", resourceId: 12 }],
      candidateNodes: [{ nodeId: 384, key: "acceptance", label: "验收中" }],
      requiredFields: ["acceptanceConclusion"],
      proposedFieldValues: {},
      references: ["story:12"],
    });
    expect(shadow.proposedFieldValues).toEqual({});
  });

  it("describes a read-only draft validation result without an operation", () => {
    const result = agentProgressionDraftResultSchema.parse({
      contractVersion: agentProgressionContractVersion,
      phase: "draft",
      resourceType: "story",
      resourceId: 34,
      intent: "UPDATE_NODE_FIELDS",
      contextVersion: "12",
      draft,
      warnings: [],
    });
    expect(result.phase).toBe("draft");
    expect(result.draft.patch).toEqual({ acceptanceConclusion: "PASS" });
  });
});
