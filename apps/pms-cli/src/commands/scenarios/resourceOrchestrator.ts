import type {
  OrchestratorConversation,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorSession,
  PmsClient,
} from "../../../../../packages/pms-client/src/index.js";
import type { ResourceNodeDraft } from "../../../../../packages/pms-contracts/src/index.js";

export type ResourceOrchestratorResourceType = "project" | "topic";

export type ResourceOrchestratorNextAction =
  | "READ_CONTEXT"
  | "PROVIDE_INPUT"
  | "PREVIEW"
  | "CONFIRM"
  | "RETRY_SAME_IDEMPOTENCY"
  | "READ_RESULT"
  | "NO_ACTION";

export interface ResourceOrchestratorSessionResume extends OrchestratorSession {
  nextAction: ResourceOrchestratorNextAction;
}

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

/**
 * Read-only recovery projection for an external Agent. It deliberately uses
 * the existing session endpoint and never creates a turn, preview, execute
 * operation, or idempotency key.
 */
export async function resumeResourceOrchestratorSession(
  client: PmsClient,
  conversationId: number,
  afterSequence = 0,
): Promise<ResourceOrchestratorSessionResume> {
  const session = await client.getOrchestratorSession(conversationId, afterSequence);
  return { ...session, nextAction: deriveResourceOrchestratorNextAction(session) };
}

export function deriveResourceOrchestratorNextAction(
  session: OrchestratorSession,
): ResourceOrchestratorNextAction {
  const plan = session.latestPlan;
  const status = plan?.status ?? session.conversation.status;
  if (!plan) return status === "SUCCEEDED" ? "NO_ACTION" : "READ_CONTEXT";
  if (status === "NEEDS_INPUT") return "PROVIDE_INPUT";
  if (status === "WAITING_CONFIRMATION") return "CONFIRM";
  if (status === "WRITE_RESULT_UNKNOWN") return "RETRY_SAME_IDEMPOTENCY";
  if (status === "SUCCEEDED" || status === "CANCELLED") return "NO_ACTION";
  if (status === "DRAFT_VALIDATED" || status === "PLAN_READY") return "PREVIEW";
  if (status === "PREVIEWED") return plan.preview ? "CONFIRM" : "PREVIEW";
  if (status === "EXECUTING" || status === "VERIFYING") return "READ_RESULT";
  if (status === "CONFLICT" || status === "FAILED") return "READ_CONTEXT";
  return "READ_CONTEXT";
}
