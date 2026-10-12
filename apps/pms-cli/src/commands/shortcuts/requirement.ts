import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { getResourceById, listResource, writeResource, type ListOptions, type WriteOptions } from "./resourceCommands.js";
import { operationExecute, type OperationOptions } from "../core/operation.js";

export const requirementList = (client: PmsClient, options: ListOptions = {}) => listResource(client, "requirement", options);
export const requirementGet = (client: PmsClient, id: number) => getResourceById(client, "requirement", id);
export const requirementCreate = (client: PmsClient, options: WriteOptions = {}) => writeResource(client, "requirement.create", options);
export const requirementUpdate = (client: PmsClient, options: WriteOptions = {}) => writeResource(client, "requirement.update", options);

export interface RequirementAnalysisSaveOptions extends OperationOptions {
  nodeId: number;
  version: number;
  idempotencyKey: string;
}

export function requirementAnalysisSave(
  client: PmsClient,
  requirementId: number,
  options: RequirementAnalysisSaveOptions,
) {
  if (!options.idempotencyKey.trim()) throw new Error("需求分析保存必须提供 idempotencyKey");
  return operationExecute(client, "requirement.analysis.save", options.idempotencyKey, {
    ...options,
    arguments: {
      requirementId,
      nodeId: options.nodeId,
      version: options.version,
      patch: options.arguments ?? {},
    },
  });
}
