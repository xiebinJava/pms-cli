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
import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import {
  executeStoryWorkbenchScenario,
  planStoryWorkbenchScenario,
} from "./storyWorkbench.js";
import { deriveProgressionExecutionMode, mayExecuteProgression } from "./progressionPolicy.js";
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";

export async function planStoryProgression(
  client: PmsClient,
  input: ParsedAgentProgressionInput,
): Promise<AgentProgressionPlan> {
  const binding = await readStoryBinding(client, input);
  const workbenchInput = toWorkbenchInput(input, binding, false);
  const declaredCommand = input.intent === "COMPLETE_NODE" ? binding.completionCommand : binding.command;
  if (!declaredCommand) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "故事当前节点未声明该推进能力");
  const capability = await new CapabilityResolver(client).action(declaredCommand);
  if (capability.mode === "read") {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "读取能力不能走节点写入入口");
  }
  const plan = await planStoryWorkbenchScenario(client, workbenchInput);
  const executionMode = deriveProgressionExecutionMode(capability);
  return {
    contractVersion: agentProgressionContractVersion,
    phase: "plan",
    resourceType: "story",
    resourceId: input.resourceId,
    intent: input.intent,
    operation: plan.preview.command,
    context: binding.context,
    normalizedArguments: storyArguments(workbenchInput, plan.preview.command),
    capability,
    preview: plan.preview,
    requiresConfirmation: executionMode === "confirmation",
    executionMode,
    warnings: [...plan.preview.warnings],
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
  if (!command) throw new Error("故事当前节点未声明该推进能力");
  return new CapabilityResolver(client).action(command);
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
  command: string;
  completionCommand?: string;
};

async function readStoryBinding(client: PmsClient, input: ParsedAgentProgressionInput): Promise<StoryBinding> {
  const context = await client.context(
    { type: "story", id: input.resourceId },
    input.nodeId === undefined
      ? { view: "focused", component: "story-node-workbench" }
      : { nodeId: input.nodeId, view: "focused", component: "story-node-workbench" },
  );
  const nodeId = input.nodeId ?? context.currentNode?.id;
  if (!isPositiveInteger(nodeId)) throw new Error("故事推进必须绑定当前节点 nodeId");
  const node = (Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [])
    .find((candidate) => isRecord(candidate) && candidate.id === nodeId) as Record<string, any> | undefined;
  const component = (node && Array.isArray(node.components) ? node.components : [])
    .find((candidate) => isRecord(candidate) && candidate.key === "story-node-workbench");
  const contract = component?.saveContract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("故事当前节点没有 story-node-workbench saveContract");
  }
  const raw = contract as Record<string, unknown>;
  const version = raw.version ?? context.version;
  const variant = raw.variant;
  if (!isNonNegativeInteger(version) || !isStoryVariant(variant)
    || raw.command !== "development-item.node.field.update") {
    throw new Error("故事当前节点 saveContract 不完整");
  }
  if (input.contextVersion !== undefined && String(context.version) !== input.contextVersion) {
    throw new Error(`故事上下文版本 ${context.version ?? "无"} 与请求版本 ${input.contextVersion} 不一致`);
  }
  return {
    context,
    nodeId,
    version,
    variant,
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

function storyArguments(input: StoryWorkbenchInput, operation: string): Record<string, unknown> {
  return {
    itemType: "STORY",
    itemId: input.resourceId,
    nodeId: input.nodeId,
    version: input.version,
    fieldValues: { __components: { "story-node-workbench": input.patch } },
    ...(operation === "development-item.node.complete-with-data" && input.ownerId !== undefined
      ? { ownerId: input.ownerId } : {}),
    ...(operation === "development-item.node.complete-with-data" && input.startDate !== undefined
      ? { startDate: input.startDate } : {}),
    ...(operation === "development-item.node.complete-with-data" && input.endDate !== undefined
      ? { endDate: input.endDate } : {}),
  };
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
