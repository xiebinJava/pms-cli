import type {
  AnalysisDraft,
  OrchestratorConversation,
  OrchestratorDraft,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorSession,
} from "../../pms-contracts/src/index.js";

export type { OrchestratorConversation, OrchestratorDraft, OrchestratorEvent, OrchestratorPlan, OrchestratorSession };

export interface CreateConversationRequest {
  resourceType: "requirement" | "story";
  resourceId: number;
}

export interface AppendTurnRequest {
  conversationId: number;
  message: string;
  contractVersion: "requirement-analysis/v1" | "story-workbench/v1";
  draft: OrchestratorDraft | { contractVersion: "requirement-analysis/v1" | "story-workbench/v1"; draft: AnalysisDraft };
  nodeId?: number;
  contextVersion?: number;
  requestId?: string;
}

export interface ConfirmPlanRequest {
  planId: number;
  idempotencyKey: string;
  requestId?: string;
}
