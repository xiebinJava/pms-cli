import type {
  ActionCapability,
  ResourceDetail,
  ResourceScenarioContext,
  ResourceScenarioSnapshot,
  ParsedResourceScenarioInput,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  resourceScenarioRegistry,
  ResourceScenarioError,
  type ResourceScenarioAdapter,
} from "./resourceScenarioRegistry.js";
import {
  ComponentResolutionError,
  resolveWorkflowComponent,
} from "../core/componentResolver.js";

const TOPIC_OPERATIONS = new Set([
  "topic.create",
  "topic.update",
  "topic.project.link",
  "development-item.node.field.update",
  "development-item.node.complete-with-data",
]);

type SaveContract = {
  command: string;
  itemType: string;
  itemId: number;
  nodeId: number;
  version: number;
  componentKey: string;
  fieldValuesPath: string;
  sourceProjectNodeKey: string | null;
  writableFields: string[];
  protectedFields: string[];
  completionCommand?: string;
  completionSupported?: boolean;
  completionMode?: string;
  completionAutomaticConfirmation?: boolean;
  completionBlockReason?: string;
};

type ContextBundle = {
  topic: WorkflowContext;
  targetProject: WorkflowContext | null;
};

export const topicScenarioAdapter: ResourceScenarioAdapter = {
  resourceType: "topic",

  supports(operation) {
    return TOPIC_OPERATIONS.has(operation);
  },

  async loadContext(client, input) {
    if (input.operation === "topic.create") return null;
    const topicId = requireTopicId(input);
    const focused = input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data";
    const requestedComponent = input.componentKey;
    const topic = await client.context(
      { type: "topic", id: topicId },
      focused
        ? {
          nodeId: requireNodeId(input),
          view: "focused",
          ...(requestedComponent === undefined ? {} : { component: requestedComponent }),
        }
        : undefined,
    );
    const projectId = targetProjectId(input, topic);
    const targetProject = projectId === null
      ? null
      : await client.context({ type: "project", id: projectId });
    const selectedNodeId = topic.meta?.selectedNodeId ?? topic.currentNode?.id ?? null;
    const resolution = selectedNodeId === null
      ? undefined
      : resolveReadComponent(topic, selectedNodeId, requestedComponent);
    return {
      id: `topic:${topicId}`,
      version: String(topic.version ?? "unknown"),
      entityVersion: topic.entityVersion ?? null,
      selectedNodeId,
      selectedComponentKey: resolution?.componentKey ?? topic.meta?.selectedComponentKey ?? null,
      writeCapable: resolution?.writeCapable ?? false,
      snapshot: { topic, targetProject },
    };
  },

  async normalizeArguments(input, context) {
    if (input.operation === "topic.create") return { ...input.arguments };
    const topicId = requireTopicId(input);
    const topic = readTopicContext(context);
    if (!topic) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "专题上下文不存在");

  if (input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data") {
      const nodeId = requireNodeId(input);
      const saveContract = readSaveContract(topic, nodeId, input.componentKey);
      const normalized = {
        itemType: saveContract.itemType,
        itemId: saveContract.itemId,
        nodeId: saveContract.nodeId,
        version: saveContract.version,
        fieldValues: fieldValuesAtPath(saveContract.fieldValuesPath, readPatch(input)),
      };
      if (input.operation === "development-item.node.complete-with-data") {
        if (!saveContract.completionSupported || saveContract.completionCommand !== input.operation) {
          throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "专题节点未声明原子完成能力");
        }
        return {
          ...normalized,
          ...(input.arguments.ownerId === undefined ? {} : { ownerId: input.arguments.ownerId }),
          ...(input.arguments.startDate === undefined ? {} : { startDate: input.arguments.startDate }),
          ...(input.arguments.endDate === undefined ? {} : { endDate: input.arguments.endDate }),
        };
      }
      return normalized;
    }
    return {
      ...input.arguments,
      topicId,
      ...(input.operation === "topic.project.link"
        ? { projectId: input.arguments.projectId ?? null }
        : {}),
    };
  },

  validate(input, context, normalizedArguments, capability) {
    validateDeclaredArguments(normalizedArguments, capability);
    if (input.operation === "topic.create") {
      if (input.resourceId !== undefined) {
        throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题创建不能携带已有 resourceId");
      }
      return;
    }

    const topic = readTopicContext(context);
    if (!topic) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "专题上下文不存在");
    const topicId = requireTopicId(input);
    if (topic.resource.type !== "topic" || topic.resource.id !== topicId) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题上下文与请求资源不一致");
    }
    if (input.contextVersion !== undefined && String(topic.version) !== String(input.contextVersion)) {
      throw new ResourceScenarioError(
        "CONTEXT_CONFLICT",
        `专题上下文版本 ${topic.version ?? "无"} 与请求版本 ${input.contextVersion} 不一致`,
      );
    }
    validateSuppliedArguments(input, topic, normalizedArguments);
    if (input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data") {
      const nodeId = requireNodeId(input);
      if (topic.currentNode?.id !== nodeId) {
        throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题节点不是当前 focused 节点");
      }
      validateNodeFieldArguments(topic, nodeId, normalizedArguments, input.componentKey);
    }
    if (input.operation === "topic.update" || input.operation === "topic.project.link") {
      validateTargetProject(readTargetProject(context), normalizedArguments.projectId);
    }
  },

  resolveReadbackId(input, operation) {
    if (input.resourceId !== undefined) return input.resourceId;
    const id = operation.data.topicId ?? operation.data.resourceId;
    return isPositiveInteger(id) ? id : null;
  },

  verifyReadback(before, after, _normalizedArguments, operation) {
    const expectedId = operation.data.topicId
      ?? before?.resource?.resourceId
      ?? before?.context?.resource.id;
    const resourceReadback = after.resource?.resourceType === "topic"
      && (expectedId === undefined || after.resource.resourceId === Number(expectedId));
    const contextReadback = after.context?.resource.type === "topic"
      && (expectedId === undefined || after.context.resource.id === Number(expectedId));
    const relationConsistent = relationIsConsistent(after.resource, after.context);
    const workflowStable = workflowDidNotDrift(before?.context, after.context);
    const protectedFieldsUnchanged = compareProtectedFields(before, after);
    return {
      resourceReadback,
      contextReadback: contextReadback && relationConsistent,
      patchApplied: resourceReadback && contextReadback && relationConsistent
        && workflowStable && operation.status === "SUCCEEDED",
      protectedFieldsUnchanged,
    };
  },
};

