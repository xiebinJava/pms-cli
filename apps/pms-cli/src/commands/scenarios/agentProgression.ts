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
  validateProgressionProvenance,
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
import { buildUserFacingDisplay } from "../../output/userFacing.js";
import "./requirementScenarioAdapter.js";
import "./topicScenarioAdapter.js";
import "./projectScenarioAdapter.js";

export class AgentProgressionMigrationError extends Error {
  readonly code = "MIGRATION_REQUIRED" as const;

  constructor(message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AgentProgressionMigrationError";
  }
}

export function parseAgentProgressionInput(input: unknown) {
  if (isRecord(input) && typeof input.contractVersion === "string"
    && input.contractVersion !== agentProgressionContractVersion) {
    throw new AgentProgressionMigrationError(
      `Agent progression 合约 ${input.contractVersion} 已停止服务，请升级到 ${agentProgressionContractVersion}`,
      { receivedContractVersion: input.contractVersion, requiredContractVersion: agentProgressionContractVersion },
    );
  }
  return agentProgressionInputSchema.parse(input);
}

export async function planAgentProgression(
  client: PmsClient,
  input: unknown,
): Promise<AgentProgressionPlan> {
  const parsed = parseAgentProgressionInput(input);
  if (parsed.draft) assertSafeAgentPayload(parsed.draft);
  if (parsed.intent === "READ_CONTEXT") return planReadContext(client, parsed);
  if (parsed.intent === "COMPLETE_NODE" && parsed.draft?.requestedCompletion !== true) {
    return planRejectedCompletion(parsed);
  }
  if (parsed.resourceType === "story") {
    const storyPlan = await planStoryProgression(client, parsed);
    return {
      ...storyPlan,
      ...(storyPlan.componentKey === undefined ? {} : { componentKey: storyPlan.componentKey }),
      ...(parsed.provenance === undefined ? {} : { provenance: parsed.provenance }),
      ...(storyPlan.preview?.provenanceRef === undefined ? {} : { provenanceRef: storyPlan.preview.provenanceRef }),
      ...versionFields(storyPlan.context, parsed.nodeId),
    };
  }

  const operation = resourceOperation(parsed.resourceType, parsed.intent);
  const declaredCapability = await actionFor(client, operation);
  if (declaredCapability.mode === "read") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "读取能力不能走节点写入入口");
  }
  const preflightContext = await readFocusedProgressionContext(client, parsed);
  const preflightComponentKey = parsed.componentKey ?? contextComponentKey(preflightContext);
  const executionMode = deriveProgressionExecutionMode(declaredCapability);
  if (parsed.provenance) {
    const provenanceIssue = validateProgressionProvenance(parsed, parsed.provenance, preflightContext);
    if (provenanceIssue) {
      return {
        contractVersion: agentProgressionContractVersion,
        phase: "plan",
        resourceType: parsed.resourceType,
        resourceId: parsed.resourceId,
        intent: parsed.intent,
        ...(preflightComponentKey === undefined ? {} : { componentKey: preflightComponentKey }),
        ...versionFields(preflightContext, parsed.nodeId),
        operation,
        context: preflightContext,
        normalizedArguments: {},
        capability: declaredCapability,
        preview: null,
        fieldChanges: [],
        missingFields: [],
        preconditions: [],
        writeDecision: "NEEDS_INPUT",
        requiresConfirmation: false,
        executionMode,
        rejectionReason: provenanceIssue.code,
        warnings: [provenanceIssue.message],
        userFacing: buildUserFacingDisplay({
          resourceType: parsed.resourceType,
          context: preflightContext,
          operationStatus: "REJECTED",
          actualChange: "来源审计校验未通过，尚未生成写入预览",
          blockers: [provenanceIssue.message],
        }),
      };
    }
  }
  const riskRequiresConfirmation = executionMode === "confirmation" && parsed.executeMode !== "confirm";
  const draftExecutionMode = draftModeForRequest(parsed, executionMode);
  const draftPlan = parsed.draft && preflightContext
    ? planAgentProgressionDraft(
      parsed.draft,
      preflightContext,
      parsed.nodeId,
      parsed.intent,
      draftExecutionMode,
      parsed.componentKey,
    )
    : null;
  if (draftPlan && draftPlan.writeDecision !== "READY") {
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      intent: parsed.intent,
      ...(preflightComponentKey === undefined ? {} : { componentKey: preflightComponentKey }),
      ...versionFields(preflightContext, parsed.nodeId),
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
      userFacing: buildUserFacingDisplay({
        resourceType: parsed.resourceType,
        context: preflightContext,
        operationStatus: draftPlan.writeDecision,
        actualChange: "缺少必填信息，尚未生成写入预览",
        blockers: progressionWarnings(draftPlan),
      }),
    };
  }
  const provenanceState = await new CapabilityResolver(client).provenanceState();
  if (provenanceState === "unsupported") {
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      intent: parsed.intent,
      ...(preflightComponentKey === undefined ? {} : { componentKey: preflightComponentKey }),
      ...versionFields(preflightContext, parsed.nodeId),
      operation,
      context: preflightContext,
      normalizedArguments: {},
      capability: declaredCapability,
      preview: null,
      fieldChanges: draftPlan?.fieldChanges ?? [],
      missingFields: draftPlan?.missingFields ?? [],
      preconditions: [],
      writeDecision: "CAPABILITY_UNAVAILABLE",
      requiresConfirmation: false,
      executionMode,
      warnings: ["PROVENANCE_NOT_SUPPORTED: PMS 未声明 draft-provenance/v1，已阻止 progression 写入"],
      userFacing: buildUserFacingDisplay({
        resourceType: parsed.resourceType,
        context: preflightContext,
        operationStatus: "CAPABILITY_UNAVAILABLE",
        actualChange: "PMS 未提供来源审计能力，尚未生成写入预览",
        blockers: ["PROVENANCE_NOT_SUPPORTED: PMS 未声明 draft-provenance/v1"],
      }),
    };
  }
  if (provenanceState === "supported" && !parsed.provenance) {
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      intent: parsed.intent,
      ...(preflightComponentKey === undefined ? {} : { componentKey: preflightComponentKey }),
      ...versionFields(preflightContext, parsed.nodeId),
      operation,
      context: preflightContext,
      normalizedArguments: {},
      capability: declaredCapability,
      preview: null,
      fieldChanges: draftPlan?.fieldChanges ?? [],
      missingFields: draftPlan?.missingFields ?? [],
      preconditions: [],
      writeDecision: "NEEDS_INPUT",
      requiresConfirmation: false,
      executionMode,
      warnings: ["PROVENANCE_NOT_PROVIDED: progression 写入必须携带字段级来源审计"],
      userFacing: buildUserFacingDisplay({
        resourceType: parsed.resourceType,
        context: preflightContext,
        operationStatus: "NEEDS_INPUT",
        actualChange: "缺少来源审计信息，尚未生成写入预览",
        blockers: ["PROVENANCE_NOT_PROVIDED: 请补充字段来源和 draftDigest"],
      }),
    };
  }
  const resourcePlan = await planResourceScenario(client, {
    contractVersion: "resource-scenario/v1",
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    operation,
    ...(parsed.nodeId === undefined ? {} : { nodeId: parsed.nodeId }),
    arguments: progressionArguments(parsed),
    ...(parsed.componentKey === undefined ? {} : { componentKey: parsed.componentKey }),
    ...(parsed.draft === undefined ? {} : { draft: toResourceDraft(parsed) }),
    ...(parsed.provenance === undefined ? {} : { provenance: parsed.provenance }),
    requestId: parsed.requestId,
  });
  const resolvedComponentKey = parsed.componentKey ?? resourcePlan.context?.selectedComponentKey ?? undefined;
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
    ...(resolvedComponentKey === undefined ? {} : { componentKey: resolvedComponentKey }),
    ...versionFields(preflightContext, parsed.nodeId),
    operation,
    context: resourcePlan.context,
    normalizedArguments: resourcePlan.normalizedArguments,
    capability,
    preview: resourcePlan.preview,
    ...(resourcePlan.provenance === undefined ? {} : { provenance: resourcePlan.provenance }),
    ...(resourcePlan.provenanceRef === undefined ? {} : { provenanceRef: resourcePlan.provenanceRef }),
    fieldChanges: draftPlan?.fieldChanges ?? [],
    missingFields: draftPlan?.missingFields ?? [],
    preconditions,
    writeDecision,
    requiresConfirmation: writeDecision === "WAITING_CONFIRMATION" || executionMode === "confirmation",
    executionMode: writeDecision === "WAITING_CONFIRMATION" ? "confirmation" : executionMode,
    warnings: [...resourcePlan.warnings, ...(blockedByPrecondition ? ["PMS preview 返回阻塞前置条件"] : [])],
    userFacing: buildUserFacingDisplay({
      resourceType: parsed.resourceType,
      context: resourcePlan.context?.snapshot,
      operationStatus: "PREVIEWED",
      actualChange: "已生成待执行预览",
      blockers: [...resourcePlan.warnings, ...(blockedByPrecondition ? ["PMS preview 返回阻塞前置条件"] : [])],
    }),
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
  const parsed = parseAgentProgressionInput(input);
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
    parsed.componentKey,
  );
  return agentProgressionDraftResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "draft",
    resourceType: parsed.resourceType,
    resourceId: parsed.resourceId,
    intent: parsed.intent,
    ...(parsed.componentKey === undefined ? {} : { componentKey: parsed.componentKey }),
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
  const parsed = parseAgentProgressionInput(input);
  if (parsed.draft) assertSafeAgentPayload(parsed.draft);
  if (parsed.intent === "READ_CONTEXT") return readContext(client, parsed);
  if (parsed.intent === "COMPLETE_NODE" && parsed.draft?.requestedCompletion !== true) {
    return rejectedCompletionResult(parsed);
  }
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
    ...(parsed.nodeId === undefined ? {} : { nodeId: parsed.nodeId }),
    ...(parsed.componentKey === undefined ? {} : { componentKey: parsed.componentKey }),
    ...(parsed.draft?.patch === undefined ? {} : { expectedPatch: parsed.draft.patch }),
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
    ...(parsed.componentKey === undefined ? {} : { componentKey: parsed.componentKey }),
    plan: null,
    operation: result.operation,
    readback: result.readback,
    verification: result.verification,
    warnings: result.warnings,
    ...(result.userFacing ? { userFacing: result.userFacing } : {}),
  });
}

