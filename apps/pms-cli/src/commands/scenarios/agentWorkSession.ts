import {
  agentWorkSessionSchema,
  operationEnvelopeSchema,
  previewEnvelopeSchema,
  verificationEnvelopeSchema,
  scenarioContractVersion,
  storyWorkbenchContractVersion,
  type AgentDraft,
  type AgentWorkSession,
  type AnalysisDraft,
  type OperationPreview,
  type OperationEnvelope,
  type WorkflowContext,
  type StoryWorkbenchInput,
  type StoryWorkbenchResult,
} from "../../../../../packages/pms-contracts/src/index.js";
import { buildAgentContext, nodeSourceRef } from "../core/agentContext.js";
import type {
  RequirementAnalysisScenarioPlan,
  RequirementAnalysisScenarioResult,
} from "./requirementAnalysis.js";
import type { StoryWorkbenchScenarioPlan } from "./storyWorkbench.js";

export function toRequirementAnalysisWorkSession(input: {
  sessionId: string;
  taskId: string;
  context: WorkflowContext;
  draft: AnalysisDraft | null;
  plan?: RequirementAnalysisScenarioPlan;
  result?: RequirementAnalysisScenarioResult;
}): AgentWorkSession {
  const base = buildAgentContext(input.context, {
    nodeId: input.plan?.facts.currentNode.id ?? input.context.currentNode?.id ?? undefined,
  });
  const sourceDraft = input.draft
    ?? (input.plan ? draftFromPatch(input.plan.analysisPatch) : undefined)
    ?? (input.result ? draftFromPatch(input.result.analysisPatch) : undefined);
  const draft = sourceDraft
    ? analysisDraft(sourceDraft, {
      contractVersion: scenarioContractVersion,
      declaredFields: input.plan?.declaredFields ?? [],
    })
    : null;
  return finalizeSession(base, {
    sessionId: input.sessionId,
    taskId: input.taskId,
    role: "requirement-analysis-agent",
    objective: "分析需求当前节点并生成需求分析成果",
    draft,
    preview: input.plan?.preview,
    operation: input.result?.result,
    verification: input.result
      ? {
        resourceReadback: input.result.readback.resource !== null,
        contextReadback: input.result.readback.context !== null,
        patchApplied: input.result.result.status === "SUCCEEDED"
          && input.result.readback.resource !== null
          && input.result.readback.context !== null,
        protectedFieldsUnchanged: input.result.readback.resource !== null
          && input.result.readback.context !== null
          && Object.values(input.result.protectedFieldsUnchanged).every(Boolean),
        status: input.result.result.status,
        message: input.result.warnings[0],
      }
      : undefined,
  });
}

export function toStoryWorkbenchWorkSession(input: {
  sessionId: string;
  taskId: string;
  context: WorkflowContext;
  input: StoryWorkbenchInput;
  plan?: StoryWorkbenchScenarioPlan;
  result?: StoryWorkbenchResult;
}): AgentWorkSession {
  const base = buildAgentContext(input.context, {
    nodeId: input.input.nodeId,
    component: "story-node-workbench",
  });
  const draft = fieldDraft(input.input);
  return finalizeSession(base, {
    sessionId: input.sessionId,
    taskId: input.taskId,
    role: "story-workbench-agent",
    objective: "补齐故事当前节点工作台字段",
    draft,
    preview: input.plan?.preview,
    operation: input.result ? storyOperation(input.result) : undefined,
    verification: input.result?.verification
      ? {
        ...input.result.verification,
        status: input.result.status,
        message: input.result.warnings[0],
      }
      : undefined,
  });
}

function finalizeSession(
  base: AgentWorkSession,
  input: {
    sessionId: string;
    taskId: string;
    role: string;
    objective: string;
    draft: AgentDraft | null;
    preview?: OperationPreview;
    operation?: OperationEnvelope;
    verification?: {
      resourceReadback: boolean;
      contextReadback: boolean;
      patchApplied: boolean;
      protectedFieldsUnchanged: boolean;
      status: string;
      message?: string;
    };
  },
): AgentWorkSession {
  const operation = input.operation ? operationEnvelopeSchema.parse({
    operationId: input.operation.operationId,
    status: input.operation.status,
    message: input.operation.message,
    data: input.operation.data,
    warnings: input.operation.warnings,
    refreshScopes: input.operation.refreshScopes,
    auditId: input.operation.auditId,
  }) : null;
  const verification = input.verification
    ? verificationEnvelopeSchema.parse({ ...input.verification, status: verificationStatus(input.verification.status) })
    : null;
  const preview = input.preview ? previewEnvelopeSchema.parse({ ...input.preview, phase: "PREVIEWED" }) : null;
  const permissionMode = operation ? "write" : input.draft ? "draft" : "read-only";
  const confirmation = operation
    ? { status: "CONFIRMED" as const }
    : preview ? { status: "PENDING" as const } : { status: "NOT_REQUIRED" as const };

  return agentWorkSessionSchema.parse({
    ...base,
    sessionId: input.sessionId,
    agentTask: {
      ...base.agentTask,
      taskId: input.taskId,
      role: input.role,
      objective: input.objective,
      permissionMode,
    },
    draft: input.draft,
    preview,
    confirmation,
    operation,
    verification,
  });
}

function analysisDraft(
  draft: AnalysisDraft,
  scenario: { contractVersion: typeof scenarioContractVersion; declaredFields: string[] },
): AgentDraft {
  const items = [draft.facts, draft.inferences, draft.assumptions, draft.unresolvedDecisions].flat();
  const confidence = items.some((item) => item.confidence === "low")
    ? "low"
    : items.some((item) => item.confidence === "medium") ? "medium" : "high";
  const missingFields = scenario.declaredFields.filter((field) => draft.patch[field] === undefined);
  return {
    facts: draft.facts,
    inferences: draft.inferences,
    assumptions: draft.assumptions,
    unresolvedDecisions: draft.unresolvedDecisions,
    proposedFieldValues: draft.patch,
    missingFields,
    questions: draft.unresolvedDecisions.map((item) => item.text),
    evidenceRefs: unique(items.flatMap((item) => item.sourceRefs)),
    confidence,
    scenarioDraft: {
      contractVersion: scenario.contractVersion,
      patch: draft.patch,
      declaredFields: scenario.declaredFields,
    },
  };
}

function draftFromPatch(patch: Record<string, unknown>): AnalysisDraft {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
  };
}

function fieldDraft(input: StoryWorkbenchInput): AgentDraft {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    proposedFieldValues: input.patch,
    missingFields: [],
    questions: [],
    evidenceRefs: [`story:${input.resourceId}`, nodeSourceRef("story", input.nodeId)],
    confidence: "medium",
    scenarioDraft: {
      contractVersion: storyWorkbenchContractVersion,
      resourceId: input.resourceId,
      nodeId: input.nodeId,
      version: input.version,
      variant: input.variant,
      patch: input.patch,
    },
  };
}

function storyOperation(result: StoryWorkbenchResult): OperationEnvelope | undefined {
  if (!result.operation) return undefined;
  return result.operation;
}

function verificationStatus(status: string): "PENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" {
  if (status === "SUCCEEDED") return "SUCCEEDED";
  if (status === "WRITE_RESULT_UNKNOWN") return "UNKNOWN";
  if (status === "DRAFT" || status === "PREVIEWED") return "PENDING";
  return "FAILED";
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
