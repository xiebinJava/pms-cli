import { z } from "zod";

export const userFacingResourceTypeSchema = z.enum([
  "project",
  "requirement",
  "topic",
  "story",
]);

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
  operationStatus: z.string().trim().min(1).nullable(),
  actualChange: z.string().trim().min(1).nullable(),
  blockers: z.array(z.string().trim().min(1)),
}).strict();

export type UserFacingResourceType = z.infer<typeof userFacingResourceTypeSchema>;
export type UserFacingDisplay = z.infer<typeof userFacingDisplaySchema>;
