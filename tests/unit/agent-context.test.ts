import { describe, expect, it } from "vitest";
import type { WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import {
  buildAgentContext,
  buildNodeContract,
} from "../../apps/pms-cli/src/commands/core/agentContext.js";
import { validateChildDraft } from "../../apps/pms-cli/src/commands/scenarios/AgentDraftContract.js";

function context(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    resource: { type: "story", id: 34 },
    version: 2,
    entityVersion: 7,
    currentNode: { id: 383, key: "writing", label: "编写" },
    workflow: {
      templateVersionId: 88,
      templateVersionNo: 3,
      nodes: [{
        id: 383,
        key: "writing",
        label: "编写",
        position: 0,
        status: 1,
        fields: [{ key: "summary", label: "摘要", type: "text", required: true }],
        components: [{
          key: "story-node-workbench",
          label: "故事工作台",
          fields: [{ key: "summary", label: "摘要", type: "text", required: true }],
          actions: ["development-item.node.field.update"],
          contentState: "LOADED",
          saveContract: {
            command: "development-item.node.field.update",
            itemType: "STORY",
            itemId: 34,
            nodeId: 383,
            version: 2,
            componentKey: "story-node-workbench",
            writableFields: ["summary"],
            completionMode: "AUTO_CONFIRM",
            completionAutomaticConfirmation: true,
          },
        }],
        fieldValues: { summary: "已有事实" },
        version: 2,
        fieldValuesState: "LOADED",
      }],
    },
    relations: [{ resourceType: "topic", resourceId: 9, label: "专题", readable: true }],
    allowedActions: ["development-item.node.field.update"],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-15T08:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused",
      fieldValuesScope: "selected-node",
      componentContentScope: "selected-component",
      selectedNodeId: 383,
      selectedComponentKey: "story-node-workbench",
      workflowConfigured: true,
      workflowStatus: "IN_PROGRESS",
      terminalStatus: null,
      workflowInstanceVersion: 3,
      permissionsScope: "business-user",
      referencesScope: "readable-only",
      contextVersion: "story:34:entity:7",
      warnings: [],
    },
    ...overrides,
  };
}

describe("Agent context mapping", () => {
  it("maps a focused story context and derives writable fields only from saveContract", () => {
    const session = buildAgentContext(context());

    expect(session.contractVersion).toBe("agent-contract/v1");
    expect(session.contextSnapshot).toMatchObject({
      snapshotId: "story:34@story:34:entity:7",
      contextVersion: "story:34:entity:7",
      currentNode: { id: 383, key: "writing" },
      sourceRefs: [
        "story:34",
        "topic:9",
        "story-node:383",
        "story-node:383#component:story-node-workbench",
      ],
    });
    expect(session.nodeContract).toMatchObject({
      nodeId: 383,
      key: "writing",
      writableFields: ["summary"],
      completionMode: "AUTO_CONFIRM",
      completionAutomaticConfirmation: true,
      writeCapable: true,
    });
    expect(session.draft).toBeNull();
  });

  it("authorizes the current node as child-agent evidence", () => {
    const session = buildAgentContext(context());

    expect(() => validateChildDraft({
      facts: [{ text: "当前节点事实", sourceRefs: ["story-node:383"] }],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      proposedFieldValues: {},
      missingFields: [],
      questions: [],
      evidenceRefs: ["story-node:383"],
      confidence: "high",
    }, session.contextSnapshot)).not.toThrow();
  });

  it("keeps a project node read-only when no component saveContract is published", () => {
    const project = context({
      resource: { type: "project", id: 7 },
      currentNode: { id: 301, key: "design", label: "方案设计" },
      workflow: {
        templateVersionId: 88,
        templateVersionNo: 4,
        nodes: [{
          id: 301,
          key: "design",
          label: "方案设计",
          position: 0,
          fields: [{ key: "summary", label: "摘要", type: "text", required: true }],
          components: [{ key: "solution-design", label: "方案设计", fields: [], actions: [] }],
          fieldValues: {},
          version: 1,
        }],
      },
    });

    const node = buildNodeContract(project, 301, "solution-design");
    expect(node.writeCapable).toBe(false);
    expect(node.writableFields).toEqual([]);
    expect(node.allowedActions).toEqual([]);
    expect(node.missingInputRules).toContain("当前节点/组件未公开 saveContract，禁止生成写入预览");
  });

  it("keeps a save contract read-only when the effective actions omit its command", () => {
    const node = buildNodeContract(context({ allowedActions: [] }), 383, "story-node-workbench");

    expect(node.writeCapable).toBe(false);
    expect(node.allowedActions).toEqual([]);
    expect(node.missingInputRules).toContain("当前用户未获准执行 saveContract 命令，禁止生成写入预览");
  });

  it("rejects an unsupported component instead of guessing a writable scope", () => {
    expect(() => buildNodeContract(context(), 383, "missing-component")).toThrow(/组件/);
  });

  it("returns a read-only session with a warning when workflow configuration is absent", () => {
    const session = buildAgentContext(context({ workflow: undefined, currentNode: undefined, meta: undefined }));
    expect(session.nodeContract).toBeNull();
    expect(session.contextSnapshot.currentNode).toBeNull();
    expect(session.contextSnapshot.warnings).toContainEqual(expect.objectContaining({
      code: "WORKFLOW_NOT_CONFIGURED",
    }));
  });
});
