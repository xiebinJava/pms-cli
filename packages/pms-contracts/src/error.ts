import { z } from "zod";

export const errorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
]);

/** Error codes emitted by the pms-cli envelope in addition to server errors. */
export const cliErrorCodeSchema = z.enum([
  "CLI_USAGE",
  "CLI_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "RESOURCE_NOT_FOUND",
  "CAPABILITY_UNAVAILABLE",
  "CONTEXT_CONFLICT",
  "PREVIEW_REQUIRED",
  "IDEMPOTENCY_REQUIRED",
  "WRITE_RESULT_UNKNOWN",
]);

export type CliErrorCode = z.infer<typeof cliErrorCodeSchema>;

export const pmsErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string().min(1),
  requestId: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export type PmsError = z.infer<typeof pmsErrorSchema>;
