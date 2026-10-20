import { describe, expect, it } from "vitest";
import type { WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import { validatePmsExpectedVersions } from "../../apps/pms-cli/src/commands/scenarios/AgentDraftContract.js";

const context = {
  resource: { type: "story", id: 34 },
  version: 7,
  entityVersion: 4,
  currentNode: { id: 387, key: "testing", label: "测试中" },
  workflow: {
    nodes: [{
      id: 387,
      version: 3,
      components: [{ key: "story-node-workbench", versions: { content: 2 } }],
    }],
  },
  meta: {
    formatVersion: 2,
    pureRead: true,
    loadedAt: "2026-10-20T00:00:00Z",
    businessTimezone: "Asia/Shanghai",
    view: "focused",
    fieldValuesScope: "selected-node",
    componentContentScope: "selected-component",
    selectedNodeId: 387,
    selectedComponentKey: "story-node-workbench",
    workflowConfigured: true,
    workflowStatus: "ACTIVE",
    workflowInstanceVersion: 9,
    permissionsScope: "self",
    referencesScope: "resource",
    contextVersion: "story:34:v7",
    warnings: [],
  },
  allowedActions: [],
} as unknown as WorkflowContext;

describe("PMS-owned expected version binding", () => {
  it("accepts a preview snapshot that matches the context used for the draft", () => {
    expect(validatePmsExpectedVersions({
      entityVersion: 4,
      nodeVersion: 3,
      workflowInstanceVersion: 9,
      componentVersion: 2,
      contextVersion: 7,
    }, context, 387, "story-node-workbench")).toBeNull();
  });

  it("returns a context conflict when PMS preview versions differ", () => {
    expect(validatePmsExpectedVersions({
      entityVersion: 5,
      nodeVersion: 3,
      workflowInstanceVersion: 9,
      componentVersion: 2,
      contextVersion: 7,
    }, context, 387, "story-node-workbench")).toEqual({
      code: "CONTEXT_CONFLICT",
      message: "CONTEXT_CONFLICT: preview 的 entityVersion 与当前 PMS 上下文不一致",
    });
  });

  it("treats meta.contextVersion as an audit label, not the write version", () => {
    expect(validatePmsExpectedVersions({
      entityVersion: 4,
      nodeVersion: 3,
      workflowInstanceVersion: 9,
      componentVersion: 2,
      contextVersion: "story:34:entity:4",
    }, context, 387, "story-node-workbench")?.message).toBe(
      "CONTEXT_CONFLICT: preview 的 contextVersion 与当前 PMS 上下文不一致",
    );
  });
});
