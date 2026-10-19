import type { PmsClient } from "../../../../packages/pms-client/src/index.js";
import type {
  ActionCapability,
  CapabilityCatalog,
  QueryItem,
  ResourceType,
  WorkflowContext,
} from "../../../../packages/pms-contracts/src/index.js";

export class CapabilityResolver {
  private catalog?: CapabilityCatalog;

  constructor(private readonly client: PmsClient) {}

  async list(scope?: string): Promise<CapabilityCatalog> {
    const catalog = this.catalog ?? await this.client.capabilities();
    this.catalog = catalog;
    if (!scope) return catalog;
    return {
      ...catalog,
      resources: catalog.resources
        .map((resource) => ({
          ...resource,
          actions: resource.actions.filter((action) => action.scopes.includes(scope)),
        }))
        .filter((resource) => resource.actions.length > 0),
    };
  }

  async context(resourceType: QueryItem["type"], resourceId: number): Promise<WorkflowContext> {
    return this.client.context({ type: resourceType, id: resourceId });
  }

  async action(operation: string): Promise<ActionCapability> {
    const catalog = await this.list();
    for (const resource of catalog.resources) {
      const action = resource.actions.find((candidate) => candidate.name === operation);
      if (action) return action;
    }
    throw new Error(`能力目录中不存在操作: ${operation}`);
  }

  async supportsProvenance(version = "draft-provenance/v1"): Promise<boolean> {
    const catalog = await this.list();
    return catalog.provenanceVersions?.includes(version) ?? false;
  }

  async provenanceState(version = "draft-provenance/v1"): Promise<"supported" | "unsupported" | "unknown"> {
    const catalog = await this.list();
    if (catalog.provenanceVersions === undefined) return "unknown";
    return catalog.provenanceVersions.includes(version) ? "supported" : "unsupported";
  }

  validateArguments(operation: string, argumentsValue: Record<string, unknown>): Record<string, unknown> {
    const action = this.cachedAction(operation);
    const values = { ...argumentsValue };
    for (const [key, field] of Object.entries(action.inputSchema)) {
      const value = values[key];
      if (field.required && (value === undefined || value === null || value === "")) {
        throw new Error(`缺少必填参数: ${key}`);
      }
      const options = field.options ?? field.enumValues;
      if (value !== undefined && options && !options.some((option) => String(option) === String(value))) {
        throw new Error(`参数 ${key} 不在允许选项中`);
      }
    }
    return values;
  }

  private cachedAction(operation: string): ActionCapability {
    if (!this.catalog) throw new Error("请先加载能力目录");
    for (const resource of this.catalog.resources) {
      const action = resource.actions.find((candidate) => candidate.name === operation);
      if (action) return action;
    }
    throw new Error(`能力目录中不存在操作: ${operation}`);
  }
}

export type { ResourceType };
