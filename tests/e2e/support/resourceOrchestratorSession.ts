import type { ResourceNodeDraft, WorkflowContext } from "../../../packages/pms-contracts/src/index.js";
import type { OrchestratorPlan, OrchestratorSession, PmsClient } from "../../../packages/pms-client/src/index.js";
import {
  appendResourceOrchestratorTurn,
  confirmResourceOrchestratorPlan,
  createResourceOrchestratorConversation,
  previewResourceOrchestratorPlan,
  readResourceOrchestratorSession,
} from "../../../apps/pms-cli/src/commands/scenarios/resourceOrchestrator.js";
import type { WritableNodeFixture } from "./projectFixture.js";

/** Builds the frozen resource-node/v1 draft shape from PMS-derived metadata. */
export function resourceNodeDraft(
  resourceType: "project" | "topic",
  resourceId: number,
  node: WritableNodeFixture,
  marker: string,
  options: { requestedCompletion?: boolean; fieldSources?: Record<string, unknown> } = {},
): ResourceNodeDraft {
  const patch = {
    ...node.requiredFieldValues,
    [node.fieldKey]: markerValue(node.fieldValue, marker),
  };
  const nodeRef = `${resourceType}-node:${node.nodeId}#component:${node.componentKey}`;
  const fieldSources = options.fieldSources ?? Object.fromEntries(
    Object.keys(patch).map((field) => [field, {
      sourceType: "pms_context",
      sourceRefs: [nodeRef],
      confidence: "high",
    }]),
  );
  return {
    facts: [{
      text: `${resourceType} ${resourceId} 的当前节点来自 PMS focused context`,
      sourceRefs: [nodeRef],
      confidence: "high",
    }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
    ...(options.requestedCompletion === undefined
      ? {}
      : { requestedCompletion: options.requestedCompletion }),
    fieldSources: fieldSources as ResourceNodeDraft["fieldSources"],
  };
}

/** Keeps structured PMS workbench fields in their declared DTO shape. */
function markerValue(value: unknown, marker: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!isRecord(item)) return marker;
      if (Object.prototype.hasOwnProperty.call(item, "title")) return { ...item, title: marker };
      if (Object.prototype.hasOwnProperty.call(item, "name")) {
        return { ...item, name: marker, description: marker, acceptanceCriteria: marker };
      }
      return { ...item, value: marker };
    });
  }
  if (isRecord(value)) {
    if (Object.prototype.hasOwnProperty.call(value, "title")) return { ...value, title: marker };
    if (Object.prototype.hasOwnProperty.call(value, "name")) return { ...value, name: marker };
    return { ...value, value: marker };
  }
  return marker;
}

/** Finds the selected component in a focused context without assuming array order. */
export function focusedComponent(
  context: WorkflowContext,
  nodeId: number,
  componentKey: string,
): Record<string, unknown> | null {
  const nodes = context.workflow?.nodes ?? [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  if (!isRecord(node) || !Array.isArray(node.components)) return null;
  const component = node.components.find((candidate) => isRecord(candidate) && candidate.key === componentKey);
  return isRecord(component) ? component : null;
}

export function writableComponentKeys(context: WorkflowContext, nodeId: number): string[] {
  const nodes = context.workflow?.nodes ?? [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  if (!isRecord(node) || !Array.isArray(node.components)) return [];
  return node.components
    .filter((candidate) => isRecord(candidate) && isRecord(candidate.saveContract))
    .filter((candidate) => {
      const contract = candidate.saveContract as Record<string, unknown>;
      const fields = contract.effectiveWritableFields ?? contract.writableFields;
      return Array.isArray(fields) && fields.some((field) => typeof field === "string" && field.trim() !== "");
    })
    .map((candidate) => String(candidate.key));
}

export async function runHappyResourceNodeSession(input: {
  client: PmsClient;
  resourceType: "project" | "topic";
  resourceId: number;
  node: WritableNodeFixture;
  marker: string;
  runId: string;
}): Promise<{
  conversationId: number;
  prepared: OrchestratorPlan;
  preview: OrchestratorPlan;
  confirmed: OrchestratorPlan;
  session: OrchestratorSession;
}> {
  const draft = resourceNodeDraft(input.resourceType, input.resourceId, input.node, input.marker);
  const conversation = await createResourceOrchestratorConversation(
    input.client, input.resourceType, input.resourceId,
  );
  const prepared = await appendResourceOrchestratorTurn(input.client, {
    conversationId: conversation.conversationId,
    message: `读取${input.resourceType}当前节点并准备保存节点详情`,
    draft,
    nodeId: input.node.nodeId,
    nodeVersion: input.node.nodeVersion,
    componentKey: input.node.componentKey,
    contextVersion: input.node.contextVersion,
    requestId: `${input.runId}-turn`,
  });
  const preview = await previewResourceOrchestratorPlan(
    input.client, prepared.planId, `${input.runId}-preview`,
  );
  const confirmed = await confirmResourceOrchestratorPlan(
    input.client, prepared.planId, `${input.runId}-save`, `${input.runId}-confirm`,
  );
  const session = await readResourceOrchestratorSession(
    input.client, conversation.conversationId, 0,
  );
  return {
    conversationId: conversation.conversationId,
    prepared,
    preview,
    confirmed,
    session,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
