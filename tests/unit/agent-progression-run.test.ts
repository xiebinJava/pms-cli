import { describe, expect, it, vi } from "vitest";
import {
  runAgentProgression,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgressionRun.js";
import {
  agentProgressionContractVersion,
  computeDraftDigest,
} from "../../packages/pms-contracts/src/index.js";

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
  const executePreview = vi.fn(async () => {
    (context.workflow.nodes[0] as any).components[0].content = { testResult: "PASS" };
    return {
      operationId: "operation-requirement-complete",
      command: "development-item.node.complete-with-data",
      status: "SUCCEEDED" as const,
      data: { requirementId: 24 },
      warnings: [],
      refreshScopes: ["development-detail"],
      auditId: "audit-requirement-complete",
    };
  });
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

function projectClient(options: { withCompletion?: boolean } = {}) {
  const withCompletion = options.withCompletion === true;
  const context = {
    resource: { type: "project" as const, id: 42 },
    version: 3,
    entityVersion: 3,
    currentNode: { id: 301, key: "design", label: "方案设计" },
    workflow: {
      nodes: [{
        id: 301,
        key: "design",
        label: "方案设计",
        version: 4,
        components: [{
          key: "solution-design",
          content: { solutionPackage: "旧方案" },
          saveContract: {
            command: "node.field.update",
            projectId: 42,
            nodeId: 301,
            nodeVersion: 4,
            workbench: "solution-design",
            writableFields: ["solutionPackage"],
            protectedFields: ["status"],
            dynamicFields: false,
            ...(withCompletion ? {
              completionSupported: true,
              completionCommand: "node.complete-with-data",
              completionRequiredMetadata: [],
            } : {}),
          },
        }],
      }],
    },
    allowedActions: ["node.field.update"],
  };
  const detail = {
    resourceType: "project" as const,
    resourceId: 42,
    entityVersion: 3,
    details: { name: "PMS 项目", status: "ACTIVE" },
  };
  return {
    context: vi.fn(async () => context),
    get: vi.fn(async () => detail),
    capabilities: vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: "project",
        actions: [{
          name: "node.field.update",
          label: "更新项目节点",
          description: "更新项目节点",
          mode: "automatic" as const,
          risk: "medium" as const,
          scopes: [],
          inputSchema: {
            projectId: { type: "integer", label: "项目" },
            nodeId: { type: "integer", label: "节点" },
            workbench: { type: "string", label: "工作台" },
            fields: { type: "object", label: "字段" },
          },
          requiresContext: true,
          refreshScopes: [],
        },
          ...(withCompletion ? [{
            name: "node.complete-with-data",
            label: "保存并完成",
            description: "保存项目节点详情并完成节点",
            mode: "automatic" as const,
            risk: "medium" as const,
            scopes: [],
            inputSchema: {
              projectId: { type: "integer", label: "项目" },
              nodeId: { type: "integer", label: "节点" },
              workbench: { type: "string", label: "工作台" },
              fields: { type: "object", label: "字段" },
            },
            requiresContext: true,
            refreshScopes: [],
          }] : []),
        ],
      }],
      scopes: [],
      workflowTypes: [],
    })),
    preview: vi.fn(async () => ({
      operationId: "preview-project-complete",
      command: "node.field.update",
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: "3",
      warnings: [],
      changes: [{ field: "solutionPackage", to: "新方案" }],
      refreshScopes: [],
      preconditions: [],
    })),
    executePreview: vi.fn(async () => {
      (context.workflow.nodes[0] as any).components[0].content = { solutionPackage: "新方案" };
      return {
        operationId: "operation-project-update",
        command: "node.field.update",
        status: "SUCCEEDED" as const,
        data: { projectId: 42 },
        warnings: [],
        refreshScopes: [],
        auditId: "audit-project-update",
      };
    }),
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

  it("propagates the PMS-bound provenance reference and digest through the run envelope", async () => {
    const client = requirementClient();
    const originalCapabilities = client.capabilities;
    client.capabilities = vi.fn(async () => ({
      ...await originalCapabilities(),
      provenanceVersions: ["draft-provenance/v1"],
    }));
    const fieldSources = {
      testResult: {
        sourceType: "pms_context" as const,
        sourceRefs: ["requirement-node:101#component:requirement-node-workbench"],
        confidence: "high" as const,
      },
    };
    const provenance = {
      contractVersion: "draft-provenance/v1" as const,
      draftDigest: computeDraftDigest({
        contractVersion: "draft-provenance/v1",
        resourceType: "requirement",
        resourceId: 24,
        nodeId: 101,
        componentKey: "requirement-node-workbench",
        intent: "COMPLETE_NODE",
        requestedCompletion: true,
        versionSnapshot: {
          nodeVersion: null,
          entityVersion: 3,
          workflowInstanceVersion: null,
          componentVersion: 5,
          contextVersion: 5,
        },
        facts: [],
        inferences: [],
        assumptions: [],
        unresolvedDecisions: [],
        patch: { testResult: "PASS" },
        fieldSources,
      }),
      fieldSources,
    };
    client.preview = vi.fn(async () => ({
      operationId: "preview-requirement-complete-with-provenance",
      command: "development-item.node.complete-with-data",
      expiresAt: "2099-01-01T00:00:00Z",
      contextVersion: "5",
      warnings: [],
      changes: [{ field: "testResult", to: "PASS" }],
      refreshScopes: ["development-detail"],
      preconditions: [],
      provenanceRef: "operation:preview-requirement-complete-with-provenance",
      draftDigest: provenance.draftDigest,
    }));

    const result = await runAgentProgression(client, input("plan", {
      componentKey: "requirement-node-workbench",
      provenance,
    }));

    expect(result.status).toBe("PLAN_READY");
    expect(result.provenanceRef).toBe("operation:preview-requirement-complete-with-provenance");
    expect(result.draftDigest).toBe(provenance.draftDigest);
    expect(result.plan?.provenanceRef).toBe(result.provenanceRef);
    expect(result.plan?.preview?.draftDigest).toBe(provenance.draftDigest);
  });

  it("requires provenance when the PMS advertises the v1 contract", async () => {
    const client = requirementClient();
    const originalCapabilities = client.capabilities;
    client.capabilities = vi.fn(async () => ({
      ...await originalCapabilities(),
      provenanceVersions: ["draft-provenance/v1"],
    }));

    const result = await runAgentProgression(client, input("plan"));

    expect(result.status).toBe("NEEDS_INPUT");
    expect(result.warnings.join(" ")).toContain("PROVENANCE_NOT_PROVIDED");
    expect(result.plan?.preview).toBeNull();
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("blocks progression writes when the PMS explicitly lacks provenance support", async () => {
    const client = requirementClient();
    const originalCapabilities = client.capabilities;
    client.capabilities = vi.fn(async () => ({
      ...await originalCapabilities(),
      provenanceVersions: [],
    }));

    const result = await runAgentProgression(client, input("plan"));

    expect(result.status).toBe("CAPABILITY_UNAVAILABLE");
    expect(result.warnings.join(" ")).toContain("PROVENANCE_NOT_SUPPORTED");
    expect(result.plan?.preview).toBeNull();
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("rejects COMPLETE_NODE when the Agent did not explicitly request completion", async () => {
    const client = requirementClient();
    const result = await runAgentProgression(client, input("auto", {
      draft: { ...draft(), requestedCompletion: false },
    }));

    expect(result.status).toBe("REJECTED");
    expect(result.writeDecision).toBe("NEEDS_INPUT");
    expect(result.rejectionReason).toBe("COMPLETION_NOT_REQUESTED");
    expect(result.plan?.preview).toBeNull();
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("maps invalid provenance to an in-band rejected run without touching PMS", async () => {
    const client = requirementClient();
    const result = await runAgentProgression(client, input("auto", {
      provenance: {
        contractVersion: "draft-provenance/v1",
        draftDigest: `sha256:${"a".repeat(64)}`,
        fieldSources: {
          testResult: {
            sourceType: "pms_context",
            sourceRefs: ["conversation:latest"],
            confidence: "high",
          },
        },
      },
    }));

    expect(result.status).toBe("REJECTED");
    expect(result.writeDecision).toBe("NEEDS_INPUT");
    expect(result.rejectionReason).toBe("PROVENANCE_INVALID");
    expect(result.plan).toBeNull();
    expect(client.context).not.toHaveBeenCalled();
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("maps oversized provenance to a distinct in-band rejection", async () => {
    const client = requirementClient();
    const result = await runAgentProgression(client, input("plan", {
      provenance: {
        contractVersion: "draft-provenance/v1",
        draftDigest: `sha256:${"b".repeat(64)}`,
        fieldSources: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
          `field-${index}`,
          {
            sourceType: "pms_context",
            sourceRefs: ["requirement:24"],
            confidence: "high",
          },
        ])),
      },
    }));

    expect(result.status).toBe("REJECTED");
    expect(result.rejectionReason).toBe("PROVENANCE_TOO_LARGE");
    expect(client.context).not.toHaveBeenCalled();
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

  it("runs a project node field update through the shared resource scenario", async () => {
    const client = projectClient();
    const result = await runAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 42,
      nodeId: 301,
      intent: "UPDATE_NODE_FIELDS",
      executeMode: "auto",
      idempotencyKey: "run-project-update-1",
      draft: {
        facts: [],
        inferences: [],
        assumptions: [],
        unresolvedDecisions: [],
        patch: { solutionPackage: "新方案" },
        fieldSources: {
          solutionPackage: {
            sourceType: "conversation",
            sourceRefs: ["conversation:latest"],
            confidence: "high",
          },
        },
      },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.resourceType).toBe("project");
    expect(result.operationId).toBe("operation-project-update");
    expect(client.executePreview).toHaveBeenCalledWith(
      "preview-project-complete",
      "run-project-update-1",
    );
  });

  it("reads project context without preview or execute", async () => {
    const client = projectClient();
    const result = await runAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 42,
      nodeId: 301,
      intent: "READ_CONTEXT",
      executeMode: "plan",
    });

    expect(result.status).toBe("CONTEXT_READY");
    expect(result.result?.status).toBe("CONTEXT_READY");
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("reports project node completion as unavailable without preview or execute", async () => {
    const client = projectClient();
    const result = await runAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 42,
      nodeId: 301,
      intent: "COMPLETE_NODE",
      executeMode: "auto",
      idempotencyKey: "run-project-complete-1",
      draft: {
        facts: [],
        inferences: [],
        assumptions: [],
        unresolvedDecisions: [],
        patch: { solutionPackage: "新方案" },
        fieldSources: {
          solutionPackage: {
            sourceType: "conversation",
            sourceRefs: ["conversation:latest"],
            confidence: "high",
          },
        },
        requestedCompletion: true,
      },
    });
    expect(result.status).toBe("CAPABILITY_UNAVAILABLE");
    expect(result.warnings.join(" ")).toMatch(/CAPABILITY_UNAVAILABLE/);
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("completes a project node through the atomic save-and-complete operation", async () => {
    const client = projectClient({ withCompletion: true });
    const result = await runAgentProgression(client, {
      contractVersion: agentProgressionContractVersion,
      resourceType: "project",
      resourceId: 42,
      nodeId: 301,
      intent: "COMPLETE_NODE",
      executeMode: "auto",
      idempotencyKey: "run-project-complete-with-data-1",
      draft: {
        facts: [],
        inferences: [],
        assumptions: [],
        unresolvedDecisions: [],
        patch: { solutionPackage: "新方案" },
        fieldSources: {
          solutionPackage: {
            sourceType: "conversation",
            sourceRefs: ["conversation:latest"],
            confidence: "high",
          },
        },
        requestedCompletion: true,
      },
    });

    expect(result.status).toBe("SUCCEEDED");
    expect(result.plan?.operation).toBe("node.complete-with-data");
    expect(client.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "node.complete-with-data",
      arguments: expect.objectContaining({
        projectId: 42,
        nodeId: 301,
        workbench: "solution-design",
        fields: { solutionPackage: "新方案" },
      }),
    }));
  });
});
