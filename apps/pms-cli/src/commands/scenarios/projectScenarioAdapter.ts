import type {
  ActionCapability,
  ResourceDetail,
  ResourceScenarioContext,
  ParsedResourceScenarioInput,
  ResourceScenarioSnapshot,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  resourceScenarioRegistry,
  ResourceScenarioError,
  type ResourceScenarioAdapter,
} from "./resourceScenarioRegistry.js";

const PROJECT_OPERATIONS = new Set([
  "project.create",
  "project.update",
  "node.field.update",
  "node.complete-with-data",
]);

type SaveContract = {
  command: string;
  projectId: number;
  nodeId: number;
  nodeVersion: number;
  workbench: string;
  writableFields: string[];
  protectedFields: string[];
  dynamicFields: boolean;
  completionSupported: boolean;
  completionCommand?: string;
  completionRequiredMetadata: string[];
  completionMode?: string;
  completionAutomaticConfirmation?: boolean;
  completionBlockReason?: string;
};

export const projectScenarioAdapter: ResourceScenarioAdapter = {
  resourceType: "project",

  supports(operation) {
    return PROJECT_OPERATIONS.has(operation);
  },

  async loadContext(client, input) {
    if (input.operation === "project.create") return null;
    const projectId = requireProjectId(input);
    const focused = input.operation === "node.field.update" || input.operation === "node.complete-with-data";
    const context = await client.context(
      { type: "project", id: projectId },
      focused ? { nodeId: requireNodeId(input), view: "focused" } : undefined,
    );
    return {
      id: `project:${projectId}`,
      version: String(context.entityVersion ?? context.version ?? "unknown"),
      entityVersion: context.entityVersion ?? context.version ?? null,
      selectedNodeId: context.meta?.selectedNodeId ?? context.currentNode?.id ?? null,
      snapshot: context,
    };
  },

  async normalizeArguments(input, context) {
    if (input.operation === "project.create") return { ...input.arguments };
    const projectId = requireProjectId(input);
    if (input.operation === "project.update") {
      return { ...input.arguments, projectId };
    }

    const project = readProjectContext(context);
    if (!project) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "项目上下文不存在");
    const nodeId = requireNodeId(input);
    const saveContract = readSaveContract(project, nodeId, input.arguments.workbench, readPatch(input));
    const normalized: Record<string, unknown> = {
      projectId: saveContract.projectId,
      nodeId: saveContract.nodeId,
      workbench: saveContract.workbench,
      fields: readPatch(input),
    };
    if (input.operation === "node.complete-with-data") {
      if (!saveContract.completionSupported || saveContract.completionCommand !== input.operation) {
        throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "项目节点未声明原子完成能力");
      }
      for (const key of ["ownerId", "startDate", "endDate"] as const) {
        if (Object.prototype.hasOwnProperty.call(input.arguments, key)) normalized[key] = input.arguments[key];
      }
    }
    return normalized;
  },

  validate(input, context, normalizedArguments, capability) {
    validateDeclaredArguments(normalizedArguments, capability);
    if (input.operation === "project.create") {
      if (input.resourceId !== undefined) {
        throw new ResourceScenarioError("CONTEXT_CONFLICT", "项目创建不能携带已有 resourceId");
      }
      return;
    }

    const project = readProjectContext(context);
    if (!project) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "项目上下文不存在");
    const projectId = requireProjectId(input);
    if (project.resource.type !== "project" || project.resource.id !== projectId) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "项目上下文与请求资源不一致");
    }
    if (input.contextVersion !== undefined
      && String(project.entityVersion ?? project.version) !== String(input.contextVersion)) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "项目上下文版本与请求版本不一致");
    }
    if (input.operation === "project.update") {
      if (normalizedArguments.projectId !== projectId) {
        throw new ResourceScenarioError("CONTEXT_CONFLICT", "写入参数中的项目 ID 与资源 ID 不一致");
      }
      return;
    }

    const nodeId = requireNodeId(input);
    const fieldsForContract = isRecord(normalizedArguments.fields) ? normalizedArguments.fields : {};
    const saveContract = readSaveContract(project, nodeId, normalizedArguments.workbench, fieldsForContract);
    if (normalizedArguments.projectId !== saveContract.projectId
      || normalizedArguments.nodeId !== saveContract.nodeId
      || normalizedArguments.workbench !== saveContract.workbench) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "项目节点参数与 saveContract 不一致");
    }
    if (input.operation === "node.complete-with-data"
      && (!saveContract.completionSupported || saveContract.completionCommand !== input.operation)) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "项目节点未声明原子完成能力");
    }
    validateNodeFields(saveContract, normalizedArguments.fields);
  },

  resolveReadbackId(input, operation) {
    if (input.resourceId !== undefined) return input.resourceId;
    const project = operation.data.project;
    const projectId = isRecord(project) ? project.id : operation.data.projectId;
    return isPositiveInteger(projectId) ? projectId : null;
  },

  verifyReadback(before, after, _normalizedArguments, operation) {
    const expectedId = operation.data.projectId
      ?? (isRecord(operation.data.project) ? operation.data.project.id : undefined)
      ?? before?.resource?.resourceId
      ?? before?.context?.resource.id;
    const resourceReadback = after.resource?.resourceType === "project"
      && (expectedId === undefined || after.resource.resourceId === Number(expectedId));
    const contextReadback = after.context?.resource.type === "project"
      && (expectedId === undefined || after.context.resource.id === Number(expectedId));
    const workflowStable = workflowDidNotDrift(before?.context, after.context);
    const protectedFieldsUnchanged = compareProtectedFields(before?.resource, after.resource);
    return {
      resourceReadback,
      contextReadback,
      patchApplied: resourceReadback && contextReadback && workflowStable
        && operation.status === "SUCCEEDED",
      protectedFieldsUnchanged,
    };
  },
};

