import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import type {
  AgentDraft,
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
