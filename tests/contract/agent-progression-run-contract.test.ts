import { describe, expect, it } from "vitest";
import {
  agentProgressionContractVersion,
  agentProgressionRunContractVersion,
  agentProgressionRunResultSchema,
} from "../../packages/pms-contracts/src/index.js";

function plan(writeDecision: "READY" | "NEEDS_INPUT" | "WAITING_CONFIRMATION" = "READY") {
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan" as const,
    resourceType: "requirement" as const,
    resourceId: 33,
    intent: "UPDATE_NODE_FIELDS" as const,
    operation: "development-item.node.field.update",
    context: {},
    normalizedArguments: {},
    capability: {},
    preview: null,
    fieldChanges: [],
    missingFields: [],
    preconditions: [],
    writeDecision,
    requiresConfirmation: writeDecision === "WAITING_CONFIRMATION",
    executionMode: "automatic" as const,
    warnings: [],
  };
}

describe("agent progression run contract", () => {
  it("accepts a read-only run result without operation identifiers", () => {
    const parsed = agentProgressionRunResultSchema.parse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "CONTEXT_READY",
      resourceType: "requirement",
      resourceId: 33,
      intent: "READ_CONTEXT",
      writeDecision: "READY",
      plan: null,
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: { resource: null, context: { resource: { type: "requirement", id: 33 } } },
      verification: null,
      warnings: [],
    });

    expect(parsed.contractVersion).toBe("agent-progression-run/v2");
    expect(parsed.status).toBe("CONTEXT_READY");
  });

  it("accepts a rejected completion request with an explicit reason", () => {
    const parsed = agentProgressionRunResultSchema.parse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "REJECTED",
      resourceType: "story",
      resourceId: 34,
      intent: "COMPLETE_NODE",
      writeDecision: "NEEDS_INPUT",
      plan: { ...plan("NEEDS_INPUT"), resourceType: "story", resourceId: 34, intent: "COMPLETE_NODE" },
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: null,
      verification: null,
      warnings: ["缺少验收结论"],
      rejectionReason: "COMPLETION_NOT_REQUESTED",
    });

    expect(parsed.plan?.writeDecision).toBe("NEEDS_INPUT");
    expect(parsed.rejectionReason).toBe("COMPLETION_NOT_REQUESTED");
    expect(parsed.result).toBeNull();
  });

  it("keeps story user-facing node and field summaries separate from machine identifiers", () => {
    const parsed = agentProgressionRunResultSchema.parse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "NEEDS_INPUT",
      resourceType: "story",
      resourceId: 34,
      intent: "UPDATE_NODE_FIELDS",
      writeDecision: "NEEDS_INPUT",
      plan: null,
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: null,
      verification: null,
      warnings: ["缺少验收结论"],
      userFacing: {
        resourceType: "story",
        resourceName: "项目管理标准",
        resourceStatus: "IN_PROGRESS",
        currentNode: "开发中",
        targetNode: "验收中",
        operationStatus: "NEEDS_INPUT",
        actualChange: "缺少必填信息，尚未执行写入",
        fieldChanges: [{ field: "验收结论", from: null, to: "通过" }],
        blockers: ["缺少验收结论"],
      },
    });

    expect(parsed.userFacing?.targetNode).toBe("验收中");
    expect(parsed.userFacing?.fieldChanges[0]?.field).toBe("验收结论");
    expect(JSON.stringify(parsed.userFacing)).not.toContain("384");
  });

  it("accepts a project run result for shared context and field-update flows", () => {
    const parsed = agentProgressionRunResultSchema.parse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "CONTEXT_READY",
      resourceType: "project",
      resourceId: 42,
      intent: "READ_CONTEXT",
      writeDecision: "READY",
      plan: null,
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: { resource: null, context: { resource: { type: "project", id: 42 } } },
      verification: null,
      warnings: [],
    });

    expect(parsed.resourceType).toBe("project");
  });

  it("preserves preview, operation, audit, readback, and verification identifiers", () => {
    const parsed = agentProgressionRunResultSchema.parse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "SUCCEEDED",
      resourceType: "topic",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      writeDecision: "READY",
      plan: { ...plan(), resourceType: "topic", resourceId: 12 },
      result: {
        contractVersion: agentProgressionContractVersion,
        phase: "execute",
        status: "SUCCEEDED",
        resourceType: "topic",
        resourceId: 12,
        intent: "UPDATE_NODE_FIELDS",
        plan: null,
        operation: {
          operationId: "operation-1",
          status: "SUCCEEDED",
          data: {},
          warnings: [],
          refreshScopes: [],
          auditId: "audit-1",
        },
        readback: { resource: null, context: null },
        verification: {
          resourceReadback: true,
          contextReadback: true,
          patchApplied: true,
          protectedFieldsUnchanged: true,
        },
        warnings: [],
      },
      previewOperationId: "preview-1",
      operationId: "operation-1",
      auditId: "audit-1",
      readback: { resource: null, context: null },
      verification: {
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      },
      warnings: [],
    });

    expect(parsed.previewOperationId).toBe("preview-1");
    expect(parsed.operationId).toBe("operation-1");
    expect(parsed.auditId).toBe("audit-1");
    expect(parsed.verification?.patchApplied).toBe(true);
  });

  it("rejects unknown top-level fields", () => {
    const result = agentProgressionRunResultSchema.safeParse({
      contractVersion: agentProgressionRunContractVersion,
      phase: "run",
      status: "CONTEXT_READY",
      resourceType: "requirement",
      resourceId: 33,
      intent: "READ_CONTEXT",
      writeDecision: "READY",
      plan: null,
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: null,
      verification: null,
      warnings: [],
      leakedToken: "must fail",
    });

    expect(result.success).toBe(false);
  });
});