async function planReadContext(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionPlan> {
  const readback = await readContextSnapshot(client, input);
  const componentKey = input.componentKey ?? contextComponentKey(readback.context);
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    ...(componentKey === undefined ? {} : { componentKey }),
    ...versionFields(readback.context, input.nodeId),
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
    {
      view: "focused",
      ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
      ...(input.componentKey === undefined ? {} : { component: input.componentKey }),
    },
  );
  return context;
}

function contextComponentKey(context: unknown): string | undefined {
  if (!isRecord(context) || !isRecord(context.meta)) return undefined;
  return typeof context.meta.selectedComponentKey === "string"
    ? context.meta.selectedComponentKey
    : undefined;
}

function progressionWarnings(details: ReturnType<typeof planAgentProgressionDraft>): string[] {
  return [
    ...details.unknownFields.map((key) => `草稿字段 ${key} 不在当前 PMS 可写契约中`),
    ...details.protectedFields.map((key) => `草稿字段 ${key} 是受保护字段`),
    ...details.missingSources.map((key) => evidenceWarning(key)),
    ...details.unresolvedDecisions,
    ...(details.completionBlockReason ? [details.completionBlockReason] : []),
  ];
}

function evidenceWarning(key: string): string {
  if (/^(facts|inferences)\[\d+\]\.sourceRefs$/.test(key)) {
    return `草稿证据 ${key} 引用了当前 PMS 上下文之外的来源`;
  }
  if (/^(facts|inferences)\[\d+\]$/.test(key)) {
    return `草稿证据 ${key} 缺少来源引用`;
  }
  return `草稿字段 ${key} 缺少来源引用`;
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
  const componentKey = input.componentKey ?? contextComponentKey(readback.context);
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: "CONTEXT_READY",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    ...(componentKey === undefined ? {} : { componentKey }),
    ...versionFields(readback.context, input.nodeId),
    plan: null,
    operation: null,
    readback,
    verification: null,
    warnings: [],
    userFacing: buildUserFacingDisplay({
      resourceType: input.resourceType,
      context: readback.context,
      resourceDetails: readback.resource.details,
      operationStatus: "CONTEXT_READY",
    }),
  });
}

