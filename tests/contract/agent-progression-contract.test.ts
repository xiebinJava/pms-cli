import { describe, expect, it } from "vitest";
import {
  agentProgressionContractVersion,
  agentProgressionInputSchema,
  agentProgressionPlanSchema,
  agentProgressionResultSchema,
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
          intent,
          draft,
          executeMode: "auto",
        })).toMatchObject({ resourceType, intent, executeMode: "auto" });
      }
    }
  });

  it("keeps plan policy machine-readable", () => {
    const plan = agentProgressionPlanSchema.parse({
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: "story",
      resourceId: 12,
      intent: "COMPLETE_NODE",
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
});
