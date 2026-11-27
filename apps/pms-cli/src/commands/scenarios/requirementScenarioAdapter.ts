import type {
  ActionCapability,
  AnalysisDraft,
  ResourceScenarioContext,
  ParsedResourceScenarioInput,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { AnalysisDraftValidator } from "./AnalysisDraftValidator.js";
import {
  resourceScenarioRegistry,
  ResourceScenarioError,
  type ResourceScenarioAdapter,
} from "./resourceScenarioRegistry.js";
import {
  ComponentResolutionError,
  resolveWorkflowComponent,
} from "../core/componentResolver.js";
import {
  buildVerificationResult,
  publicVerification,
  type ReadbackVerificationInput,
} from "./readbackVerification.js";

const REQUIREMENT_OPERATIONS = new Set([
  "requirement.update",
  "requirement.analysis.save",
  "requirement.execution-target.link",
  "requirement.execution-target.change",
  "requirement.execution-target.unlink",
  "development-item.node.field.update",
  "development-item.node.complete",
  "development-item.node.complete-with-data",
]);

type SaveContract = {
  command: string;
  itemType: string;
  itemId: number;
  nodeId: number;
  version: number;
  fieldValuesPath?: string;
  componentKey?: string;
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
      || input.operation === "development-item.node.complete"
      || input.operation === "development-item.node.complete-with-data";
    const requestedComponent = input.componentKey;
    const context = await client.context(
      { type: "requirement", id: requirementId },
      focused
        ? {
          nodeId: requireNodeId(input),
          view: "focused",
          ...(requestedComponent === undefined ? {} : { component: requestedComponent }),
        }
        : undefined,
    );
    const selectedNodeId = context.meta?.selectedNodeId ?? context.currentNode?.id ?? null;
    const resolution = selectedNodeId === null
      ? undefined
      : resolveReadComponent(context, selectedNodeId, requestedComponent);
    return {
      id: `requirement:${requirementId}`,
      version: String(context.version ?? "unknown"),
      entityVersion: context.entityVersion ?? null,
      selectedNodeId,
      selectedComponentKey: resolution?.componentKey ?? context.meta?.selectedComponentKey ?? null,
      writeCapable: resolution?.writeCapable ?? false,
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

    if (input.operation === "development-item.node.complete") {
      const nodeId = requireNodeId(input);
      const completion = readSaveContract(rawContext, nodeId, input.componentKey);
      if (completion.command !== input.operation || !completion.completionSupported) {
        throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点未声明直接完成能力");
      }
      return {
        itemType: completion.itemType,
        itemId: completion.itemId,
        nodeId: completion.nodeId,
        version: completion.version,
      };
    }

    if (input.operation === "development-item.node.field.update"
      || input.operation === "development-item.node.complete-with-data") {
      const nodeId = requireNodeId(input);
      const saveContract = readSaveContract(rawContext, nodeId, input.componentKey);
      if (!saveContract.fieldValuesPath && saveContract.command === "development-item.node.field.update") {
        throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点 saveContract.fieldValuesPath 不能为空");
      }
      const patch = readPatch(input);
      if (saveContract.command !== "development-item.node.field.update"
        && (input.operation !== "development-item.node.complete-with-data" || Object.keys(patch).length > 0)) {
        throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "完成专用节点不允许写入字段");
      }
      const normalized = {
        itemType: saveContract.itemType,
        itemId: saveContract.itemId,
        nodeId: saveContract.nodeId,
        version: saveContract.version,
        ...(saveContract.command === "development-item.node.field.update"
          && (input.operation !== "development-item.node.complete-with-data" || Object.keys(patch).length > 0)
          ? { fieldValues: fieldValuesAtPath(saveContract.fieldValuesPath!, patch) } : {}),
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
      || input.operation === "development-item.node.complete"
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
      } else if (input.operation === "development-item.node.complete") {
        validateCompletionArguments(rawContext, nodeId, normalizedArguments, input.componentKey);
      } else {
        validateNodeFieldArguments(rawContext, nodeId, normalizedArguments, input.componentKey);
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

  verifyReadback(before, after, verificationInput, operation) {
    const verification = buildVerificationResult({
      ...(verificationInput as Partial<ReadbackVerificationInput>),
      resourceType: "requirement",
      protectedFields: ["status", "ownerId"],
    }, before, after, operation);
    if (verificationInput.operation === "development-item.node.complete") {
      return publicVerification({
        ...verification,
        patchApplied: verification.patchApplied && completedNode(
          after.context,
          typeof verificationInput.nodeId === "number" ? verificationInput.nodeId : undefined,
        ),
      });
    }
    return publicVerification(verification);
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

function readSaveContract(context: WorkflowContext, nodeId: number, componentKey?: string): SaveContract {
  const node = readNode(context, nodeId);
  if (!node) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", `需求上下文中不存在节点 ${nodeId}`);
  }
  let resolution;
  try {
    resolution = resolveWorkflowComponent(node as any, { componentKey, mode: "write" });
  } catch (error) {
    if (error instanceof ComponentResolutionError) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", error.message);
    }
    throw error;
  }
  const component = resolution.component as Record<string, any> | undefined;
  const raw = isRecord(component?.saveContract)
    ? component.saveContract
    : isRecord(resolution.saveContract) ? resolution.saveContract : null;
  if (!isRecord(raw)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "所选需求节点没有可写 saveContract");
  }
  if (["development-item.node.complete", "development-item.node.complete-with-data"].includes(raw.command)) {
    if (!isPositiveInteger(raw.itemId) || raw.itemId !== context.resource.id
      || !isPositiveInteger(raw.nodeId) || !isNonNegativeInteger(raw.version)
      || raw.itemType !== "REQUIREMENT" || raw.completionSupported !== true
      || raw.completionCommand !== raw.command
      || raw.nodeId !== nodeId || raw.version !== node.version) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点 completionContract 不完整");
    }
    return {
      command: raw.command,
      itemType: raw.itemType,
      itemId: raw.itemId,
      nodeId: raw.nodeId,
      version: raw.version,
      writableFields: [],
      protectedFields: isStringArray(raw.protectedFields) ? raw.protectedFields : [],
      completionSupported: true,
      completionCommand: raw.completionCommand,
      ...(typeof raw.completionMode === "string" ? { completionMode: raw.completionMode } : {}),
      ...(typeof raw.completionAutomaticConfirmation === "boolean"
        ? { completionAutomaticConfirmation: raw.completionAutomaticConfirmation } : {}),
      ...(typeof raw.completionBlockReason === "string" ? { completionBlockReason: raw.completionBlockReason } : {}),
    };
  }
  if (!isPositiveInteger(raw.itemId) || raw.itemId !== context.resource.id
    || !isPositiveInteger(raw.nodeId) || raw.nodeId !== nodeId || raw.version !== node.version || !isNonNegativeInteger(raw.version)
    || raw.command !== "development-item.node.field.update"
    || raw.itemType !== "REQUIREMENT" || typeof raw.fieldValuesPath !== "string"
    || !isStringArray(raw.effectiveWritableFields ?? raw.writableFields)) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点 saveContract 不完整");
  }
  return {
    command: raw.command,
    itemType: raw.itemType,
    itemId: raw.itemId,
    nodeId: raw.nodeId,
    version: raw.version,
    fieldValuesPath: raw.fieldValuesPath,
    componentKey: typeof raw.componentKey === "string" ? raw.componentKey : undefined,
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
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "节点写入参数与 saveContract 不一致");
  }
  if (contract.command !== "development-item.node.field.update") {
    if (normalizedArguments.fieldValues !== undefined) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "完成专用节点不允许写入字段");
    return;
  }
  if (!contract.fieldValuesPath) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点 saveContract.fieldValuesPath 不能为空");
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

