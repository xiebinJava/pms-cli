import type { CapabilityCatalog, OperationResult } from "../../../packages/pms-contracts/src/index.js";
import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import { operationExecutePreview, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";
import { resolveWorkflowComponent } from "../../../apps/pms-cli/src/commands/core/componentResolver.js";

export interface WritableNodeFixture {
  nodeId: number;
  nodeVersion: number;
  contextVersion: number;
  componentKey: string;
  fieldKey: string;
  fieldValue: unknown;
  requiredFieldValues: Record<string, unknown>;
  ownerId: number;
  completionSupported: boolean;
  completionMode: string | null;
  completionRequiredMetadata: string[];
}

export interface ProjectFixture {
  projectId: number;
  name: string;
  created: true;
  node?: WritableNodeFixture;
}

/**
 * Creates a project in the disposable E2E database using the registered
 * project.create command. There is no implicit cleanup here: the fixture is
 * intentionally scoped to the disposable database teardown.
 */
export async function createProjectFixture(
  client: PmsClient,
  runId: string,
): Promise<ProjectFixture> {
  const capabilities = await client.capabilities();
  const selected = selectProjectTemplate(capabilities);
  const name = `AI-E2E-项目-${runId}`;
  const preview = await operationPreview(client, "project.create", {
    arguments: {
      name,
      projectTypeId: selected.projectTypeId,
      workflowTemplateVersionId: selected.templateVersionId,
    },
    context: { id: "global:pms", version: "v1" },
  });
  const result = await operationExecutePreview(client, preview.operationId, `project-fixture-${runId}`);
  if (result.status !== "SUCCEEDED") throw new Error("项目夹具创建未成功");
  const projectId = readProjectId(result);
  if (projectId === null) throw new Error("项目夹具创建成功响应缺少项目 ID");
  const readback = await client.get({ type: "project", id: projectId });
  if (readback.resourceId !== projectId) throw new Error("项目夹具回读资源 ID 不一致");
  const ownerId = capabilities.viewer?.id;
  if (!ownerId) throw new Error("项目夹具能力目录缺少当前用户 ID，无法完成节点验收");
  const node = await findWritableNode(client, projectId, ownerId);
  return { projectId, name, created: true, node };
}

async function findWritableNode(client: PmsClient, projectId: number, ownerId: number): Promise<WritableNodeFixture | undefined> {
  const legacy = await client.context({ type: "project", id: projectId });
  const nodeId = positiveNodeId(legacy.currentNode?.id, "项目夹具创建后没有当前节点，无法进行节点场景验收");
  const focused = await client.context(
    { type: "project", id: projectId },
    { nodeId, view: "focused" },
  );
  const node = (focused.workflow?.nodes ?? []).find((candidate) => isRecord(candidate)
    && candidate.id === nodeId);
  if (!isRecord(node)) throw new Error(`项目夹具当前节点 ${nodeId} 无法读取 focused 上下文`);
  // The initial project node is backed by the entity-level project-basic-info
  // component. Its writes go through project.update, so it intentionally has
  // no node-level saveContract until the workflow advances.
  if (!Array.isArray(node.components) || node.components.length === 0
    || node.components.some((component) => isRecord(component) && component.key === "project-basic-info")) {
    return undefined;
  }
  let resolution;
  try {
    resolution = resolveWorkflowComponent(node as any, { mode: "write" });
  } catch (error) {
    throw new Error(`项目夹具当前节点 ${nodeId} 没有唯一可写组件：${error instanceof Error ? error.message : String(error)}`);
  }
  const contract = isRecord(resolution.saveContract) ? resolution.saveContract : undefined;
  const fieldKey = resolution.writableFields.find((field) => !stringArray(contract?.protectedFields).includes(field));
  if (!fieldKey || !resolution.componentKey) {
    throw new Error(`项目夹具当前节点 ${nodeId} 没有不受保护的可写字段`);
  }
  return {
    nodeId,
    nodeVersion: readInteger(contract?.nodeVersion ?? node.version, `项目节点 ${nodeId} 缺少节点版本`),
    contextVersion: readInteger(focused.entityVersion ?? focused.version, `项目 ${projectId} 缺少实体版本`),
    componentKey: resolution.componentKey,
    fieldKey,
    fieldValue: fixtureValue(contract?.fieldContracts, fieldKey),
    requiredFieldValues: requiredFieldValues(contract?.fieldContracts, resolution.writableFields),
    ownerId,
    completionSupported: contract?.completionSupported === true
      && contract?.completionCommand === "node.complete-with-data",
    completionMode: typeof contract?.completionMode === "string" ? contract.completionMode : null,
    completionRequiredMetadata: stringArray(contract?.completionRequiredMetadata),
  };
}

function requiredFieldValues(rawContracts: unknown, writableFields: string[]): Record<string, unknown> {
  const contracts = Array.isArray(rawContracts) ? rawContracts : [];
  const writable = new Set(writableFields);
  return Object.fromEntries(contracts
    .filter((candidate) => isRecord(candidate)
      && candidate.required === true
      && typeof candidate.key === "string"
      && writable.has(candidate.key))
    .map((candidate) => [candidate.key as string, fixtureValue(contracts, candidate.key as string)]));
}

function fixtureValue(rawContracts: unknown, fieldKey: string): unknown {
  const contracts = Array.isArray(rawContracts) ? rawContracts : [];
  const contract = contracts.find((candidate) => isRecord(candidate) && candidate.key === fieldKey);
  if (!isRecord(contract)) return `AI-E2E-${fieldKey}`;
  const options = Array.isArray(contract.options) ? contract.options : [];
  if (options.length > 0) return options[0];
  const type = typeof contract.type === "string" ? contract.type.toLowerCase() : "string";
  if (type === "boolean") return true;
  if (type === "number" || type === "integer") return 1;
  if (type === "array") return [`AI-E2E-${fieldKey}`];
  if (type.includes("date")) return "2026-10-10";
  return `AI-E2E-${fieldKey}`;
}

function readInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}

function positiveNodeId(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function selectProjectTemplate(catalog: CapabilityCatalog): { projectTypeId: number; templateVersionId: number } {
  const type = catalog.workflowTypes.find((candidate) =>
    candidate.templates.some((template) => template.defaultTemplate && template.templateVersionId),
  ) ?? catalog.workflowTypes.find((candidate) =>
    candidate.templates.some((template) => template.templateVersionId),
  );
  const template = type?.templates.find((candidate) => candidate.defaultTemplate && candidate.templateVersionId)
    ?? type?.templates.find((candidate) => candidate.templateVersionId);
  if (!type?.projectTypeId || !template?.templateVersionId) {
    throw new Error("项目夹具能力目录缺少可用项目类型和流程模板");
  }
  return { projectTypeId: type.projectTypeId, templateVersionId: template.templateVersionId };
}

function readProjectId(result: OperationResult): number | null {
  const project = result.data.project;
  const rawId = project && typeof project === "object" && !Array.isArray(project)
    ? (project as Record<string, unknown>).id
    : result.data.projectId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
