import type {
  ActionCapability,
  AgentProgressionPlan,
  AgentProgressionResult,
  ParsedAgentProgressionInput,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  agentProgressionContractVersion,
  agentProgressionDraftResultSchema,
  agentProgressionInputSchema,
  agentProgressionResultSchema,
} from "../../../../../packages/pms-contracts/src/index.js";
import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import {
  assertSafeAgentPayload,
  planAgentProgressionDraft,
  validateAgentProgressionDraftFields,
} from "./AgentDraftContract.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "./resourceScenarioExecutor.js";
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";
import {
  deriveProgressionExecutionMode,
  mayExecuteProgression,
} from "./progressionPolicy.js";
import { executeStoryProgression, planStoryProgression } from "./storyProgressionAdapter.js";
import "./requirementScenarioAdapter.js";
import "./topicScenarioAdapter.js";
import "./projectScenarioAdapter.js";

export async function planAgentProgression(
  client: PmsClient,
  input: unknown,
): Promise<AgentProgressionPlan> {
  const parsed = agentProgressionInputSchema.parse(input);
  if (parsed.draft) assertSafeAgentPayload(parsed.draft);
  if (parsed.intent === "READ_CONTEXT") return planReadContext(client, parsed);
  if (parsed.resourceType === "story") return planStoryProgression(client, parsed);

  const operation = resourceOperation(parsed.resourceType, parsed.intent);
  const declaredCapability = await actionFor(client, operation);
  if (declaredCapability.mode === "read") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "读取能力不能走节点写入入口");
  }
  const preflightContext = parsed.resourceType === "project"
    ? null
    : await readFocusedProgressionContext(client, parsed);
  const executionMode = deriveProgressionExecutionMode(declaredCapability);
  const riskRequiresConfirmation = executionMode === "confirmation" && parsed.executeMode !== "confirm";
  const draftExecutionMode = draftModeForRequest(parsed, executionMode);
  const draftPlan = parsed.draft && preflightContext
    ? planAgentProgressionDraft(parsed.draft, preflightContext, parsed.nodeId, parsed.intent, draftExecutionMode)
    : null;
  if (draftPlan && draftPlan.writeDecision !== "READY") {
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      intent: parsed.intent,
      operation,
      context: preflightContext,
      normalizedArguments: {},
      capability: declaredCapability,
      preview: null,
      fieldChanges: draftPlan.fieldChanges,
      missingFields: draftPlan.missingFields,
      preconditions: draftPlan.preconditions,
      writeDecision: draftPlan.writeDecision,
      requiresConfirmation: draftPlan.writeDecision === "WAITING_CONFIRMATION",
      executionMode: draftPlan.writeDecision === "WAITING_CONFIRMATION" ? "confirmation" : executionMode,
      warnings: progressionWarnings(draftPlan),
    };
  }
  const resourcePlan = await planResourceScenario(client, {
    contractVersion: "resource-scenario/v1",
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    operation,
    ...(parsed.nodeId === undefined ? {} : { nodeId: parsed.nodeId }),
    ...(parsed.contextVersion === undefined ? {} : { contextVersion: parsed.contextVersion }),
    arguments: progressionArguments(parsed),
    ...(parsed.draft === undefined ? {} : { draft: toResourceDraft(parsed) }),
    requestId: parsed.requestId,
  });
  const capability = resourcePlan.capability as ActionCapability;
  const preconditions = resourcePlan.preview?.preconditions ?? [];
  const blockedByPrecondition = preconditions.some((value) => isRecord(value) && value.blocking === true);
  const draftDecision = draftPlan?.writeDecision;
  const writeDecision = blockedByPrecondition
    ? "NEEDS_INPUT"
    : draftDecision && draftDecision !== "READY"
      ? draftDecision
      : riskRequiresConfirmation ? "WAITING_CONFIRMATION" : "READY";
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan",
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    intent: parsed.intent,
    operation,
    context: resourcePlan.context,
    normalizedArguments: resourcePlan.normalizedArguments,
    capability,
    preview: resourcePlan.preview,
    fieldChanges: draftPlan?.fieldChanges ?? [],
    missingFields: draftPlan?.missingFields ?? [],
    preconditions,
    writeDecision,
    requiresConfirmation: writeDecision === "WAITING_CONFIRMATION" || executionMode === "confirmation",
    executionMode: writeDecision === "WAITING_CONFIRMATION" ? "confirmation" : executionMode,
    warnings: [...resourcePlan.warnings, ...(blockedByPrecondition ? ["PMS preview 返回阻塞前置条件"] : [])],
  };
}

