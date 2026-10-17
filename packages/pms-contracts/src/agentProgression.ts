import { z } from "zod";
import { operationPreviewSchema, operationResultSchema } from "./operation.js";
import {
  resourceScenarioDraftSchema,
  resourceScenarioVerificationSchema,
} from "./resourceScenario.js";
import { resourceDetailSchema } from "./query.js";
import { analysisItemSchema } from "./scenario.js";

export const agentProgressionContractVersion = "agent-progression/v1" as const;

export const agentProgressionResourceTypeSchema = z.enum([
  "project",
  "requirement",
  "topic",
  "story",
]);
export type AgentProgressionResourceType = z.infer<typeof agentProgressionResourceTypeSchema>;

export const agentProgressionIntentSchema = z.enum([
  "READ_CONTEXT",
  "UPDATE_NODE_FIELDS",
  "COMPLETE_NODE",
]);
export type AgentProgressionIntent = z.infer<typeof agentProgressionIntentSchema>;

export const agentProgressionExecuteModeSchema = z.enum(["plan", "auto", "confirm"]);
export type AgentProgressionExecuteMode = z.infer<typeof agentProgressionExecuteModeSchema>;

export const agentProgressionExecutionModeSchema = z.enum(["read", "automatic", "confirmation"]);
export type AgentProgressionExecutionMode = z.infer<typeof agentProgressionExecutionModeSchema>;

export const agentProgressionWriteDecisionSchema = z.enum([
  "READY",
  "NEEDS_INPUT",
  "WAITING_CONFIRMATION",
  "CAPABILITY_UNAVAILABLE",
]);
export type AgentProgressionWriteDecision = z.infer<typeof agentProgressionWriteDecisionSchema>;

export const agentProgressionFieldChangeSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  from: z.unknown().nullable(),
  to: z.unknown().nullable(),
  sourceType: z.enum(["pms_context", "conversation", "inference"]).nullable(),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
}).strict();

export const agentProgressionMissingFieldSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  reason: z.string().trim().min(1),
}).strict();

const contextVersionSchema = z.union([
  z.string().trim().min(1),
  z.number().int().nonnegative(),
]).transform((value) => String(value));

