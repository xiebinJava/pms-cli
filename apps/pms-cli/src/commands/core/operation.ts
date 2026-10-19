import { randomUUID } from "node:crypto";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { AutomaticOperationRequest, DraftProvenance, OperationPreview, OperationResult } from "../../../../../packages/pms-contracts/src/index.js";

export interface OperationOptions {
  arguments?: Record<string, unknown>;
  context?: { id: string; version: string };
  contract?: { id: string; version: string };
  provenance?: DraftProvenance;
  clientId?: "pms-cli";
  requestId?: string;
}

export const LEGACY_PROVENANCE_WARNING = "PROVENANCE_NOT_AUDITED";

function requestFor(operation: string, options: OperationOptions, idempotencyKey: string): AutomaticOperationRequest {
  return {
    operation,
    arguments: options.arguments ?? {},
    context: options.context,
    contract: options.contract,
    provenance: options.provenance,
    idempotencyKey,
    clientId: options.clientId ?? "pms-cli",
    requestId: options.requestId ?? randomUUID(),
  };
}

export async function operationPreview(
  client: PmsClient,
  operation: string,
  options: OperationOptions = {},
): Promise<OperationPreview> {
  const resolver = new CapabilityResolver(client);
  const catalog = await resolver.list();
  if (options.provenance && !(catalog.provenanceVersions?.includes("draft-provenance/v1") ?? false)) {
    throw new Error("PMS 未声明 draft-provenance/v1，不能发送来源审计写入预览");
  }
  const argumentsValue = resolver.validateArguments(operation, options.arguments ?? {});
  return client.preview(requestFor(operation, { ...options, arguments: argumentsValue }, `preview-${randomUUID()}`));
}

export async function operationExecute(
  client: PmsClient,
  operation: string,
  idempotencyKey: string,
  options: OperationOptions = {},
): Promise<OperationResult> {
  if (options.provenance) throw new Error("operation execute 只能引用原 preview，不能提交新的 provenance");
  const resolver = new CapabilityResolver(client);
  await resolver.list();
  const argumentsValue = resolver.validateArguments(operation, options.arguments ?? {});
  return client.execute(requestFor(operation, { ...options, arguments: argumentsValue }, idempotencyKey));
}

/**
 * Execute a low/medium-risk operation through PMS's automatic endpoint. The
 * endpoint still performs server-side preview validation, permission checks,
 * idempotency and audit logging; this CLI path only removes the repeated human
 * confirmation prompt for an explicitly authorized agent turn.
 */
export async function operationAuto(
  client: PmsClient,
  operation: string,
  idempotencyKey: string,
  options: OperationOptions = {},
): Promise<OperationResult> {
  if (options.provenance) throw new Error("operation auto 只能引用原 preview，不能提交新的 provenance");
  const resolver = new CapabilityResolver(client);
  const action = await resolver.action(operation);
  if (action.mode !== "automatic") {
    throw new Error("operation auto 只允许自动写入能力");
  }
  if (action.risk === "high") {
    throw new Error("高风险操作必须先 preview 再 execute");
  }
  const argumentsValue = resolver.validateArguments(operation, options.arguments ?? {});
  const result = await client.execute(requestFor(operation, { ...options, arguments: argumentsValue }, idempotencyKey));
  return {
    ...result,
    warnings: appendWarning(result.warnings, LEGACY_PROVENANCE_WARNING),
  };
}

function appendWarning(warnings: readonly string[], warning: string): string[] {
  return warnings.includes(warning) ? [...warnings] : [...warnings, warning];
}

export async function operationExecutePreview(
  client: PmsClient,
  operationId: string,
  idempotencyKey: string,
): Promise<OperationResult> {
  return client.executePreview(operationId, idempotencyKey);
}
