import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { QueryRequest, QueryResult, QueryItem } from "../../../../../packages/pms-contracts/src/index.js";
import { getResource } from "../core/get.js";
import { operationExecutePreview, operationPreview, type OperationOptions } from "../core/operation.js";
import { search } from "../core/search.js";

export interface ListOptions {
  keyword?: string;
  filters?: Record<string, unknown>;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface WriteOptions extends OperationOptions {
  dryRun?: boolean;
  idempotencyKey?: string;
  previewOperationId?: string;
}

export function listResource(
  client: PmsClient,
  resourceType: QueryItem["type"],
  options: ListOptions = {},
): Promise<QueryResult> {
  const { keyword, filters, page, pageSize, ...shortcutFilters } = options;
  const request: QueryRequest = {
    resourceType,
    keyword,
    filters: { ...shortcutFilters, ...(filters ?? {}) },
    page: page ?? 1,
    pageSize: pageSize ?? 20,
  };
  return search(client, request);
}

export function getResourceById(client: PmsClient, resourceType: QueryItem["type"], id: number) {
  return getResource(client, resourceType, id);
}

export async function writeResource(
  client: PmsClient,
  operation: string,
  options: WriteOptions = {},
) {
  if (options.dryRun) return operationPreview(client, operation, options);
  if (!options.idempotencyKey?.trim()) throw new Error("写操作必须提供 idempotencyKey");
  if (!options.previewOperationId?.trim()) throw new Error("写操作必须提供 preview-operation-id");
  return operationExecutePreview(client, options.previewOperationId, options.idempotencyKey);
}
