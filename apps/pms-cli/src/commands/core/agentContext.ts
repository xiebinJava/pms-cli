import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import {
  agentContractVersion,
  agentWorkSessionSchema,
  workflowContextNodeSchema,
  type AgentWorkSession,
  type ContextNode,
  type NodeContract,
  type WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";

type AgentResourceType = "project" | "requirement" | "topic" | "story";

const agentResourceTypes = new Set<AgentResourceType>([
  "project", "requirement", "topic", "story",
]);

/** Maps the server-owned workflow context to the stable external-Agent envelope. */
export function buildAgentContext(
  context: WorkflowContext,
  options: { nodeId?: number; component?: string } = {},
): AgentWorkSession {
  const resource = toAgentResource(context);
  const warnings = context.meta?.warnings?.map((warning) => ({
    code: warning.code,
    message: warning.message,
  })) ?? [];
  const contextVersion = readContextVersion(context);
  if (!context.meta?.contextVersion && contextVersion.endsWith(":unknown")) {
    warnings.push({
      code: "MISSING_CONTEXT_VERSION",
      message: "PMS 未返回可用于写入校验的上下文版本；当前会话只能保持只读",
    });
  }
  if (context.meta?.workflowConfigured === false || !context.workflow) {
    warnings.push({
      code: "WORKFLOW_NOT_CONFIGURED",
      message: "当前资源没有可用的流程配置",
    });
  }

  const relations = (context.relations ?? []).flatMap((relation) => {
    if (!agentResourceTypes.has(relation.resourceType as AgentResourceType)) {
      warnings.push({
        code: "UNSUPPORTED_RELATION",
        message: `关系资源类型 ${relation.resourceType} 不在 Agent 契约范围内，已忽略`,
      });
      return [];
    }
    return [{
      resource: {
        type: relation.resourceType as AgentResourceType,
        id: relation.resourceId,
      },
      label: relation.label,
      readable: relation.readable,
    }];
  });

  const snapshotId = `${resource.type}:${resource.id}@${contextVersion}`;
  const selectedNodeId = options.nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id ?? undefined;
  const selectedComponentKey = options.component ?? context.meta?.selectedComponentKey ?? undefined;
  const nodeContract = context.workflow && selectedNodeId !== undefined && selectedNodeId !== null
    ? buildNodeContract(context, selectedNodeId,
      selectedComponentKey)
    : null;
  const sourceRefs = [
    `${resource.type}:${resource.id}`,
    ...relations.map((relation) => `${relation.resource.type}:${relation.resource.id}`),
    ...(selectedNodeId === undefined ? [] : [nodeSourceRef(resource.type, selectedNodeId)]),
    ...(selectedNodeId === undefined || selectedComponentKey === undefined
      ? []
      : [componentSourceRef(resource.type, selectedNodeId, selectedComponentKey)]),
  ];

  return agentWorkSessionSchema.parse({
    contractVersion: agentContractVersion,
    sessionId: `agent-session:${snapshotId}`,
    resource,
    contextSnapshot: {
      snapshotId,
      resource,
      contextVersion,
      capturedAt: context.meta?.loadedAt ?? new Date().toISOString(),
      currentNode: context.currentNode ?? null,
      workflowNodes: context.workflow?.nodes ?? [],
      relations,
      allowedActions: context.allowedActions ?? [],
      sourceRefs: unique(sourceRefs),
      warnings,
    },
    nodeContract,
    agentTask: {
      taskId: `agent-task:${snapshotId}`,
      role: "pms-context-reader",
      objective: `读取 ${resource.type} ${resource.id} 的当前流程上下文`,
      resource,
      contextSnapshotId: snapshotId,
      permissionMode: "read-only",
    },
    draft: null,
    preview: null,
    confirmation: { status: "NOT_REQUIRED" },
    operation: null,
    verification: null,
  });
}

export function nodeSourceRef(resourceType: string, nodeId: number): string {
  return `${resourceType}-node:${nodeId}`;
}

export function componentSourceRef(resourceType: string, nodeId: number, componentKey: string): string {
  return `${nodeSourceRef(resourceType, nodeId)}#component:${componentKey}`;
}

/** Builds a node/field contract without inferring write scope from labels or UI text. */
export function buildNodeContract(
  context: WorkflowContext,
  nodeId?: number,
  componentKey?: string,
): NodeContract {
  const rawNodes = context.workflow?.nodes ?? [];
  const selectedId = nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id ?? null;
  if (selectedId === null || selectedId === undefined) {
    throw new AgentContextMappingError("AGENT_CONTEXT_NODE_REQUIRED: 当前上下文没有选中的流程节点");
  }
  const rawNode = rawNodes.find((candidate) => isNodeWithId(candidate, selectedId));
  if (rawNode === undefined) {
    throw new AgentContextMappingError(`AGENT_CONTEXT_NODE_NOT_FOUND: 未找到流程节点 ${selectedId}`);
  }
  const parsedNode = workflowContextNodeSchema.safeParse(rawNode);
  if (!parsedNode.success) {
    throw new AgentContextMappingError(`AGENT_CONTEXT_NODE_INVALID: 流程节点 ${selectedId} 结构不完整`);
  }
  const node = parsedNode.data;
  const component = selectComponent(node, componentKey);
  const fields = component?.fields ?? node.fields;
  const saveContract = asRecord(component?.saveContract);
  const writableFields = stringArray(saveContract?.writableFields);
  const protectedFields = stringArray(saveContract?.protectedFields).length > 0
    ? stringArray(saveContract?.protectedFields)
    : fields.map((field) => field.key).filter((key) => !writableFields.includes(key));
  const effectiveAllowedActions = unique(context.allowedActions ?? []);
  const saveCommand = typeof saveContract?.command === "string" ? saveContract.command : undefined;
  const actionAuthorized = saveCommand !== undefined && effectiveAllowedActions.includes(saveCommand);
  const writeCapable = saveContract !== undefined
    && actionAuthorized
    && writableFields.length > 0
    && node.id !== null
    && node.version !== null
    && node.version !== undefined;
  const missingInputRules = stringArray(saveContract?.missingInputRules);
  if (!saveContract) {
    missingInputRules.push("当前节点/组件未公开 saveContract，禁止生成写入预览");
  } else if (!actionAuthorized) {
    missingInputRules.push("当前用户未获准执行 saveContract 命令，禁止生成写入预览");
  } else if (!writeCapable) {
    missingInputRules.push("saveContract 未声明有效命令和可写字段，禁止生成写入预览");
  }

  const requiredFields = fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type ?? null,
    required: field.required,
    ...(field.options ? { options: field.options } : {}),
    ...(node.fieldValues[field.key] !== undefined ? { currentValue: node.fieldValues[field.key] } : {}),
  }));
  const componentActions = component
    ? component.actions.filter((action) => effectiveAllowedActions.includes(action))
    : [];
  const actions = writeCapable && componentActions.length > 0
    ? componentActions
    : writeCapable ? effectiveAllowedActions : [];
  return {
    nodeId: node.id,
    key: node.key,
    label: node.label,
    version: node.version ?? null,
    requiredFields,
    writableFields: unique(writableFields),
    protectedFields: unique(protectedFields),
    allowedActions: unique(actions),
    allowedTransitions: stringArray(saveContract?.allowedTransitions),
    missingInputRules: unique(missingInputRules),
    writeCapable,
  };
}