resourceScenarioRegistry.register(topicScenarioAdapter);

function requireTopicId(input: ParsedResourceScenarioInput): number {
  const value = input.resourceId ?? input.arguments.topicId;
  if (!isPositiveInteger(value)) {
    throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "专题场景必须提供 resourceId 或 topicId");
  }
  return value;
}

function requireNodeId(input: ParsedResourceScenarioInput): number {
  if (!isPositiveInteger(input.nodeId)) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题节点场景必须提供 nodeId");
  }
  return input.nodeId;
}

function readTopicContext(context: ResourceScenarioContext | null): WorkflowContext | null {
  if (!context || !isRecord(context.snapshot)) return null;
  const topic = context.snapshot.topic;
  return isRecord(topic) ? topic as WorkflowContext : null;
}

function readTargetProject(context: ResourceScenarioContext | null): WorkflowContext | null {
  if (!context || !isRecord(context.snapshot)) return null;
  const project = context.snapshot.targetProject;
  return isRecord(project) ? project as WorkflowContext : null;
}

function targetProjectId(input: ParsedResourceScenarioInput, topic: WorkflowContext): number | null {
  const raw = input.arguments.projectId;
  if (raw === null) return null;
  if (raw !== undefined) {
    if (!isPositiveInteger(raw)) throw new ResourceScenarioError("CONTEXT_CONFLICT", "projectId 必须是正整数或 null");
    return raw;
  }
  const current = topic.resourceDetails?.projectId;
  return current === null || current === undefined ? null : isPositiveInteger(current) ? current : null;
}

function validateTargetProject(project: WorkflowContext | null, requested: unknown): void {
  if (requested === null || requested === undefined) return;
  if (!project) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "目标项目不存在或当前用户不可读");
  const status = project.resourceDetails?.status;
  const terminal = project.meta?.terminalStatus;
  const closed = terminal === "COMPLETED" || terminal === "TERMINATED"
    || status === "COMPLETED" || status === "TERMINATED" || status === 2 || status === 3;
  if (closed || (project.meta?.workflowStatus !== undefined
      && ["COMPLETED", "TERMINATED"].includes(project.meta.workflowStatus))) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "目标项目已完成或已终止，只能绑定进行中的项目");
  }
}

