import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type {
  ActionCapability,
  CapabilityCatalog,
  OperationPreview,
  OperationResult,
  ResourceDetail,
  ResourceScenarioResult,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  resourceScenarioContractVersion,
  resourceScenarioResultSchema,
} from "../../../../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import { operationPreview, type OperationOptions } from "../core/operation.js";
import { createProjectWithReadback, type ProjectCreateReadback } from "../shortcuts/project.js";
import { buildUserFacingDisplay } from "../../output/userFacing.js";

export interface ProjectCreateScenarioOptions extends OperationOptions {
  idempotencyKey?: string;
  previewOperationId?: string;
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
  userFacing?: ReturnType<typeof buildUserFacingDisplay>;
}

export interface ProjectCreateScenarioResult {
  scenario: "project-create";
  phase: "execute";
  arguments: Record<string, unknown>;
  preview: OperationPreview | null;
  previewOperationId: string;
  result: OperationResult;
  readback: {
    resource: ResourceDetail | null;
    context: WorkflowContext | null;
  };
  warnings: string[];
  trace: ScenarioTrace;
  userFacing?: ReturnType<typeof buildUserFacingDisplay>;
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
    userFacing: buildUserFacingDisplay({
      resourceType: "project",
      resourceDetails: { name: typeof argumentsValue.name === "string" ? argumentsValue.name : undefined },
      operationStatus: "PREVIEWED",
      actualChange: "已生成待执行预览",
    }),
  };
}

export async function executeProjectCreateScenario(
  client: PmsClient,
  options: ProjectCreateScenarioOptions & { idempotencyKey: string; previewOperationId: string },
): Promise<ProjectCreateScenarioResult> {
  const readback: ProjectCreateReadback = await createProjectWithReadback(client, options);
  return {
    scenario: "project-create",
    phase: "execute",
    arguments: options.arguments ?? {},
    preview: readback.preview,
    previewOperationId: readback.previewOperationId,
    result: readback.result,
    readback: { resource: readback.resource, context: readback.context },
    warnings: readback.warnings,
    userFacing: buildUserFacingDisplay({
      resourceType: "project",
      context: readback.context,
      resourceDetails: readback.resource?.details ?? { name: options.arguments?.name },
      operationStatus: readback.result.status,
      actualChange: readback.result.status === "SUCCEEDED"
        && readback.resource !== null && readback.context !== null
        ? "项目已创建并通过回读验证"
        : "项目创建未完成",
      blockers: readback.warnings,
    }),
    trace: {
      requestId: options.requestId,
      operationId: readback.result.operationId,
      idempotencyKey: options.idempotencyKey,
      ...(readback.result.auditId ? { auditId: readback.result.auditId } : {}),
    },
  };
}

/**
 * Maps the legacy project-create scenario result to the resource-scenario
 * envelope. The old route remains compatible, while callers can migrate to
 * one result shape without re-running the write.
 */
export function toResourceScenarioResult(result: ProjectCreateScenarioResult): ResourceScenarioResult {
  const resourceId = result.readback.resource?.resourceId ?? readProjectId(result.result);
  const resourceReadback = result.readback.resource?.resourceId === resourceId;
  const contextReadback = result.readback.context?.resource.type === "project"
    && result.readback.context.resource.id === resourceId;
  const status = result.result.status === "SUCCEEDED" && resourceReadback && contextReadback
    ? "SUCCEEDED"
    : result.result.status;
  return resourceScenarioResultSchema.parse({
    scenario: "resource-scenario",
    phase: "execute",
    contractVersion: resourceScenarioContractVersion,
    resourceType: "project",
    resourceId,
    operation: result.result,
    previewOperationId: result.previewOperationId,
    readback: {
      resource: result.readback.resource,
      context: result.readback.context,
    },
    verification: {
      resourceReadback,
      contextReadback,
      patchApplied: status === "SUCCEEDED",
      protectedFieldsUnchanged: true,
    },
    status,
    warnings: [...result.warnings, ...result.result.warnings],
    refreshScopes: result.result.refreshScopes,
    userFacing: result.userFacing,
  });
}

function readProjectId(result: OperationResult): number | null {
  const project = result.data.project;
  const rawId = project && typeof project === "object" && !Array.isArray(project)
    ? (project as Record<string, unknown>).id
    : result.data.projectId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
