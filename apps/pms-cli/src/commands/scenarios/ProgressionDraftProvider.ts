import type {
  AgentProgressionShadowDraft,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";

export interface ProgressionDraftProviderInput {
  userMessage: string;
  resourceType: "project" | "requirement" | "topic" | "story";
  context: WorkflowContext;
}

/** A shadow provider may propose structure, but it has no PMS write capability. */
export interface ProgressionDraftProvider {
  generate(input: ProgressionDraftProviderInput): Promise<AgentProgressionShadowDraft>;
}

export class FixedProgressionDraftProvider implements ProgressionDraftProvider {
  public constructor(private readonly draft: AgentProgressionShadowDraft) {}

  public async generate(_input: ProgressionDraftProviderInput): Promise<AgentProgressionShadowDraft> {
    return JSON.parse(JSON.stringify(this.draft)) as AgentProgressionShadowDraft;
  }
}
