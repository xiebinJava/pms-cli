import { z } from "zod";
import {
  operationPreviewSchema,
  operationResultSchema,
  type OperationPreview,
  type OperationResult,
} from "./operation.js";
import { resourceDetailSchema, type ResourceDetail, type WorkflowContext } from "./query.js";
import { userFacingDisplaySchema } from "./userFacing.js";

export const resourceScenarioContractVersion = "resource-scenario/v1" as const;

export const resourceScenarioResourceTypeSchema = z.enum(["requirement", "topic", "project"]);
export type ResourceScenarioResourceType = z.infer<typeof resourceScenarioResourceTypeSchema>;

const contextVersionSchema = z.union([
  z.string().trim().min(1),
  z.number().int().nonnegative(),
]).transform((value) => String(value));

export const resourceScenarioDraftItemSchema = z.object({
  text: z.string().trim().min(1),
  sourceRefs: z.array(z.string().trim().min(1)),
  confidence: z.enum(["high", "medium", "low"]).optional(),
}).strict();

export const resourceScenarioDraftSchema = z.object({
  facts: z.array(resourceScenarioDraftItemSchema).default([]),
  inferences: z.array(resourceScenarioDraftItemSchema).default([]),
  assumptions: z.array(resourceScenarioDraftItemSchema).default([]),
  unresolvedDecisions: z.array(resourceScenarioDraftItemSchema).default([]),
  patch: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const resourceScenarioInputSchema = z.object({
  contractVersion: z.literal(resourceScenarioContractVersion),
  resourceType: resourceScenarioResourceTypeSchema,
  resourceId: z.number().int().positive().optional(),
  operation: z.string().trim().min(1).max(160),
  nodeId: z.number().int().positive().optional(),
  contextVersion: contextVersionSchema.optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  draft: resourceScenarioDraftSchema.optional(),
  requestId: z.string().trim().min(1).max(160).optional(),
}).strict();

export const resourceScenarioExecuteInputSchema = z.object({
  resourceType: resourceScenarioResourceTypeSchema,
  resourceId: z.number().int().positive().optional(),
  operation: z.string().trim().min(1).max(160),
  previewOperationId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(1).max(160),
  requestId: z.string().trim().min(1).max(160).optional(),
}).strict();

export const resourceScenarioContextSchema = z.object({
  id: z.string().trim().min(1),
  version: z.string().trim().min(1),
  entityVersion: z.number().int().nonnegative().nullable().optional(),
  selectedNodeId: z.number().int().positive().nullable().optional(),
  snapshot: z.unknown().optional(),
}).strict();

export const resourceScenarioVerificationSchema = z.object({
  resourceReadback: z.boolean(),
  contextReadback: z.boolean(),
  patchApplied: z.boolean(),
  protectedFieldsUnchanged: z.boolean(),
}).strict();

/** Normalized context shape returned by PmsClient.context, not the wire envelope. */
export const resourceScenarioReadbackContextSchema = z.object({
  resource: z.object({
    type: z.string().trim().min(1),
    id: z.number().int().positive(),
  }).strict(),
  version: z.number().int().nonnegative().nullable(),
  entityVersion: z.number().int().nonnegative().nullable().optional(),
}).passthrough();

export const resourceScenarioPlanSchema = z.object({
  scenario: z.literal("resource-scenario"),
  phase: z.literal("plan"),
  contractVersion: z.literal(resourceScenarioContractVersion),
  resourceType: resourceScenarioResourceTypeSchema,
  resourceId: z.number().int().positive().nullable(),
  operation: z.string().trim().min(1),
  context: resourceScenarioContextSchema.nullable(),
  normalizedArguments: z.record(z.string(), z.unknown()),
  capability: z.record(z.string(), z.unknown()),
  preview: operationPreviewSchema,
  requiresConfirmation: z.boolean(),
  executionMode: z.enum(["read", "automatic", "confirmation"]).default("confirmation"),
  warnings: z.array(z.string()).default([]),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export const resourceScenarioResultSchema = z.object({
  scenario: z.literal("resource-scenario"),
  phase: z.literal("execute"),
  contractVersion: z.literal(resourceScenarioContractVersion),
  resourceType: resourceScenarioResourceTypeSchema,
  resourceId: z.number().int().positive().nullable(),
  operation: operationResultSchema,
  previewOperationId: z.string().trim().min(1),
  readback: z.object({
    resource: resourceDetailSchema.nullable(),
    context: resourceScenarioReadbackContextSchema.nullable(),
  }).strict(),
  verification: resourceScenarioVerificationSchema,
  status: z.enum(["SUCCEEDED", "REJECTED", "CONFLICT", "WRITE_RESULT_UNKNOWN"]),
  warnings: z.array(z.string()).default([]),
  refreshScopes: z.array(z.string()).default([]),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export type ResourceScenarioDraft = z.infer<typeof resourceScenarioDraftSchema>;
export type ResourceScenarioInput = z.input<typeof resourceScenarioInputSchema>;
export type ParsedResourceScenarioInput = z.output<typeof resourceScenarioInputSchema>;
export type ResourceScenarioExecuteInput = z.input<typeof resourceScenarioExecuteInputSchema>;
export type ParsedResourceScenarioExecuteInput = z.output<typeof resourceScenarioExecuteInputSchema>;
export type ResourceScenarioContext = z.infer<typeof resourceScenarioContextSchema>;
export type ResourceScenarioVerification = z.infer<typeof resourceScenarioVerificationSchema>;
export type ResourceScenarioPlan = z.infer<typeof resourceScenarioPlanSchema>;
export type ResourceScenarioResult = z.infer<typeof resourceScenarioResultSchema>;
export type ResourceScenarioSnapshot = {
  resource: ResourceDetail | null;
  context: WorkflowContext | null;
};
export type ResourceScenarioOperation = OperationResult;
export type ResourceScenarioPreview = OperationPreview;
