import { describe, expect, it } from "vitest";
import {
  toRequirementAnalysisWorkSession,
  toStoryWorkbenchWorkSession,
} from "../../apps/pms-cli/src/commands/scenarios/agentWorkSession.js";
import {
  scenarioContractVersion,
  storyWorkbenchContractVersion,
  type AnalysisDraft,
  type StoryWorkbenchInput,
  type StoryWorkbenchResult,
  type WorkflowContext,
} from "../../packages/pms-contracts/src/index.js";
import type {
  RequirementAnalysisScenarioPlan,
  RequirementAnalysisScenarioResult,
} from "../../apps/pms-cli/src/commands/scenarios/requirementAnalysis.js";
import type { StoryWorkbenchScenarioPlan } from "../../apps/pms-cli/src/commands/scenarios/storyWorkbench.js";

function context(type: "requirement" | "story", id: number): WorkflowContext {
  return {
    resource: { type, id },
    version: 3,
    entityVersion: 5,
    currentNode: { id: 701, key: "analysis", label: "分析" },
    workflow: {
      templateVersionId: 88,
      templateVersionNo: 2,
      nodes: [{
        id: 701,
        key: "analysis",
        label: "分析",
        position: 0,
        fields: [{ key: "summary", label: "摘要", type: "text", required: true }],
        components: [{
          key: type === "story" ? "story-node-workbench" : "requirement-node-workbench",
          label: "工作台",
          fields: [],
          actions: [],
          saveContract: {
            command: "development-item.node.field.update",
            itemType: type.toUpperCase(),
            itemId: id,
            nodeId: 701,
            version: 3,
            writableFields: ["summary"],
          },
        }],
        fieldValues: {},
        version: 3,
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
      selectedNodeId: 701,
      selectedComponentKey: type === "story" ? "story-node-workbench" : "requirement-node-workbench",
      workflowConfigured: true,
      workflowStatus: "IN_PROGRESS",
      workflowInstanceVersion: 2,
      permissionsScope: "business-user",
      referencesScope: "readable-only",
      contextVersion: `${type}:${id}:entity:5`,
      warnings: [],
    },
  };
}

const preview = {
  operationId: "preview-1",
  command: "development-item.node.field.update",
  expiresAt: "2026-10-15T12:00:00Z",
  contextVersion: "requirement:42:entity:5",
  warnings: [],
  changes: [{ field: "summary", after: "已分析" }],
  refreshScopes: ["requirement-detail"],
  preconditions: [],
};

describe("AgentWorkSession scenario adapters", () => {
  it("keeps requirement-analysis draft, preview, operation and verification in one envelope", () => {
    const draft: AnalysisDraft = {
      facts: [{ text: "事实", sourceRefs: ["requirement:42"], confidence: "high" }],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      patch: { summary: "已分析" },
    };
    const plan = {
      scenario: "requirement-analysis" as const,
      phase: "plan" as const,
      requirementId: 42,
      analysisPatch: draft.patch,
      facts: {
        resource: { resourceType: "requirement" as const, resourceId: 42, entityVersion: 5, details: {} },
        currentNode: { id: 701, key: "analysis", label: "分析" },
        workflow: { templateVersionId: 88, templateVersionNo: 2, nodes: [] },
        allowedActions: ["development-item.node.field.update"],
      },
      declaredFields: ["summary"],
      inferences: [],
      assumptions: [],
      preview,
      trace: { requestId: "req-1" },
    } satisfies RequirementAnalysisScenarioPlan;
    const result = {
      scenario: "requirement-analysis" as const,
      phase: "execute" as const,
      requirementId: 42,
      analysisPatch: draft.patch,
      facts: plan.facts,
      result: {
        operationId: "operation-1",
        status: "SUCCEEDED" as const,
        data: { saved: true },
        warnings: [],
        refreshScopes: ["requirement-detail"],
      },
      readback: { resource: plan.facts.resource, context: context("requirement", 42) },
      protectedFieldsUnchanged: { ownerId: true },
      warnings: [],
      trace: { requestId: "req-1", operationId: "operation-1", idempotencyKey: "idem-1" },
    } satisfies RequirementAnalysisScenarioResult;

    const session = toRequirementAnalysisWorkSession({
      sessionId: "session-1",
      taskId: "task-1",
      context: context("requirement", 42),
      draft,
      plan,
      result,
    });

    expect(session.agentTask.permissionMode).toBe("write");
    expect(session.draft?.scenarioDraft).toMatchObject({ contractVersion: scenarioContractVersion });
    expect(session.draft?.proposedFieldValues).toEqual({ summary: "已分析" });
    expect(session.preview?.operationId).toBe("preview-1");
    expect(session.operation).toMatchObject({ operationId: "operation-1", status: "SUCCEEDED" });
    expect(session.verification).toMatchObject({ status: "SUCCEEDED", resourceReadback: true });
  });

  it("preserves story-workbench variant and write result while retaining the common envelope", () => {
    const input = {
      contractVersion: storyWorkbenchContractVersion,
      resourceType: "story" as const,
      resourceId: 34,
      nodeId: 701,
      version: 3,
      variant: "writing" as const,
      patch: { summary: "故事摘要" },
      save: true,
      idempotencyKey: "story-34-3",
    } satisfies StoryWorkbenchInput;
    const plan = {
      scenario: "story-workbench" as const,
      phase: "plan" as const,
      contractVersion: storyWorkbenchContractVersion,
      resourceId: 34,
      nodeId: 701,
      version: 3,
      variant: "writing" as const,
      patch: input.patch,
      saveContract: {
        command: "development-item.node.field.update",
        itemType: "STORY",
        itemId: 34,
        nodeId: 701,
        version: 3,
        componentKey: "story-node-workbench",
        variant: "writing",
        fieldValuesPath: "__components.story-node-workbench",
        writableFields: ["summary"],
      },
      preview: { ...preview, contextVersion: "story:34:entity:5" },
    } satisfies StoryWorkbenchScenarioPlan;
    const result = {
      contractVersion: storyWorkbenchContractVersion,
      status: "SUCCEEDED" as const,
      resourceId: 34,
      nodeId: 701,
      version: 3,
      variant: "writing" as const,
      patch: input.patch,
      operationId: "operation-story-1",
      verification: {
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      },
      warnings: [],
    } satisfies StoryWorkbenchResult;

    const session = toStoryWorkbenchWorkSession({
      sessionId: "session-story-1",
      taskId: "task-story-1",
      context: context("story", 34),
      input,
      plan,
      result,
    });

    expect(session.agentTask.permissionMode).toBe("write");
    expect(session.draft?.scenarioDraft).toMatchObject({
      contractVersion: storyWorkbenchContractVersion,
      variant: "writing",
    });
    expect(session.preview?.operationId).toBe("preview-1");
    expect(session.operation?.operationId).toBe("operation-story-1");
    expect(session.verification?.patchApplied).toBe(true);
  });

  it("derives a requirement draft from a legacy patch when no draft JSON was supplied", () => {
    const plan = {
      scenario: "requirement-analysis" as const,
      phase: "plan" as const,
      requirementId: 42,
      analysisPatch: { summary: "legacy patch" },
      facts: {
        resource: { resourceType: "requirement" as const, resourceId: 42, entityVersion: 5, details: {} },
        currentNode: { id: 701, key: "analysis", label: "分析" },
        workflow: { templateVersionId: 88, templateVersionNo: 2, nodes: [] },
        allowedActions: [],
      },
      declaredFields: ["summary"],
      inferences: [],
      assumptions: [],
      preview,
      trace: { requestId: "req-legacy" },
    } satisfies RequirementAnalysisScenarioPlan;

    const session = toRequirementAnalysisWorkSession({
      sessionId: "session-legacy",
      taskId: "task-legacy",
      context: context("requirement", 42),
      draft: null,
      plan,
    });

    expect(session.draft?.proposedFieldValues).toEqual({ summary: "legacy patch" });
    expect(session.draft?.scenarioDraft).toMatchObject({ contractVersion: scenarioContractVersion });
    expect(session.agentTask.permissionMode).toBe("draft");
  });

  it("retains WRITE_RESULT_UNKNOWN in the common operation envelope", () => {
    const input = {
      contractVersion: storyWorkbenchContractVersion,
      resourceType: "story" as const,
      resourceId: 34,
      nodeId: 701,
      version: 3,
      variant: "writing" as const,
      patch: { summary: "故事摘要" },
      save: true,
      idempotencyKey: "story-34-unknown",
    } satisfies StoryWorkbenchInput;
    const session = toStoryWorkbenchWorkSession({
      sessionId: "session-unknown",
      taskId: "task-unknown",
      context: context("story", 34),
      input,
      result: {
        contractVersion: storyWorkbenchContractVersion,
        status: "WRITE_RESULT_UNKNOWN",
        resourceId: 34,
        nodeId: 701,
        version: 3,
        variant: "writing",
        patch: input.patch,
        operationId: "operation-unknown",
        verification: {
          resourceReadback: false,
          contextReadback: false,
          patchApplied: false,
          protectedFieldsUnchanged: false,
        },
        warnings: ["回读失败"],
      },
    });

    expect(session.operation?.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(session.verification?.status).toBe("UNKNOWN");
  });
});
