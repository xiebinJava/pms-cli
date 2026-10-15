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

export type OrchestratorDraft = z.infer<typeof orchestratorDraftSchema>;
export type OrchestratorConversation = z.infer<typeof orchestratorConversationSchema>;
export type OrchestratorPreview = z.infer<typeof orchestratorPreviewSchema>;
export type OrchestratorOperation = z.infer<typeof orchestratorOperationSchema>;
export type OrchestratorVerification = z.infer<typeof orchestratorVerificationSchema>;
export type OrchestratorPlan = z.infer<typeof orchestratorPlanSchema>;
export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;
