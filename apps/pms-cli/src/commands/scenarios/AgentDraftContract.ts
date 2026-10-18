import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import type {
  AgentDraft,
  AgentProgressionDraft,
  AgentProgressionIntent,
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

export interface AgentProgressionPlanDetails extends AgentProgressionDraftDiagnostics {
  fieldChanges: Array<{
    key: string;
    label: string;
    from: unknown;
    to: unknown;
    sourceType: "pms_context" | "conversation" | "inference" | null;
    confidence: "high" | "medium" | "low" | null;
  }>;
  missingFields: Array<{ key: string; label: string; reason: string }>;
  preconditions: unknown[];
  completionMode?: string;
  completionBlockReason?: string;
  writeDecision: "READY" | "NEEDS_INPUT" | "WAITING_CONFIRMATION" | "CAPABILITY_UNAVAILABLE";
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

/** Builds a plan summary directly from the PMS saveContract and current component content. */
export function planAgentProgressionDraft(
  draft: AgentProgressionDraft,
  context: WorkflowContext,
  nodeId: number | undefined,
  intent: AgentProgressionIntent,
  executionMode: "read" | "automatic" | "confirmation",
): AgentProgressionPlanDetails {
  const contract = readNodeDetailContract(context, nodeId);
  const diagnostics = validateAgentProgressionDraftFields(draft, context, nodeId);
  const fieldChanges = Object.keys(draft.patch ?? {})
    .filter((key) => contract.writableFields.includes(key))
    .map((key) => {
      const source = draft.fieldSources?.[key];
      return {
        key,
        label: contract.labels.get(key) ?? key,
        from: contract.currentValues.get(key) ?? null,
        to: draft.patch[key] ?? null,
        sourceType: source?.sourceType ?? null,
        confidence: source?.confidence ?? null,
      };
    });
  const missingFields = intent === "COMPLETE_NODE"
    ? requiredNodeFields(contract, draft)
    : [];
  const completionMissing = intent === "COMPLETE_NODE" && draft.requestedCompletion !== false
    ? contract.completionRequiredMetadata
        .filter((key) => missingCompletionMetadata(context, nodeId, draft, key))
        .map((key) => ({ key, label: completionLabel(key), reason: "完成节点需要提供该信息" }))
    : [];
  const allMissing = [...missingFields, ...completionMissing];
  let writeDecision: AgentProgressionPlanDetails["writeDecision"] = "READY";
  if (contract.writableFields.length === 0 || !contract.command) writeDecision = "CAPABILITY_UNAVAILABLE";
  else if (diagnostics.unknownFields.length > 0 || diagnostics.protectedFields.length > 0) {
    writeDecision = "CAPABILITY_UNAVAILABLE";
  } else if (allMissing.length > 0 || diagnostics.missingSources.length > 0) {
    writeDecision = "NEEDS_INPUT";
  } else if (diagnostics.unresolvedDecisions.length > 0 || executionMode === "confirmation") {
    writeDecision = "WAITING_CONFIRMATION";
  } else if (intent === "COMPLETE_NODE" && contract.completionMode === "REQUIRES_DOMAIN_CONFIRMATION") {
    writeDecision = "WAITING_CONFIRMATION";
  }
  return {
    ...diagnostics,
    fieldChanges,
    missingFields: allMissing,
    preconditions: [],
    ...(contract.completionMode === undefined ? {} : { completionMode: contract.completionMode }),
    ...(contract.completionBlockReason === undefined ? {} : { completionBlockReason: contract.completionBlockReason }),
    writeDecision,
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
  requiredFields: Set<string>;
  labels: Map<string, string>;
  currentValues: Map<string, unknown>;
  completionRequiredMetadata: string[];
  completionMode?: string;
  completionAutomaticConfirmation?: boolean;
  completionBlockReason?: string;
  command?: string;
} {
  const selectedNodeId = nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id;
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate)
    && (selectedNodeId === undefined || candidate.id === selectedNodeId));
  if (!isRecord(node)) {
    return {
      writableFields: [], protectedFields: [], requiredFields: new Set(), labels: new Map(),
      currentValues: new Map(), completionRequiredMetadata: [],
    };
  }
  const components = Array.isArray(node.components) ? node.components : [];
  const component = components.find((candidate) => isRecord(candidate)
    && isRecord(candidate.saveContract))
    ?? components.find((candidate) => isRecord(candidate));
  const saveContract = component && isRecord(component.saveContract) ? component.saveContract : undefined;
  const labels = new Map<string, string>();
  const currentValues = new Map<string, unknown>();
  if (Array.isArray(saveContract?.fieldContracts)) {
    for (const raw of saveContract.fieldContracts) {
      if (!isRecord(raw) || typeof raw.key !== "string") continue;
      labels.set(raw.key, typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : raw.key);
    }
  }
  for (const key of stringArray(saveContract?.writableFields)) {
    if (!labels.has(key)) labels.set(key, key);
    if (component && isRecord(component.content)
      && Object.prototype.hasOwnProperty.call(component.content, key)) {
      currentValues.set(key, component.content[key]);
    }
  }
  const requiredFields = new Set(stringArray(saveContract?.requiredFields));
  if (Array.isArray(saveContract?.fieldContracts)) {
    for (const raw of saveContract.fieldContracts) {
      if (isRecord(raw) && raw.required === true && typeof raw.key === "string") requiredFields.add(raw.key);
    }
  }
  return {
    writableFields: stringArray(saveContract?.writableFields),
    protectedFields: stringArray(saveContract?.protectedFields),
    requiredFields,
    labels,
    currentValues,
    completionRequiredMetadata: stringArray(saveContract?.completionRequiredMetadata),
    ...(typeof saveContract?.completionMode === "string"
      ? { completionMode: saveContract.completionMode } : {}),
    ...(typeof saveContract?.completionAutomaticConfirmation === "boolean"
      ? { completionAutomaticConfirmation: saveContract.completionAutomaticConfirmation } : {}),
    ...(typeof saveContract?.completionBlockReason === "string"
      ? { completionBlockReason: saveContract.completionBlockReason } : {}),
    command: typeof saveContract?.command === "string" ? saveContract.command : undefined,
  };
}

function requiredNodeFields(
  contract: ReturnType<typeof readNodeDetailContract>,
  draft: AgentProgressionDraft,
): Array<{ key: string; label: string; reason: string }> {
  return [...contract.requiredFields]
    .filter((key) => isMissingValue(draft.patch[key] ?? contract.currentValues.get(key)))
    .map((key) => ({
      key,
      label: contract.labels.get(key) ?? key,
      reason: "当前节点完成前必须填写",
    }));
}

function missingCompletionMetadata(
  context: WorkflowContext,
  nodeId: number | undefined,
  draft: AgentProgressionDraft,
  key: string,
): boolean {
  if (draft[key as keyof AgentProgressionDraft] !== undefined) return false;
  const selectedNodeId = nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id;
  const node = Array.isArray(context.workflow?.nodes)
    ? context.workflow.nodes.find((candidate) => isRecord(candidate)
      && (selectedNodeId === undefined || candidate.id === selectedNodeId))
    : undefined;
  if (!isRecord(node)) return true;
  const value = key === "ownerId" ? node.ownerId : key === "startDate" ? node.startDate : node.endDate;
  return isMissingValue(value);
}

function completionLabel(key: string): string {
  return key === "ownerId" ? "负责人" : key === "startDate" ? "开始日期" : key === "endDate" ? "结束日期" : key;
}

function isMissingValue(value: unknown): boolean {
  return value === undefined || value === null
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0)
    || (isRecord(value) && Object.keys(value).length === 0);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];
}