function validateSuppliedArguments(
  input: ParsedResourceScenarioInput,
  topic: WorkflowContext,
  normalizedArguments: Record<string, unknown>,
): void {
  assertMatchingNumber(input.arguments.topicId, topic.resource.id, "topicId");
  assertMatchingNumber(input.arguments.itemId, topic.resource.id, "itemId");
  if (input.operation === "development-item.node.field.update"
    || input.operation === "development-item.node.complete-with-data") {
    const nodeId = requireNodeId(input);
    assertMatchingNumber(input.arguments.nodeId, nodeId, "nodeId");
    const expectedVersion = readNode(topic, nodeId)?.version;
    assertMatchingNumber(input.arguments.version, expectedVersion ?? topic.version ?? -1, "version");
  }
  if (normalizedArguments.topicId !== undefined && Number(normalizedArguments.topicId) !== topic.resource.id) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "写入参数中的专题 ID 与资源 ID 不一致");
  }
}

function validateNodeFieldArguments(
  context: WorkflowContext,
  nodeId: number,
  normalizedArguments: Record<string, unknown>,
  componentKey?: string,
): void {
  const contract = readSaveContract(context, nodeId, componentKey);
  if (normalizedArguments.itemType !== contract.itemType
    || normalizedArguments.itemId !== contract.itemId
    || normalizedArguments.nodeId !== contract.nodeId
    || normalizedArguments.version !== contract.version) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题节点参数与 saveContract 不一致");
  }
  const values = nestedFieldValues(contract.fieldValuesPath, normalizedArguments.fieldValues);
  const unknownField = Object.keys(values).find((field) => !contract.writableFields.includes(field));
  if (unknownField) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", `草稿字段 ${unknownField} 不在 saveContract.writableFields 中`);
  }
  const protectedField = Object.keys(values).find((field) => contract.protectedFields.includes(field));
  if (protectedField) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", `草稿字段 ${protectedField} 是受保护字段`);
  }
  if (contract.sourceProjectNodeKey !== null
    && context.resourceDetails?.sourceProjectNodeKey !== contract.sourceProjectNodeKey) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "专题节点的项目挂载键已发生漂移");
  }
}

function readSaveContract(context: WorkflowContext, nodeId: number, componentKey?: string): SaveContract {
  const node = readNode(context, nodeId);
  let component: Record<string, any> | undefined;
  try {
    component = node
      ? resolveWorkflowComponent(node as any, { componentKey, mode: "write" })
        .component as Record<string, any> | undefined
      : undefined;
  } catch (error) {
    if (error instanceof ComponentResolutionError) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", error.message);
    }
    throw error;
  }
  if (!isRecord(component) || !isRecord(component.saveContract)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "专题节点没有可用的 saveContract");
  }
  const raw = component.saveContract;
  if (!isPositiveInteger(raw.itemId) || raw.itemId !== context.resource.id
    || !isPositiveInteger(raw.nodeId) || !isNonNegativeInteger(raw.version)
    || raw.command !== "development-item.node.field.update"
    || raw.itemType !== "TOPIC" || typeof raw.componentKey !== "string"
    || typeof raw.fieldValuesPath !== "string"
    || !isStringArray(raw.effectiveWritableFields ?? raw.writableFields)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "专题节点 saveContract 不完整");
  }
  return {
    command: raw.command,
    itemType: raw.itemType,
    itemId: raw.itemId,
    nodeId: raw.nodeId,
    version: raw.version,
    componentKey: raw.componentKey,
    fieldValuesPath: raw.fieldValuesPath,
    sourceProjectNodeKey: typeof raw.sourceProjectNodeKey === "string" ? raw.sourceProjectNodeKey : null,
    writableFields: isStringArray(raw.effectiveWritableFields)
      ? raw.effectiveWritableFields
      : raw.writableFields,
    protectedFields: isStringArray(raw.protectedFields) ? raw.protectedFields : [],
    ...(raw.completionCommand === "development-item.node.complete-with-data"
      ? { completionCommand: raw.completionCommand } : {}),
    ...(typeof raw.completionSupported === "boolean"
      ? { completionSupported: raw.completionSupported } : {}),
    ...(typeof raw.completionMode === "string" ? { completionMode: raw.completionMode } : {}),
    ...(typeof raw.completionAutomaticConfirmation === "boolean"
      ? { completionAutomaticConfirmation: raw.completionAutomaticConfirmation } : {}),
    ...(typeof raw.completionBlockReason === "string" ? { completionBlockReason: raw.completionBlockReason } : {}),
  };
}

