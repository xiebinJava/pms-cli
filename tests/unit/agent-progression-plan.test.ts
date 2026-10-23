import { describe, expect, it, vi } from "vitest";
import {
  executeAgentProgression,
  planAgentProgression,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgression.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";

function storyClient(overrides: {
  patch?: Record<string, unknown>;
  contextVersion?: number;
  completionMode?: "AUTO_CONFIRM" | "REQUIRES_DOMAIN_CONFIRMATION";
} = {}) {
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
            completionMode: overrides.completionMode ?? "AUTO_CONFIRM",
            completionAutomaticConfirmation: overrides.completionMode !== "REQUIRES_DOMAIN_CONFIRMATION",
            ...(overrides.completionMode === "REQUIRES_DOMAIN_CONFIRMATION"
              ? { completionBlockReason: "需要产品、设计和技术评审完成" } : {}),
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

function requirementClient() {
  const context = {
    resource: { type: "requirement" as const, id: 24 },
    version: 5,
    currentNode: { id: 101, key: "testing", label: "测试中" },
    workflow: {
      nodes: [{
        id: 101,
        version: 5,
        key: "testing",
        label: "测试中",
        components: [{
          key: "requirement-node-workbench",
          content: { testResult: "" },
          saveContract: {
            command: "development-item.node.field.update",
            completionCommand: "development-item.node.complete-with-data",
            completionSupported: true,
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 101,
            version: 5,
            fieldValuesPath: "__components.requirement-node-workbench",
            writableFields: ["testResult", "buildVersion", "reportUrl", "residualIssues"],
            protectedFields: ["status", "ownerId", "startDate", "endDate"],
            fieldContracts: [{ key: "testResult", label: "测试结果", required: true }],
          },
        }],
      }],
    },
    allowedActions: ["development-item.node.field.update", "development-item.node.complete-with-data"],
  };
  const capabilities = vi.fn(async () => ({
    version: "ai-v1",
    resources: [{
      type: "requirement",
      actions: [{
        name: "development-item.node.complete-with-data", label: "保存并完成", description: "保存并完成",
        mode: "automatic", risk: "medium", scopes: [], inputSchema: {
          itemType: {}, itemId: {}, nodeId: {}, version: {}, fieldValues: {},
          ownerId: {}, startDate: {}, endDate: {},
        }, requiresContext: true, refreshScopes: [],
      }],
    }],
    scopes: [], workflowTypes: [],
  }));
  const preview = vi.fn(async (request: { operation: string }) => ({
    operationId: "preview-requirement-complete",
    command: request.operation,
    expiresAt: "2099-01-01T00:00:00Z",
    contextVersion: "5",
    warnings: [], changes: [], refreshScopes: [], preconditions: [],
  }));
  return { context: vi.fn(async () => context), contextData: context, capabilities, preview } as any;
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

  it("stops before preview when PMS declares a domain confirmation requirement", async () => {
    const client = storyClient({ completionMode: "REQUIRES_DOMAIN_CONFIRMATION" });
    const result = await planAgentProgression(client, input("COMPLETE_NODE", {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      patch: { acceptanceConclusion: "PASS" },
      fieldSources: { acceptanceConclusion: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } },
      requestedCompletion: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    }));

    expect(result.writeDecision).toBe("WAITING_CONFIRMATION");
    expect(result.preview).toBeNull();
    expect(result.warnings).toContain("需要产品、设计和技术评审完成");
    expect(client.preview).not.toHaveBeenCalled();
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

  it("uses the atomic completion command for a requirement node", async () => {
    const client = requirementClient();
    const result = await planAgentProgression(client, {
      ...input("COMPLETE_NODE", {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { testResult: "PASS" },
        fieldSources: { testResult: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } },
        requestedCompletion: true,
        ownerId: 2,
        startDate: "2026-10-10",
        endDate: "2026-10-20",
      }),
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 101,
    });

    expect(result.writeDecision).toBe("READY");
    expect(result.operation).toBe("development-item.node.complete-with-data");
    expect(result.preview).toMatchObject({ command: "development-item.node.complete-with-data" });
  });

  it("selects direct completion for a requirement node with no fields or components", async () => {
    const client = requirementClient();
    const directContext = {
      ...client.contextData,
      currentNode: { id: 102, key: "release", label: "需求上线" },
      workflow: {
        nodes: [{
          id: 102,
          key: "release",
          label: "需求上线",
          version: 6,
          components: [],
          fields: [],
          completionContract: {
            command: "development-item.node.complete",
            completionSupported: true,
            completionCommand: "development-item.node.complete",
            writableFields: [],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 102,
            version: 6,
          },
        }],
      },
      version: 6,
      allowedActions: ["development-item.node.complete"],
    };
    client.context = vi.fn(async () => directContext);
    client.capabilities = vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "requirement",
        actions: [{
          name: "development-item.node.complete",
          label: "完成节点",
          description: "完成无字段节点",
          mode: "automatic",
          risk: "medium",
          scopes: [],
          inputSchema: { itemType: {}, itemId: {}, nodeId: {}, version: {} },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [], workflowTypes: [],
    }));

    const result = await planAgentProgression(client, {
      ...input("COMPLETE_NODE", {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: {}, requestedCompletion: true,
      }),
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 102,
    });

    expect(result.writeDecision).toBe("READY");
    expect(result.operation).toBe("development-item.node.complete");
    expect(result.normalizedArguments).toEqual({
      itemType: "REQUIREMENT", itemId: 24, nodeId: 102, version: 6,
    });
    expect(client.preview.mock.calls[0]?.[0].operation).toBe("development-item.node.complete");
  });

  it("completes a readonly execution node with metadata and no fieldValues", async () => {
    const client = requirementClient();
    const directContext = {
      ...client.contextData,
      currentNode: { id: 102, key: "release", label: "需求上线" },
      workflow: {
        nodes: [{
          id: 102,
          key: "release",
          label: "需求上线",
          version: 6,
          components: [{ key: "requirement-execution", fields: [], actions: [], contentState: "UNSUPPORTED" }],
          fields: [],
          completionContract: {
            command: "development-item.node.complete-with-data",
            completionSupported: true,
            completionCommand: "development-item.node.complete-with-data",
            writableFields: [],
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 102,
            version: 6,
          },
        }],
      },
      version: 6,
      allowedActions: ["development-item.node.complete-with-data"],
    };
    client.context = vi.fn(async () => directContext);
    client.capabilities = vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "requirement",
        actions: [{
          name: "development-item.node.complete-with-data",
          label: "完成节点",
          description: "完成无字段节点",
          mode: "automatic",
          risk: "medium",
          scopes: [],
          inputSchema: { itemType: {}, itemId: {}, nodeId: {}, version: {}, ownerId: {}, startDate: {}, endDate: {} },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [], workflowTypes: [],
    }));

    const result = await planAgentProgression(client, {
      ...input("COMPLETE_NODE", {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: {}, requestedCompletion: true, ownerId: 2, startDate: "2026-10-10", endDate: "2026-10-20",
      }),
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 102,
    });

    expect(result.writeDecision).toBe("READY");
    expect(result.operation).toBe("development-item.node.complete-with-data");
    expect(result.normalizedArguments).toEqual({
      itemType: "REQUIREMENT", itemId: 24, nodeId: 102, version: 6, ownerId: 2, startDate: "2026-10-10", endDate: "2026-10-20",
    });
    expect(client.preview.mock.calls[0]?.[0].operation).toBe("development-item.node.complete-with-data");
  });

  it("completes a root entry with metadata and an empty patch", async () => {
    const client = requirementClient();
    const directContext = {
      ...client.contextData,
      currentNode: { id: 102, key: "release", label: "需求上线" },
      workflow: {
        nodes: [{
          id: 102,
          key: "release",
          label: "需求上线",
          version: 6,
          components: [],
          fieldValues: { "requirement-title": "Existing title" },
          fields: [],
          saveContract: {
            command: "development-item.node.field.update",
            fieldValuesPath: "$",
            completionSupported: true,
            completionCommand: "development-item.node.complete-with-data",
            writableFields: ["requirement-title"],
            requiredFields: ["requirement-title"],
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 102,
            version: 6,
          },
        }],
      },
      version: 6,
      allowedActions: ["development-item.node.complete-with-data"],
    };
    client.context = vi.fn(async () => directContext);
    client.capabilities = vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "requirement",
        actions: [{
          name: "development-item.node.complete-with-data",
          label: "完成节点",
          description: "完成无字段节点",
          mode: "automatic",
          risk: "medium",
          scopes: [],
          inputSchema: { itemType: {}, itemId: {}, nodeId: {}, version: {}, ownerId: {}, startDate: {}, endDate: {} },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [], workflowTypes: [],
    }));

    const result = await planAgentProgression(client, {
      ...input("COMPLETE_NODE", {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: {}, requestedCompletion: true, ownerId: 2, startDate: "2026-10-10", endDate: "2026-10-20",
      }),
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 102,
    });

    expect(result.writeDecision).toBe("READY");
    expect(result.operation).toBe("development-item.node.complete-with-data");
    expect(result.normalizedArguments).toEqual({
      itemType: "REQUIREMENT", itemId: 24, nodeId: 102, version: 6, ownerId: 2, startDate: "2026-10-10", endDate: "2026-10-20",
    });
    expect(client.preview.mock.calls[0]?.[0].operation).toBe("development-item.node.complete-with-data");
  });

  it.each(["COMPLETE_NODE", "UPDATE_NODE_FIELDS"] as const)("rejects field patches for completion-only execution: %s", async (intent) => {
    const client = requirementClient();
    const directContext = {
      ...client.contextData,
      currentNode: { id: 102, key: "release", label: "需求上线" },
      workflow: {
        nodes: [{
          id: 102,
          key: "release",
          label: "需求上线",
          version: 6,
          components: [{ key: "requirement-execution", fields: [], actions: [], contentState: "UNSUPPORTED" }],
          fields: [],
          completionContract: {
            command: "development-item.node.complete-with-data",
            completionSupported: true,
            completionCommand: "development-item.node.complete-with-data",
            writableFields: [],
            completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 102,
            version: 6,
          },
        }],
      },
      version: 6,
      allowedActions: ["development-item.node.complete-with-data"],
    };
    client.context = vi.fn(async () => directContext);
    client.capabilities = vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "requirement",
        actions: [{
          name: "development-item.node.complete-with-data",
          label: "完成节点",
          description: "完成无字段节点",
          mode: "automatic",
          risk: "medium",
          scopes: [],
          inputSchema: { itemType: {}, itemId: {}, nodeId: {}, version: {}, ownerId: {}, startDate: {}, endDate: {} },
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [], workflowTypes: [],
    }));

    const completionCapabilities = client.capabilities;
    client.capabilities = vi.fn(async () => {
      const capabilities = await completionCapabilities();
      return { ...capabilities, resources: capabilities.resources.map((resource: any) => ({ ...resource, actions: [...resource.actions, { ...resource.actions[0]!, name: "development-item.node.field.update" }] })) };
    });
    const planned = planAgentProgression(client, {
      ...input(intent, {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { target: 999 }, fieldSources: { target: { sourceType: "conversation", sourceRefs: ["conversation:latest"], confidence: "high" } }, requestedCompletion: true, ownerId: 2, startDate: "2026-10-10", endDate: "2026-10-20",
      }),
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 102,
    });

    if (intent === "UPDATE_NODE_FIELDS") await expect(planned).rejects.toThrow(/完成专用节点/);
    else expect((await planned).writeDecision).toBe("CAPABILITY_UNAVAILABLE");
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("executes a requirement completion preview and verifies the readback", async () => {
    const client = requirementClient();
    client.get = vi.fn(async () => ({
      resourceType: "requirement",
      resourceId: 24,
      entityVersion: 5,
      details: { title: "PMS", status: "IN_PROGRESS", ownerId: 2 },
    }));
    client.executePreview = vi.fn(async () => {
      (client.contextData.workflow.nodes[0] as any).components[0].content = { testResult: "PASS" };
      return {
        operationId: "preview-requirement-complete",
        command: "development-item.node.complete-with-data",
        status: "SUCCEEDED",
        data: { requirementId: 24 },
        warnings: [],
        refreshScopes: ["development-detail"],
      };
    });
    const result = await executeAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 101,
      intent: "COMPLETE_NODE",
      executeMode: "auto",
      previewOperationId: "preview-requirement-complete",
      idempotencyKey: "requirement-complete-1",
      draft: {
        facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
        patch: { testResult: "PASS" },
        requestedCompletion: true,
        ownerId: 2,
        startDate: "2026-10-10",
        endDate: "2026-10-20",
      },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(client.executePreview).toHaveBeenCalledWith("preview-requirement-complete", "requirement-complete-1");
    expect(result.readback?.resource?.resourceId).toBe(24);
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });
  });
});
