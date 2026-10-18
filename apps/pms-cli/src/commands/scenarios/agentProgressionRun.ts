import type {
  AgentProgressionPlan,
  AgentProgressionResult,
  AgentProgressionRunResult,
  ParsedAgentProgressionInput,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  agentProgressionInputSchema,
  agentProgressionRunContractVersion,
  agentProgressionRunResultSchema,
} from "../../../../../packages/pms-contracts/src/index.js";
import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { executeAgentProgression, planAgentProgression } from "./agentProgression.js";
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
  const parsed = agentProgressionInputSchema.parse(input);

  if (parsed.intent === "READ_CONTEXT") {
    const result = await executeAgentProgression(client, parsed);
    return resultForRead(parsed, result);
  }

  if (parsed.executeMode !== "plan" && !parsed.idempotencyKey) {
    return baseResult(parsed, "NEEDS_INPUT", null, null, {
      warnings: ["auto/confirm 模式必须提供 idempotencyKey，才能安全执行写入"],
    });
  }

  const plan = await planAgentProgression(client, parsed);
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

  const result = await executeAgentProgression(client, {
    ...parsed,
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
    previewOperationId: null,
    operationId: null,
    auditId: null,
    readback: null,
    verification: null,
    warnings: [],
    userFacing: buildUserFacingDisplay({
      resourceType: input.resourceType,
      context: result?.readback?.context ?? plan?.context,
      resourceDetails: result?.readback?.resource?.details,
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
