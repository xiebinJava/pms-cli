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
import { buildUserFacingDisplay } from "../../output/userFacing.js";
import {
  resourceScenarioRegistry,
  ResourceScenarioError,
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
  if (parsed.provenance && !(await resolver.supportsProvenance())) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "PMS 未声明 draft-provenance/v1，不能发送来源审计写入预览");
  }
  const validatedArguments = resolver.validateArguments(parsed.operation, normalizedArguments);
  adapter.validate(parsed, context, validatedArguments, action);
  const executionMode = action.mode === "read"
    ? "read" as const
    : action.risk === "high" ? "confirmation" as const : "automatic" as const;
  const preview = await operationPreview(client, parsed.operation, {
    arguments: validatedArguments,
    context: context ? { id: context.id, version: context.version } : { id: "global:pms", version: "v1" },
    provenance: parsed.provenance,
    requestId: parsed.requestId,
  });
  if (parsed.provenance
    && (preview.provenanceRef === undefined || preview.provenanceRef === null
      || preview.draftDigest !== parsed.provenance.draftDigest)) {
    throw new ResourceScenarioError(
      "CAPABILITY_UNAVAILABLE",
      "PMS preview 未返回与本次 draft 匹配的 provenanceRef/draftDigest",
    );
  }
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
    requiresConfirmation: executionMode === "confirmation",
    executionMode,
    ...(parsed.provenance === undefined ? {} : { provenance: parsed.provenance }),
    ...(preview.provenanceRef === undefined ? {} : { provenanceRef: preview.provenanceRef }),
    warnings: [...preview.warnings],
    userFacing: buildUserFacingDisplay({
      resourceType: parsed.resourceType,
      context: context?.snapshot,
      resourceDetails: parsed.arguments,
      operationStatus: "PREVIEWED",
      actualChange: "已生成待执行预览",
      blockers: preview.preconditions
        .filter((precondition) => precondition.blocking)
        .map((precondition) => precondition.message),
    }),
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
    const context = await client.context(
      { type: parsed.resourceType, id: resourceId },
      readbackContextOptions(parsed),
    );
    const after: ResourceScenarioSnapshot = { resource, context };
    recordContextVersionChange(before, after, warnings);
    const rawVerification = adapter.verifyReadback(before, after, {
      resourceType: parsed.resourceType,
      nodeId: parsed.nodeId,
      componentKey: parsed.componentKey,
      expectedPatch: parsed.expectedPatch,
    }, operation);
    const verification = parsed.expectedPatch === undefined
      ? { ...rawVerification, patchApplied: false }
      : rawVerification;
    if (parsed.expectedPatch === undefined) {
      warnings.push("旧 execute 未携带 expectedPatch，只完成资源身份和保护字段校验，patchApplied 无法确认");
    }
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
  const context = await client.context(
    { type: input.resourceType, id: input.resourceId },
    readbackContextOptions(input),
  );
  return { resource, context };
}

function readbackContextOptions(input: ParsedResourceScenarioExecuteInput) {
  if (input.nodeId === undefined) return undefined;
  return {
    nodeId: input.nodeId,
    view: "focused" as const,
    ...(input.componentKey === undefined ? {} : { component: input.componentKey }),
  };
}

function recordContextVersionChange(
  before: ResourceScenarioSnapshot | null,
  after: ResourceScenarioSnapshot,
  warnings: string[],
): void {
  const beforeVersion = before?.context?.version;
  const afterVersion = after.context?.version;
  if (beforeVersion === undefined || afterVersion === undefined || beforeVersion === afterVersion) return;
  warnings.push(`写入前后上下文版本发生变化：${String(beforeVersion)} -> ${String(afterVersion)}`);
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
    userFacing: buildUserFacingDisplay({
      resourceType: input.resourceType,
      context: readback?.context,
      resourceDetails: readback?.resource?.details,
      operationStatus: status,
      actualChange: actualChangeFor(status),
      blockers: warnings,
    }),
  };
  return resourceScenarioResultSchema.parse(result);
}

function actualChangeFor(status: ResourceScenarioResult["status"]): string {
  if (status === "SUCCEEDED") return "写入已完成并通过回读验证";
  if (status === "WRITE_RESULT_UNKNOWN") return "写入结果无法完全确认，需要回读核验";
  if (status === "CONFLICT") return "写入未完成，发生上下文冲突";
  return "写入未完成";
}
