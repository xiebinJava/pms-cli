import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import type { CapabilityCatalog, OperationResult } from "../../../packages/pms-contracts/src/index.js";
import { operationExecutePreview, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";

export interface RequirementFixture {
  requirementId: number;
  nodeId: number;
  version: number;
  title: string;
}

export function fixtureTitle(runId: string): string {
  const normalized = runId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(normalized)) {
    throw new Error("需求夹具 run ID 只允许 3-64 位字母、数字、下划线和连字符");
  }
  return `AI-E2E-需求-${normalized}`;
}

export function fixtureScheduleDates(now = new Date()): { startDate: string; endDate: string } {
  const start = new Date(now);
  if (Number.isNaN(start.getTime())) throw new Error("需求夹具基准日期无效");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export async function createRequirementFixture(
  client: PmsClient,
  runId: string,
): Promise<RequirementFixture> {
  const title = fixtureTitle(runId);
  const capabilities = await client.capabilities();
  const templateVersionId = requirementAnalysisTemplateVersion(capabilities);
  const ownerId = capabilities.viewer?.id;
  if (!ownerId) throw new Error("需求夹具能力目录缺少当前用户 ID，无法分配节点负责人");
  const argumentsValue = {
    title,
    description: `AI 隔离验收需求 ${runId}`,
    priority: 2,
    templateVersionId,
  };
  const createPreview = await operationPreview(client, "requirement.create", {
    arguments: argumentsValue,
    context: { id: "global:pms", version: "v1" },
  });
  const result = await operationExecutePreview(client, createPreview.operationId, `requirement-create-${runId}`);
  const requirementId = readRequirementId(result);
  if (result.status !== "SUCCEEDED" || requirementId === null) {
    throw new Error("需求夹具创建成功响应缺少需求 ID");
  }

  let context = await client.context({ type: "requirement", id: requirementId });
  if (context.version === null || context.currentNode?.id === null || context.currentNode?.id === undefined) {
    throw new Error("需求夹具上下文缺少当前节点或版本");
  }

  // A newly-created requirement starts at “需求录入”. Populate the required
  // business-line binding and complete that node through the same registered
  // operations a user/agent would use, so the fixture enters the real
  // receiving-and-analysis node instead of guessing a node id.
  const initialNodeId = context.currentNode.id;
  const ownerPreview = await operationPreview(client, "development-item.node.owner.update", {
    arguments: {
      itemType: "REQUIREMENT",
      itemId: requirementId,
      nodeId: initialNodeId,
      ownerId,
      version: context.version,
    },
    context: { id: `requirement:${requirementId}`, version: String(context.version) },
  });
  const ownerUpdate = await operationExecutePreview(client, ownerPreview.operationId,
    `requirement-fixture-owner-${runId}`);
  if (ownerUpdate.status !== "SUCCEEDED") throw new Error("需求夹具无法分配需求录入节点负责人");

  context = await client.context({ type: "requirement", id: requirementId });
  if (context.version === null || context.currentNode?.id !== initialNodeId) {
    throw new Error("需求夹具分配负责人后上下文版本或当前节点异常");
  }
  const scheduleDates = fixtureScheduleDates();
  const schedulePreview = await operationPreview(client, "development-item.node.schedule.update", {
    arguments: {
      itemType: "REQUIREMENT",
      itemId: requirementId,
      nodeId: initialNodeId,
      startDate: scheduleDates.startDate,
      endDate: scheduleDates.endDate,
      version: context.version,
    },
    context: { id: `requirement:${requirementId}`, version: String(context.version) },
  });
  const scheduleUpdate = await operationExecutePreview(client, schedulePreview.operationId,
    `requirement-fixture-schedule-${runId}`);
  if (scheduleUpdate.status !== "SUCCEEDED") throw new Error("需求夹具无法设置需求录入节点排期");

  context = await client.context({ type: "requirement", id: requirementId });
  if (context.version === null || context.currentNode?.id !== initialNodeId) {
    throw new Error("需求夹具设置排期后上下文版本或当前节点异常");
  }
  const fieldPreview = await operationPreview(client, "development-item.node.field.update", {
    arguments: {
      itemType: "REQUIREMENT",
      itemId: requirementId,
      nodeId: initialNodeId,
      version: context.version,
      fieldValues: { "requirement-business-line": 1 },
    },
    context: { id: `requirement:${requirementId}`, version: String(context.version) },
  });
  const fieldUpdate = await operationExecutePreview(client, fieldPreview.operationId,
    `requirement-fixture-field-${runId}`);
  if (fieldUpdate.status !== "SUCCEEDED") throw new Error("需求夹具无法填写需求录入必填业务线");

  context = await client.context({ type: "requirement", id: requirementId });
  if (context.version === null || context.currentNode?.id !== initialNodeId) {
    throw new Error("需求夹具填写业务线后上下文版本或当前节点异常");
  }
  const completePreview = await operationPreview(client, "development-item.node.complete", {
    arguments: { itemType: "REQUIREMENT", itemId: requirementId, nodeId: initialNodeId },
    context: { id: `requirement:${requirementId}`, version: String(context.version) },
  });
  const completed = await operationExecutePreview(client, completePreview.operationId,
    `requirement-fixture-complete-${runId}`);
  if (completed.status !== "SUCCEEDED") throw new Error("需求夹具无法进入需求接收节点");

  context = await client.context({ type: "requirement", id: requirementId });
  if (context.version === null || context.currentNode?.id === null || context.currentNode?.id === undefined) {
    throw new Error("需求夹具完成需求录入后缺少需求接收节点或版本");
  }
  return {
    requirementId,
    nodeId: context.currentNode.id,
    version: context.version,
    title,
  };
}

function requirementAnalysisTemplateVersion(catalog: CapabilityCatalog): number {
  const workflowType = catalog.workflowTypes.find((entry) => entry.processType === "requirement-management");
  const candidates = workflowType?.templates.filter((template) =>
    template.nodes.some((node) => node.components.some((component) => component.key === "requirement-receiving-analysis")));
  const selected = candidates?.find((template) => template.defaultTemplate) ?? candidates?.[0];
  if (!selected?.templateVersionId) {
    throw new Error("隔离需求夹具缺少带需求接收与分析组件的已发布模板");
  }
  return selected.templateVersionId;
}

function readRequirementId(result: OperationResult): number | null {
  const requirement = result.data.requirement;
  const rawId = requirement && typeof requirement === "object" && !Array.isArray(requirement)
    ? (requirement as Record<string, unknown>).id
    : result.data.requirementId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
