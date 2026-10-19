import type {
  ActionCapability,
  AnalysisDraft,
  ResourceScenarioContext,
  ResourceScenarioSnapshot,
  ParsedResourceScenarioInput,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { AnalysisDraftValidator } from "./AnalysisDraftValidator.js";
import {
  resourceScenarioRegistry,
  ResourceScenarioError,
  type ResourceScenarioAdapter,
} from "./resourceScenarioRegistry.js";

const REQUIREMENT_OPERATIONS = new Set([
  "requirement.update",
  "requirement.analysis.save",
  "requirement.execution-target.link",
  "requirement.execution-target.change",
  "requirement.execution-target.unlink",
  "development-item.node.field.update",
  "development-item.node.complete-with-data",
]);

type SaveContract = {
  command: string;
  itemType: string;
  itemId: number;
  nodeId: number;
  version: number;
  fieldValuesPath: string;
  writableFields: string[];
  protectedFields: string[];
  completionCommand?: string;
  completionSupported?: boolean;
  completionMode?: string;
  completionAutomaticConfirmation?: boolean;
  completionBlockReason?: string;
};

export const requirementScenarioAdapter: ResourceScenarioAdapter = {
  resourceType: "requirement",

  supports(operation) {
    return REQUIREMENT_OPERATIONS.has(operation);
  },

  async loadContext(client, input) {
    const requirementId = requireResourceId(input);
    const focused = input.operation === "requirement.analysis.save"
      || input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data";
    const context = await client.context(
      { type: "requirement", id: requirementId },
      focused
        ? { nodeId: requireNodeId(input), view: "focused" }
        : undefined,
    );
    return {
      id: `requirement:${requirementId}`,
      version: String(context.version ?? "unknown"),
      entityVersion: context.entityVersion ?? null,
      selectedNodeId: context.meta?.selectedNodeId ?? context.currentNode?.id ?? null,
      snapshot: context,
    };
  },

  async normalizeArguments(input, context) {
    const requirementId = requireResourceId(input);
    const rawContext = readWorkflowContext(context);
    if (!rawContext) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "需求上下文不存在");

    if (input.operation === "requirement.analysis.save") {
      const nodeId = requireNodeId(input);
      const patch = readPatch(input);
      return {
        requirementId,
        nodeId,
        version: requireNodeVersion(input, rawContext),
        patch,
      };
    }

    if (input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data") {
      const nodeId = requireNodeId(input);
      const saveContract = readSaveContract(rawContext, nodeId);
      const patch = readPatch(input);
      const normalized = {
        itemType: saveContract.itemType,
        itemId: saveContract.itemId,
        nodeId: saveContract.nodeId,
        version: saveContract.version,
        fieldValues: fieldValuesAtPath(saveContract.fieldValuesPath, patch),
      };
      if (input.operation === "development-item.node.complete-with-data") {
        if (!saveContract.completionSupported || saveContract.completionCommand !== input.operation) {
          throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点未声明原子完成能力");
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

    if (input.operation === "requirement.update") {
      return {
        ...input.arguments,
        requirementId,
        version: requireEntityVersion(rawContext),
      };
    }

    return {
      ...input.arguments,
      requirementId,
      requirementVersion: requireEntityVersion(rawContext),
    };
  },

  validate(input, context, normalizedArguments, capability) {
    const requirementId = requireResourceId(input);
    const rawContext = readWorkflowContext(context);
    if (!rawContext) throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "需求上下文不存在");
    if (rawContext.resource.type !== "requirement" || rawContext.resource.id !== requirementId) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "上下文资源与需求 ID 不一致");
    }
    validateDeclaredArguments(normalizedArguments, capability);
    validateSuppliedArguments(input, rawContext, requirementId);
    if (input.contextVersion !== undefined && String(rawContext.version) !== String(input.contextVersion)) {
      throw new ResourceScenarioError(
        "CONTEXT_CONFLICT",
        `需求上下文版本 ${rawContext.version ?? "无"} 与请求版本 ${input.contextVersion} 不一致`,
      );
    }

    if (input.operation === "requirement.analysis.save"
      || input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data") {
      const nodeId = requireNodeId(input);
      if (rawContext.currentNode?.id !== nodeId) {
        throw new ResourceScenarioError(
          "CONTEXT_CONFLICT",
          `当前节点 ${rawContext.currentNode?.id ?? "无"} 与指定节点 ${nodeId} 不一致`,
        );
      }
      if (input.operation === "requirement.analysis.save") {
        const draft = toAnalysisDraft(input);
        AnalysisDraftValidator.validate(draft, rawContext);
      } else {
        validateNodeFieldArguments(rawContext, nodeId, normalizedArguments);
      }
    }

    const suppliedId = normalizedArguments.requirementId ?? normalizedArguments.itemId;
    if (suppliedId !== undefined && Number(suppliedId) !== requirementId) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "写入参数中的需求 ID 与资源 ID 不一致");
    }
  },

  resolveReadbackId(input, operation) {
    if (input.resourceId !== undefined) return input.resourceId;
    const id = operation.data.requirementId ?? operation.data.resourceId;
    return isPositiveInteger(id) ? id : null;
  },

  verifyReadback(before, after, normalizedArguments, operation) {
    const expectedId = normalizedArguments.requirementId
      ?? normalizedArguments.itemId
      ?? operation.data.requirementId
      ?? before?.resource?.resourceId
      ?? before?.context?.resource.id;
    const resourceReadback = after.resource?.resourceType === "requirement"
      && (expectedId === undefined || after.resource.resourceId === Number(expectedId));
    const contextReadback = after.context?.resource.type === "requirement"
      && (expectedId === undefined || after.context.resource.id === Number(expectedId));
    const protectedFieldsUnchanged = compareProtectedFields(before, after);
    const patchApplied = resourceReadback && contextReadback && operation.status === "SUCCEEDED";
    return {
      resourceReadback,
      contextReadback,
      patchApplied,
      protectedFieldsUnchanged,
    };
  },
};

