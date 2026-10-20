import { z } from "zod";

export const userFacingResourceTypeSchema = z.enum([
  "project",
  "requirement",
  "topic",
  "story",
]);

export const userFacingFieldChangeSchema = z.object({
  field: z.string().trim().min(1),
  from: z.string().nullable(),
  to: z.string().nullable(),
}).strict();

/**
 * Stable, ID-free projection for natural-language Agent responses.
 * Machine-readable envelopes keep their identifiers elsewhere for execution,
 * idempotency, and audit purposes.
 */
export const userFacingDisplaySchema = z.object({
  resourceType: userFacingResourceTypeSchema,
  resourceName: z.string().trim().min(1),
  resourceStatus: z.string().trim().min(1).nullable(),
  currentNode: z.string().trim().min(1).nullable(),
  targetNode: z.string().trim().min(1).nullable().default(null),
  operationStatus: z.string().trim().min(1).nullable(),
  actualChange: z.string().trim().min(1).nullable(),
  fieldChanges: z.array(userFacingFieldChangeSchema).default([]),
  blockers: z.array(z.string().trim().min(1)),
}).strict();

export type UserFacingResourceType = z.infer<typeof userFacingResourceTypeSchema>;
export type UserFacingFieldChange = z.infer<typeof userFacingFieldChangeSchema>;
export type UserFacingDisplay = z.infer<typeof userFacingDisplaySchema>;
