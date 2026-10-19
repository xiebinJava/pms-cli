import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type {
  ActionCapability,
  OperationPreview,
  OperationResult,
  QueryResourceType,
  ResourceDetail,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import {
  LEGACY_PROVENANCE_WARNING,
  operationExecutePreview,
  operationPreview,
  type OperationOptions,
} from "../core/operation.js";

export const resourceWriteScenarioContractVersion = "resource-write/v1" as const;
export type ResourceWriteResourceType = Extract<QueryResourceType, "project" | "topic" | "story">;

export interface ResourceWriteScenarioOptions extends OperationOptions {
  resourceType: ResourceWriteResourceType;
  operation: string;
  idempotencyKey?: string;
  previewOperationId?: string;
}

export interface ResourceWriteScenarioPlan {
  scenario: "resource-write";
  phase: "plan";
  contractVersion: typeof resourceWriteScenarioContractVersion;
  resourceType: ResourceWriteResourceType;
  operation: string;
  resourceId: number | null;
  arguments: Record<string, unknown>;
  action: ActionCapability;
  preview: OperationPreview;
}

export interface ResourceWriteVerification {
  resourceReadback: boolean;
  contextReadback: boolean;
}

export interface ResourceWriteScenarioResult {
  scenario: "resource-write";
  phase: "execute";
  contractVersion: typeof resourceWriteScenarioContractVersion;
  resourceType: ResourceWriteResourceType;
  operation: OperationResult & { previewOperationId: string };
  previewOperationId: string;
  resourceId: number | null;
  readback: {
    resource: ResourceDetail | null;
    context: WorkflowContext | null;
  };
  verification: ResourceWriteVerification;
  refreshScopes: string[];
  warnings: string[];
  status: OperationResult["status"];
}

export async function planResourceWriteScenario(
  client: PmsClient,
  options: ResourceWriteScenarioOptions,
): Promise<ResourceWriteScenarioPlan> {
  const resolver = new CapabilityResolver(client);
  const catalog = await resolver.list();
  const resourceCapability = catalog.resources.find((resource) =>
    resource.actions.some((candidate) => candidate.name === options.operation));
  if (!resourceCapability) throw new Error(`能力目录中不存在操作: ${options.operation}`);
  if (resourceCapability.type !== options.resourceType) {
    throw new Error(
      `操作 ${options.operation} 属于资源 ${resourceCapability.type}，不能用于 ${options.resourceType}`,
    );
  }
  const action = resourceCapability.actions.find((candidate) => candidate.name === options.operation);
  if (!action) throw new Error(`能力目录中不存在操作: ${options.operation}`);
  const argumentsValue = resolver.validateArguments(options.operation, options.arguments ?? {});
  const context = await readOperationContext(client, options.resourceType, argumentsValue);
  const preview = await operationPreview(client, options.operation, {
    ...options,
    arguments: argumentsValue,
    context,
  });
  return {
    scenario: "resource-write",
    phase: "plan",
    contractVersion: resourceWriteScenarioContractVersion,
    resourceType: options.resourceType,
    operation: options.operation,
    resourceId: readResourceId(options.resourceType, argumentsValue),
    arguments: argumentsValue,
    action,
    preview,
  };
}

export async function executeResourceWriteScenario(
  client: PmsClient,
  options: ResourceWriteScenarioOptions & { idempotencyKey: string; previewOperationId: string },
): Promise<ResourceWriteScenarioResult> {
  if (!options.previewOperationId?.trim()) throw new Error("资源写入必须提供 preview-operation-id");
  if (!options.idempotencyKey?.trim()) throw new Error("资源写入必须提供 idempotencyKey");
  if (options.arguments && Object.keys(options.arguments).length > 0) {
    throw new Error("资源写入 execute 已绑定预览，不接受 arguments；请重新执行 plan");
  }

  const operation = await operationExecutePreview(client, options.previewOperationId, options.idempotencyKey);
  const resultResourceId = readResourceId(options.resourceType, operation.data);
  const warnings = appendWarning(operation.warnings, LEGACY_PROVENANCE_WARNING);
  const operationWithPreview = {
    ...operation,
    warnings,
    previewOperationId: options.previewOperationId,
  };
  if (operation.status !== "SUCCEEDED") {
    return {
      scenario: "resource-write",
      phase: "execute",
      contractVersion: resourceWriteScenarioContractVersion,
      resourceType: options.resourceType,
      operation: operationWithPreview,
      previewOperationId: options.previewOperationId,
      resourceId: resultResourceId,
      readback: { resource: null, context: null },
      verification: { resourceReadback: false, contextReadback: false },
      refreshScopes: operation.refreshScopes,
      warnings,
      status: operation.status,
    };
  }
  if (resultResourceId === null) {
    warnings.push("操作已成功，但响应中没有可用于回读的资源 ID");
    return {
      scenario: "resource-write",
      phase: "execute",
      contractVersion: resourceWriteScenarioContractVersion,
      resourceType: options.resourceType,
      operation: { ...operationWithPreview, status: "WRITE_RESULT_UNKNOWN" },
      previewOperationId: options.previewOperationId,
      resourceId: null,
      readback: { resource: null, context: null },
      verification: { resourceReadback: false, contextReadback: false },
      refreshScopes: operation.refreshScopes,
      warnings,
      status: "WRITE_RESULT_UNKNOWN",
    };
  }

  try {
    const resource = await client.get({ type: options.resourceType, id: resultResourceId });
    const context = await client.context({ type: options.resourceType, id: resultResourceId });
    return {
      scenario: "resource-write",
      phase: "execute",
      contractVersion: resourceWriteScenarioContractVersion,
      resourceType: options.resourceType,
      operation: operationWithPreview,
      previewOperationId: options.previewOperationId,
      resourceId: resultResourceId,
      readback: { resource, context },
      verification: { resourceReadback: true, contextReadback: true },
      refreshScopes: operation.refreshScopes,
      warnings,
      status: "SUCCEEDED",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`操作已成功，但资源回读失败：${message}`);
    return {
      scenario: "resource-write",
      phase: "execute",
      contractVersion: resourceWriteScenarioContractVersion,
      resourceType: options.resourceType,
      operation: { ...operationWithPreview, status: "WRITE_RESULT_UNKNOWN" },
      previewOperationId: options.previewOperationId,
      resourceId: resultResourceId,
      readback: { resource: null, context: null },
      verification: { resourceReadback: false, contextReadback: false },
      refreshScopes: operation.refreshScopes,
      warnings,
      status: "WRITE_RESULT_UNKNOWN",
    };
  }
}

function appendWarning(warnings: readonly string[], warning: string): string[] {
  return warnings.includes(warning) ? [...warnings] : [...warnings, warning];
}

async function readOperationContext(
  client: PmsClient,
  resourceType: ResourceWriteResourceType,
  argumentsValue: Record<string, unknown>,
): Promise<{ id: string; version: string }> {
  const resourceId = readResourceId(resourceType, argumentsValue);
  if (resourceId === null) return { id: "global:pms", version: "v1" };
  const context = await client.context({ type: resourceType, id: resourceId });
  return {
    id: `${resourceType}:${resourceId}`,
    version: String(context.version ?? context.entityVersion ?? "0"),
  };
}

function readResourceId(resourceType: ResourceWriteResourceType, value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const key = `${resourceType}Id`;
  const direct = readPositiveInteger(record[key]);
  if (direct !== null) return direct;
  const nested = record[resourceType];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedId = readPositiveInteger((nested as Record<string, unknown>).id);
    if (nestedId !== null) return nestedId;
  }
  return readPositiveInteger(record.id);
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
