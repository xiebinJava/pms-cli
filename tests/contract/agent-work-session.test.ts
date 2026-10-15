import { describe, expect, it } from "vitest";
import { agentWorkSessionSchema } from "../../packages/pms-contracts/src/index.js";

const nodeContract = {
  nodeId: 10,
  key: "analysis",
  label: "分析",
  version: 0,
  requiredFields: [],
  writableFields: ["summary"],
  protectedFields: ["title", "status"],
  allowedActions: ["node.field.update"],
  allowedTransitions: [],
  missingInputRules: [],
  writeCapable: true,
};

function session(resourceType: "project" | "requirement" | "topic" | "story") {
  const resource = { type: resourceType, id: 7 };
  const contextSnapshot = {
    snapshotId: `${resourceType}-snapshot-7`,
    resource,
    contextVersion: "0",
    capturedAt: "2026-10-15T12:00:00.000Z",
    currentNode: { id: 10, key: "analysis", label: "分析" },
    workflowNodes: [],
    relations: [],
    allowedActions: ["node.field.update"],
    sourceRefs: [`${resourceType}:7`],
    warnings: [],
  };
  return {
    contractVersion: "agent-contract/v1",
    sessionId: `${resourceType}-session-7`,
    resource,
    contextSnapshot,
    nodeContract,
    agentTask: {
      taskId: `${resourceType}-task-7`,
      role: "project-assistant",
      objective: "补齐当前节点信息",
      resource,
      contextSnapshotId: contextSnapshot.snapshotId,
      permissionMode: "draft",
    },
    draft: {
      facts: [],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      proposedFieldValues: { summary: "草稿" },
      missingFields: [],
      questions: [],
      evidenceRefs: [`${resourceType}:7`],
      confidence: "medium",
    },
    preview: null,
    confirmation: { status: "NOT_REQUIRED" },
    operation: null,
    verification: null,
  };
}

describe("AgentWorkSession", () => {
  it.each(["project", "requirement", "topic", "story"] as const)(
    "accepts a %s session envelope",
    (resourceType) => {
      const parsed = agentWorkSessionSchema.parse(session(resourceType));
      expect(parsed.resource.type).toBe(resourceType);
      expect(parsed.contractVersion).toBe("agent-contract/v1");
    },
  );

  it("accepts a pure read session before a draft exists", () => {
    const readSession = session("story") as any;
    readSession.agentTask.permissionMode = "read-only";
    readSession.draft = null;
    const parsed = agentWorkSessionSchema.parse(readSession);
    expect(parsed.draft).toBeNull();
    expect(parsed.operation).toBeNull();
  });

  it("rejects a write operation without verification", () => {
    expect(() => agentWorkSessionSchema.parse({
      ...session("story"),
      agentTask: { ...session("story").agentTask, permissionMode: "write" },
      confirmation: { status: "CONFIRMED", confirmedAt: "2026-10-15T12:01:00.000Z" },
      operation: { operationId: "op-1", status: "SUCCEEDED", warnings: [] },
      verification: null,
    })).toThrow(/verification/);
  });

  it("requires provenance for a confirmed write", () => {
    expect(() => agentWorkSessionSchema.parse({
      ...session("story"),
      agentTask: { ...session("story").agentTask, permissionMode: "write" },
      confirmation: { status: "CONFIRMED" },
    })).toThrow(/confirmedAt|confirmedBy/);
  });

  it("requires a preview binding and successful verification for a successful write", () => {
    const base = session("story");
    expect(() => agentWorkSessionSchema.parse({
      ...base,
      agentTask: { ...base.agentTask, permissionMode: "write" },
      confirmation: {
        status: "CONFIRMED",
        confirmedAt: "2026-10-15T12:01:00.000Z",
        confirmedBy: "pms-cli",
      },
      operation: { operationId: "op-1", status: "SUCCEEDED", warnings: [] },
      verification: {
        status: "SUCCEEDED",
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      },
    })).toThrow(/preview/);

    expect(() => agentWorkSessionSchema.parse({
      ...base,
      agentTask: { ...base.agentTask, permissionMode: "write" },
      confirmation: {
        status: "CONFIRMED",
        confirmedAt: "2026-10-15T12:01:00.000Z",
        confirmedBy: "pms-cli",
      },
      operation: {
        operationId: "op-1",
        previewOperationId: "preview-1",
        status: "SUCCEEDED",
        warnings: [],
      },
      verification: {
        status: "UNKNOWN",
        resourceReadback: false,
        contextReadback: false,
        patchApplied: false,
        protectedFieldsUnchanged: false,
      },
    })).toThrow(/verification/);
  });

  it("rejects a context without a version", () => {
    const invalid = session("requirement");
    invalid.contextSnapshot.contextVersion = "";
    expect(() => agentWorkSessionSchema.parse(invalid)).toThrow(/contextVersion/);
  });

  it("rejects an unknown permission mode", () => {
    const invalid = session("project");
    invalid.agentTask.permissionMode = "admin";
    expect(() => agentWorkSessionSchema.parse(invalid)).toThrow(/permissionMode/);
  });
});
