import type {
  OrchestratorConversation,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorSession,
  PmsClient,
} from "../../../../../packages/pms-client/src/index.js";
import type { AnalysisDraft } from "../../../../../packages/pms-contracts/src/index.js";

export async function createStoryNodeConversation(
  client: PmsClient,
  storyId: number,
): Promise<OrchestratorConversation> {
  return client.createConversation({ resourceType: "story", resourceId: storyId });
}

export function appendStoryNodeTurn(
  client: PmsClient,
  input: {
    conversationId: number;
    message: string;
    draft: AnalysisDraft;
    nodeId: number;
    contextVersion: number;
    requestId?: string;
  },
): Promise<OrchestratorPlan> {
  return client.appendTurn({
    conversationId: input.conversationId,
    message: input.message,
    contractVersion: "story-workbench/v1",
    draft: { contractVersion: "story-workbench/v1", draft: input.draft },
    nodeId: input.nodeId,
    contextVersion: input.contextVersion,
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  });
}

export function previewStoryNodePlan(client: PmsClient, planId: number, requestId?: string) {
  return client.previewPlan(planId, requestId);
}

export function confirmStoryNodePlan(
  client: PmsClient,
  planId: number,
  idempotencyKey: string,
  requestId?: string,
) {
  return client.confirmPlan({ planId, idempotencyKey, requestId });
}

export function readStoryNodeEvents(
  client: PmsClient,
  conversationId: number,
  afterSequence = 0,
): Promise<OrchestratorEvent[]> {
  return client.listConversationEvents(conversationId, afterSequence);
}

export function readStoryNodeSession(
  client: PmsClient,
  conversationId: number,
  afterSequence = 0,
): Promise<OrchestratorSession> {
  return client.getOrchestratorSession(conversationId, afterSequence);
}
