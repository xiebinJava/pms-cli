import type {
  OperationResult,
  ResourceScenarioSnapshot,
  ResourceScenarioVerification,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { resolveWorkflowComponent } from "../core/componentResolver.js";

export type ReadbackResourceType = "requirement" | "project" | "topic" | "story";

export type VerificationComparison = {
  known: boolean;
  matches: boolean;
  mismatches: string[];
};

export type ReadbackVerificationInput = {
  resourceType: ReadbackResourceType;
  resourceId?: number;
  nodeId?: number;
  componentKey?: string;
  expectedPatch?: Record<string, unknown>;
  protectedFields?: string[];
};

export type BuiltVerificationResult = ResourceScenarioVerification & {
  readbackComplete: boolean;
  patchComparison: VerificationComparison;
  protectedComparison: VerificationComparison;
};

/**
 * Merges resource and workflow projections into the only snapshot used by the verifier.
 * Component content is resolved through the same resolver as the write path; it is never
 * selected by array position or by a resource-specific details path.
 */
export function mergeSnapshotDetails(
  snapshot: ResourceScenarioSnapshot | null | undefined,
  resourceType?: ReadbackResourceType,
  componentKey?: string,
  nodeId?: number,
): Record<string, unknown> | null {
  if (!snapshot) return null;
  const details: Record<string, unknown> = {
    ...(snapshot.resource?.details ?? {}),
    ...(snapshot.context?.resourceDetails ?? {}),
  };
  if (resourceType && snapshot.context) {
    const content = extractComponentContent(snapshot, resourceType, componentKey, nodeId);
    if (content) Object.assign(details, content);
  }
  return details;
}

/** Returns the loaded business fields for the selected workflow component. */
export function extractComponentContent(
  snapshot: ResourceScenarioSnapshot | null | undefined,
  _resourceType: ReadbackResourceType,
  componentKey?: string,
  nodeId?: number,
): Record<string, unknown> | undefined {
  const context = snapshot?.context;
  if (!context) return undefined;
  const node = readNode(context, nodeId);
  if (!node) return undefined;
  const requestedComponent = componentKey ?? context.meta?.selectedComponentKey ?? undefined;
  let component: Record<string, unknown> | undefined;
  try {
    component = resolveWorkflowComponent(node as any, {
      componentKey: requestedComponent,
      mode: "read",
    }).component as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
  if (!component) return undefined;
  if (component.contentState === "NOT_REQUESTED" || component.contentState === "UNSUPPORTED") {
    return undefined;
  }
  if (isRecord(component.content)) return component.content;
  const contract = isRecord(component.saveContract) ? component.saveContract : undefined;
  const fieldValues = isRecord(node.fieldValues) ? node.fieldValues : undefined;
  const path = typeof contract?.fieldValuesPath === "string" ? contract.fieldValuesPath : undefined;
  const fromFieldValues = path ? readPath(fieldValues, path) : undefined;
  return isRecord(fromFieldValues) ? fromFieldValues : undefined;
}

/** Returns the field contracts declared by the selected saveContract. */
export function extractFieldContracts(
  snapshot: ResourceScenarioSnapshot | null | undefined,
  resourceType: ReadbackResourceType,
  componentKey?: string,
  nodeId?: number,
): Array<Record<string, unknown>> {
  const contract = extractComponentSaveContract(snapshot, resourceType, componentKey, nodeId);
  return Array.isArray(contract?.fieldContracts)
    ? contract.fieldContracts.filter(isRecord)
    : [];
}

export function extractComponentSaveContract(
  snapshot: ResourceScenarioSnapshot | null | undefined,
  _resourceType: ReadbackResourceType,
  componentKey?: string,
  nodeId?: number,
): Record<string, unknown> | undefined {
  const context = snapshot?.context;
  const node = context ? readNode(context, nodeId) : undefined;
  if (!context || !node) return undefined;
  const requestedComponent = componentKey ?? context.meta?.selectedComponentKey ?? undefined;
  try {
    const component = resolveWorkflowComponent(node as any, {
      componentKey: requestedComponent,
      mode: "read",
    }).component as Record<string, unknown> | undefined;
    return isRecord(component?.saveContract) ? component.saveContract : undefined;
  } catch {
    return undefined;
  }
}

export function comparePatchedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  expectedPatch: Record<string, unknown> | undefined,
  fieldContracts: readonly Record<string, unknown>[] = [],
): VerificationComparison {
  if (expectedPatch === undefined) return unknownComparison("expectedPatch 未提供");
  const afterRecord = after ?? {};
  const mismatches: string[] = [];
  let known = true;
  for (const [key, expected] of Object.entries(expectedPatch)) {
    if (!Object.prototype.hasOwnProperty.call(afterRecord, key)) {
      known = false;
      mismatches.push(`${key}: 回读未提供字段`);
      continue;
    }
    const contract = fieldContracts.find((candidate) => candidate.key === key);
    if (!valuesEqual(afterRecord[key], expected, contract)) {
      mismatches.push(`${key}: 期望 ${stringify(expected)}，实际 ${stringify(afterRecord[key])}`);
    }
  }
  // `before` is intentionally accepted as part of the contract. A patch may legitimately
  // write the same value, so equality is checked against the expected after-state only.
  void before;
  return { known, matches: known && mismatches.length === 0, mismatches };
}

export function compareProtectedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  protectedFields: readonly string[],
  allowedMutations: unknown = undefined,
): VerificationComparison {
  if (!before) return { known: true, matches: true, mismatches: [] };
  if (!after) return unknownComparison("保护字段缺少回读快照");
  const allowed = mutationKeys(allowedMutations);
  // A protected field can be introduced by a focused component projection
  // after the write (for example projectId/nodeId metadata). Without a
  // before-state value there is no mutation to compare, so only fields that
  // were observable before the operation participate in the invariant.
  const observable = protectedFields.filter((key) =>
    Object.prototype.hasOwnProperty.call(before, key));
  const mismatches: string[] = [];
  let known = true;
  for (const key of observable) {
    if (allowed.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(before, key)
      || !Object.prototype.hasOwnProperty.call(after, key)) {
      known = false;
      mismatches.push(`${key}: 保护字段回读不完整`);
      continue;
    }
    if (!valuesEqual(before[key], after[key])) {
      mismatches.push(`${key}: 保护字段发生未授权变化`);
    }
  }
  return { known, matches: known && mismatches.length === 0, mismatches };
}