resourceScenarioRegistry.register(requirementScenarioAdapter);

function requireResourceId(input: ParsedResourceScenarioInput): number {
  if (input.resourceId === undefined) {
    throw new ResourceScenarioError("RESOURCE_NOT_FOUND", "需求场景必须提供 resourceId");
  }
  return input.resourceId;
}

function requireNodeId(input: ParsedResourceScenarioInput): number {
  if (input.nodeId === undefined) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "需求节点场景必须提供 nodeId");
  }
  return input.nodeId;
}

function readWorkflowContext(context: ResourceScenarioContext | null): WorkflowContext | null {
  if (!context || !isRecord(context.snapshot)) return null;
  return context.snapshot as WorkflowContext;
}

function requireEntityVersion(context: WorkflowContext): number {
  if (context.entityVersion === null || context.entityVersion === undefined) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "需求上下文缺少实体版本，不能安全写入");
  }
  return context.entityVersion;
}

function requireNodeVersion(input: ParsedResourceScenarioInput, context: WorkflowContext): number {
  const nodeId = requireNodeId(input);
  const node = readNode(context, nodeId);
  if (input.contextVersion !== undefined && Number(input.contextVersion) !== context.version) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "节点写入的上下文版本已过期");
  }
  const version = node?.version ?? context.version;
  if (version === null || version === undefined) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", `节点 ${nodeId} 缺少版本`);
  }
  return version;
}

function readPatch(input: ParsedResourceScenarioInput): Record<string, unknown> {
  if (input.draft) return input.draft.patch;
  const patch = input.arguments.patch;
  if (isRecord(patch)) return patch;
  const fieldValues = input.arguments.fieldValues;
  if (isRecord(fieldValues)) return fieldValues;
  return input.arguments;
}

function toAnalysisDraft(input: ParsedResourceScenarioInput): AnalysisDraft {
  return {
    facts: input.draft?.facts ?? [],
    inferences: input.draft?.inferences ?? [],
    assumptions: input.draft?.assumptions ?? [],
    unresolvedDecisions: input.draft?.unresolvedDecisions ?? [],
    patch: readPatch(input),
  };
}

