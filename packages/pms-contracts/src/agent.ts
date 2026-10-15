import { z } from "zod";

import { operationPreviewSchema, resourceRefSchema } from "./operation.js";
import { analysisItemSchema } from "./scenario.js";

export const agentContractVersion = "agent-contract/v1" as const;

const agentResourceTypeSchema = z.enum(["project", "requirement", "topic", "story"]);

/** Resource reference used by an Agent session; an Agent target always has an ID. */
export const agentResourceRefSchema = resourceRefSchema.extend({
  type: agentResourceTypeSchema,
  id: z.number().int().positive(),
}).strict();

const agentWarningSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
}).strict();

const agentNodeRefSchema = z.object({
  id: z.number().int().positive().nullable(),
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
}).strict();

export const contextSnapshotSchema = z.object({
  snapshotId: z.string().trim().min(1),
  resource: agentResourceRefSchema,
  contextVersion: z.string().trim().min(1),
  capturedAt: z.string().trim().min(1),
  currentNode: agentNodeRefSchema.nullable(),
  workflowNodes: z.array(z.unknown()),
  relations: z.array(z.object({
    resource: agentResourceRefSchema,
    label: z.string().trim().min(1),
    readable: z.boolean(),
  }).strict()).default([]),
  allowedActions: z.array(z.string().trim().min(1)),
  sourceRefs: z.array(z.string().trim().min(1)),
  warnings: z.array(agentWarningSchema).default([]),
  raw: z.unknown().optional(),
}).strict();

const nodeFieldSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.string().trim().min(1).nullable().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  currentValue: z.unknown().optional(),
}).strict();

export const nodeContractSchema = z.object({
  nodeId: z.number().int().positive().nullable(),
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  version: z.number().int().nonnegative().nullable(),
  requiredFields: z.array(nodeFieldSchema),
  writableFields: z.array(z.string().trim().min(1)),
  protectedFields: z.array(z.string().trim().min(1)),
  allowedActions: z.array(z.string().trim().min(1)),
  allowedTransitions: z.array(z.string().trim().min(1)),
  missingInputRules: z.array(z.string().trim().min(1)),
  writeCapable: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.writeCapable && value.writableFields.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["writableFields"],
      message: "可写节点必须声明 writableFields",
    });
  }
  if (value.writeCapable && value.nodeId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["nodeId"],
      message: "可写节点必须声明 nodeId",
    });
  }
  if (value.writeCapable && value.version === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["version"],
      message: "可写节点必须声明 version",
    });
  }
});

export const agentTaskSchema = z.object({
  taskId: z.string().trim().min(1),
  parentTaskId: z.string().trim().min(1).nullable().optional(),
  role: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  resource: agentResourceRefSchema,
  contextSnapshotId: z.string().trim().min(1),
  permissionMode: z.enum(["read-only", "draft", "write"]),
}).strict();

/**
 * The only payload shape a parent Agent may hand to a child Agent.
 * It contains the immutable snapshot and task metadata, never a PMS client,
 * token, auth-store path, or executable callback.
 */
export const childAgentTaskPayloadSchema = z.object({
  contextSnapshot: contextSnapshotSchema,
  task: agentTaskSchema,
}).strict().superRefine((value, ctx) => {
  if (value.task.contextSnapshotId !== value.contextSnapshot.snapshotId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["task", "contextSnapshotId"],
      message: "子 Agent 任务必须引用所携带的上下文快照",
    });
  }
  if (value.task.resource.type !== value.contextSnapshot.resource.type
      || value.task.resource.id !== value.contextSnapshot.resource.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["task", "resource"],
      message: "子 Agent 任务资源必须与上下文快照一致",
    });
  }
  if (value.task.permissionMode !== "read-only") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["task", "permissionMode"],
      message: "子 Agent 任务只能使用 read-only 权限模式",
    });
  }
});

export const agentDraftSchema = z.object({
  facts: z.array(analysisItemSchema),
  inferences: z.array(analysisItemSchema),
  assumptions: z.array(analysisItemSchema),
  unresolvedDecisions: z.array(analysisItemSchema),
  proposedFieldValues: z.record(z.string(), z.unknown()),
  missingFields: z.array(z.string().trim().min(1)),
  questions: z.array(z.string().trim().min(1)),
  evidenceRefs: z.array(z.string().trim().min(1)),
  confidence: z.enum(["high", "medium", "low"]),
  scenarioDraft: z.unknown().optional(),
}).strict();

export const previewEnvelopeSchema = operationPreviewSchema.extend({
  phase: z.literal("PREVIEWED").default("PREVIEWED"),
});

