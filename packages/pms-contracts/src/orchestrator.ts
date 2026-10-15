import { z } from "zod";

import { operationPreconditionSchema } from "./operation.js";
import { analysisDraftSchema, scenarioContractVersion } from "./scenario.js";

export const orchestratorDraftSchema = z.object({
  contractVersion: z.literal(scenarioContractVersion),
  draft: analysisDraftSchema,
}).strict();

export const orchestratorConversationSchema = z.object({
  conversationId: z.number().int().positive(),
  resourceType: z.literal("requirement"),
  resourceId: z.number().int().positive(),
  status: z.string().trim().min(1),
  latestPlan: z.lazy(() => orchestratorPlanSchema).nullable().optional(),
}).strict();

export const orchestratorPreviewSchema = z.object({
  operationId: z.string().trim().min(1),
  command: z.string().trim().min(1),
  expiresAt: z.string().trim().min(1),
  contextVersion: z.string().trim().min(1),
  warnings: z.array(z.string()).default([]),
  changes: z.array(z.record(z.string(), z.unknown())).default([]),
  refreshScopes: z.array(z.string()).default([]),
  preconditions: z.array(operationPreconditionSchema).default([]),
}).strict();

export const orchestratorOperationSchema = z.object({
  operationId: z.string().trim().min(1),
  status: z.string().trim().min(1),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  refreshScopes: z.array(z.string()).default([]),
}).strict();

export const orchestratorVerificationSchema = z.object({
  resourceReadback: z.boolean(),
  contextReadback: z.boolean(),
  protectedFieldsUnchanged: z.boolean(),
  patchApplied: z.boolean(),
  status: z.string().trim().min(1),
  message: z.string().optional(),
}).strict();

export const orchestratorPlanSchema = z.object({
  planId: z.number().int().positive(),
  turnId: z.number().int().positive().nullable().optional(),
  intent: z.literal("REQUIREMENT_ANALYSIS_SAVE"),
  status: z.string().trim().min(1),
  resourceType: z.literal("requirement"),
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive().nullable().optional(),
  contextVersion: z.number().int().nonnegative().nullable().optional(),
  contextSnapshot: z.unknown().nullable().optional(),
  draft: orchestratorDraftSchema,
  preview: orchestratorPreviewSchema.nullable().optional(),
  operation: orchestratorOperationSchema.nullable().optional(),
  verification: orchestratorVerificationSchema.nullable().optional(),
  validationErrors: z.array(z.unknown()).default([]),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
}).strict();

export const orchestratorEventSchema = z.object({
  sequenceNo: z.number().int().positive(),
  eventType: z.string().trim().min(1),
  operationId: z.string().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().nullable().optional(),
}).strict();

/** Stable projection of the context identity captured by an orchestrator plan. */
export const orchestratorContextSnapshotSchema = z.object({
  resourceType: z.string().trim().min(1),
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive().nullable().optional(),
  version: z.number().int().nonnegative().nullable().optional(),
  snapshot: z.unknown().nullable().optional(),
}).passthrough();

/** A turn is persisted by PMS even though the stateless CLI only submits it. */
export const orchestratorTurnSchema = z.object({
  turnId: z.number().int().positive(),
  conversationId: z.number().int().positive(),
  message: z.string().trim().min(1),
  status: z.string().trim().min(1),
  planId: z.number().int().positive().nullable().optional(),
  createdAt: z.string().nullable().optional(),
}).passthrough();

export const orchestratorConfirmationSchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "REJECTED", "EXPIRED"]),
  idempotencyKey: z.string().trim().min(1).optional(),
  confirmedAt: z.string().nullable().optional(),
  confirmedBy: z.string().nullable().optional(),
}).strict();

/** A stateless CLI can reconstruct this snapshot in a later process. */
export const orchestratorSessionSchema = z.object({
  sessionId: z.number().int().positive(),
  conversation: orchestratorConversationSchema,
  latestPlan: orchestratorPlanSchema.nullable(),
  events: z.array(orchestratorEventSchema),
  afterSequence: z.number().int().nonnegative(),
  nextSequence: z.number().int().nonnegative(),
}).strict();

export type OrchestratorDraft = z.infer<typeof orchestratorDraftSchema>;
export type OrchestratorConversation = z.infer<typeof orchestratorConversationSchema>;
export type OrchestratorContextSnapshot = z.infer<typeof orchestratorContextSnapshotSchema>;
export type OrchestratorTurn = z.infer<typeof orchestratorTurnSchema>;
export type OrchestratorConfirmation = z.infer<typeof orchestratorConfirmationSchema>;
export type OrchestratorPreview = z.infer<typeof orchestratorPreviewSchema>;
export type OrchestratorOperation = z.infer<typeof orchestratorOperationSchema>;
export type OrchestratorVerification = z.infer<typeof orchestratorVerificationSchema>;
export type OrchestratorPlan = z.infer<typeof orchestratorPlanSchema>;
export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;
export type OrchestratorSession = z.infer<typeof orchestratorSessionSchema>;
