import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { OperationPreview, OperationResult, ResourceDetail, WorkflowContext } from "../../../../../packages/pms-contracts/src/index.js";
import { getResourceById, listResource, writeResource, type ListOptions, type WriteOptions } from "./resourceCommands.js";
import { operationExecute, operationExecutePreview, operationPreview } from "../core/operation.js";

export const projectList = (client: PmsClient, options: ListOptions = {}) => listResource(client, "project", options);
export const projectGet = (client: PmsClient, id: number) => getResourceById(client, "project", id);
export const projectCreate = (client: PmsClient, options: WriteOptions = {}) => writeResource(client, "project.create", options);
export const projectUpdate = (client: PmsClient, options: WriteOptions = {}) => writeResource(client, "project.update", options);

export interface ProjectCreateReadback {
  preview: OperationPreview | null;
  previewOperationId: string;
  result: OperationResult;
  resource: ResourceDetail | null;
  context: WorkflowContext | null;
  warnings: string[];
}

export async function createProjectWithReadback(
  client: PmsClient,
  options: WriteOptions & { idempotencyKey: string; previewOperationId: string },
): Promise<ProjectCreateReadback> {
  if (!options.previewOperationId?.trim()) throw new Error("项目创建必须提供 preview-operation-id");
  const result = await operationExecutePreview(client, options.previewOperationId, options.idempotencyKey);
  const warnings: string[] = [];
  const projectId = readProjectId(result);
  if (result.status !== "SUCCEEDED" || projectId === null) {
    return { preview: null, previewOperationId: options.previewOperationId, result, resource: null, context: null, warnings };
  }

  let resource: ResourceDetail | null = null;
  let context: WorkflowContext | null = null;
  try {
    resource = await client.get({ type: "project", id: projectId });
    context = await client.context({ type: "project", id: projectId });
  } catch (error) {
    const warning = "项目已创建，但结果回读失败：" + (error instanceof Error ? error.message : String(error));
    warnings.push(warning);
    return {
      preview: null,
      previewOperationId: options.previewOperationId,
      result: { ...result, status: "WRITE_RESULT_UNKNOWN", warnings: [...result.warnings, warning] },
      resource,
      context,
      warnings,
    };
  }
  return { preview: null, previewOperationId: options.previewOperationId, result, resource, context, warnings };
}

/**
 * Compatibility helper for fixture/bootstrap code that must exercise the
 * legacy automatic endpoint. Agent-facing CLI commands must use
 * createProjectWithReadback with a persisted previewOperationId.
 */
export async function createProjectWithAutomaticWrite(
  client: PmsClient,
  options: WriteOptions & { idempotencyKey: string },
): Promise<ProjectCreateReadback> {
  const preview = await operationPreview(client, "project.create", {
    ...options,
    context: options.context ?? { id: "global:pms", version: "v1" },
  });
  const result = await operationExecute(client, "project.create", options.idempotencyKey, options);
  const warnings = [...preview.warnings];
  const projectId = readProjectId(result);
  if (result.status !== "SUCCEEDED" || projectId === null) {
    return { preview, previewOperationId: preview.operationId, result, resource: null, context: null, warnings };
  }
  let resource: ResourceDetail | null = null;
  let context: WorkflowContext | null = null;
  try {
    resource = await client.get({ type: "project", id: projectId });
    context = await client.context({ type: "project", id: projectId });
  } catch (error) {
    const warning = "项目已创建，但结果回读失败：" + (error instanceof Error ? error.message : String(error));
    warnings.push(warning);
    return {
      preview,
      previewOperationId: preview.operationId,
      result: { ...result, status: "WRITE_RESULT_UNKNOWN", warnings: [...result.warnings, warning] },
      resource,
      context,
      warnings,
    };
  }
  return { preview, previewOperationId: preview.operationId, result, resource, context, warnings };
}

function readProjectId(result: OperationResult): number | null {
  const project = result.data.project;
  const rawId = project && typeof project === "object" && !Array.isArray(project)
    ? (project as Record<string, unknown>).id
    : result.data.projectId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
