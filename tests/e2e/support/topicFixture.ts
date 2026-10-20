import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import type { OperationResult } from "../../../packages/pms-contracts/src/index.js";
import { operationExecutePreview, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";
import { resolveWorkflowComponent } from "../../../apps/pms-cli/src/commands/core/componentResolver.js";
import type { WritableNodeFixture } from "./projectFixture.js";

export interface TopicFixture {
  topicId: number;
  title: string;
  created: true;
  node: WritableNodeFixture;
}

/** Creates a standalone topic in the disposable E2E database. */
export async function createTopicFixture(
  client: PmsClient,
  runId: string,
): Promise<TopicFixture> {
  const viewer = (await client.capabilities()).viewer;
  const title = `AI-E2E-专题-${runId}`;
  const preview = await operationPreview(client, "topic.create", {
    arguments: {
      title,
      ...(viewer?.id === undefined ? {} : { ownerId: viewer.id }),
    },
    context: { id: "global:pms", version: "v1" },
  });
  const result = await operationExecutePreview(client, preview.operationId, `topic-fixture-${runId}`);
  if (result.status !== "SUCCEEDED") throw new Error("专题夹具创建未成功");
  const topicId = readTopicId(result);
  if (topicId === null) throw new Error("专题夹具创建成功响应缺少专题 ID");
  const readback = await client.get({ type: "topic", id: topicId });
  if (readback.resourceId !== topicId) throw new Error("专题夹具回读资源 ID 不一致");
  const ownerId = viewer?.id;
  if (!ownerId) throw new Error("专题夹具能力目录缺少当前用户 ID，无法完成节点验收");
  const node = await findWritableNode(client, topicId, ownerId);
  return { topicId, title, created: true, node };
}

async function findWritableNode(client: PmsClient, topicId: number, ownerId: number): Promise<WritableNodeFixture> {
  const legacy = await client.context({ type: "topic", id: topicId });
  const nodeId = positiveNodeId(legacy.currentNode?.id, "专题夹具创建后没有当前节点，无法进行节点场景验收");
  const focused = await client.context(
    { type: "topic", id: topicId },
    { nodeId, view: "focused" },
  );
  const node = (focused.workflow?.nodes ?? []).find((candidate) => isRecord(candidate)
    && candidate.id === nodeId);
  if (!isRecord(node)) throw new Error(`专题夹具当前节点 ${nodeId} 无法读取 focused 上下文`);
  let resolution;
  try {
    resolution = resolveWorkflowComponent(node as any, { mode: "write" });
  } catch (error) {
    throw new Error(`专题夹具当前节点 ${nodeId} 没有唯一可写组件：${error instanceof Error ? error.message : String(error)}`);
  }
  const contract = isRecord(resolution.saveContract) ? resolution.saveContract : undefined;
  const fieldKey = resolution.writableFields.find((field) => !stringArray(contract?.protectedFields).includes(field));
  if (!fieldKey || !resolution.componentKey) {
    throw new Error(`专题夹具当前节点 ${nodeId} 没有不受保护的可写字段`);
  }
  const requiredValues = requiredFieldValues(contract?.fieldContracts, resolution.writableFields);
  // topic-research has conditional business validation that is stricter than
  // the generic workflow field contract: YES requires goal and reportUrl.
  if (resolution.componentKey === "topic-research") {
    requiredValues.needed = "YES";
    requiredValues.goal = `AI-E2E-${topicId}-research-goal`;
    requiredValues.reportUrl = `AI-E2E-${topicId}-research-report`;
  }
  return {
    nodeId,
    nodeVersion: readInteger(contract?.version ?? node.version, `专题节点 ${nodeId} 缺少节点版本`),
    contextVersion: readInteger(focused.version, `专题 ${topicId} 缺少流程版本`),
    componentKey: resolution.componentKey,
    fieldKey,
    fieldValue: resolution.componentKey === "topic-research" && fieldKey === "needed"
      ? "YES"
      : fixtureValue(contract?.fieldContracts, fieldKey),
    requiredFieldValues: requiredValues,
    ownerId,
    completionSupported: contract?.completionSupported === true
      && contract?.completionCommand === "development-item.node.complete-with-data",
    completionMode: typeof contract?.completionMode === "string" ? contract.completionMode : null,
    completionRequiredMetadata: stringArray(contract?.completionRequiredMetadata),
  };
}

function requiredFieldValues(rawContracts: unknown, writableFields: string[]): Record<string, unknown> {
  const contracts = Array.isArray(rawContracts) ? rawContracts : [];
  const writable = new Set(writableFields);
  return Object.fromEntries(contracts
    .filter((candidate) => isRecord(candidate)
      && candidate.required === true
      && typeof candidate.key === "string"
      && writable.has(candidate.key))
    .map((candidate) => [candidate.key as string, fixtureValue(contracts, candidate.key as string)]));
}

function fixtureValue(rawContracts: unknown, fieldKey: string): unknown {
  const contracts = Array.isArray(rawContracts) ? rawContracts : [];
  const contract = contracts.find((candidate) => isRecord(candidate) && candidate.key === fieldKey);
  if (!isRecord(contract)) return `AI-E2E-${fieldKey}`;
  const options = Array.isArray(contract.options) ? contract.options : [];
  if (options.length > 0) return options[0];
  const type = typeof contract.type === "string" ? contract.type.toLowerCase() : "string";
  if (type === "boolean") return true;
  if (type === "number" || type === "integer") return 1;
  if (type === "array") return [`AI-E2E-${fieldKey}`];
  if (type.includes("date")) return "2026-10-10";
  return `AI-E2E-${fieldKey}`;
}

function readInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(message);
  return value;
}

function positiveNodeId(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(message);
  return value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTopicId(result: OperationResult): number | null {
  const rawId = result.data.topicId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