/**
 * Validates a draft produced by an external Agent against a fresh PMS context.
 * This intentionally does not create a preview or execute an operation; the
 * subsequent plan call remains the authoritative saveContract validation.
 */
export async function validateAgentProgressionDraft(
  client: PmsClient,
  input: unknown,
) {
  const parsed = agentProgressionInputSchema.parse(input);
  if (parsed.intent === "READ_CONTEXT") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "READ_CONTEXT 不需要 draft 校验");
  }
  if (!parsed.draft) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "写入意图必须提供 draft");
  }
  assertSafeAgentPayload(parsed.draft);
  const readback = await readContextSnapshot(client, parsed);
  const diagnostics = validateAgentProgressionDraftFields(
    parsed.draft,
    readback.context,
    parsed.nodeId,
  );
  return agentProgressionDraftResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "draft",
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    intent: parsed.intent,
    contextVersion: String(readback.context.version),
    draft: parsed.draft,
    diagnostics,
    warnings: [],
  });
}

export async function executeAgentProgression(
  client: PmsClient,
  input: unknown,
): Promise<AgentProgressionResult> {
  const parsed = agentProgressionInputSchema.parse(input);
  if (parsed.draft) assertSafeAgentPayload(parsed.draft);
  if (parsed.intent === "READ_CONTEXT") return readContext(client, parsed);
  if (!parsed.previewOperationId || !parsed.idempotencyKey) {
    throw new Error("Agent Progression execute 必须提供 previewOperationId 和 idempotencyKey");
  }
  if (parsed.resourceType === "story") return executeStoryProgression(client, parsed);

  const operation = resourceOperation(parsed.resourceType, parsed.intent);
  const capability = await actionFor(client, operation);
  if (!mayExecuteProgression(capability, parsed.executeMode)) {
    return waitingForConfirmation(parsed, deriveProgressionExecutionMode(capability));
  }
  const result = await executeResourceScenario(client, {
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    operation,
    previewOperationId: parsed.previewOperationId,
    idempotencyKey: parsed.idempotencyKey,
    requestId: parsed.requestId,
  });
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: result.status,
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    intent: parsed.intent,
    plan: null,
    operation: result.operation,
    readback: result.readback,
    verification: result.verification,
    warnings: result.warnings,
  });
}

async function planReadContext(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionPlan> {
  const readback = await readContextSnapshot(client, input);
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    operation: null,
    context: readback.context,
    normalizedArguments: {},
    capability: null,
    preview: null,
    fieldChanges: [],
    missingFields: [],
    preconditions: [],
    writeDecision: "READY",
    requiresConfirmation: false,
    executionMode: "read",
    warnings: [],
  };
}

async function readFocusedProgressionContext(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
) {
  const context = await client.context(
    { type: input.resourceType, id: input.resourceId },
    input.nodeId === undefined ? { view: "focused" } : { nodeId: input.nodeId, view: "focused" },
  );
  if (input.contextVersion !== undefined && String(context.version) !== input.contextVersion) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "请求的上下文版本已过期");
  }
  return context;
}