function readPatch(input: ParsedResourceScenarioInput): Record<string, unknown> {
  if (input.draft) return input.draft.patch;
  if (isRecord(input.arguments.patch)) return input.arguments.patch;
  if (isRecord(input.arguments.fieldValues)) return input.arguments.fieldValues;
  return input.arguments;
}

function relationIsConsistent(resource: ResourceDetail | null, context: WorkflowContext | null): boolean {
  if (!resource || !context) return false;
  const resourceProjectId = resource.details.projectId ?? null;
  const contextProjectId = context.resourceDetails?.projectId ?? null;
  if (resourceProjectId !== contextProjectId) return false;
  if (resourceProjectId === null) return true;
  return (context.relations ?? []).some((relation) =>
    relation.resourceType === "project" && relation.resourceId === Number(resourceProjectId));
}

function workflowDidNotDrift(before: WorkflowContext | null | undefined, after: WorkflowContext | null): boolean {
  if (!after?.workflow) return before?.workflow === undefined || before.workflow === null;
  if (!before?.workflow) return true;
  const beforeNodes = new Set(before.workflow.nodes.map(nodeKey));
  const afterNodes = new Set(after.workflow.nodes.map(nodeKey));
  return beforeNodes.size === afterNodes.size && [...beforeNodes].every((key) => afterNodes.has(key));
}

function nodeKey(value: unknown): string {
  if (!isRecord(value)) return "unknown";
  return `${String(value.id)}:${String(value.key)}`;
}

function compareProtectedFields(
  before: ResourceScenarioSnapshot | null | undefined,
  after: ResourceScenarioSnapshot | null,
): boolean {
  if (!before) return true;
  if (!after) return false;
  const beforeDetails = {
    ...(before.resource?.details ?? {}),
    ...(before.context?.resourceDetails ?? {}),
  };
  const afterDetails = {
    ...(after.resource?.details ?? {}),
    ...(after.context?.resourceDetails ?? {}),
  };
  return ["id", "status", "deleted"].every((key) => !Object.prototype.hasOwnProperty.call(beforeDetails, key)
    || Object.prototype.hasOwnProperty.call(afterDetails, key)
      && JSON.stringify(beforeDetails[key]) === JSON.stringify(afterDetails[key]));
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

function nestedFieldValues(path: string, fieldValues: unknown): Record<string, unknown> {
  if (!isRecord(fieldValues)) return {};
  let current: unknown = fieldValues;
  for (const segment of path.split(".").filter(Boolean)) {
    if (!isRecord(current)) return {};
    current = current[segment];
  }
  return isRecord(current) ? current : {};
}

function fieldValuesAtPath(path: string, patch: Record<string, unknown>): Record<string, unknown> {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "saveContract.fieldValuesPath 不能为空");
  let result: Record<string, unknown> = patch;
  for (let index = segments.length - 1; index >= 0; index -= 1) result = { [segments[index]!]: result };
  return result;
}

function readNode(context: WorkflowContext, nodeId: number): Record<string, any> | null {
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  return isRecord(node) ? node : null;
}

function resolveReadComponent(
  context: WorkflowContext,
  nodeId: number,
  componentKey?: string,
) {
  const node = readNode(context, nodeId);
  if (!node) return undefined;
  try {
    return resolveWorkflowComponent(node as any, { componentKey, mode: "read" });
  } catch {
    return undefined;
  }
}

function assertMatchingNumber(value: unknown, expected: number, name: string): void {
  if (value !== undefined && Number(value) !== expected) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", `${name} 与当前专题上下文不一致`);
  }
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
