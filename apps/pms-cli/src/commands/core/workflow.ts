import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type { QueryItem } from "../../../../../packages/pms-contracts/src/index.js";
import { operationExecute, type OperationOptions } from "./operation.js";

export async function workflowAction(
  client: PmsClient,
  resourceType: QueryItem["type"],
  resourceId: number,
  action: string,
  idempotencyKey: string,
  options: OperationOptions = {},
) {
  if (!idempotencyKey.trim()) throw new Error("workflow action 必须提供 idempotencyKey");
  const context = options.context
    ? undefined
    : await client.context({ type: resourceType, id: resourceId });
  if (context && !context.allowedActions.includes(action)) {
    throw new Error("当前对象不允许执行操作: " + action);
  }
  const contextVersion = options.context?.version ?? String(context?.version ?? "");
  if (!contextVersion) throw new Error("当前对象缺少可用于恢复的 context version");
  return operationExecute(client, action, idempotencyKey, {
    ...options,
    context: options.context ?? { id: `${resourceType}:${resourceId}`, version: contextVersion },
  });
}
