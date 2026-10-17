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
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";

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
  assertSupportedResource(parsed);

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

function assertSupportedResource(input: ParsedAgentProgressionInput): void {
  if (input.resourceType === "project") {
    throw new ResourceScenarioError(
      "CAPABILITY_UNAVAILABLE",
      "统一 Agent 推进 run 当前支持需求、专题、故事；项目节点写入将在第二期开放",
    );
  }
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
    ...overrides,
  });
}

function statusForDecision(
  decision: AgentProgressionPlan["writeDecision"],
): AgentProgressionRunResult["status"] | null {
  if (decision === "NEEDS_INPUT") return "NEEDS_INPUT";
  if (decision === "WAITING_CONFIRMATION") return "WAITING_CONFIRMATION";
  if (decision === "CAPABILITY_UNAVAILABLE") return "CAPABILITY_UNAVAILABLE";
  return null;
}

