import type {
  ActionCapability,
  AgentProgressionPlan,
  AgentProgressionResult,
  ParsedAgentProgressionInput,
  StoryWorkbenchInput,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  agentProgressionContractVersion,
  agentProgressionResultSchema,
} from "../../../../../packages/pms-contracts/src/index.js";
import { PmsClientError, type PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import {
  executeStoryWorkbenchScenario,
  planStoryWorkbenchScenario,
} from "./storyWorkbench.js";
import { planAgentProgressionDraft, validateProgressionProvenance } from "./AgentDraftContract.js";
import { deriveProgressionExecutionMode, mayExecuteProgression } from "./progressionPolicy.js";
import { ComponentResolutionError, resolveWorkflowComponent } from "../core/componentResolver.js";
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";

export async function planStoryProgression(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionPlan> {
  const binding = await readStoryBinding(client, input);
  const workbenchInput = toWorkbenchInput(input, binding, false);
  const declaredCommand = input.intent === "COMPLETE_NODE" ? binding.completionCommand : binding.command;
  if (!declaredCommand) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事当前节点未声明该推进能力");
  const capability = await capabilityFor(client, input, binding);
  if (capability.mode === "read") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "读取能力不能走节点写入入口");
  }
  if (input.provenance) {
    const provenanceIssue = validateProgressionProvenance(input, input.provenance, binding.context);
    if (provenanceIssue) {
      return {
        contractVersion: agentProgressionContractVersion,
        phase: "plan",
        resourceType: "story",
        resourceId: input.resourceId,
        intent: input.intent,
        componentKey: binding.componentKey,
        nodeVersion: binding.version,
        entityVersion: typeof binding.context.entityVersion === "number" ? binding.context.entityVersion : null,
        workflowInstanceVersion: typeof binding.context.meta?.workflowInstanceVersion === "number"
          ? binding.context.meta.workflowInstanceVersion : null,
        operation: declaredCommand,
        context: binding.context,
        normalizedArguments: storyArguments(workbenchInput, binding, declaredCommand),
        capability,
        preview: null,
        fieldChanges: [],
        missingFields: [],
        preconditions: [],
        writeDecision: "NEEDS_INPUT",
        requiresConfirmation: false,
        executionMode: deriveProgressionExecutionMode(capability),
        rejectionReason: provenanceIssue.code,
        warnings: [provenanceIssue.message],
      };
    }
  }
  const executionMode = deriveProgressionExecutionMode(capability);
  const riskRequiresConfirmation = executionMode === "confirmation" && input.executeMode !== "confirm";
  const draftExecutionMode = executionMode === "confirmation" && input.executeMode === "auto"
    ? "confirmation" as const
    : "automatic" as const;
  const draftPlan = input.draft
    ? planAgentProgressionDraft(
      input.draft,
      binding.context,
      binding.nodeId,
      input.intent,
      draftExecutionMode,
      input.componentKey,
    )
    : null;
  if (draftPlan && draftPlan.writeDecision !== "READY") {
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: "story",
      resourceId: input.resourceId,
      intent: input.intent,
      componentKey: binding.componentKey,
      operation: declaredCommand,
      context: binding.context,
      normalizedArguments: storyArguments(workbenchInput, binding, declaredCommand),
      capability,
      preview: null,
      fieldChanges: draftPlan.fieldChanges,
      missingFields: draftPlan.missingFields,
      preconditions: draftPlan.preconditions,
      writeDecision: draftPlan.writeDecision,
      requiresConfirmation: draftPlan.writeDecision === "WAITING_CONFIRMATION",
      executionMode: draftPlan.writeDecision === "WAITING_CONFIRMATION" ? "confirmation" : executionMode,
      warnings: [
        ...draftPlan.unknownFields.map((key) => `草稿字段 ${key} 不在当前 PMS 可写契约中`),
        ...draftPlan.protectedFields.map((key) => `草稿字段 ${key} 是受保护字段`),
        ...draftPlan.missingSources.map((key) => `草稿字段 ${key} 缺少来源引用`),
        ...draftPlan.unresolvedDecisions,
        ...(draftPlan.completionBlockReason ? [draftPlan.completionBlockReason] : []),
      ],
    };
  }
  const provenanceState = await new CapabilityResolver(client).provenanceState();
  if ((provenanceState !== "supported" && input.provenance)
    || provenanceState === "unsupported"
    || (provenanceState === "supported" && !input.provenance)) {
    const unsupported = provenanceState !== "supported";
    const warning = unsupported
      ? "PROVENANCE_NOT_SUPPORTED: PMS 未声明 draft-provenance/v1，已阻止 progression 写入"
      : "PROVENANCE_NOT_PROVIDED: progression 写入必须携带字段级来源审计";
    return {
      contractVersion: agentProgressionContractVersion,
      phase: "plan",
      resourceType: "story",
      resourceId: input.resourceId,
      intent: input.intent,
      componentKey: binding.componentKey,
      nodeVersion: binding.version,
      entityVersion: typeof binding.context.entityVersion === "number" ? binding.context.entityVersion : null,
      workflowInstanceVersion: typeof binding.context.meta?.workflowInstanceVersion === "number"
        ? binding.context.meta.workflowInstanceVersion : null,
      operation: declaredCommand,
      context: binding.context,
      normalizedArguments: storyArguments(workbenchInput, binding, declaredCommand),
      capability,
      preview: null,
      fieldChanges: draftPlan?.fieldChanges ?? [],
      missingFields: draftPlan?.missingFields ?? [],
      preconditions: [],
      writeDecision: unsupported ? "CAPABILITY_UNAVAILABLE" : "NEEDS_INPUT",
      requiresConfirmation: false,
      executionMode,
      warnings: [warning],
    };
  }
  let plan;
  try {
    plan = await planStoryWorkbenchScenario(client, workbenchInput, {
      provenance: input.provenance,
    });
  } catch (error) {
    if (error instanceof PmsClientError && error.kind === "conflict") {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", error.message);
    }
    if (error instanceof PmsClientError && ["validation", "forbidden", "not_found"].includes(error.kind)) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", error.message);
    }
    throw error;
  }
  const preconditions = plan.preview.preconditions ?? [];
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
    resourceType: "story",
    resourceId: input.resourceId,
    intent: input.intent,
    componentKey: binding.componentKey,
    operation: plan.preview.command,
    context: binding.context,
    normalizedArguments: storyArguments(workbenchInput, binding, plan.preview.command),
    capability,
    preview: plan.preview,
    fieldChanges: draftPlan?.fieldChanges ?? [],
    missingFields: draftPlan?.missingFields ?? [],
    preconditions,
    writeDecision,
    requiresConfirmation: writeDecision === "WAITING_CONFIRMATION" || executionMode === "confirmation",
    executionMode: writeDecision === "WAITING_CONFIRMATION" ? "confirmation" : executionMode,
    warnings: [...plan.preview.warnings, ...(blockedByPrecondition ? ["PMS preview 返回阻塞前置条件"] : [])],
  };
}

