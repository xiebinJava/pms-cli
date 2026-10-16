import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import {
  resourceScenarioExecuteInputSchema,
  resourceScenarioInputSchema,
  resourceScenarioContractVersion,
  resourceScenarioResultSchema,
  type ResourceScenarioExecuteInput,
  type ParsedResourceScenarioExecuteInput,
  type ResourceScenarioInput,
  type ParsedResourceScenarioInput,
  type ResourceScenarioPlan,
  type ResourceScenarioResult,
  type ResourceScenarioSnapshot,
} from "../../../../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import { operationExecutePreview, operationPreview } from "../core/operation.js";
import {
  resourceScenarioRegistry,
  type ResourceScenarioAdapter,
  type ResourceScenarioRegistry,
} from "./resourceScenarioRegistry.js";

export async function planResourceScenario(
  client: PmsClient,
  input: ResourceScenarioInput,
  registry: ResourceScenarioRegistry = resourceScenarioRegistry,
): Promise<ResourceScenarioPlan> {
  const parsed = resourceScenarioInputSchema.parse(input);
  const adapter = registry.find(parsed.resourceType, parsed.operation);
  const context = await adapter.loadContext(client, parsed);
  const normalizedArguments = await adapter.normalizeArguments(parsed, context);
  const resolver = new CapabilityResolver(client);
  const action = await resolver.action(parsed.operation);
  const validatedArguments = resolver.validateArguments(parsed.operation, normalizedArguments);
  adapter.validate(parsed, context, validatedArguments, action);
  const preview = await operationPreview(client, parsed.operation, {
    arguments: validatedArguments,
    context: context ? { id: context.id, version: context.version } : { id: "global:pms", version: "v1" },
    requestId: parsed.requestId,
  });
  return {
    scenario: "resource-scenario",
    phase: "plan",
    contractVersion: resourceScenarioContractVersion,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId ?? null,
    operation: parsed.operation,
    context,
    normalizedArguments: validatedArguments,
    capability: action,
    preview,
    requiresConfirmation: true,
    warnings: [...preview.warnings],
  } as ResourceScenarioPlan;
}

export async function executeResourceScenario(
  client: PmsClient,
  input: ResourceScenarioExecuteInput,
  registry: ResourceScenarioRegistry = resourceScenarioRegistry,
): Promise<ResourceScenarioResult> {
  const parsed = resourceScenarioExecuteInputSchema.parse(input);
  const adapter = registry.find(parsed.resourceType, parsed.operation);
  const before = await readBeforeSnapshot(client, parsed);
  const operation = await operationExecutePreview(client, parsed.previewOperationId, parsed.idempotencyKey);
  const warnings = [...operation.warnings];
  if (operation.status !== "SUCCEEDED") {
    return resultFor(parsed, operation, null, null, {
      resourceReadback: false,
      contextReadback: false,
      patchApplied: false,
      protectedFieldsUnchanged: true,
    }, operation.status, warnings);
  }

  const resourceId = adapter.resolveReadbackId(parsed, operation);
  if (resourceId === null) {
    warnings.push("操作已成功，但响应中没有可用于回读的资源 ID");
    return resultFor(parsed, operation, null, null, {
      resourceReadback: false,
      contextReadback: false,
      patchApplied: false,
      protectedFieldsUnchanged: false,
    }, "WRITE_RESULT_UNKNOWN", warnings);
  }

  try {
    const resource = await client.get({ type: parsed.resourceType, id: resourceId });
    const context = await client.context({ type: parsed.resourceType, id: resourceId });
    const after: ResourceScenarioSnapshot = { resource, context };
    const verification = adapter.verifyReadback(before, after, {}, operation);
    const status = verification.resourceReadback
      && verification.contextReadback
      && verification.patchApplied
      && verification.protectedFieldsUnchanged
      ? "SUCCEEDED"
      : "WRITE_RESULT_UNKNOWN";
    if (status === "WRITE_RESULT_UNKNOWN") warnings.push("写入后回读未能证明所有变更已安全生效");
    return resultFor(parsed, operation, resourceId, { resource, context }, verification, status, warnings);
  } catch (error) {
    warnings.push(`操作已成功，但结果回读失败：${error instanceof Error ? error.message : String(error)}`);
    return resultFor(parsed, operation, resourceId, null, {
      resourceReadback: false,
      contextReadback: false,
      patchApplied: false,
      protectedFieldsUnchanged: false,
    }, "WRITE_RESULT_UNKNOWN", warnings);
  }
}

async function readBeforeSnapshot(
  client: PmsClient,
  input: ParsedResourceScenarioExecuteInput,
): Promise<ResourceScenarioSnapshot | null> {
  if (input.resourceId === undefined) return null;
  const resource = await client.get({ type: input.resourceType, id: input.resourceId });
  const context = await client.context({ type: input.resourceType, id: input.resourceId });
  return { resource, context };
}

function resultFor(
  input: ParsedResourceScenarioExecuteInput,
  operation: ResourceScenarioResult["operation"],
  resourceId: number | null,
  readback: { resource: ResourceScenarioResult["readback"]["resource"]; context: unknown } | null,
  verification: ResourceScenarioResult["verification"],
  status: ResourceScenarioResult["status"],
  warnings: string[],
): ResourceScenarioResult {
  const result = {
    scenario: "resource-scenario" as const,
    phase: "execute" as const,
    contractVersion: resourceScenarioContractVersion,
    resourceType: input.resourceType,
    resourceId,
    operation,
    previewOperationId: input.previewOperationId,
    readback: readback ?? { resource: null, context: null },
    verification,
    status,
    warnings,
    refreshScopes: operation.refreshScopes,
  };
  return resourceScenarioResultSchema.parse(result);
}
