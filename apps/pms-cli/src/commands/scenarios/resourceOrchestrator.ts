import type {
  OrchestratorConversation,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorSession,
  PmsClient,
} from "../../../../../packages/pms-client/src/index.js";
import type { ResourceNodeDraft } from "../../../../../packages/pms-contracts/src/index.js";

export type ResourceOrchestratorResourceType = "project" | "topic";

export function createResourceOrchestratorConversation(
  client: PmsClient,
  resourceType: ResourceOrchestratorResourceType,
  resourceId: number,
): Promise<OrchestratorConversation> {
  return client.createConversation({ resourceType, resourceId });
}

export function appendResourceOrchestratorTurn(
  client: PmsClient,
  input: {
    conversationId: number;
    message: string;
    draft: ResourceNodeDraft;
    nodeId: number;
    nodeVersion?: number;
    componentKey?: string;
    contextVersion?: number;
    requestId?: string;
  },
): Promise<OrchestratorPlan> {
  return client.appendTurn({
    conversationId: input.conversationId,
    message: input.message,
    contractVersion: "resource-node/v1",
    draft: { contractVersion: "resource-node/v1", draft: input.draft },
    nodeId: input.nodeId,
    ...(input.nodeVersion === undefined ? {} : { nodeVersion: input.nodeVersion }),
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    ...(input.contextVersion === undefined ? {} : { contextVersion: input.contextVersion }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  });
}

export function previewResourceOrchestratorPlan(client: PmsClient, planId: number, requestId?: string) {
  return client.previewPlan(planId, requestId);
}

export function confirmResourceOrchestratorPlan(
  client: PmsClient,
  planId: number,
  idempotencyKey: string,
  requestId?: string,
) {
  return client.confirmPlan({ planId, idempotencyKey, requestId });
}

export function readResourceOrchestratorEvents(
  client: PmsClient,
  conversationId: number,
  afterSequence = 0,
): Promise<OrchestratorEvent[]> {
  return client.listConversationEvents(conversationId, afterSequence);
}

export function readResourceOrchestratorSession(
  client: PmsClient,
  conversationId: number,
  afterSequence = 0,
): Promise<OrchestratorSession> {
  return client.getOrchestratorSession(conversationId, afterSequence);
}
