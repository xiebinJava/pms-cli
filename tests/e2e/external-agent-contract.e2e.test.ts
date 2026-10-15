import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  agentContractVersion,
  storyWorkbenchContractVersion,
  type AnalysisDraft,
  type StoryWorkbenchInput,
  type StoryWorkbenchResult,
  type WorkflowContext,
} from "../../packages/pms-contracts/src/index.js";
import {
  toRequirementAnalysisWorkSession,
  toStoryWorkbenchWorkSession,
} from "../../apps/pms-cli/src/commands/scenarios/agentWorkSession.js";

interface ExternalAgentCase {
  id: string;
  title: string;
  resourceType: "requirement" | "story";
  resourceId: number;
  nodeId: number;
  contractVersion: string;
  contextVersion: string;
  operationId: string | null;
  permissionMode: "read-only" | "draft" | "write";
  verification: "SUCCEEDED" | "FAILED" | "UNKNOWN" | null;
  expectedMutation: false | true | "unknown";
}

const casesUrl = new URL("../fixtures/external-agent-cases.json", import.meta.url);

async function loadCases(): Promise<ExternalAgentCase[]> {
  return JSON.parse(await readFile(casesUrl, "utf8")) as ExternalAgentCase[];
}

function workflowContext(type: "requirement" | "story", id: number, nodeId: number, version: string): WorkflowContext {
  const componentKey = type === "story" ? "story-node-workbench" : "requirement-node-workbench";
  return {
    resource: { type, id },
    version: Number(version.split(":").at(-1) ?? 1),
    entityVersion: Number(version.split(":").at(-1) ?? 1),
    currentNode: { id: nodeId, key: type === "story" ? "writing" : "analysis", label: type === "story" ? "编写" : "分析" },
    workflow: {
      templateVersionId: 88,
      templateVersionNo: 3,
      nodes: [{
        id: nodeId,
        key: type === "story" ? "writing" : "analysis",
        label: type === "story" ? "编写" : "分析",
        position: 0,
        fields: [{ key: "summary", label: "摘要", type: "text", required: true }],
        components: [{
          key: componentKey,
          label: "工作台",
          fields: [],
          actions: ["development-item.node.field.update"],
          saveContract: {
            command: "development-item.node.field.update",
            itemType: type.toUpperCase(),
            itemId: id,
            nodeId,
            version: Number(version.split(":").at(-1) ?? 1),
            componentKey,
            variant: "writing",
            fieldValuesPath: "__components.story-node-workbench",
            writableFields: ["summary"],
          },
        }],
        fieldValues: {},
        version: Number(version.split(":").at(-1) ?? 1),
      }],
    },
    relations: [],
    allowedActions: ["development-item.node.field.update"],
    meta: {
      formatVersion: 2,
      pureRead: true,
      loadedAt: "2026-10-15T08:00:00Z",
      businessTimezone: "Asia/Shanghai",
      view: "focused",
      fieldValuesScope: "selected-node",
      componentContentScope: "selected-component",
      selectedNodeId: nodeId,
      selectedComponentKey: componentKey,
      workflowConfigured: true,
      workflowStatus: "IN_PROGRESS",
      workflowInstanceVersion: Number(version.split(":").at(-1) ?? 1),
      permissionsScope: "business-user",
      referencesScope: "readable-only",
      contextVersion: version,
      warnings: [],
    },
  };
}