export function buildVerificationResult(
  input: ReadbackVerificationInput,
  before: ResourceScenarioSnapshot | null,
  after: ResourceScenarioSnapshot,
  operation: OperationResult,
): BuiltVerificationResult {
  const operationResource = operation.data[input.resourceType];
  const expectedResourceId = input.resourceId
    ?? operation.data[`${input.resourceType}Id`]
    ?? (isRecord(operationResource) ? operationResource.id : undefined)
    ?? before?.resource?.resourceId
    ?? before?.context?.resource.id;
  const resourceReadback = after.resource?.resourceType === input.resourceType
    && (expectedResourceId === undefined || after.resource.resourceId === Number(expectedResourceId));
  const contextReadback = after.context?.resource.type === input.resourceType
    && (expectedResourceId === undefined || after.context.resource.id === Number(expectedResourceId));
  const beforeDetails = mergeSnapshotDetails(before, input.resourceType, input.componentKey, input.nodeId);
  const afterDetails = mergeSnapshotDetails(after, input.resourceType, input.componentKey, input.nodeId);
  const fieldContracts = [
    ...extractFieldContracts(before, input.resourceType, input.componentKey, input.nodeId),
    ...extractFieldContracts(after, input.resourceType, input.componentKey, input.nodeId),
  ].filter((contract, index, all) => all.findIndex((candidate) => candidate.key === contract.key) === index);
  const contract = extractComponentSaveContract(after, input.resourceType, input.componentKey, input.nodeId)
    ?? extractComponentSaveContract(before, input.resourceType, input.componentKey, input.nodeId);
  const protectedFields = [
    ...(input.protectedFields ?? []),
    ...(Array.isArray(contract?.protectedFields) ? contract.protectedFields.filter(isString) : []),
  ].filter((field, index, all) => all.indexOf(field) === index);
  const patchComparison = comparePatchedFields(beforeDetails, afterDetails, input.expectedPatch, fieldContracts);
  const protectedComparison = compareProtectedFields(
    beforeDetails,
    afterDetails,
    protectedFields,
    operation.data.allowedMutations,
  );
  const readbackComplete = resourceReadback && contextReadback
    && patchComparison.known && protectedComparison.known;
  return {
    resourceReadback,
    contextReadback,
    patchApplied: readbackComplete && patchComparison.matches && operation.status === "SUCCEEDED",
    protectedFieldsUnchanged: protectedComparison.matches,
    readbackComplete,
    patchComparison,
    protectedComparison,
  };
}

export function publicVerification(result: BuiltVerificationResult): ResourceScenarioVerification {
  return {
    resourceReadback: result.resourceReadback,
    contextReadback: result.contextReadback,
    patchApplied: result.patchApplied,
    protectedFieldsUnchanged: result.protectedFieldsUnchanged,
  };
}

function readNode(context: WorkflowContext, nodeId?: number): Record<string, unknown> | undefined {
  const selectedNodeId = nodeId ?? context.meta?.selectedNodeId ?? context.currentNode?.id ?? undefined;
  if (selectedNodeId === undefined || selectedNodeId === null) return undefined;
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === selectedNodeId);
  return isRecord(node) ? node : undefined;
}

function readPath(value: Record<string, unknown> | undefined, path: string): unknown {
  if (!value) return undefined;
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) =>
    isRecord(current) ? current[segment] : undefined, value);
}

function valuesEqual(left: unknown, right: unknown, contract?: Record<string, unknown>): boolean {
  const type = typeof contract?.type === "string" ? contract.type.toLowerCase() : undefined;
  if (type?.includes("date")) return normalizeDate(left) === normalizeDate(right);
  if (type === "number" || type === "integer") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  if (type === "boolean") return normalizeBoolean(left) === normalizeBoolean(right);
  // PMS may enrich a structured field on write (for example, scope items get
  // generated IDs). Compare the caller's expected shape as a subset while
  // keeping array cardinality and order strict, so readback still proves that
  // the complete list was replaced rather than merely containing the patch.
  if (Array.isArray(right)) {
    return Array.isArray(left)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isRecord(right)) {
    return isRecord(left)
      && Object.entries(right).every(([key, value]) => valuesEqual(left[key], value));
  }
  return stringify(left) === stringify(right);
}

function normalizeDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value);
  const calendarDate = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (calendarDate) return calendarDate;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}

function normalizeBoolean(value: unknown): boolean | unknown {
  if (typeof value !== "string") return Boolean(value);
  if (value.trim().toLowerCase() === "true") return true;
  if (value.trim().toLowerCase() === "false") return false;
  return value;
}

function stringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${key}:${stringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function mutationKeys(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.filter(isString));
  if (isRecord(value)) return new Set(Object.keys(value));
  return new Set();
}

function unknownComparison(message: string): VerificationComparison {
  return { known: false, matches: false, mismatches: [message] };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