async function readContextSnapshot(client: PmsClient, input: ParsedAgentProgressionInput) {
  const resource = await client.get({ type: input.resourceType, id: input.resourceId });
  const context = await client.context(
    { type: input.resourceType, id: input.resourceId },
    {
      view: "focused",
      ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
      ...(input.componentKey === undefined ? {} : { component: input.componentKey }),
    },
  );
  return { resource, context };
}

function planRejectedCompletion(
  input: ParsedAgentProgressionInput,
): AgentProgressionPlan {
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    nodeVersion: null,
    entityVersion: null,
    workflowInstanceVersion: null,
    operation: completionOperation(input.resourceType),
    context: null,
    normalizedArguments: {},
    capability: null,
    preview: null,
    fieldChanges: [],
    missingFields: [],
    preconditions: [],
    writeDecision: "NEEDS_INPUT",
    requiresConfirmation: false,
    executionMode: "automatic",
    rejectionReason: "COMPLETION_NOT_REQUESTED",
    warnings: ["COMPLETE_NODE 必须显式提供 requestedCompletion=true，当前未生成写入预览"],
  };
}

function rejectedCompletionResult(
  input: ParsedAgentProgressionInput,
): AgentProgressionResult {
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: "REJECTED",
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    intent: input.intent,
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    plan: null,
    operation: null,
    readback: null,
    verification: null,
    rejectionReason: "COMPLETION_NOT_REQUESTED",
    warnings: ["COMPLETE_NODE 必须显式提供 requestedCompletion=true，当前未执行写入"],
  });
}

