import type {
  AgentProgressionPlan,
  AgentProgressionResult,
  AgentProgressionRunResult,
  ParsedAgentProgressionInput,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  agentProgressionRunContractVersion,
  agentProgressionRunResultSchema,
  agentProgressionResourceTypeSchema,
  agentProgressionIntentSchema,
  validateDraftProvenance,
} from "../../../../../packages/pms-contracts/src/index.js";
import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import {
  AgentProgressionMigrationError,
  executeAgentProgression,
  parseAgentProgressionInput,
  planAgentProgression,
} from "./agentProgression.js";
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";
import { buildUserFacingDisplay } from "../../output/userFacing.js";

/**
 * Composes the external-agent progression lifecycle without owning any PMS
 * resource rules. The existing plan and execute functions remain the only
 * paths that resolve save contracts, preview operations, and writes.
 */
export async function runAgentProgression(
  client: PmsClient,
  input: unknown,
): Promise<AgentProgressionRunResult> {
  let parsed: ParsedAgentProgressionInput;
  try {
    parsed = parseAgentProgressionInput(input);
  } catch (error) {
    const rejected = provenanceRejection(input);
    if (rejected) return rejected;
    throw error;
  }

  try {
    return await runParsedAgentProgression(client, parsed);
  } catch (error) {
    if (error instanceof AgentProgressionMigrationError) throw error;
    if (!(error instanceof ResourceScenarioError)) throw error;
    const status = error.code === "CONTEXT_CONFLICT"
      ? "CONFLICT"
      : error.code === "WRITE_RESULT_UNKNOWN"
        ? "WRITE_RESULT_UNKNOWN"
        : "CAPABILITY_UNAVAILABLE";
    return baseResult(parsed, status, null, null, {
      warnings: [error.message],
    });
  }
}

