import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import {
  agentContractVersion,
  agentWorkSessionSchema,
  workflowContextNodeSchema,
  type AgentWorkSession,
  type NodeContract,
  type WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { buildUserFacingDisplay } from "../../output/userFacing.js";
import {
  ComponentResolutionError,
  resolveWorkflowComponent,
} from "./componentResolver.js";

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
  const requestedComponentKey = options.component ?? context.meta?.selectedComponentKey ?? undefined;
  const selectedComponentKey = resolveSelectedComponentKey(context, selectedNodeId, requestedComponentKey);
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
      ...(context.resourceDetails ? { resourceDetails: context.resourceDetails } : {}),
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
    userFacing: buildUserFacingDisplay({
      resourceType: resource.type,
      context,
    }),
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
  let resolution;
  try {
    resolution = resolveWorkflowComponent(node, { componentKey, mode: "read" });
  } catch (error) {
    throw componentMappingError(error);
  }
  const component = resolution.component;
  const saveContract = asRecord(resolution.saveContract);
  const fields = saveContract?.contractVersion === "project-profile/v1"
    && Array.isArray(saveContract.fieldContracts)
    ? saveContract.fieldContracts.filter((field): field is Record<string, unknown> =>
      typeof field === "object" && field !== null && typeof (field as any).key === "string")
      .map((field) => ({
        key: field.key as string,
        label: typeof field.label === "string" ? field.label : field.key as string,
        type: typeof field.type === "string" ? field.type : null,
        required: field.required === true,
        options: undefined as string[] | undefined,
      }))
    : component?.fields ?? node.fields;
  const writableFields = stringArray(saveContract?.effectiveWritableFields ?? saveContract?.writableFields);
  const protectedFields = stringArray(saveContract?.protectedFields).length > 0
    ? stringArray(saveContract?.protectedFields)
    : fields.map((field) => field.key).filter((key) => !writableFields.includes(key));
  const effectiveAllowedActions = unique(context.allowedActions ?? []);
  const saveCommand = typeof saveContract?.command === "string" ? saveContract.command : undefined;
  const actionAuthorized = saveCommand !== undefined && effectiveAllowedActions.includes(saveCommand);
  const completionOnly = ["development-item.node.complete", "development-item.node.complete-with-data"].includes(saveCommand ?? "")
    && saveContract?.completionSupported === true;
  const writeCapable = saveContract !== undefined
    && actionAuthorized
    && (writableFields.length > 0 || completionOnly)
    && node.id !== null
    && node.version !== null
    && node.version !== undefined;
  const missingInputRules = stringArray(saveContract?.missingInputRules);
  const completionMode = typeof saveContract?.completionMode === "string"
    ? saveContract.completionMode : undefined;
  const completionAutomaticConfirmation = typeof saveContract?.completionAutomaticConfirmation === "boolean"
    ? saveContract.completionAutomaticConfirmation : undefined;
  const completionBlockReason = typeof saveContract?.completionBlockReason === "string"
    ? saveContract.completionBlockReason : undefined;
  const completionSupported = saveContract?.completionSupported === true;
  if (resolution.reason === "MULTIPLE_WRITABLE_COMPONENTS") {
    missingInputRules.push("当前节点存在多个可写组件，请显式指定 componentKey");
  } else if (!saveContract) {
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
  const actions = completionOnly && writeCapable
    ? [saveCommand!]
    : writeCapable && componentActions.length > 0
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
    completionRequiredMetadata: stringArray(saveContract?.completionRequiredMetadata),
    missingInputRules: unique(missingInputRules),
    ...(completionMode === "AUTO_CONFIRM" || completionMode === "VALIDATE_ONLY"
      || completionMode === "REQUIRES_DOMAIN_CONFIRMATION" ? { completionMode } : {}),
    ...(completionAutomaticConfirmation === undefined ? {} : { completionAutomaticConfirmation }),
    ...(completionBlockReason === undefined ? {} : { completionBlockReason }),
    ...(completionSupported ? { completionSupported: true } : {}),
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

function resolveSelectedComponentKey(
  context: WorkflowContext,
  nodeId: number | null | undefined,
  componentKey?: string,
): string | undefined {
  if (!context.workflow || nodeId === undefined || nodeId === null) return componentKey;
  const rawNode = context.workflow.nodes.find((candidate) => isNodeWithId(candidate, nodeId));
  if (rawNode === undefined) return componentKey;
  const parsedNode = workflowContextNodeSchema.safeParse(rawNode);
  if (!parsedNode.success) return componentKey;
  try {
    return resolveWorkflowComponent(parsedNode.data, { componentKey, mode: "read" }).componentKey
      ?? componentKey;
  } catch (error) {
    throw componentMappingError(error);
  }
}

function componentMappingError(error: unknown): AgentContextMappingError {
  if (error instanceof ComponentResolutionError) {
    const code = error.code === "COMPONENT_NOT_FOUND"
      ? "AGENT_CONTEXT_COMPONENT_NOT_FOUND"
      : "AGENT_CONTEXT_COMPONENT_UNAVAILABLE";
    return new AgentContextMappingError(`${code}: ${error.message.replace(`${error.code}: `, "")}`);
  }
  return new AgentContextMappingError(`AGENT_CONTEXT_COMPONENT_INVALID: ${String(error)}`);
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
