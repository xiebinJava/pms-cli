import { z } from "zod";

import {
  orchestratorConversationSchema,
  orchestratorEventSchema,
  orchestratorPlanSchema,
  type OrchestratorConversation,
  type OrchestratorEvent,
  type OrchestratorPlan,
} from "../../pms-contracts/src/index.js";
import type { PmsHttpClient } from "./PmsClient.js";
import type {
  AppendTurnRequest,
  ConfirmPlanRequest,
  CreateConversationRequest,
} from "./OrchestratorClientTypes.js";

export type OrchestratorClient = Pick<PmsHttpClient,
  "createConversation" | "appendTurn" | "previewPlan" | "confirmPlan" | "getConversation" | "listConversationEvents">;

export function parseOrchestratorConversation(data: unknown): OrchestratorConversation {
  return orchestratorConversationSchema.parse(data);
}

export function parseOrchestratorPlan(data: unknown): OrchestratorPlan {
  return orchestratorPlanSchema.parse(data);
}

export function parseOrchestratorEvents(data: unknown): OrchestratorEvent[] {
  return z.array(orchestratorEventSchema).parse(data);
}

export type {
  AppendTurnRequest,
  ConfirmPlanRequest,
  CreateConversationRequest,
};
