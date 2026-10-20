import { createHash } from "node:crypto";
import { z } from "zod";

export const draftProvenanceContractVersion = "draft-provenance/v1" as const;
export const draftProvenanceMaxFields = 200 as const;
export const draftProvenanceMaxRefsPerField = 20 as const;
export const draftProvenanceMaxSerializedBytes = 64 * 1024;

const provenanceResourceTypeSchema = z.enum(["project", "requirement", "topic", "story"]);

const provenanceIntentSchema = z.enum([
  "READ_CONTEXT",
  "UPDATE_NODE_FIELDS",
  "COMPLETE_NODE",
  "RESOURCE_NODE_FIELD_UPDATE",
  "RESOURCE_NODE_COMPLETE",
]);

const provenanceVersionSchema = z.union([
  z.number().int().nonnegative(),
  z.string().trim().min(1),
  z.null(),
]);

export const provenanceVersionSnapshotSchema = z.object({
  nodeVersion: provenanceVersionSchema,
  entityVersion: provenanceVersionSchema,
  workflowInstanceVersion: provenanceVersionSchema,
  componentVersion: provenanceVersionSchema,
  contextVersion: provenanceVersionSchema,
}).strict();

export type ProvenanceVersionSnapshot = z.infer<typeof provenanceVersionSnapshotSchema>;

const readableResourceRefPattern = /^(project|requirement|topic|story|task|subtask|iteration_plan|workflow_template|user):[1-9]\d*$/;
const readableNodeRefPattern = /^(project|requirement|topic|story)-node:[1-9]\d*(#component:[A-Za-z0-9][A-Za-z0-9._-]{0,159})?$/;

export const persistedSourceRefSchema = z.string().trim().min(1).superRefine((value, ctx) => {
  if (!readableResourceRefPattern.test(value) && !readableNodeRefPattern.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "PROVENANCE_INVALID: sourceRef 必须是可读取的资源、节点或组件引用",
    });
  }
});

export const provenanceFieldSourceSchema = z.object({
  sourceType: z.enum(["pms_context", "conversation", "inference"]),
  sourceRefs: z.array(persistedSourceRefSchema).min(1).superRefine((refs, ctx) => {
    if (refs.length > draftProvenanceMaxRefsPerField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PROVENANCE_TOO_LARGE: 每个字段最多 20 个 sourceRefs",
      });
    }
  }),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();

export const provenanceFieldSourcesSchema = z.record(
  z.string().trim().min(1).max(160),
  provenanceFieldSourceSchema,
);

const provenanceDraftDigestSchema = z.string().regex(
  /^sha256:[0-9a-f]{64}$/,
  "PROVENANCE_INVALID: draftDigest 必须是 sha256:<64 位小写十六进制>",
);

export const draftProvenanceSchema = z.object({
  contractVersion: z.literal(draftProvenanceContractVersion),
  draftDigest: provenanceDraftDigestSchema,
  fieldSources: provenanceFieldSourcesSchema,
}).strict().superRefine((value, ctx) => {
  const fieldCount = Object.keys(value.fieldSources).length;
  if (fieldCount > draftProvenanceMaxFields) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fieldSources"],
      message: "PROVENANCE_TOO_LARGE: fieldSources 最多 200 个字段",
    });
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (serializedBytes > draftProvenanceMaxSerializedBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "PROVENANCE_TOO_LARGE: provenance 序列化后不得超过 64 KiB",
    });
  }
});

export type DraftProvenance = z.infer<typeof draftProvenanceSchema>;

export const provenanceRefSchema = z.string()
  .trim()
  .max(180)
  .regex(/^operation:[^\s]+$/, "PROVENANCE_INVALID: provenanceRef 必须是 operation:<previewOperationId>");

export const draftDigestInputSchema = z.object({
  contractVersion: z.literal(draftProvenanceContractVersion),
  resourceType: provenanceResourceTypeSchema,
  resourceId: z.number().int().positive(),
  nodeId: z.number().int().positive().nullable(),
  componentKey: z.string().trim().min(1).max(160).nullable(),
  intent: provenanceIntentSchema,
  requestedCompletion: z.boolean(),
  versionSnapshot: provenanceVersionSnapshotSchema,
  facts: z.array(z.unknown()),
  inferences: z.array(z.unknown()),
  assumptions: z.array(z.unknown()),
  unresolvedDecisions: z.array(z.unknown()),
  patch: z.record(z.string(), z.unknown()),
  fieldSources: provenanceFieldSourcesSchema,
}).strict();

export type DraftDigestInput = z.infer<typeof draftDigestInputSchema>;

function normalizeForDigest(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeForDigest(item));
    return key === "sourceRefs"
      ? normalized.sort((left, right) => {
        const leftText = String(left);
        const rightText = String(right);
        return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
      })
      : normalized;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((recordKey) => [
      recordKey,
      normalizeForDigest(record[recordKey], recordKey),
    ]));
  }

  return value;
}

export function canonicalizeDraftDigestInput(input: DraftDigestInput): string {
  const parsed = draftDigestInputSchema.parse(input);
  return JSON.stringify(normalizeForDigest(parsed));
}

export function computeDraftDigest(input: DraftDigestInput): string {
  return `sha256:${createHash("sha256")
    .update(canonicalizeDraftDigestInput(input), "utf8")
    .digest("hex")}`;
}

export function verifyDraftDigest(input: DraftDigestInput, provenance: DraftProvenance): boolean {
  return computeDraftDigest(input) === provenance.draftDigest;
}

export type DraftProvenanceValidationCode = "PROVENANCE_INVALID" | "PROVENANCE_TOO_LARGE";
export type DraftProvenanceValidationResult =
  | { success: true; data: DraftProvenance }
  | { success: false; code: DraftProvenanceValidationCode; error: z.ZodError };

export function validateDraftProvenance(value: unknown): DraftProvenanceValidationResult {
  const result = draftProvenanceSchema.safeParse(value);
  if (result.success) {
    return result;
  }

  const code: DraftProvenanceValidationCode = result.error.issues.some((issue) =>
    issue.message.includes("PROVENANCE_TOO_LARGE")
  ) ? "PROVENANCE_TOO_LARGE" : "PROVENANCE_INVALID";
  return { success: false, code, error: result.error };
}
