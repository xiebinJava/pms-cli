import type {
  ContextComponent,
  ContextNode,
  ContextSaveContract,
} from "../../../../../packages/pms-contracts/src/index.js";

export type ComponentResolutionMode = "read" | "write";

export type ComponentResolutionReason =
  | "NO_COMPONENTS"
  | "NO_WRITABLE_SAVE_CONTRACT"
  | "MULTIPLE_WRITABLE_COMPONENTS"
  | "SELECTED_COMPONENT_NOT_WRITABLE";

export interface ComponentResolutionOptions {
  componentKey?: string;
  /** Compatibility alias used by the project adapter. */
  workbench?: string;
  mode: ComponentResolutionMode;
}

export interface ResolvedWorkflowComponent {
  node: ContextNode;
  component?: ContextComponent;
  saveContract?: ContextSaveContract;
  componentKey?: string;
  requestedComponentKey?: string;
  writableFields: string[];
  writeCapable: boolean;
  reason?: ComponentResolutionReason;
}

export type ComponentResolutionErrorCode =
  | "COMPONENT_NOT_FOUND"
  | "COMPONENT_SELECTION_REQUIRED"
  | "COMPONENT_NOT_WRITABLE"
  | "COMPONENT_SELECTOR_CONFLICT";

export class ComponentResolutionError extends Error {
  readonly name = "ComponentResolutionError";

  constructor(
    readonly code: ComponentResolutionErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/**
 * Resolves the backend-declared component and saveContract for a node.
 *
 * The resolver is deliberately independent from a resource adapter. That keeps
 * the same selection rule in context reads, draft validation, previews and
 * readback validation across project, requirement, topic and story resources.
 */
export function resolveWorkflowComponent(
  node: ContextNode,
  options: ComponentResolutionOptions,
): ResolvedWorkflowComponent {
  const requestedComponentKey = normalizeComponentKey(options);
  const components = node.components ?? [];
  const nodeContract = components.length === 0 && node.saveContract
    ? node.saveContract : node.completionContract;
  const nodeFields = nodeContract?.effectiveWritableFields ?? nodeContract?.writableFields ?? [];
  const nodeCompletion = nodeContract?.completionSupported === true
    && ["development-item.node.complete", "development-item.node.complete-with-data"].includes(nodeContract.command ?? "");
  if (requestedComponentKey === undefined && nodeContract
    && (components.length === 0 || components.every(candidate => writableFields(candidate).length === 0))
    && (nodeFields.length > 0 || nodeCompletion)) {
    return { node, saveContract: nodeContract, writableFields: nodeFields, writeCapable: true };
  }
  if (components.length === 0) {
    if (requestedComponentKey !== undefined) {
      throw new ComponentResolutionError("COMPONENT_NOT_FOUND", `节点没有组件 ${requestedComponentKey}，只能使用节点直接完成能力`);
    }
    if (options.mode === "write") {
      throw new ComponentResolutionError(
        "COMPONENT_NOT_WRITABLE",
        "当前节点没有后端声明的组件或 saveContract",
      );
    }
    return {
      node,
      writableFields: [],
      writeCapable: false,
      reason: "NO_COMPONENTS",
    };
  }

  const writable = components.filter((candidate) => writableFields(candidate).length > 0);
  const component = requestedComponentKey === undefined
    ? selectImplicitComponent(components, writable, options.mode)
    : findExplicitComponent(components, requestedComponentKey);

  if (!component) {
    if (options.mode === "write" && writable.length > 1) {
      throw new ComponentResolutionError(
        "COMPONENT_SELECTION_REQUIRED",
        "当前节点存在多个可写组件，请显式指定 componentKey",
      );
    }
    if (options.mode === "write") {
      throw new ComponentResolutionError(
        "COMPONENT_NOT_WRITABLE",
        "当前节点没有可写 saveContract",
      );
    }
    return {
      node,
      requestedComponentKey,
      writableFields: [],
      writeCapable: false,
      reason: writable.length > 1 ? "MULTIPLE_WRITABLE_COMPONENTS" : "NO_WRITABLE_SAVE_CONTRACT",
    };
  }

  const fields = writableFields(component);
  const saveContract = component.saveContract ?? undefined;
  const writeCapable = fields.length > 0;
  if (options.mode === "write" && !writeCapable) {
    throw new ComponentResolutionError(
      "COMPONENT_NOT_WRITABLE",
      `组件 ${component.key} 没有声明可写 saveContract`,
    );
  }

  return {
    node,
    component,
    ...(saveContract ? { saveContract } : {}),
    componentKey: component.key,
    ...(requestedComponentKey === undefined ? {} : { requestedComponentKey }),
    writableFields: fields,
    writeCapable,
    ...(writeCapable ? {} : { reason: "SELECTED_COMPONENT_NOT_WRITABLE" as const }),
  };
}

/** Normalizes project.workbench and the common componentKey selector once. */
export function normalizeComponentKey(options: Pick<ComponentResolutionOptions, "componentKey" | "workbench">): string | undefined {
  const componentKey = normalizeString(options.componentKey);
  const workbench = normalizeString(options.workbench);
  if (componentKey !== undefined && workbench !== undefined && componentKey !== workbench) {
    throw new ComponentResolutionError(
      "COMPONENT_SELECTOR_CONFLICT",
      `componentKey 与 workbench 不一致: ${componentKey} != ${workbench}`,
    );
  }
  return componentKey ?? workbench;
}

function selectImplicitComponent(
  components: ContextComponent[],
  writable: ContextComponent[],
  mode: ComponentResolutionMode,
): ContextComponent | undefined {
  if (writable.length === 1) return writable[0];
  if (writable.length > 1) {
    if (mode === "write") {
      throw new ComponentResolutionError(
        "COMPONENT_SELECTION_REQUIRED",
        "当前节点存在多个可写组件，请显式指定 componentKey",
      );
    }
    return undefined;
  }
  return components.length === 1 ? components[0] : undefined;
}

function findExplicitComponent(
  components: ContextComponent[],
  requestedComponentKey: string,
): ContextComponent {
  const component = components.find((candidate) => candidate.key === requestedComponentKey
    || candidate.saveContract?.componentKey === requestedComponentKey
    || candidate.saveContract?.workbench === requestedComponentKey);
  if (!component) {
    throw new ComponentResolutionError(
      "COMPONENT_NOT_FOUND",
      `未找到组件 ${requestedComponentKey}`,
    );
  }
  return component;
}

function writableFields(component: ContextComponent): string[] {
  const contract = component.saveContract;
  if (!contract) return [];
  const effective = contract.effectiveWritableFields ?? contract.writableFields ?? [];
  return [...new Set(effective.filter((field) => typeof field === "string" && field.trim() !== ""))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
