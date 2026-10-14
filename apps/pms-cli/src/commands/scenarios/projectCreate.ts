import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type {
  ActionCapability,
  CapabilityCatalog,
  OperationPreview,
  OperationResult,
  ResourceDetail,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import { operationPreview, type OperationOptions } from "../core/operation.js";
import { createProjectWithReadback, type ProjectCreateReadback } from "../shortcuts/project.js";

export interface ProjectCreateScenarioOptions extends OperationOptions {
  idempotencyKey?: string;
}

export interface ScenarioTrace {
  requestId?: string;
  operationId?: string;
  idempotencyKey?: string;
  auditId?: string;
}

export interface ProjectCreateScenarioPlan {
  scenario: "project-create";
  phase: "plan";
  arguments: Record<string, unknown>;
  capabilitiesSummary: {
    action: ActionCapability;
    workflowTypes: CapabilityCatalog["workflowTypes"];
  };
  preview: OperationPreview;
  trace: ScenarioTrace;
}

export interface ProjectCreateScenarioResult {
  scenario: "project-create";
  phase: "execute";
  arguments: Record<string, unknown>;
  preview: OperationPreview;
  result: OperationResult;
  readback: {
    resource: ResourceDetail | null;
    context: WorkflowContext | null;
  };
  warnings: string[];
  trace: ScenarioTrace;
}

export async function planProjectCreateScenario(
  client: PmsClient,
  options: ProjectCreateScenarioOptions,
): Promise<ProjectCreateScenarioPlan> {
  const resolver = new CapabilityResolver(client);
  const catalog = await resolver.list();
  const action = await resolver.action("project.create");
  const argumentsValue = options.arguments ?? {};
  // The PMS preview contract always requires a context. Project creation is
  // global (it has no existing project/node context), so mirror the backend's
  // execution fallback explicitly during planning as well.
  const preview = await operationPreview(client, "project.create", {
    ...options,
    context: options.context ?? { id: "global:pms", version: "v1" },
  });
  return {
    scenario: "project-create",
    phase: "plan",
    arguments: argumentsValue,
    capabilitiesSummary: { action, workflowTypes: catalog.workflowTypes },
    preview,
    trace: { requestId: options.requestId },
  };
}

export async function executeProjectCreateScenario(
  client: PmsClient,
  options: ProjectCreateScenarioOptions & { idempotencyKey: string },
): Promise<ProjectCreateScenarioResult> {
  const readback: ProjectCreateReadback = await createProjectWithReadback(client, options);
  return {
    scenario: "project-create",
    phase: "execute",
    arguments: options.arguments ?? {},
    preview: readback.preview,
    result: readback.result,
    readback: { resource: readback.resource, context: readback.context },
    warnings: readback.warnings,
    trace: {
      requestId: options.requestId,
      operationId: readback.result.operationId,
      idempotencyKey: options.idempotencyKey,
      ...(readback.result.auditId ? { auditId: readback.result.auditId } : {}),
    },
  };
}