export async function executeStoryProgression(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionResult> {
  const binding = await readStoryBinding(client, input);
  const workbenchInput = toWorkbenchInput(input, binding, true);
  const capability = await capabilityFor(client, input, binding);
  if (!mayExecuteProgression(capability, input.executeMode)) {
    return waitingForConfirmation(input, deriveProgressionExecutionMode(capability));
  }
  const result = await executeStoryWorkbenchScenario(client, workbenchInput);
  return agentProgressionResultSchema.parse({
    contractVersion: agentProgressionContractVersion,
    phase: "execute",
    status: result.status === "DRAFT" || result.status === "PREVIEWED"
      ? "PLAN_READY" : result.status,
    resourceType: "story",
    resourceId: input.resourceId,
    intent: input.intent,
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    nodeVersion: binding.version,
    entityVersion: typeof binding.context.entityVersion === "number" ? binding.context.entityVersion : null,
    workflowInstanceVersion: typeof binding.context.meta?.workflowInstanceVersion === "number"
      ? binding.context.meta.workflowInstanceVersion : null,
    plan: null,
    operation: result.operation ?? null,
    readback: result.readback ?? null,
    verification: result.verification ?? null,
    warnings: result.warnings,
  });
}

async function capabilityFor(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
  binding: StoryBinding,
): Promise<ActionCapability> {
  const command = input.intent === "COMPLETE_NODE" ? binding.completionCommand : binding.command;
  if (!command) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事当前节点未声明该推进能力");
  try {
    return await new CapabilityResolver(client).action(command);
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
    resourceType: "story",
    resourceId: input.resourceId,
    intent: input.intent,
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    plan: null,
    operation: null,
    readback: null,
    verification: null,
    warnings: [executionMode === "read"
      ? "读取能力不能通过写入入口执行"
      : "当前能力需要明确确认；请使用 executeMode=confirm 后重试"],
  });
}

type StoryBinding = {
  context: WorkflowContext;
  nodeId: number;
  version: number;
  variant: StoryWorkbenchInput["variant"];
  componentKey: string;
  fieldValuesPath: string;
  command: string;
  completionCommand?: string;
};

