import { z } from "zod";
import { operationResultSchema } from "./operation.js";
import { userFacingDisplaySchema } from "./userFacing.js";

export const scenarioContractVersion = "requirement-analysis/v1" as const;
export const storyWorkbenchContractVersion = "story-workbench/v1" as const;

const analysisConfidenceSchema = z.enum(["high", "medium", "low"]);

export const analysisItemSchema = z.object({
  text: z.string().trim().min(1),
  sourceRefs: z.array(z.string().trim().min(1)),
  confidence: analysisConfidenceSchema.optional(),
}).strict();

export const analysisDraftSchema = z.object({
  facts: z.array(analysisItemSchema),
  inferences: z.array(analysisItemSchema),
  assumptions: z.array(analysisItemSchema),
  unresolvedDecisions: z.array(analysisItemSchema),
  patch: z.record(z.string(), z.unknown()),
}).strict();

export const requirementAnalysisInputSchema = z.object({
  resourceType: z.literal("requirement"),
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  contextVersion: z.number().int().nonnegative(),
  draft: analysisDraftSchema,
  save: z.boolean(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.save && !value.idempotencyKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["idempotencyKey"],
      message: "保存需求分析必须提供 idempotencyKey",
    });
  }
});

export const requirementAnalysisPlanSchema = z.object({
  scenarioContractVersion: z.literal(scenarioContractVersion),
  resourceId: z.number().int().positive(),
  contextId: z.string().trim().min(1),
  contextVersion: z.string().trim().min(1),
  previewRequired: z.literal(true),
  proposedWrite: z.record(z.string(), z.unknown()),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export const verificationResultSchema = z.object({
  resourceReadback: z.boolean(),
  contextReadback: z.boolean(),
  protectedFieldsUnchanged: z.boolean(),
}).strict();

export const requirementAnalysisResultSchema = z.object({
  status: z.enum(["DRAFT", "PREVIEWED", "SUCCEEDED", "REJECTED", "CONFLICT", "WRITE_RESULT_UNKNOWN"]),
  operationId: z.string().trim().min(1).optional(),
  draft: analysisDraftSchema,
  verification: verificationResultSchema.optional(),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export type AnalysisItem = z.infer<typeof analysisItemSchema>;
export type AnalysisDraft = z.infer<typeof analysisDraftSchema>;
export type RequirementAnalysisInput = z.infer<typeof requirementAnalysisInputSchema>;
export type RequirementAnalysisPlan = z.infer<typeof requirementAnalysisPlanSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type RequirementAnalysisResult = z.infer<typeof requirementAnalysisResultSchema>;

export const storyWorkbenchVariantSchema = z.enum([
  "writing",
  "iteration",
  "development",
  "acceptance",
  "release",
  "launch",
]);

export const storyWorkbenchInputSchema = z.object({
  contractVersion: z.literal(storyWorkbenchContractVersion),
  resourceType: z.literal("story"),
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  variant: storyWorkbenchVariantSchema,
  patch: z.record(z.string().trim().min(1), z.unknown()),
  save: z.boolean(),
  complete: z.boolean().optional(),
  ownerId: z.number().int().positive().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  previewOperationId: z.string().trim().min(1).max(160).optional(),
  requestId: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value.patch).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["patch"],
      message: "故事节点草稿 patch 不能为空",
    });
  }
  if (value.save && !value.idempotencyKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["idempotencyKey"],
      message: "保存故事节点草稿必须提供 idempotencyKey",
    });
  }
});

export const storyWorkbenchVerificationSchema = z.object({
  resourceReadback: z.boolean(),
  contextReadback: z.boolean(),
  patchApplied: z.boolean(),
  protectedFieldsUnchanged: z.boolean(),
}).strict();

export const storyWorkbenchReadbackSchema = z.object({
  resource: z.unknown().nullable(),
  context: z.unknown().nullable(),
}).strict();

export const storyWorkbenchCurrentNodeSchema = z.object({
  id: z.number().int().positive().nullable(),
  key: z.string(),
  label: z.string(),
}).strict();

export const storyWorkbenchResultSchema = z.object({
  contractVersion: z.literal(storyWorkbenchContractVersion),
  status: z.enum(["DRAFT", "PREVIEWED", "SUCCEEDED", "REJECTED", "CONFLICT", "WRITE_RESULT_UNKNOWN"]),
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  variant: storyWorkbenchVariantSchema,
  patch: z.record(z.string(), z.unknown()),
  complete: z.boolean().optional(),
  operationId: z.string().trim().min(1).optional(),
  operation: operationResultSchema.extend({
    previewOperationId: z.string().trim().min(1).optional(),
  }).optional(),
  preview: z.record(z.string(), z.unknown()).optional(),
  verification: storyWorkbenchVerificationSchema.optional(),
  readback: storyWorkbenchReadbackSchema.optional(),
  currentNode: storyWorkbenchCurrentNodeSchema.nullable().optional(),
  warnings: z.array(z.string()).default([]),
  userFacing: userFacingDisplaySchema.optional(),
}).strict();

export type StoryWorkbenchVariant = z.infer<typeof storyWorkbenchVariantSchema>;
export type StoryWorkbenchInput = z.infer<typeof storyWorkbenchInputSchema>;
export type StoryWorkbenchVerification = z.infer<typeof storyWorkbenchVerificationSchema>;
export type StoryWorkbenchReadback = z.infer<typeof storyWorkbenchReadbackSchema>;
export type StoryWorkbenchCurrentNode = z.infer<typeof storyWorkbenchCurrentNodeSchema>;
export type StoryWorkbenchResult = z.infer<typeof storyWorkbenchResultSchema>;
