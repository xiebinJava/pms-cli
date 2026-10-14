import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { ContextReadOptions, QueryItem } from "../../../../../packages/pms-contracts/src/index.js";

export function getContext(
  client: PmsClient,
  resourceType: QueryItem["type"],
  resourceId: number,
  options?: ContextReadOptions,
) {
  return client.context({ type: resourceType, id: resourceId }, options);
}