function progressionWarnings(details: ReturnType<typeof planAgentProgressionDraft>): string[] {
  return [
    ...details.unknownFields.map((key) => `草稿字段 ${key} 不在当前 PMS 可写契约中`),
    ...details.protectedFields.map((key) => `草稿字段 ${key} 是受保护字段`),
    ...details.missingSources.map((key) => `草稿字段 ${key} 缺少来源引用`),
    ...details.unresolvedDecisions,
  ];
}

function draftModeForRequest(
  input: ParsedAgentProgressionInput,
  capabilityMode: "read" | "automatic" | "confirmation",
): "read" | "automatic" | "confirmation" {
  // Explicit confirm authorizes a high-risk preview+execute path. Auto and
  // plan must still stop before preview for the same capability.
  if (capabilityMode !== "confirmation") return capabilityMode;
  return input.executeMode === "auto" ? "confirmation" : "automatic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readContext(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionResult> {
  const readback = await readContextSnapshot(client, input);
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: "CONTEXT_READY",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    plan: null,
    operation: null,
    readback,
    verification: null,
    warnings: [],
  });
}

async function readContextSnapshot(client: PmsClient, input: ParsedAgentProgressionInput) {
  const resource = await client.get({ type: input.resourceType, id: input.resourceId });
  const context = await client.context(
    { type: input.resourceType, id: input.resourceId },
    input.nodeId === undefined ? { view: "focused" } : { nodeId: input.nodeId, view: "focused" },
  );
  if (input.contextVersion !== undefined && String(context.version) !== input.contextVersion) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "请求的上下文版本已过期");
  }
  return { resource, context };
}

function resourceOperation(
  resourceType: Exclude<ParsedAgentProgressionInput["resourceType"], "story">,
  intent: ParsedAgentProgressionInput["intent"],
): string {
  if (intent === "COMPLETE_NODE") {
    if (resourceType === "project") {
      throw new ResourceScenarioError(
        "CAPABILITY_UNAVAILABLE",
        "project 当前没有注册 COMPLETE_NODE 能力；项目节点完成将在第二期开放",
      );
    }
    return "development-item.node.complete-with-data";
  }
  if (intent !== "UPDATE_NODE_FIELDS") {
    throw new ResourceScenarioError(
      "CAPABILITY_UNAVAILABLE",
      `${resourceType} 当前没有注册 ${intent} 能力`,
    );
  }
  return resourceType === "project" ? "node.field.update" : "development-item.node.field.update";
}

function progressionArguments(input: ParsedAgentProgressionInput): Record<string, unknown> {
  if (!input.draft || input.intent !== "COMPLETE_NODE") return {};
  return {
    ...(input.draft.ownerId === undefined ? {} : { ownerId: input.draft.ownerId }),
    ...(input.draft.startDate === undefined ? {} : { startDate: input.draft.startDate }),
    ...(input.draft.endDate === undefined ? {} : { endDate: input.draft.endDate }),
  };
}

function toResourceDraft(input: ParsedAgentProgressionInput) {
  if (!input.draft) return undefined;
  return {
    facts: input.draft.facts,
    inferences: input.draft.inferences,
    assumptions: input.draft.assumptions,
    unresolvedDecisions: input.draft.unresolvedDecisions,
    patch: input.draft.patch,
  };
}

async function actionFor(client: PmsClient, operation: string): Promise<ActionCapability> {
  try {
    return await new CapabilityResolver(client).action(operation);
  } catch (error) {
    throw new ResourceScenarioError(
      "CAPABILITY_UNAVAILABLE",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function waitingForConfirmation(
  input: ParsedAgentProgressionInput,
  executionMode: "read" | "automatic" | "confirmation",
): AgentProgressionResult {
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: executionMode === "read" ? "CAPABILITY_UNAVAILABLE" : "WAITING_CONFIRMATION",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    plan: null,
    operation: null,
    readback: null,
    verification: null,
    warnings: [executionMode === "read"
      ? "读取能力不能通过写入入口执行"
      : "当前能力需要明确确认；请使用 executeMode=confirm 后重试"],
  });
}
