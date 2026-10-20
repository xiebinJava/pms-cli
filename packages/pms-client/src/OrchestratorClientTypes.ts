import type {
  AnalysisDraft,
  OrchestratorConversation,
  OrchestratorDraft,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorResourceType,
  OrchestratorSession,
  ResourceNodeDraft,
} from "../../pms-contracts/src/index.js";

export type {
  OrchestratorConversation,
  OrchestratorDraft,
  OrchestratorEvent,
  OrchestratorPlan,
  OrchestratorResourceType,
  OrchestratorSession,
  ResourceNodeDraft,
};

export type OrchestratorContractVersion = "requirement-analysis/v1" | "story-workbench/v1" | "resource-node/v1";

export interface CreateConversationRequest {
  resourceType: OrchestratorResourceType;
  resourceId: number;
}

export interface AppendTurnRequest {
  conversationId: number;
  message: string;
  contractVersion: OrchestratorContractVersion;
  draft: OrchestratorDraft | {
    contractVersion: OrchestratorContractVersion;
    draft: AnalysisDraft | ResourceNodeDraft;
  };
  nodeId?: number;
  nodeVersion?: number;
  componentKey?: string;
  contextVersion?: number;
  requestId?: string;
}

export interface ConfirmPlanRequest {
  planId: number;
  idempotencyKey: string;
  requestId?: string;
}
