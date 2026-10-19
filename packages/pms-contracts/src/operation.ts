import { z } from "zod";
import { draftProvenanceSchema, type DraftProvenance } from "./provenance.js";

export const resourceTypeSchema = z.enum([
  "requirement",
  "project",
  "project_node",
  "topic",
  "topic_node",
  "story",
  "story_node",
  "task",
  "subtask",
  "iteration_plan",
  "workflow_template",
  "user",
]);

export type ResourceType = z.infer<typeof resourceTypeSchema>;

export const resourceRefSchema = z.object({
  type: resourceTypeSchema,
  id: z.number().int().positive().optional(),
});

export const operationContextSchema = z.object({
  id: z.string().trim().min(1),
  version: z.string().trim().min(1),
});

export const operationContractSchema = z.object({
  id: z.string().trim().min(1),
  version: z.string().trim().min(1),
});

export type OperationContract = z.infer<typeof operationContractSchema>;

export const automaticOperationRequestSchema = z.object({
  operation: z.string().trim().min(1).max(160),
  arguments: z.record(z.string(), z.unknown()).default({}),
  context: operationContextSchema.optional(),
  contract: operationContractSchema.optional(),
  provenance: draftProvenanceSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(160),
  clientId: z.literal("pms-cli"),
  requestId: z.string().trim().min(1).max(160),
});

export type AutomaticOperationRequest = z.infer<typeof automaticOperationRequestSchema>;
export type OperationProvenance = DraftProvenance;

export const operationStatusSchema = z.enum([
  "SUCCEEDED",
  "REJECTED",
  "CONFLICT",
  "WRITE_RESULT_UNKNOWN",
]);

export const operationResultSchema = z.object({
  operationId: z.string().trim().min(1),
  status: operationStatusSchema,
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  warnings: z.array(z.string()).default([]),
  refreshScopes: z.array(z.string()).default([]),
  auditId: z.string().trim().min(1).optional(),
});

export type OperationResult = z.infer<typeof operationResultSchema>;

export const operationPreconditionSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  blocking: z.boolean(),
  suggestedAction: z.string().trim().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type OperationPrecondition = z.infer<typeof operationPreconditionSchema>;

export const operationPreviewSchema = z.object({
  operationId: z.string().trim().min(1),
  command: z.string().trim().min(1),
  expiresAt: z.string().trim().min(1),
  contextVersion: z.string().trim().min(1),
  warnings: z.array(z.string()).default([]),
  changes: z.array(z.record(z.string(), z.unknown())).default([]),
  refreshScopes: z.array(z.string()).default([]),
  preconditions: z.array(operationPreconditionSchema).default([]),
  provenanceRef: z.string().trim().min(1).nullable().optional(),
  draftDigest: z.string().trim().min(1).nullable().optional(),
});

export type OperationPreview = z.infer<typeof operationPreviewSchema>;