resourceScenarioRegistry.register(projectScenarioAdapter);

function requireProjectId(input: ParsedResourceScenarioInput): number {
  const value = input.resourceId ?? input.arguments.projectId;
  if (!isPositiveInteger(value)) {
    throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "项目场景必须提供 resourceId 或 projectId");
  }
  return value;
}

function requireNodeId(input: ParsedResourceScenarioInput): number {
  if (!isPositiveInteger(input.nodeId ?? input.arguments.nodeId)) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "项目节点场景必须提供 nodeId");
  }
  return input.nodeId ?? Number(input.arguments.nodeId);
}

function readProjectContext(context: ResourceScenarioContext | null): WorkflowContext | null {
  if (!context || !isRecord(context.snapshot)) return null;
  return context.snapshot as WorkflowContext;
}

function readPatch(input: ParsedResourceScenarioInput): Record<string, unknown> {
  if (input.draft) return input.draft.patch;
  if (isRecord(input.arguments.fields)) return input.arguments.fields;
  if (isRecord(input.arguments.patch)) return input.arguments.patch;
  return {};
}

function readSaveContract(
  context: WorkflowContext,
  nodeId: number,
  requestedWorkbench: unknown,
  patch: Record<string, unknown> = {},
): SaveContract {
  const node = readNode(context, nodeId);
  const components = node?.components;
  const candidates = (Array.isArray(components) ? components : []).filter((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.saveContract)) return false;
    return requestedWorkbench === undefined || candidate.saveContract.workbench === requestedWorkbench;
  });
  const matching = requestedWorkbench === undefined && Object.keys(patch).length > 0
    ? candidates.filter((candidate) => {
      const contract = candidate.saveContract;
      if (contract.dynamicFields === true) return true;
      return isStringArray(contract.writableFields)
        && Object.keys(patch).every((field) => contract.writableFields.includes(field));
    })
    : candidates;
  const raw = matching.length === 1 && isRecord(matching[0]) ? matching[0].saveContract : null;
  if (!isRecord(raw)) {
    throw new ResourceScenarioError(
      "CAPABILITY_UNAVAILABLE",
      candidates.length > 1 && Object.keys(patch).length === 0
        ? "项目节点存在多个可写 saveContract，请指定 workbench"
        : "项目节点没有可用的 saveContract",
    );
  }
  if (raw.command !== "node.field.update" || !isPositiveInteger(raw.projectId)
    || !isPositiveInteger(raw.nodeId) || !isNonNegativeInteger(raw.nodeVersion)
    || typeof raw.workbench !== "string" || !isStringArray(raw.writableFields)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "项目节点 saveContract 不完整");
  }
  return {
    command: raw.command,
    projectId: raw.projectId,
    nodeId: raw.nodeId,
    nodeVersion: raw.nodeVersion,
    workbench: raw.workbench,
    writableFields: raw.writableFields,
    protectedFields: isStringArray(raw.protectedFields) ? raw.protectedFields : [],
    dynamicFields: raw.dynamicFields === true,
    completionSupported: raw.completionSupported === true,
    ...(typeof raw.completionCommand === "string" ? { completionCommand: raw.completionCommand } : {}),
    completionRequiredMetadata: isStringArray(raw.completionRequiredMetadata)
      ? raw.completionRequiredMetadata : [],
    ...(typeof raw.completionMode === "string" ? { completionMode: raw.completionMode } : {}),
    ...(typeof raw.completionAutomaticConfirmation === "boolean"
      ? { completionAutomaticConfirmation: raw.completionAutomaticConfirmation } : {}),
    ...(typeof raw.completionBlockReason === "string" ? { completionBlockReason: raw.completionBlockReason } : {}),
  };
}