function provenanceRejection(input: unknown): AgentProgressionRunResult | null {
  if (!isRecord(input)
    || input.contractVersion !== "agent-progression/v2"
    || input.provenance === undefined) return null;
  const resourceType = agentProgressionResourceTypeSchema.safeParse(input.resourceType);
  const resourceId = typeof input.resourceId === "number"
    && Number.isInteger(input.resourceId) && input.resourceId > 0
    ? input.resourceId : null;
  const intent = agentProgressionIntentSchema.safeParse(input.intent);
  if (!resourceType.success || resourceId === null || !intent.success) return null;
  const validation = validateDraftProvenance(input.provenance);
  if (validation.success) return null;
  const rejectionReason = validation.code === "PROVENANCE_TOO_LARGE"
    ? "PROVENANCE_TOO_LARGE" as const
    : "PROVENANCE_INVALID" as const;
  return agentProgressionRunResultSchema.parse({
    contractVersion: agentProgressionRunContractVersion,
    phase: "run",
    status: "REJECTED",
    resourceType: resourceType.data,
    resourceId,
    intent: intent.data,
    writeDecision: "NEEDS_INPUT",
    plan: null,
    result: null,
    previewOperationId: null,
    operationId: null,
    auditId: null,
    readback: null,
    verification: null,
    rejectionReason,
    warnings: [validation.code === "PROVENANCE_TOO_LARGE"
      ? "provenance 超过 PMS 允许的大小限制"
      : "provenance 不符合 draft-provenance/v1 契约"],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function runParsedAgentProgression(
  client: PmsClient,
  parsed: ParsedAgentProgressionInput,
): Promise<AgentProgressionRunResult> {

  if (parsed.intent === "READ_CONTEXT") {
    const result = await executeAgentProgression(client, parsed);
    return resultForRead(parsed, result);
  }

  // Completion intent is rejected before idempotency validation when the
  // Agent did not explicitly request a completion. This keeps the safety
  // decision deterministic and guarantees no preview or write is created.
  if (parsed.intent === "COMPLETE_NODE" && parsed.draft?.requestedCompletion !== true) {
    const plan = await planAgentProgression(client, parsed);
    return baseResult(parsed, "REJECTED", plan, null, {
      rejectionReason: plan.rejectionReason,
      warnings: plan.warnings,
    });
  }

  if (parsed.executeMode !== "plan" && !parsed.idempotencyKey) {
    return baseResult(parsed, "NEEDS_INPUT", null, null, {
      warnings: ["auto/confirm 模式必须提供 idempotencyKey，才能安全执行写入"],
    });
  }

  const plan = await planAgentProgression(client, parsed);
  if (plan.rejectionReason) {
    return baseResult(parsed, "REJECTED", plan, null, {
      previewOperationId: null,
      rejectionReason: plan.rejectionReason,
      warnings: plan.warnings,
    });
  }
  const blockedStatus = statusForDecision(plan.writeDecision);
  if (blockedStatus) {
    return baseResult(parsed, blockedStatus, plan, null, {
      previewOperationId: plan.preview?.operationId ?? null,
      warnings: plan.warnings,
    });
  }
  if (parsed.executeMode === "plan") {
    return baseResult(parsed, "PLAN_READY", plan, null, {
      previewOperationId: plan.preview?.operationId ?? null,
      warnings: plan.warnings,
    });
  }
  if (!plan.preview) {
    return baseResult(parsed, "CAPABILITY_UNAVAILABLE", plan, null, {
      warnings: [...plan.warnings, "PMS 没有返回可执行的 preview"],
    });
  }

  const { provenance: _provenance, ...executeInput } = parsed;
  const result = await executeAgentProgression(client, {
    ...executeInput,
    ...(parsed.componentKey === undefined && plan.componentKey !== undefined
      ? { componentKey: plan.componentKey } : {}),
    previewOperationId: plan.preview.operationId,
  });
  return baseResult(parsed, result.status, plan, result, {
    previewOperationId: plan.preview.operationId,
    operationId: result.operation?.operationId ?? null,
    auditId: result.operation?.auditId ?? null,
    readback: result.readback,
    verification: result.verification,
    warnings: [...plan.warnings, ...result.warnings],
  });
}

function resultForRead(
  input: ParsedAgentProgressionInput,
  result: AgentProgressionResult,
): AgentProgressionRunResult {
  return baseResult(input, result.status, null, result, {
    readback: result.readback,
    verification: result.verification,
    warnings: result.warnings,
  });
}

function baseResult(
  input: ParsedAgentProgressionInput,
  status: AgentProgressionRunResult["status"],
  plan: AgentProgressionPlan | null,
  result: AgentProgressionResult | null,
  overrides: Partial<AgentProgressionRunResult> = {},
): AgentProgressionRunResult {
  return agentProgressionRunResultSchema.parse({
    contractVersion: agentProgressionRunContractVersion,
    phase: "run",
    status,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    writeDecision: plan?.writeDecision ?? "READY",
    plan,
    result,
    ...((input.componentKey ?? result?.componentKey) === undefined
      ? {} : { componentKey: input.componentKey ?? result?.componentKey }),
    ...((plan?.nodeVersion ?? result?.nodeVersion) === undefined
      ? {} : { nodeVersion: plan?.nodeVersion ?? result?.nodeVersion }),
    ...((plan?.entityVersion ?? result?.entityVersion) === undefined
      ? {} : { entityVersion: plan?.entityVersion ?? result?.entityVersion }),
    ...((plan?.workflowInstanceVersion ?? result?.workflowInstanceVersion) === undefined
      ? {} : { workflowInstanceVersion: plan?.workflowInstanceVersion ?? result?.workflowInstanceVersion }),
    ...((plan?.provenanceRef ?? result?.provenanceRef) === undefined
      ? {} : { provenanceRef: plan?.provenanceRef ?? result?.provenanceRef }),
    ...((plan?.provenance?.draftDigest ?? result?.draftDigest) === undefined
      ? {} : { draftDigest: plan?.provenance?.draftDigest ?? result?.draftDigest }),
    previewOperationId: null,
    operationId: null,
    auditId: null,
    readback: null,
    verification: null,
    warnings: [],
    ...(overrides.rejectionReason === undefined ? {} : { rejectionReason: overrides.rejectionReason }),
    userFacing: buildUserFacingDisplay({
      resourceType: input.resourceType,
      context: result?.readback?.context ?? plan?.context,
      resourceDetails: result?.readback?.resource?.details,
      fieldChanges: plan?.fieldChanges,
      operationStatus: result?.status ?? status,
      actualChange: actualChangeFor(status),
      blockers: overrides.warnings,
    }),
    ...overrides,
  });
}

function actualChangeFor(status: AgentProgressionRunResult["status"]): string {
  if (status === "CONTEXT_READY") return "已读取当前流程上下文";
  if (status === "PLAN_READY") return "已生成待执行预览";
  if (status === "SUCCEEDED") return "写入已完成并通过回读验证";
  if (status === "WRITE_RESULT_UNKNOWN") return "写入结果无法完全确认，需要回读核验";
  if (status === "NEEDS_INPUT") return "缺少必填信息，尚未执行写入";
  return "当前操作尚未完成";
}

function statusForDecision(
  decision: AgentProgressionPlan["writeDecision"],
): AgentProgressionRunResult["status"] | null {
  if (decision === "NEEDS_INPUT") return "NEEDS_INPUT";
  if (decision === "WAITING_CONFIRMATION") return "WAITING_CONFIRMATION";
  if (decision === "CAPABILITY_UNAVAILABLE") return "CAPABILITY_UNAVAILABLE";
  return null;
}
