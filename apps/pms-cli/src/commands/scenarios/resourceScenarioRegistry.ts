import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type {
  OperationResult,
  ResourceScenarioExecuteInput,
  ParsedResourceScenarioInput,
  ResourceScenarioContext,
  ResourceScenarioResourceType,
  ResourceScenarioSnapshot,
  ResourceScenarioVerification,
} from "../../../../../packages/pms-contracts/src/index.js";

export class ResourceScenarioError extends Error {
  readonly name = "ResourceScenarioError";

  constructor(readonly code: "CAPABILITY_UNAVAILABLE" | "RESOURCE_NOT_FOUND" | "CONTEXT_CONFLICT", message: string) {
    super(`${code}: ${message}`);
  }
}

export interface ResourceScenarioAdapter {
  resourceType: ResourceScenarioResourceType;
  supports(operation: string): boolean;
  loadContext(client: PmsClient, input: ParsedResourceScenarioInput): Promise<ResourceScenarioContext | null>;
  normalizeArguments(
    input: ParsedResourceScenarioInput,
    context: ResourceScenarioContext | null,
  ): Promise<Record<string, unknown>>;
  validate(
    input: ParsedResourceScenarioInput,
    context: ResourceScenarioContext | null,
    normalizedArguments: Record<string, unknown>,
  ): void;
  resolveReadbackId(input: ResourceScenarioExecuteInput | ParsedResourceScenarioInput, operation: OperationResult): number | null;
  verifyReadback(
    before: ResourceScenarioSnapshot | null,
    after: ResourceScenarioSnapshot,
    normalizedArguments: Record<string, unknown>,
  ): ResourceScenarioVerification;
}

export interface ResourceScenarioRegistry {
  register(adapter: ResourceScenarioAdapter): void;
  find(resourceType: ResourceScenarioResourceType, operation: string): ResourceScenarioAdapter;
}

export function createResourceScenarioRegistry(
  initialAdapters: readonly ResourceScenarioAdapter[] = [],
): ResourceScenarioRegistry {
  const adapters = [...initialAdapters];
  return {
    register(adapter) {
      const existing = adapters.findIndex((candidate) => candidate.resourceType === adapter.resourceType);
      if (existing >= 0) adapters[existing] = adapter;
      else adapters.push(adapter);
    },
    find(resourceType, operation) {
      const adapter = adapters.find((candidate) =>
        candidate.resourceType === resourceType && candidate.supports(operation));
      if (!adapter) {
        throw new ResourceScenarioError(
          "CAPABILITY_UNAVAILABLE",
          `资源 ${resourceType} 未注册操作 ${operation} 的场景适配器`,
        );
      }
      return adapter;
    },
  };
}

export const resourceScenarioRegistry = createResourceScenarioRegistry();