function requirementDraft(missingInput: boolean): AnalysisDraft {
  return {
    facts: [{ text: "当前需求正在分析节点", sourceRefs: ["requirement:33"], confidence: "high" }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: missingInput
      ? [{ text: "需要确认验收口径", sourceRefs: ["requirement:33"], confidence: "medium" }]
      : [],
    patch: missingInput ? {} : { summary: "已确认分析" },
  };
}

function storyInput(save: boolean): StoryWorkbenchInput {
  return {
    contractVersion: storyWorkbenchContractVersion,
    resourceType: "story",
    resourceId: 34,
    nodeId: 702,
    version: 5,
    variant: "writing",
    patch: { summary: "故事节点草稿" },
    save,
    ...(save ? { idempotencyKey: "external-agent-e2e-34" } : {}),
  };
}

function storyPlan() {
  return {
    scenario: "story-workbench" as const,
    phase: "plan" as const,
    contractVersion: storyWorkbenchContractVersion,
    resourceId: 34,
    nodeId: 702,
    version: 5,
    variant: "writing" as const,
    patch: { summary: "故事节点草稿" },
    saveContract: {
      command: "development-item.node.field.update",
      itemType: "STORY",
      itemId: 34,
      nodeId: 702,
      version: 5,
      componentKey: "story-node-workbench",
      variant: "writing",
      fieldValuesPath: "__components.story-node-workbench",
      writableFields: ["summary"],
    },
    preview: {
      operationId: "preview-external-agent",
      command: "development-item.node.field.update",
      expiresAt: "2026-10-15T12:00:00Z",
      contextVersion: "story:34:entity:5",
      warnings: [],
      changes: [{ field: "summary", after: "故事节点草稿" }],
      refreshScopes: ["story-detail"],
      preconditions: [],
    },
  };
}

function storyResult(caseId: string): StoryWorkbenchResult {
  const status = caseId === "confirmed-write"
    ? "SUCCEEDED"
    : caseId === "version-conflict" ? "CONFLICT" : "WRITE_RESULT_UNKNOWN";
  const successful = status === "SUCCEEDED";
  return {
    contractVersion: storyWorkbenchContractVersion,
    status,
    resourceId: 34,
    nodeId: 702,
    version: 5,
    variant: "writing",
    patch: { summary: "故事节点草稿" },
    operationId: caseId === "confirmed-write"
      ? "operation-confirmed-1"
      : caseId === "version-conflict" ? "operation-conflict-1" : "operation-unknown-1",
    verification: {
      resourceReadback: successful,
      contextReadback: successful,
      patchApplied: successful,
      protectedFieldsUnchanged: successful,
    },
    warnings: successful ? [] : [caseId === "version-conflict" ? "上下文版本冲突" : "回读结果未知"],
  };
}

describe("external Agent contract acceptance cases", () => {
  it("covers read, clarification, draft, confirmed write, conflict and unknown readback", async () => {
    const cases = await loadCases();
    expect(cases).toHaveLength(6);

    for (const testCase of cases) {
      const context = workflowContext(testCase.resourceType, testCase.resourceId, testCase.nodeId, testCase.contextVersion);
      const session = testCase.id === "read-only-analysis"
        ? toRequirementAnalysisWorkSession({
          sessionId: testCase.id,
          taskId: `${testCase.id}-task`,
          context,
          draft: null,
        })
        : testCase.id === "missing-input-clarification"
          ? toRequirementAnalysisWorkSession({
            sessionId: testCase.id,
            taskId: `${testCase.id}-task`,
            context,
            draft: requirementDraft(true),
          })
          : testCase.id === "draft-only-story"
            ? toStoryWorkbenchWorkSession({
              sessionId: testCase.id,
              taskId: `${testCase.id}-task`,
              context,
              input: storyInput(false),
            })
            : toStoryWorkbenchWorkSession({
              sessionId: testCase.id,
              taskId: `${testCase.id}-task`,
              context,
              input: storyInput(true),
              plan: storyPlan(),
              result: storyResult(testCase.id),
            });

      expect(session.contractVersion).toBe(agentContractVersion);
      expect(session.resource).toEqual({ type: testCase.resourceType, id: testCase.resourceId });
      expect(session.contextSnapshot.contextVersion).toBe(testCase.contextVersion);
      expect(session.agentTask.permissionMode).toBe(testCase.permissionMode);
      expect(session.operation?.operationId ?? null).toBe(testCase.operationId);
      expect(session.verification?.status ?? null).toBe(testCase.verification);
      if (testCase.expectedMutation === false && testCase.operationId === null) {
        expect(session.operation).toBeNull();
      }
      if (testCase.expectedMutation === false && testCase.operationId !== null) {
        expect(session.operation?.status).not.toBe("SUCCEEDED");
      }
      if (testCase.id === "missing-input-clarification") {
        expect(session.draft?.questions).toContain("需要确认验收口径");
      }
      if (testCase.id === "unknown-readback") {
        expect(session.operation?.status).toBe("WRITE_RESULT_UNKNOWN");
        expect(session.verification?.status).toBe("UNKNOWN");
      }
    }
  });
});
