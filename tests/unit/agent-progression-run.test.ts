import { describe, expect, it, vi } from "vitest";
import {
  runAgentProgression,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgressionRun.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";

type Risk = "low" | "medium" | "high";

function requirementClient(risk: Risk = "medium") {
  const context = {
    resource: { type: "requirement" as const, id: 24 },
    version: 5,
    entityVersion: 3,
    currentNode: { id: 101, key: "testing", label: "测试中" },
    workflow: {
      nodes: [{
        id: 101,
        key: "testing",
        label: "测试中",
        components: [{
          key: "requirement-node-workbench",
          content: { testResult: "" },
          saveContract: {
            command: "development-item.node.field.update",
            completionCommand: "development-item.node.complete-with-data",
            completionSupported: true,
            completionRequiredMetadata: [],
            itemType: "REQUIREMENT",
            itemId: 24,
            nodeId: 101,
            version: 5,
            fieldValuesPath: "__components.requirement-node-workbench",
            writableFields: ["testResult"],
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
      actions: [
        {
          name: "development-item.node.complete-with-data",
          label: "保存并完成",
          description: "保存并完成需求节点",
          mode: "automatic" as const,
          risk,
          scopes: [],
          inputSchema: {
            itemType: { type: "string", label: "itemType" },
            itemId: { type: "integer", label: "itemId" },
            nodeId: { type: "integer", label: "nodeId" },
            version: { type: "integer", label: "version" },
            fieldValues: { type: "object", label: "fieldValues" },
          },
          requiresContext: true,
          refreshScopes: [],
        },
      ],
    }],
    scopes: [],
    workflowTypes: [],
  }));
  const preview = vi.fn(async (request: { operation: string }) => ({
    operationId: "preview-requirement-complete",
    command: request.operation,
    expiresAt: "2099-01-01T00:00:00Z",
    contextVersion: "5",
    warnings: [],
    changes: [{ field: "testResult", to: "PASS" }],
    refreshScopes: ["development-detail"],
    preconditions: [],
  }));
  const executePreview = vi.fn(async () => ({
    operationId: "operation-requirement-complete",
    command: "development-item.node.complete-with-data",
    status: "SUCCEEDED" as const,
    data: { requirementId: 24 },
    warnings: [],
    refreshScopes: ["development-detail"],
    auditId: "audit-requirement-complete",
  }));
  const get = vi.fn(async () => ({
    resourceType: "requirement" as const,
    resourceId: 24,
    entityVersion: 3,
    details: { title: "PMS", status: "IN_PROGRESS" },
  }));
  return {
    context: vi.fn(async () => context),
    capabilities,
    preview,
    executePreview,
    get,
  } as any;
}

function draft(patch: Record<string, unknown> = { testResult: "PASS" }) {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
    fieldSources: Object.fromEntries(Object.keys(patch).map((key) => [key, {
      sourceType: "conversation",
      sourceRefs: ["conversation:latest"],
      confidence: "high",
    }])),
    requestedCompletion: true,
  };
}

function input(executeMode: "plan" | "auto" | "confirm" = "auto", extra: Record<string, unknown> = {}) {
  return {
    contractVersion: agentProgressionContractVersion,
    resourceType: "requirement" as const,
    resourceId: 24,
    nodeId: 101,
    intent: "COMPLETE_NODE" as const,
    executeMode,
    draft: draft(),
    ...extra,
  };
}

describe("agent progression run", () => {
  it("reads context without preview or execute", async () => {
    const client = requirementClient();
    const result = await runAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "requirement",
      resourceId: 24,
      nodeId: 101,
      intent: "READ_CONTEXT",
      executeMode: "plan",
    });

    expect(result.status).toBe("CONTEXT_READY");
    expect(result.plan).toBeNull();
    expect(result.result?.status).toBe("CONTEXT_READY");
    expect(client.get).toHaveBeenCalledOnce();
    expect(client.context).toHaveBeenCalledOnce();
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("previews and executes a complete medium-risk draft in auto mode", async () => {
    const client = requirementClient("medium");
    const result = await runAgentProgression(client, input("auto", {
      idempotencyKey: "run-requirement-complete-1",
    }));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.writeDecision).toBe("READY");
    expect(result.previewOperationId).toBe("preview-requirement-complete");
    expect(result.operationId).toBe("operation-requirement-complete");
    expect(result.auditId).toBe("audit-requirement-complete");
    expect(result.readback?.resource?.resourceId).toBe(24);
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });
    expect(client.executePreview).toHaveBeenCalledWith(
      "preview-requirement-complete",
      "run-requirement-complete-1",
    );
  });

  it("returns a plan without executing when executeMode is plan", async () => {
    const client = requirementClient();
    const result = await runAgentProgression(client, input("plan"));

    expect(result.status).toBe("PLAN_READY");
    expect(result.plan?.preview?.operationId).toBe("preview-requirement-complete");
    expect(result.result).toBeNull();
    expect(client.preview).toHaveBeenCalledOnce();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("does not execute a high-risk draft in auto mode", async () => {
    const client = requirementClient("high");
    const result = await runAgentProgression(client, input("auto", {
      idempotencyKey: "run-high-risk-auto",
    }));

    expect(result.status).toBe("WAITING_CONFIRMATION");
    expect(result.previewOperationId).toBeNull();
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("creates a high-risk preview in plan mode before waiting for confirmation", async () => {
    const client = requirementClient("high");
    const result = await runAgentProgression(client, input("plan"));

    expect(result.status).toBe("WAITING_CONFIRMATION");
    expect(result.plan?.preview?.operationId).toBe("preview-requirement-complete");
    expect(result.previewOperationId).toBe("preview-requirement-complete");
    expect(client.preview).toHaveBeenCalledOnce();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("executes a high-risk draft only after explicit confirm", async () => {
    const client = requirementClient("high");
    const result = await runAgentProgression(client, input("confirm", {
      idempotencyKey: "run-high-risk-confirm",
    }));

    expect(result.status).toBe("SUCCEEDED");
    expect(result.previewOperationId).toBe("preview-requirement-complete");
    expect(client.preview).toHaveBeenCalledOnce();
    expect(client.executePreview).toHaveBeenCalledWith(
      "preview-requirement-complete",
      "run-high-risk-confirm",
    );
  });

  it("stops before preview and execute when the draft is incomplete or protected", async () => {
    const missingClient = requirementClient();
    const missing = await runAgentProgression(missingClient, input("auto", {
      draft: draft({}),
      idempotencyKey: "run-missing",
    }));
    expect(missing.status).toBe("NEEDS_INPUT");
    expect(missingClient.preview).not.toHaveBeenCalled();
    expect(missingClient.executePreview).not.toHaveBeenCalled();

    const protectedClient = requirementClient();
    const protectedResult = await runAgentProgression(protectedClient, input("auto", {
      draft: draft({ status: "DONE" }),
      idempotencyKey: "run-protected",
    }));
    expect(protectedResult.status).toBe("CAPABILITY_UNAVAILABLE");
    expect(protectedClient.preview).not.toHaveBeenCalled();
    expect(protectedClient.executePreview).not.toHaveBeenCalled();
  });
});