export const agentProgressionFieldSourceSchema = z.object({
  sourceType: z.enum(["pms_context", "conversation", "inference"]),
  sourceRefs: z.array(z.string().trim().min(1)).min(1),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();

export type AgentProgressionFieldSource = z.infer<typeof agentProgressionFieldSourceSchema>;

export const agentProgressionDraftSchema = resourceScenarioDraftSchema.extend({
  ownerId: z.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fieldSources: z.record(z.string().trim().min(1), agentProgressionFieldSourceSchema).optional(),
  requestedCompletion: z.boolean().optional(),
}).strict();

export const agentProgressionInputSchema = z.object({
  contractVersion: z.literal(agentProgressionContractVersion),
  resourceType: agentProgressionResourceTypeSchema,
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive().optional(),
  contextVersion: contextVersionSchema.optional(),
  intent: agentProgressionIntentSchema,
  draft: agentProgressionDraftSchema.optional(),
  executeMode: agentProgressionExecuteModeSchema.default("plan"),
  previewOperationId: z.string().trim().min(1).max(160).optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  requestId: z.string().trim().min(1).max(160).optional(),
}).strict();

export const agentProgressionPlanSchema = z.object({
  contractVersion: z.literal(agentProgressionContractVersion),
  phase: z.literal("plan"),
  resourceType: agentProgressionResourceTypeSchema,
  resourceId: z.number().int().positive(),
  intent: agentProgressionIntentSchema,
  operation: z.string().trim().min(1).nullable(),
  context: z.unknown().nullable(),
  normalizedArguments: z.record(z.string(), z.unknown()).default({}),
  capability: z.record(z.string(), z.unknown()).nullable(),
  preview: operationPreviewSchema.nullable(),
  fieldChanges: z.array(agentProgressionFieldChangeSchema).default([]),
  missingFields: z.array(agentProgressionMissingFieldSchema).default([]),
  preconditions: z.array(z.unknown()).default([]),
  writeDecision: agentProgressionWriteDecisionSchema.default("READY"),
  requiresConfirmation: z.boolean(),
  executionMode: agentProgressionExecutionModeSchema,
  warnings: z.array(z.string()).default([]),
}).strict();

export const agentProgressionResultSchema = z.object({
  contractVersion: z.literal(agentProgressionContractVersion),
  phase: z.literal("execute"),
  status: z.enum([
    "CONTEXT_READY",
    "PLAN_READY",
    "WAITING_CONFIRMATION",
    "SUCCEEDED",
    "REJECTED",
    "CONFLICT",
    "CAPABILITY_UNAVAILABLE",
    "WRITE_RESULT_UNKNOWN",
  ]),
  resourceType: agentProgressionResourceTypeSchema,
  resourceId: z.number().int().positive(),
  intent: agentProgressionIntentSchema,
  plan: agentProgressionPlanSchema.nullable(),
  operation: operationResultSchema.nullable(),
  readback: z.object({
    resource: resourceDetailSchema.nullable(),
    context: z.unknown().nullable(),
  }).strict().nullable(),
  verification: resourceScenarioVerificationSchema.nullable(),
  warnings: z.array(z.string()).default([]),
}).strict();

export const agentProgressionDraftResultSchema = z.object({
  contractVersion: z.literal(agentProgressionContractVersion),
  phase: z.literal("draft"),
  resourceType: agentProgressionResourceTypeSchema,
  resourceId: z.number().int().positive(),
  intent: z.enum(["UPDATE_NODE_FIELDS", "COMPLETE_NODE"]),
  contextVersion: z.string().trim().min(1),
  draft: agentProgressionDraftSchema,
  diagnostics: z.object({
    unknownFields: z.array(z.string().trim().min(1)).default([]),
    protectedFields: z.array(z.string().trim().min(1)).default([]),
    missingSources: z.array(z.string().trim().min(1)).default([]),
    unsafePayloadKeys: z.array(z.string().trim().min(1)).default([]),
    unresolvedDecisions: z.array(z.string().trim().min(1)).default([]),
  }).strict().default({
    unknownFields: [],
    protectedFields: [],
    missingSources: [],
    unsafePayloadKeys: [],
    unresolvedDecisions: [],
  }),
  warnings: z.array(z.string()).default([]),
}).strict();

export type AgentProgressionDraft = z.infer<typeof agentProgressionDraftSchema>;
export type AgentProgressionInput = z.input<typeof agentProgressionInputSchema>;
export type ParsedAgentProgressionInput = z.output<typeof agentProgressionInputSchema>;
export type AgentProgressionPlan = z.infer<typeof agentProgressionPlanSchema>;
export type AgentProgressionResult = z.infer<typeof agentProgressionResultSchema>;
export type AgentProgressionDraftResult = z.infer<typeof agentProgressionDraftResultSchema>;

export const agentProgressionShadowCandidateResourceSchema = z.object({
  resourceType: agentProgressionResourceTypeSchema,
  resourceId: z.number().int().positive().optional(),
  label: z.string().trim().min(1).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
}).strict();

export const agentProgressionShadowCandidateNodeSchema = z.object({
  nodeId: z.number().int().positive().optional(),
  key: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
}).strict();

export const agentProgressionShadowDraftSchema = z.object({
  facts: z.array(analysisItemSchema),
  inferences: z.array(analysisItemSchema),
  assumptions: z.array(analysisItemSchema),
  unresolvedDecisions: z.array(analysisItemSchema),
  candidateResources: z.array(agentProgressionShadowCandidateResourceSchema),
  candidateNodes: z.array(agentProgressionShadowCandidateNodeSchema),
  requiredFields: z.array(z.string().trim().min(1)),
  proposedFieldValues: z.record(z.string(), z.unknown()),
  references: z.array(z.string().trim().min(1)),
}).strict();

export type AgentProgressionShadowDraft = z.infer<typeof agentProgressionShadowDraftSchema>;
