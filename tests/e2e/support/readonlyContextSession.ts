import type { WorkflowContext } from "../../../packages/pms-contracts/src/index.js";

const RESOURCES = ['project', 'requirement', 'topic', 'story'] as const;
export type ReadonlyResourceType = (typeof RESOURCES)[number];

export interface ReadonlyContextCase {
  resourceType: ReadonlyResourceType;
  resourceId: number;
  nodeId?: number;
  view?: "legacy" | "focused";
  component?: string;
}

export interface ReadonlyContextCaseStore {
  /** Mapped by <type> or <type>:<index> for repeated fixtures. */
  ids: Record<string, number>;
}

/**
 * Resolves a readonly-context e2e case from the environment without falling back to the
 * first search result and without creating/cleaning anything. A missing id for a type only
 * marks that scenario as "not run" — it never fabricates a target.
 */
export function requireReadonlyContextCase(
  resourceType: ReadonlyResourceType,
  env: Record<string, string | undefined> = process.env,
  store: ReadonlyContextCaseStore = envStore(env),
): { case: ReadonlyContextCase; skipReason?: string } {
  const rawId = env[`${resourceType.toUpperCase()}_SR_ID`];
  if (!rawId) {
    return { case: { resourceType, resourceId: 0 }, skipReason: `${resourceType}_SR_ID 未提供` };
  }
  const parsed = Number(rawId);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > Number.MAX_SAFE_INTEGER) {
    return { case: { resourceType, resourceId: 0 }, skipReason: `${resourceType}_SR_ID 非法` };
  }
  const rawNodeId = env[`${resourceType.toUpperCase()}_SR_NODE_ID`];
  let nodeId: number | undefined;
  if (rawNodeId) {
    const parsedNodeId = Number(rawNodeId);
    if (!Number.isInteger(parsedNodeId) || parsedNodeId <= 0
        || parsedNodeId > Number.MAX_SAFE_INTEGER) {
      return { case: { resourceType, resourceId: parsed }, skipReason: `${resourceType}_SR_NODE_ID 非法` };
    }
    nodeId = parsedNodeId;
  }
  const view = rawNodeId !== undefined && env[`${resourceType.toUpperCase()}_SR_VIEW`] === "focused"
    ? "focused" as const
    : undefined;
  const component = view === "focused" && env[`${resourceType.toUpperCase()}_SR_COMPONENT`]?.trim()
    ? env[`${resourceType.toUpperCase()}_SR_COMPONENT`]
    : undefined;
  return { case: { resourceType, resourceId: parsed, nodeId, view, component } };
}

function envStore(env: Record<string, string | undefined>): ReadonlyContextCaseStore {
  const ids: Record<string, number> = {};
  for (const type of RESOURCES) {
    const raw = env[`${type.toUpperCase()}_SR_ID`];
    const value = raw ? Number(raw) : undefined;
    if (value !== undefined && Number.isInteger(value) && value > 0) ids[type] = value;
  }
  return { ids };
}

export function assertContextReceipt(
  requested: ResourceRefLike,
  context: WorkflowContext,
  explicitNodeId?: number,
  explicitComponent?: string,
): void {
  if (context.resource.id !== requested.id
      || context.resource.type !== requested.resourceType) {
    throw new Error(`context 响应定位不一致: ${JSON.stringify(context.resource)}`);
  }
  if (explicitNodeId !== undefined) {
    const nodeId = (context.meta as { selectedNodeId?: number | null } | undefined)?.selectedNodeId;
    if (nodeId !== explicitNodeId) {
      throw new Error(`selectedNodeId=${nodeId ?? null} 与请求 nodeId=${explicitNodeId} 不一致`);
    }
  }
  if (explicitComponent !== undefined
      && (context.meta as { selectedComponentKey?: string | null } | undefined)
          ?.selectedComponentKey !== explicitComponent) {
    throw new Error("selectedComponentKey 与请求 component 不一致");
  }
}

interface ResourceRefLike {
  resourceType: string;
  id: number;
}