function completionOperation(resourceType: ParsedAgentProgressionInput["resourceType"]): string {
  if (resourceType === "project") return "node.complete-with-data";
  return "development-item.node.complete-with-data";
}

function versionFields(context: any, nodeId?: number): {
  nodeVersion?: number | null;
  entityVersion?: number | null;
  workflowInstanceVersion?: number | null;
} {
  const nodes = Array.isArray(context?.workflow?.nodes) ? context.workflow.nodes : [];
  const selectedNodeId = nodeId ?? context?.meta?.selectedNodeId ?? context?.currentNode?.id;
  const node = nodes.find((candidate: any) => isRecord(candidate) && candidate.id === selectedNodeId);
  return {
    nodeVersion: typeof node?.version === "number" ? node.version : null,
    entityVersion: typeof context?.entityVersion === "number" ? context.entityVersion : null,
    workflowInstanceVersion: typeof context?.meta?.workflowInstanceVersion === "number"
      ? context.meta.workflowInstanceVersion : null,
  };
}

function resourceOperation(
  resourceType: Exclude<ParsedAgentProgressionInput["resourceType"], "story">,
  intent: ParsedAgentProgressionInput["intent"],
): string {
  if (intent === "COMPLETE_NODE") {
    if (resourceType === "project") return "node.complete-with-data";
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