async function readStoryBinding(client: PmsClient, input: ParsedAgentProgressionInput): Promise<StoryBinding> {
  const requestedComponent = input.componentKey;
  const context = await client.context(
    { type: "story", id: input.resourceId },
    input.nodeId === undefined
      ? { view: "focused", ...(requestedComponent === undefined ? {} : { component: requestedComponent }) }
      : {
        nodeId: input.nodeId,
        view: "focused",
        ...(requestedComponent === undefined ? {} : { component: requestedComponent }),
      },
  );
  const nodeId = input.nodeId ?? context.currentNode?.id;
  if (!isPositiveInteger(nodeId)) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "故事推进必须绑定当前节点 nodeId");
  }
  if (context.currentNode?.id !== nodeId) {
    throw new ResourceScenarioError(
      "CONTEXT_CONFLICT",
      `故事当前节点 ${context.currentNode?.id ?? "无"} 与指定节点 ${nodeId} 不一致`,
    );
  }
  const node = (Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [])
    .find((candidate) => isRecord(candidate) && candidate.id === nodeId) as Record<string, any> | undefined;
  let component: Record<string, any> | undefined;
  try {
    component = node
      ? resolveWorkflowComponent(node as any, { componentKey: requestedComponent, mode: "write" })
        .component as Record<string, any> | undefined
      : undefined;
  } catch (error) {
    if (error instanceof ComponentResolutionError) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", error.message);
    }
    throw error;
  }
  const contract = component?.saveContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事当前节点没有可写 saveContract");
  }
  const raw = contract as Record<string, unknown>;
  const version = raw.version ?? context.version;
  const variant = raw.variant;
  if (!isNonNegativeInteger(version) || !isStoryVariant(variant)
    || raw.command !== "development-item.node.field.update") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事当前节点 saveContract 不完整");
  }
  const componentKey = typeof raw.componentKey === "string" ? raw.componentKey : component?.key;
  const fieldValuesPath = typeof raw.fieldValuesPath === "string"
    ? raw.fieldValuesPath : `__components.${component?.key}`;
  if (typeof componentKey !== "string" || componentKey.trim() === "") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事节点 saveContract 缺少 componentKey");
  }
  if (fieldValuesPath.split(".").map((segment) => segment.trim()).filter(Boolean).length === 0) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事节点 saveContract.fieldValuesPath 不能为空");
  }
  return {
    context,
    nodeId,
    version,
    variant,
    componentKey,
    fieldValuesPath,
    command: raw.command,
    ...(typeof raw.completionCommand === "string" ? { completionCommand: raw.completionCommand } : {}),
  };
}

function toWorkbenchInput(
  input: ParsedAgentProgressionInput,
  binding: StoryBinding,
  execute: boolean,
): StoryWorkbenchInput {
  const draft = input.draft;
  const complete = input.intent === "COMPLETE_NODE";
  return {
    contractVersion: "story-workbench/v1",
    resourceType: "story",
    resourceId: input.resourceId,
    nodeId: binding.nodeId,
    version: binding.version,
    componentKey: binding.componentKey,
    variant: binding.variant,
    patch: draft?.patch ?? {},
    save: execute,
    ...(complete ? { complete: true } : {}),
    ...(draft?.ownerId === undefined ? {} : { ownerId: draft.ownerId }),
    ...(draft?.startDate === undefined ? {} : { startDate: draft.startDate }),
    ...(draft?.endDate === undefined ? {} : { endDate: draft.endDate }),
    ...(execute && input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(execute && input.previewOperationId !== undefined ? { previewOperationId: input.previewOperationId } : {}),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  };
}

function storyArguments(
  input: StoryWorkbenchInput,
  binding: StoryBinding,
  operation: string,
): Record<string, unknown> {
  return {
    itemType: "STORY",
    itemId: input.resourceId,
    nodeId: input.nodeId,
    version: input.version,
    fieldValues: fieldValuesAtPath(binding.fieldValuesPath, input.patch),
    ...(operation === "development-item.node.complete-with-data" && input.ownerId !== undefined
      ? { ownerId: input.ownerId } : {}),
    ...(operation === "development-item.node.complete-with-data" && input.startDate !== undefined
      ? { startDate: input.startDate } : {}),
    ...(operation === "development-item.node.complete-with-data" && input.endDate !== undefined
      ? { endDate: input.endDate } : {}),
  };
}

function fieldValuesAtPath(path: string, patch: Record<string, unknown>): Record<string, unknown> {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  let result: Record<string, unknown> = patch;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    result = { [segments[index]!]: result };
  }
  return result;
}

function isStoryVariant(value: unknown): value is StoryWorkbenchInput["variant"] {
  return value === "writing" || value === "iteration" || value === "development"
    || value === "acceptance" || value === "release" || value === "launch";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