function readSaveContract(context: WorkflowContext, nodeId: number): SaveContract {
  const node = readNode(context, nodeId);
  if (!node || !Array.isArray(node.components)) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", `需求上下文中不存在节点 ${nodeId}`);
  }
  const component = node.components.find((candidate) =>
    isRecord(candidate) && isRecord(candidate.saveContract)
    && candidate.saveContract.command === "development-item.node.field.update"
    && candidate.saveContract.itemType === "REQUIREMENT"
    && candidate.saveContract.itemId === context.resource.id,
  );
  if (!isRecord(component) || !isRecord(component.saveContract)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "所选需求节点没有可写 saveContract");
  }
  const raw = component.saveContract;
  if (!isPositiveInteger(raw.itemId) || !isPositiveInteger(raw.nodeId)
    || !isNonNegativeInteger(raw.version) || typeof raw.command !== "string"
    || typeof raw.itemType !== "string" || typeof raw.fieldValuesPath !== "string"
    || !isStringArray(raw.writableFields)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点 saveContract 不完整");
  }
  return {
    command: raw.command,
    itemType: raw.itemType,
    itemId: raw.itemId,
    nodeId: raw.nodeId,
    version: raw.version,
    fieldValuesPath: raw.fieldValuesPath,
    writableFields: raw.writableFields,
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

function validateNodeFieldArguments(
  context: WorkflowContext,
  nodeId: number,
  normalizedArguments: Record<string, unknown>,
): void {
  const contract = readSaveContract(context, nodeId);
  if (normalizedArguments.itemType !== contract.itemType
    || normalizedArguments.itemId !== contract.itemId
    || normalizedArguments.nodeId !== contract.nodeId
    || normalizedArguments.version !== contract.version) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "节点写入参数与 saveContract 不一致");
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
}

function validateSuppliedArguments(
  input: ParsedResourceScenarioInput,
  context: WorkflowContext,
  requirementId: number,
): void {
  assertMatchingNumber(input.arguments.requirementId, requirementId, "requirementId");
  assertMatchingNumber(input.arguments.itemId, requirementId, "itemId");
  if (input.operation === "requirement.update") {
    assertMatchingNumber(input.arguments.version, requireEntityVersion(context), "version");
    return;
  }
  if (input.operation === "requirement.execution-target.link"
    || input.operation === "requirement.execution-target.change"
    || input.operation === "requirement.execution-target.unlink") {
    assertMatchingNumber(input.arguments.requirementVersion, requireEntityVersion(context), "requirementVersion");
    return;
  }
  if (input.operation === "requirement.analysis.save") {
    assertMatchingNumber(input.arguments.nodeId, requireNodeId(input), "nodeId");
    assertMatchingNumber(input.arguments.version, requireNodeVersion(input, context), "version");
    return;
  }
  if (input.operation === "development-item.node.field.update"
    || input.operation === "development-item.node.complete-with-data") {
    const nodeId = requireNodeId(input);
    const contract = readSaveContract(context, nodeId);
    if (input.arguments.itemType !== undefined && input.arguments.itemType !== contract.itemType) {
      throw new ResourceScenarioError("CONTEXT_CONFLICT", "itemType 与 saveContract 不一致");
    }
    assertMatchingNumber(input.arguments.nodeId, contract.nodeId, "nodeId");
    assertMatchingNumber(input.arguments.version, contract.version, "version");
  }
}

function assertMatchingNumber(value: unknown, expected: number, name: string): void {
  if (value !== undefined && Number(value) !== expected) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", `${name} 与当前需求上下文不一致`);
  }
}

function readNode(context: WorkflowContext, nodeId: number): Record<string, any> | null {
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  return isRecord(node) ? node : null;
}

function nestedFieldValues(path: string, fieldValues: unknown): Record<string, unknown> {
  if (!isRecord(fieldValues)) return {};
  const segments = path.split(".").filter(Boolean);
  let current: unknown = fieldValues;
  for (const segment of segments) {
    if (!isRecord(current)) return {};
    current = current[segment];
  }
  return isRecord(current) ? current : {};
}

function fieldValuesAtPath(path: string, patch: Record<string, unknown>): Record<string, unknown> {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "saveContract.fieldValuesPath 不能为空");
  let result: Record<string, unknown> = patch;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    result = { [segments[index]!]: result };
  }
  return result;
}

function compareProtectedFields(
  before: ResourceScenarioSnapshot | null | undefined,
  after: ResourceScenarioSnapshot | null,
): boolean {
  if (!before || !after) return false;
  const beforeDetails = {
    ...(before.resource?.details ?? {}),
    ...(before.context?.resourceDetails ?? {}),
  };
  const afterDetails = {
    ...(after.resource?.details ?? {}),
    ...(after.context?.resourceDetails ?? {}),
  };
  return ["systemId", "targetType", "targetId", "ownerId", "status", "startDate", "endDate"]
    .every((key) => !Object.prototype.hasOwnProperty.call(beforeDetails, key)
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

