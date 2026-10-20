import type {
  UserFacingDisplay,
  UserFacingFieldChange,
  UserFacingResourceType,
} from "../../../../packages/pms-contracts/src/index.js";

export interface UserFacingFieldChangeInput {
  key?: unknown;
  field?: unknown;
  label?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface UserFacingDisplayInput {
  resourceType: UserFacingResourceType;
  context?: unknown;
  resourceDetails?: unknown;
  operationStatus?: string | null;
  actualChange?: string | null;
  targetNode?: unknown;
  fieldChanges?: readonly UserFacingFieldChangeInput[];
  blockers?: string[];
}

/**
 * Builds the only projection that a natural-language Agent should use when it
 * reports a PMS result. IDs are deliberately read only to locate names and
 * never copied into this object.
 */
export function buildUserFacingDisplay(input: UserFacingDisplayInput): UserFacingDisplay {
  const context = asRecord(input.context);
  const details = asRecord(input.resourceDetails)
    ?? asRecord(context?.resourceDetails)
    ?? asRecord(asRecord(context?.resource)?.details)
    ?? asRecord(asRecord(context?.snapshot)?.resourceDetails)
    ?? {};
  const currentNode = asRecord(context?.currentNode)
    ?? asRecord(asRecord(context?.snapshot)?.currentNode);
  const meta = asRecord(context?.meta)
    ?? asRecord(asRecord(context?.snapshot)?.meta);
  const currentNodeLabel = firstString(currentNode, ["label", "name", "title"]);
  const blockers = input.blockers
    ?? warningMessages(meta)
    ?? warningMessages(context)
    ?? [];

  return {
    resourceType: input.resourceType,
    resourceName: resourceName(input.resourceType, details),
    resourceStatus: resourceStatus(details, meta),
    currentNode: currentNodeLabel,
    targetNode: displayNode(input.targetNode)
      ?? displayNode(context?.targetNode)
      ?? currentNodeLabel,
    operationStatus: input.operationStatus ?? null,
    actualChange: input.actualChange ?? null,
    fieldChanges: normalizeFieldChanges(input.fieldChanges),
    blockers: blockers.map(safeBlocker).filter((value): value is string => value !== null),
  };
}

export function normalizeFieldChanges(
  changes: readonly UserFacingFieldChangeInput[] | undefined,
): UserFacingFieldChange[] {
  if (!changes) return [];
  return changes.flatMap((change) => {
    const record = asRecord(change);
    if (!record) return [];
    const field = firstString(record, ["label", "field", "key"]);
    if (!field) return [];
    const key = firstString(record, ["key", "field", "label"]) ?? field;
    return [{
      field,
      from: displayFieldValue(record.from, key),
      to: displayFieldValue(record.to, key),
    }];
  });
}

function displayNode(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  const record = asRecord(value);
  return firstString(record, ["label", "name", "title"]);
}

function displayFieldValue(value: unknown, key: string): string | null {
  if (value === null || value === undefined) return null;
  if (/(^|_)(id|ids)$|id$/i.test(key)) return "已设置";
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  const record = asRecord(value);
  if (record) return firstString(record, ["name", "title", "label", "displayName"]) ?? "已更新";
  if (Array.isArray(value)) return value.length === 0 ? "空" : "已更新";
  return "已更新";
}

function resourceStatus(
  details: Record<string, unknown>,
  meta: Record<string, unknown> | undefined,
): string | null {
  const explicit = firstString(details, ["status", "state", "workflowStatus"])
    ?? firstString(meta, ["workflowStatus", "terminalStatus", "status"]);
  if (explicit) return explicit;

  const numeric = firstNumber(details, ["status"]);
  if (numeric === null) return null;
  if (numeric === 0 || numeric === 1) return "IN_PROGRESS";
  if (numeric === 2) return "COMPLETED";
  if (numeric === 3) return "TERMINATED";
  if (numeric === 4) return "DELETED";
  return null;
}

export function resourceName(
  resourceType: UserFacingResourceType,
  details: Record<string, unknown>,
): string {
  const keys = resourceType === "project"
    ? ["name", "title"]
    : ["title", "name"];
  return firstString(details, keys) ?? "名称未返回";
}

function warningMessages(value: Record<string, unknown> | undefined): string[] | undefined {
  if (!value || !Array.isArray(value.warnings)) return undefined;
  const messages = value.warnings.flatMap((warning) => {
    if (typeof warning === "string") return [warning];
    const record = asRecord(warning);
    return record && typeof record.message === "string" ? [record.message] : [];
  });
  return messages.length > 0 ? messages : undefined;
}

function firstString(value: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
  }
  return null;
}

function firstNumber(value: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!value) return null;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function safeBlocker(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Keep the business message while removing the common identifier forms.
  const withoutIds = trimmed
    .replace(/(项目|需求|专题|故事|节点)\s*(?:ID\s*)?[:#=]?\s*\d+/gi, "$1")
    .replace(/\b(?:ID|id)\s*[:#=]?\s*\d+/g, "");
  return withoutIds.trim() || "存在未说明的阻塞";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
