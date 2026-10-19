import { z } from "zod";
import {
  agentProgressionIntentSchema,
  agentProgressionPlanSchema,
  agentProgressionResourceTypeSchema,
  agentProgressionResultSchema,
  agentProgressionWriteDecisionSchema,
  agentProgressionRejectionReasonSchema,
  type AgentProgressionIntent,
  type AgentProgressionPlan,
  type AgentProgressionResult,
  type AgentProgressionWriteDecision,
} from "./agentProgression.js";
import { resourceDetailSchema, type ResourceDetail } from "./query.js";
import { resourceScenarioVerificationSchema, type ResourceScenarioVerification } from "./resourceScenario.js";
import { userFacingDisplaySchema } from "./userFacing.js";
import { provenanceRefSchema } from "./provenance.js";

export const agentProgressionRunContractVersion = "agent-progression-run/v2" as const;

export const agentProgressionRunResourceTypeSchema = agentProgressionResourceTypeSchema;
export type AgentProgressionRunResourceType = z.infer<typeof agentProgressionRunResourceTypeSchema>;

export const agentProgressionRunStatusSchema = z.enum([
  "CONTEXT_READY",
  "PLAN_READY",
  "NEEDS_INPUT",
  "WAITING_CONFIRMATION",
  "CAPABILITY_UNAVAILABLE",
  "SUCCEEDED",
  "REJECTED",
  "CONFLICT",
  "WRITE_RESULT_UNKNOWN",
]);
export type AgentProgressionRunStatus = z.infer<typeof agentProgressionRunStatusSchema>;

export const agentProgressionRunResultSchema = z.object({
  contractVersion: z.literal(agentProgressionRunContractVersion),
  phase: z.literal("run"),
  status: agentProgressionRunStatusSchema,
  resourceType: agentProgressionRunResourceTypeSchema,
  resourceId: z.number().int().positive(),
  intent: agentProgressionIntentSchema,
  componentKey: z.string().trim().min(1).max(160).optional(),
  nodeVersion: z.number().int().nonnegative().nullable().optional(),
  entityVersion: z.number().int().nonnegative().nullable().optional(),
  workflowInstanceVersion: z.number().int().nonnegative().nullable().optional(),
  writeDecision: agentProgressionWriteDecisionSchema,
  plan: agentProgressionPlanSchema.nullable(),
  result: agentProgressionResultSchema.nullable(),
  previewOperationId: z.string().trim().min(1).nullable(),
  operationId: z.string().trim().min(1).nullable(),
  auditId: z.string().trim().min(1).nullable(),
  readback: z.object({
    resource: resourceDetailSchema.nullable(),
    context: z.unknown().nullable(),
  }).strict().nullable(),
  verification: resourceScenarioVerificationSchema.nullable(),
  provenanceRef: provenanceRefSchema.nullable().optional(),
  draftDigest: z.string().trim().min(1).optional(),
  warnings: z.array(z.string()).default([]),
  rejectionReason: agentProgressionRejectionReasonSchema.optional(),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export type AgentProgressionRunResult = z.infer<typeof agentProgressionRunResultSchema>;

// Keep these aliases available to callers that build typed run projections.
export type { AgentProgressionIntent, AgentProgressionPlan, AgentProgressionResult, AgentProgressionWriteDecision };
export type { ResourceDetail, ResourceScenarioVerification };