function validateCompletionArguments(
  context: WorkflowContext,
  nodeId: number,
  normalizedArguments: Record<string, unknown>,
  componentKey?: string,
): void {
  const contract = readSaveContract(context, nodeId, componentKey);
  if (contract.command !== "development-item.node.complete" || !contract.completionSupported) {
    throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "需求节点未声明直接完成能力");
  }
  if (normalizedArguments.itemType !== contract.itemType
    || normalizedArguments.itemId !== contract.itemId
    || normalizedArguments.nodeId !== contract.nodeId
    || normalizedArguments.version !== contract.version) {
    throw new ResourceScenarioError("CONTEXT_CONFLICT", "节点完成参数与 completionContract 不一致");
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
    || input.operation === "development-item.node.complete"
    || input.operation === "development-item.node.complete-with-data") {
    const nodeId = requireNodeId(input);
    const contract = readSaveContract(context, nodeId, input.componentKey);
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

function completedNode(snapshot: unknown, nodeId?: number): boolean {
  if (!isRecord(snapshot) || nodeId === undefined) return false;
  const context = snapshot as WorkflowContext;
  const node = readNode(context, nodeId);
  return Number(node?.status) === 2;
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

function nestedFieldValues(path: string, fieldValues: unknown): Record<string, unknown> {
  if (!isRecord(fieldValues)) return {};
  if (path === "$") return fieldValues;
  const segments = path.split(".").filter(Boolean);
  let current: unknown = fieldValues;
  for (const segment of segments) {
    if (!isRecord(current)) return {};
    current = current[segment];
  }
  return isRecord(current) ? current : {};
}

function fieldValuesAtPath(path: string, patch: Record<string, unknown>): Record<string, unknown> {
  if (path === "$") return patch;
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", "saveContract.fieldValuesPath 不能为空");
  let result: Record<string, unknown> = patch;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    result = { [segments[index]!]: result };
  }
  return result;
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