function toAgentResource(context: WorkflowContext) {
  if (!agentResourceTypes.has(context.resource.type as AgentResourceType)) {
    throw new AgentContextMappingError(`AGENT_CONTEXT_RESOURCE_UNSUPPORTED: ${context.resource.type}`);
  }
  return {
    type: context.resource.type as AgentResourceType,
    id: context.resource.id,
  };
}

function readContextVersion(context: WorkflowContext): string {
  const declared = context.meta?.contextVersion?.trim();
  if (declared) return declared;
  const version = context.entityVersion ?? context.version;
  return `${context.resource.type}:${context.resource.id}:entity:${version ?? "unknown"}`;
}

function selectComponent(node: ContextNode, componentKey?: string) {
  if (componentKey === undefined || componentKey.trim() === "") {
    return node.components.length === 1 ? node.components[0] : undefined;
  }
  const component = node.components.find((candidate) => candidate.key === componentKey);
  if (!component) {
    throw new AgentContextMappingError(`AGENT_CONTEXT_COMPONENT_NOT_FOUND: 未找到组件 ${componentKey}`);
  }
  return component;
}

function isNodeWithId(value: unknown, id: number): boolean {
  return Boolean(value && typeof value === "object" && (value as { id?: unknown }).id === id);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export class AgentContextMappingError extends PmsClientError {
  constructor(message: string) {
    super("validation", message, { details: { code: message.split(":", 1)[0] } });
  }
}