const operationStatusSchema = z.enum([
  "PLANNED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REJECTED",
  "CONFLICT",
  "WRITE_RESULT_UNKNOWN",
]);

export const operationEnvelopeSchema = z.object({
  operationId: z.string().trim().min(1),
  previewOperationId: z.string().trim().min(1).optional(),
  status: operationStatusSchema,
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  warnings: z.array(z.string()).default([]),
  refreshScopes: z.array(z.string()).default([]),
  auditId: z.string().trim().min(1).optional(),
}).strict();

export const confirmationEnvelopeSchema = z.object({
  status: z.enum(["NOT_REQUIRED", "PENDING", "CONFIRMED", "REJECTED"]),
  confirmedAt: z.string().trim().min(1).optional(),
  confirmedBy: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.status === "CONFIRMED" && !value.confirmedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedAt"],
      message: "确认写入必须记录 confirmedAt",
    });
  }
  if (value.status === "CONFIRMED" && !value.confirmedBy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedBy"],
      message: "确认写入必须记录 confirmedBy",
    });
  }
});

export const verificationEnvelopeSchema = z.object({
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"]),
  resourceReadback: z.boolean(),
  contextReadback: z.boolean(),
  patchApplied: z.boolean(),
  protectedFieldsUnchanged: z.boolean(),
  message: z.string().optional(),
}).strict();

export const agentWorkSessionSchema = z.object({
  contractVersion: z.literal(agentContractVersion),
  sessionId: z.string().trim().min(1),
  resource: agentResourceRefSchema,
  contextSnapshot: contextSnapshotSchema,
  nodeContract: nodeContractSchema.nullable(),
  agentTask: agentTaskSchema,
  draft: agentDraftSchema.nullable().default(null),
  preview: previewEnvelopeSchema.nullable().default(null),
  confirmation: confirmationEnvelopeSchema.default({ status: "NOT_REQUIRED" }),
  operation: operationEnvelopeSchema.nullable().default(null),
  verification: verificationEnvelopeSchema.nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.contextSnapshot.resource.type !== value.resource.type
      || value.contextSnapshot.resource.id !== value.resource.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contextSnapshot", "resource"],
      message: "上下文快照资源必须与 Agent 会话资源一致",
    });
  }
  if (value.agentTask.resource.type !== value.resource.type
      || value.agentTask.resource.id !== value.resource.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agentTask", "resource"],
      message: "Agent 任务资源必须与会话资源一致",
    });
  }
  if (value.agentTask.contextSnapshotId !== value.contextSnapshot.snapshotId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agentTask", "contextSnapshotId"],
      message: "Agent 任务必须引用当前上下文快照",
    });
  }
  if ((value.operation?.status === "SUCCEEDED" || value.operation?.status === "WRITE_RESULT_UNKNOWN")
      && value.verification === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verification"],
      message: "成功写入必须包含 verification",
    });
  }
  if ((value.operation?.status === "SUCCEEDED" || value.operation?.status === "WRITE_RESULT_UNKNOWN")
      && value.preview === null
      && !value.operation.previewOperationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["preview"],
      message: "写入会话必须绑定操作预览",
    });
  }
  if ((value.operation?.status === "SUCCEEDED" || value.operation?.status === "WRITE_RESULT_UNKNOWN")
      && value.agentTask.permissionMode === "write"
      && value.confirmation.status !== "CONFIRMED") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmation"],
      message: "写入会话必须记录用户确认",
    });
  }
  if (value.operation?.status === "SUCCEEDED" && value.verification !== null
      && (value.verification.status !== "SUCCEEDED"
        || !value.verification.resourceReadback
        || !value.verification.contextReadback
        || !value.verification.patchApplied
        || !value.verification.protectedFieldsUnchanged)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verification"],
      message: "SUCCEEDED 写入必须通过完整回读验证",
    });
  }
});

export type AgentResourceRef = z.infer<typeof agentResourceRefSchema>;
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
export type NodeContract = z.infer<typeof nodeContractSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
export type ChildAgentTaskPayload = z.infer<typeof childAgentTaskPayloadSchema>;
export type AgentDraft = z.infer<typeof agentDraftSchema>;
export type PreviewEnvelope = z.infer<typeof previewEnvelopeSchema>;
export type OperationEnvelope = z.infer<typeof operationEnvelopeSchema>;
export type ConfirmationEnvelope = z.infer<typeof confirmationEnvelopeSchema>;
export type VerificationEnvelope = z.infer<typeof verificationEnvelopeSchema>;
export type AgentWorkSession = z.infer<typeof agentWorkSessionSchema>;
