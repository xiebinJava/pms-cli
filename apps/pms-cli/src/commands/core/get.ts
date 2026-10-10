import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { QueryItem } from "../../../../../packages/pms-contracts/src/index.js";

export async function getResource(client: PmsClient, resourceType: QueryItem["type"], resourceId: number) {
  const capabilities = await client.capabilities();
  if (capabilities.features?.resourceGet !== true) {
    throw new Error("当前 PMS 未声明精确资源读取能力（features.resourceGet）");
  }
  return client.get({ type: resourceType, id: resourceId });
}
