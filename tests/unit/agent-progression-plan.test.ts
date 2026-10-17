import { describe, expect, it, vi } from "vitest";
import {
  planAgentProgression,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgression.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";

function storyClient(overrides: { patch?: Record<string, unknown>; contextVersion?: number } = {}) {
  const preview = vi.fn(async (request: { operation: string }) => ({
    operationId: "preview-node-detail",
    command: request.operation,
    expiresAt: "2099-01-01T00:00:00Z",
    contextVersion: String(overrides.contextVersion ?? 3),
    warnings: [],
    changes: [],
    refreshScopes: [],
    preconditions: [{ code: "OWNER_REQUIRED", message: "负责人不能为空" }],
  }));
  const context = vi.fn(async () => ({
    resource: { type: "story", id: 34 },
    version: overrides.contextVersion ?? 3,
    currentNode: { id: 387, key: "acceptance", label: "验收中" },
    workflow: {
      nodes: [{
        id: 387,
        key: "acceptance",
        label: "验收中",
        version: 3,
        components: [{
          key: "story-node-workbench",
          label: "故事工作台",
          fields: [],
          content: { acceptanceConclusion: "" },
          saveContract: {
            command: "development-item.node.field.update",
            completionCommand: "development-item.node.complete-with-data",
            completionSupported: true,
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
            itemType: "STORY",
            itemId: 34,
            nodeId: 387,
            version: 3,
            componentKey: "story-node-workbench",
            variant: "acceptance",
            fieldValuesPath: "__components.story-node-workbench",
            writableFields: ["acceptanceConclusion", "acceptanceNote"],
            protectedFields: ["status", "ownerId", "startDate", "endDate"],
            fieldContracts: [{
              key: "acceptanceConclusion", label: "验收结论", type: "enum", required: true,
              nullable: false, collection: false, options: ["PASS", "CONDITIONAL", "FAIL"],
            }],
          },
        }],
      }],
    },
    allowedActions: ["development-item.node.field.update", "development-item.node.complete-with-data"],
  }));
  const capabilities = vi.fn(async () => ({
    version: "ai-v1",
    resources: [{
      type: "story",
      actions: [
        { name: "development-item.node.field.update", label: "保存", description: "保存", mode: "automatic", risk: "medium", scopes: [], inputSchema: {}, requiresContext: true, refreshScopes: [] },
        { name: "development-item.node.complete-with-data", label: "保存并完成", description: "保存并完成", mode: "automatic", risk: "medium", scopes: [], inputSchema: {}, requiresContext: true, refreshScopes: [] },
      ],
    }],
    scopes: [], workflowTypes: [],
  }));
  return { context, capabilities, preview } as any;
}

function input(intent: "UPDATE_NODE_FIELDS" | "COMPLETE_NODE", draft: Record<string, unknown>, extra = {}) {
  return {
    contractVersion: agentProgressionContractVersion,
    resourceType: "story" as const,
    resourceId: 34,
    nodeId: 387,
    intent,
    executeMode: "auto" as const,
    draft,
    ...extra,
  };
}

describe("agent progression plan", () => {
  it("returns NEEDS_INPUT without creating a preview when completion metadata is missing", async () => {
    const client = storyClient();
    const result = await planAgentProgression(client, input("COMPLETE_NODE", {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      patch: { acceptanceConclusion: "PASS" },
      fieldSources: { acceptanceConclusion: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } },
      requestedCompletion: true,
      ownerId: 2,
    }));

    expect(result.writeDecision).toBe("NEEDS_INPUT");
    expect(result.missingFields.map((field: { key: string }) => field.key)).toEqual(["startDate", "endDate"]);
    expect(result.preview).toBeNull();
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("returns a field diff and previews atomic completion for a complete draft", async () => {
    const client = storyClient();
    const result = await planAgentProgression(client, input("COMPLETE_NODE", {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      patch: { acceptanceConclusion: "PASS" },
      fieldSources: { acceptanceConclusion: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } },
      requestedCompletion: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    }));

    expect(result.writeDecision).toBe("READY");
    expect(result.fieldChanges).toEqual([expect.objectContaining({
      key: "acceptanceConclusion", label: "验收结论", from: "", to: "PASS",
      sourceType: "conversation", confidence: "high",
    })]);
    expect(result.operation).toBe("development-item.node.complete-with-data");
    expect(client.preview.mock.calls[0]?.[0].operation).toBe("development-item.node.complete-with-data");
  });

  it("keeps UPDATE_NODE_FIELDS on the field update command", async () => {
    const client = storyClient();
    const result = await planAgentProgression(client, input("UPDATE_NODE_FIELDS", {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      patch: { acceptanceNote: "补充说明" },
      fieldSources: { acceptanceNote: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } },
    }));

    expect(result.writeDecision).toBe("READY");
    expect(result.operation).toBe("development-item.node.field.update");
    expect(client.preview.mock.calls[0]?.[0].operation).toBe("development-item.node.field.update");
  });
});
