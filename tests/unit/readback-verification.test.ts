import { describe, expect, it } from "vitest";
import type {
  OperationResult,
  ResourceScenarioSnapshot,
  WorkflowContext,
} from "../../packages/pms-contracts/src/index.js";
import {
  buildVerificationResult,
  comparePatchedFields,
  compareProtectedFields,
  extractComponentContent,
  mergeSnapshotDetails,
} from "../../apps/pms-cli/src/commands/scenarios/readbackVerification.js";

function context(
  resourceType: "topic" | "project" | "story",
  content: Record<string, unknown> | undefined,
  options: { contentState?: "LOADED" | "NOT_REQUESTED"; nodeId?: number } = {},
): WorkflowContext {
  const nodeId = options.nodeId ?? 301;
  return {
    resource: { type: resourceType, id: 12 },
    version: 4,
    entityVersion: 9,
    resourceDetails: resourceType === "project"
      ? { status: "ACTIVE", name: "PMS 项目" }
      : { status: "IN_PROGRESS", title: "研发流程专题" },
    currentNode: { id: nodeId, key: "work", label: "工作节点" },
    workflow: {
      nodes: [{
        id: nodeId,
        key: "work",
        label: "工作节点",
        fieldValues: {},
        components: [{
          key: "selected-component",
          label: "选中的组件",
          content,
          contentState: options.contentState ?? "LOADED",
          saveContract: {
            fieldValuesPath: "fields",
            protectedFields: ["status"],
            fieldContracts: [
              { key: "startDate", type: "date" },
              { key: "count", type: "integer" },
            ],
          },
        }],
      }],
    },
    relations: [],
    allowedActions: [],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-19T00:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused",
      fieldValuesScope: "selected-node",
      componentContentScope: "selected-component",
      selectedNodeId: nodeId,
      selectedComponentKey: "selected-component",
      workflowConfigured: true,
      workflowStatus: "ACTIVE",
      permissionsScope: "test",
      referencesScope: "test",
      warnings: [],
    },
  };
}

function snapshot(
  resourceType: "topic" | "project" | "story",
  content: Record<string, unknown> | undefined,
  details: Record<string, unknown> = {},
  options: { contentState?: "LOADED" | "NOT_REQUESTED" } = {},
): ResourceScenarioSnapshot {
  return {
    resource: {
      resourceType,
      resourceId: 12,
      entityVersion: 9,
      details,
    },
    context: context(resourceType, content, options),
  };
}

const operation: OperationResult = {
  operationId: "operation-1",
  status: "SUCCEEDED",
  data: { topicId: 12 },
  warnings: [],
  refreshScopes: [],
};

describe("shared readback verification", () => {
  it("extracts sparse topic component content through the selected component resolver", () => {
    const before = snapshot("topic", { startDate: "2026-10-19" }, { id: 12 });
    const after = snapshot("topic", { startDate: "2026-10-20" }, { id: 12 });

    expect(extractComponentContent(after, "topic", "selected-component", 301)).toEqual({
      startDate: "2026-10-20",
    });
    expect(mergeSnapshotDetails(after, "topic", "selected-component", 301)).toMatchObject({
      id: 12,
      startDate: "2026-10-20",
    });
    expect(buildVerificationResult({
      resourceType: "topic",
      resourceId: 12,
      nodeId: 301,
      componentKey: "selected-component",
      expectedPatch: { startDate: "2026-10-20" },
      protectedFields: ["status"],
    }, before, after, operation)).toMatchObject({
      resourceReadback: true,
      contextReadback: true,
      patchApplied: true,
      protectedFieldsUnchanged: true,
      readbackComplete: true,
    });
  });

  it("normalizes date and numeric field values using field contracts", () => {
    const comparison = comparePatchedFields(
      { startDate: "2026-10-19", count: 2 },
      { startDate: "2026-10-20T07:00:00+08:00", count: "3" },
      { startDate: "2026-10-20", count: 3 },
      [{ key: "startDate", type: "date" }, { key: "count", type: "integer" }],
    );

    expect(comparison).toEqual({ known: true, matches: true, mismatches: [] });
    expect(comparePatchedFields(
      { note: "旧值" },
      { note: null },
      { note: null },
      [{ key: "note", nullable: true }],
    )).toMatchObject({ known: true, matches: true });
  });

  it("accepts PMS-generated metadata on structured list fields", () => {
    expect(comparePatchedFields(
      { scopeItems: [{ direction: "IN", title: "范围项", sort: 0 }] },
      { scopeItems: [{ id: 701, direction: "IN", title: "范围项", sort: 0, createdBy: 1 }] },
      { scopeItems: [{ direction: "IN", title: "范围项", sort: 0 }] },
    )).toEqual({ known: true, matches: true, mismatches: [] });

    expect(comparePatchedFields(
      {},
      { scopeItems: [{ id: 701, direction: "IN", title: "范围项", sort: 0 }] },
      { scopeItems: [{ direction: "IN", title: "另一项", sort: 0 }] },
    )).toMatchObject({ known: true, matches: false });
  });

  it("does not treat missing protected fields or component content as unchanged", () => {
    expect(compareProtectedFields(
      { status: "ACTIVE" },
      {},
      ["status"],
    )).toMatchObject({ known: false, matches: false });

    const result = buildVerificationResult({
      resourceType: "story",
      resourceId: 12,
      nodeId: 301,
      componentKey: "selected-component",
      expectedPatch: { acceptanceConclusion: "PASS" },
      protectedFields: ["status"],
    },
    snapshot("story", undefined, { id: 12 }, { contentState: "NOT_REQUESTED" }),
    snapshot("story", undefined, { id: 12 }, { contentState: "NOT_REQUESTED" }),
    { ...operation, data: { storyId: 12 } });

    expect(result.patchApplied).toBe(false);
    expect(result.readbackComplete).toBe(false);
    expect(result.patchComparison.known).toBe(false);
  });

  it("allows only operation-declared protected-field mutations", () => {
    expect(compareProtectedFields(
      { status: "DRAFT" },
      { status: "IN_PROGRESS" },
      ["status"],
    )).toMatchObject({ known: true, matches: false });
    expect(compareProtectedFields(
      { status: "DRAFT" },
      { status: "IN_PROGRESS" },
      ["status"],
      { status: { from: "DRAFT", to: "IN_PROGRESS" } },
    )).toMatchObject({ known: true, matches: true });

    const completionBefore = snapshot("project", { startDate: "2026-10-19" }, { id: 12, status: "ACTIVE" });
    const completionAfter = snapshot("project", { startDate: "2026-10-19" }, { id: 12, status: "COMPLETED" });
    expect(buildVerificationResult({
      resourceType: "project",
      resourceId: 12,
      nodeId: 301,
      componentKey: "selected-component",
      expectedPatch: { startDate: "2026-10-19" },
      protectedFields: ["status"],
    }, completionBefore, completionAfter, {
      ...operation,
      data: { projectId: 12, allowedMutations: ["status"] },
    })).toMatchObject({
      patchApplied: true,
      protectedFieldsUnchanged: true,
    });
  });
});