function validateNodeFields(contract: SaveContract, fields: unknown): void {
  if (!isRecord(fields) || Object.keys(fields).length === 0) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "fields 必须包含至少一个字段");
  }
  if (contract.dynamicFields) return;
  const unknown = Object.keys(fields).find((field) => !contract.writableFields.includes(field));
  if (unknown) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", `字段 ${unknown} 不在 saveContract.writableFields 中`);
  }
  const protectedField = Object.keys(fields).find((field) => contract.protectedFields.includes(field));
  if (protectedField) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", `字段 ${protectedField} 是受保护字段`);
  }
}

function validateDeclaredArguments(
  normalizedArguments: Record<string, unknown>,
  capability?: ActionCapability,
): void {
  if (!capability) return;
  const unknownField = Object.keys(normalizedArguments).find(
    (key) => !Object.prototype.hasOwnProperty.call(capability.inputSchema, key),
  );
  if (unknownField) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", `参数 ${unknownField} 不在能力目录的 inputSchema 中`);
  }
}

function workflowDidNotDrift(before: WorkflowContext | null | undefined, after: WorkflowContext | null): boolean {
  if (!after?.workflow) return before?.workflow === undefined || before.workflow === null;
  if (!before?.workflow) return true;
  const beforeNodes = new Set(before.workflow.nodes.map(nodeKey));
  const afterNodes = new Set(after.workflow.nodes.map(nodeKey));
  return beforeNodes.size === afterNodes.size && [...beforeNodes].every((key) => afterNodes.has(key));
}

function readNode(context: WorkflowContext, nodeId: number): Record<string, any> | null {
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  return isRecord(node) ? node : null;
}

function nodeKey(value: unknown): string {
  if (!isRecord(value)) return "unknown";
  return `${String(value.id)}:${String(value.key)}`;
}

function compareProtectedFields(before: ResourceDetail | null | undefined, after: ResourceDetail | null): boolean {
  if (!before) return true;
  if (!after) return false;
  return ["id", "status", "deleted"].every((key) => !Object.prototype.hasOwnProperty.call(before.details, key)
    || JSON.stringify(before.details[key]) === JSON.stringify(after.details[key]));
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
