import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { QueryResourceType } from "../../../../../packages/pms-contracts/src/index.js";
import { CliArgumentError } from "../../cli/parseArguments.js";

export type ResolvableResourceType = Extract<
  QueryResourceType,
  "project" | "requirement" | "topic" | "story"
>;

export interface ResourceReference {
  resourceType: ResolvableResourceType;
  resourceId: number;
  resourceName: string;
}

/**
 * Resolve a user-provided resource name through the PMS read facade.
 *
 * The query is intentionally exact after PMS performs its keyword search. A
 * partial or ambiguous match must return to the Agent for clarification rather
 * than silently selecting the wrong business object.
 */
export async function resolveResourceReference(
  client: PmsClient,
  resourceType: ResolvableResourceType,
  name: string,
): Promise<ResourceReference> {
  const normalizedName = name.trim();
  if (!normalizedName) throw new CliArgumentError("资源名称不能为空", "RESOURCE_NOT_FOUND");

  const result = await client.query({
    resourceType,
    keyword: normalizedName,
    filters: {},
    page: 1,
    pageSize: 100,
  });
  const normalizedTarget = normalizedName.toLocaleLowerCase();
  const matches = result.items.filter((item) =>
    item.name.trim().toLocaleLowerCase() === normalizedTarget,
  );

  if (matches.length === 0) {
    throw new CliArgumentError(
      `没有找到名称为“${normalizedName}”的${resourceLabel(resourceType)}`,
      "RESOURCE_NOT_FOUND",
    );
  }
  if (matches.length > 1) {
    throw new CliArgumentError(
      `名称为“${normalizedName}”的${resourceLabel(resourceType)}不唯一，请补充更多条件`,
      "RESOURCE_AMBIGUOUS",
    );
  }

  const match = matches[0];
  return {
    resourceType,
    resourceId: match.id,
    resourceName: match.name,
  };
}

export async function resolveResourceId(
  client: PmsClient,
  resourceType: ResolvableResourceType,
  input: { id?: number; name?: string },
): Promise<number> {
  if (input.id !== undefined && input.name !== undefined) {
    throw new CliArgumentError("资源 ID 与资源名称只能提供一个");
  }
  if (input.id !== undefined) return input.id;
  if (input.name === undefined) {
    throw new CliArgumentError(
      `需要提供${resourceLabel(resourceType)} ID 或 --name`,
    );
  }
  return (await resolveResourceReference(client, resourceType, input.name)).resourceId;
}

function resourceLabel(resourceType: ResolvableResourceType): string {
  return {
    project: "项目",
    requirement: "需求",
    topic: "专题",
    story: "故事",
  }[resourceType];
}
