import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import type {
  AgentDraft,
  AgentProgressionDraft,
  ChildAgentTaskPayload,
  AgentTask,
  AnalysisDraft,
  ContextSnapshot,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  agentDraftSchema,
  childAgentTaskPayloadSchema,
  agentTaskSchema,
  analysisDraftSchema,
  contextSnapshotSchema,
  scenarioContractVersion,
} from "../../../../../packages/pms-contracts/src/index.js";
import { AnalysisDraftValidator } from "./AnalysisDraftValidator.js";

export const agentDraftContractVersion = scenarioContractVersion;

export function parseAgentDraftJson(raw: string): AnalysisDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Agent Draft 必须是有效 JSON");
  }
  const result = analysisDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Agent Draft 不符合 AnalysisDraft 合约：${result.error.message}`);
  }
  return result.data;
}

export function validateAgentDraft(draft: AnalysisDraft, context: WorkflowContext): AnalysisDraft {
  AnalysisDraftValidator.validate(draft, context);
  return draft;
}

export interface AgentProgressionDraftDiagnostics {
  unknownFields: string[];
  protectedFields: string[];
  missingSources: string[];
  unsafePayloadKeys: string[];
  unresolvedDecisions: string[];
}

const highRiskInferenceFields = new Set([
  "acceptanceConclusion",
  "businessConfirmation",
  "conclusion",
  "decision",
  "designReviewStatus",
  "productReviewStatus",
  "selfTestResult",
  "strategicFitScore",
  "technicalReviewStatus",
  "testResult",
  "testStatus",
]);

/**
 * Checks only the field-level write boundary declared by the current PMS context. It returns
 * diagnostics instead of throwing so `scenario progression draft` can ask one consolidated
 * question and still guarantees that no preview or write was created.
 */
export function validateAgentProgressionDraftFields(
  draft: AgentProgressionDraft,
  context: WorkflowContext,
  nodeId?: number,
): AgentProgressionDraftDiagnostics {
  const patch = draft.patch ?? {};
  const patchKeys = Object.keys(patch);
  const contract = readNodeDetailContract(context, nodeId);
  const writable = new Set(contract.writableFields);
  const protectedFields = new Set(contract.protectedFields);
  const fieldSources = draft.fieldSources ?? {};
  const protectedPatchFields = patchKeys.filter((key) => protectedFields.has(key));
  const unknownFields = patchKeys.filter((key) => !writable.has(key) && !protectedFields.has(key));
  const missingSources = patchKeys.filter((key) => {
    const source = fieldSources[key];
    return writable.has(key) && (source === undefined || source.sourceRefs.length === 0);
  });
  const unresolvedDecisions = [
    ...draft.unresolvedDecisions.map((item) => item.text),
    ...patchKeys.filter((key) => {
      const source = fieldSources[key];
      return highRiskInferenceFields.has(key)
        && source?.sourceType === "inference"
        && source.confidence !== "high";
    }).map((key) => `${key}: 低置信度推断不能自动写入高风险业务结论`),
  ];
  return {
    unknownFields,
    protectedFields: protectedPatchFields,
    missingSources,
    unsafePayloadKeys: [],
    unresolvedDecisions,
  };
}

export function buildChildAgentTask(input: {
  parentTaskId: string;
  taskId: string;
  role: string;
  objective: string;
  snapshot: ContextSnapshot;
}): AgentTask {
  assertSafeAgentPayload(input);
  const snapshot = contextSnapshotSchema.parse(input.snapshot);
  return agentTaskSchema.parse({
    taskId: input.taskId,
    parentTaskId: input.parentTaskId,
    role: input.role,
    objective: input.objective,
    resource: snapshot.resource,
    contextSnapshotId: snapshot.snapshotId,
    permissionMode: "read-only",
  });
}

export function buildChildAgentTaskPayload(input: {
  parentTaskId: string;
  taskId: string;
  role: string;
  objective: string;
  snapshot: ContextSnapshot;
}): ChildAgentTaskPayload {
  const task = buildChildAgentTask(input);
  return childAgentTaskPayloadSchema.parse({
    contextSnapshot: input.snapshot,
    task,
  });
}

export function validateChildDraft(draft: AgentDraft, snapshot: ContextSnapshot): void {
  assertSafeAgentPayload(draft);
  const parsedDraft = agentDraftSchema.parse(draft);
  const parsedSnapshot = contextSnapshotSchema.parse(snapshot);
  const unreadableRefs = new Set(
    parsedSnapshot.relations
      .filter((relation) => !relation.readable)
      .map((relation) => `${relation.resource.type}:${relation.resource.id}`),
  );
  const allowedRefs = new Set([
    `${parsedSnapshot.resource.type}:${parsedSnapshot.resource.id}`,
    ...parsedSnapshot.sourceRefs.filter((ref) => !unreadableRefs.has(ref)),
  ]);
  const evidenceRefs = [
    ...parsedDraft.evidenceRefs,
    ...[
      parsedDraft.facts,
      parsedDraft.inferences,
      parsedDraft.assumptions,
      parsedDraft.unresolvedDecisions,
    ].flatMap((items) => items.flatMap((item) => item.sourceRefs)),
  ];
  const unauthorized = evidenceRefs.find((ref) => !allowedRefs.has(ref));
  if (unauthorized) {
    throw new PmsClientError(
      "validation",
      `CHILD_DRAFT_EVIDENCE_UNAUTHORIZED: 子 Agent 证据引用不在当前快照中: ${unauthorized}`,
      { details: { code: "CHILD_DRAFT_EVIDENCE_UNAUTHORIZED", sourceRef: unauthorized } },
    );
  }
}

const forbiddenPayloadKey = /(?:token|api[_-]?key|auth(?:orization|store)?|password|secret|credential|cookie|callback)/i;

export function assertSafeAgentPayload(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (typeof value === "function") {
    throw new PmsClientError("validation", `CHILD_AGENT_PAYLOAD_EXECUTABLE: ${path} 不允许携带可执行回调`, {
      details: { code: "CHILD_AGENT_PAYLOAD_EXECUTABLE", path },
    });
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSafeAgentPayload(entry, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenPayloadKey.test(key)) {
      throw new PmsClientError("validation", `CHILD_AGENT_PAYLOAD_CREDENTIAL: ${path}.${key} 不允许传递凭据字段`, {
        details: { code: "CHILD_AGENT_PAYLOAD_CREDENTIAL", path: `${path}.${key}` },
      });
    }
    assertSafeAgentPayload(entry, `${path}.${key}`, seen);
  }
}

function readNodeDetailContract(context: WorkflowContext, nodeId?: number): {
  writableFields: string[];
  protectedFields: string[];
} {
  const selectedNodeId = nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id;
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate)
    && (selectedNodeId === undefined || candidate.id === selectedNodeId));
  if (!isRecord(node)) return { writableFields: [], protectedFields: [] };
  const components = Array.isArray(node.components) ? node.components : [];
  const component = components.find((candidate) => isRecord(candidate)
    && isRecord(candidate.saveContract))
    ?? components.find((candidate) => isRecord(candidate));
  const saveContract = component && isRecord(component.saveContract) ? component.saveContract : undefined;
  return {
    writableFields: stringArray(saveContract?.writableFields),
    protectedFields: stringArray(saveContract?.protectedFields),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}
