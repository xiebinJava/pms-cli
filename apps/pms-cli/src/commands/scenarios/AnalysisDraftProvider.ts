import type { AnalysisDraft, WorkflowContext } from "../../../../../packages/pms-contracts/src/index.js";

export interface AnalysisDraftProviderInput {
  userMessage: string;
  context: WorkflowContext;
}

/**
 * Generates a structured draft only. A provider never previews or writes to PMS.
 * The caller remains responsible for context validation and user approval.
 */
export interface AnalysisDraftProvider {
  generate(input: AnalysisDraftProviderInput): Promise<AnalysisDraft>;
}

export class FixedAnalysisDraftProvider implements AnalysisDraftProvider {
  public constructor(private readonly draft: AnalysisDraft) {}

  public async generate(_input: AnalysisDraftProviderInput): Promise<AnalysisDraft> {
    return cloneDraft(this.draft);
  }
}

function cloneDraft(draft: AnalysisDraft): AnalysisDraft {
  return JSON.parse(JSON.stringify(draft)) as AnalysisDraft;
}
