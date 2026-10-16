import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import type {
  CapabilityCatalog,
  OperationResult,
  WorkflowContext,
} from "../../../packages/pms-contracts/src/index.js";
import { operationExecute, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";

export interface StoryFixture {
  storyId: number;
  nodeId: number;
  version: number;
  title: string;
  templateVersionId: number;
  created: boolean;
}

interface FixtureComponent {
  key: string;
  saveContract?: Record<string, unknown> | null;
}

interface FixtureNode {
  id: number;
  components: FixtureComponent[];
}

/**
 * Creates a standalone story in the disposable acceptance database.
 *
 * PMS currently exposes story.create/story.update but no story.delete command.
 * Therefore this helper records the ID and relies on the disposable database
 * teardown to remove it. It never attempts an undeclared delete endpoint.
 */
export async function createStoryFixture(client: PmsClient, runId: string): Promise<StoryFixture> {
  const capabilities = await client.capabilities();
  const templateVersionId = storyWorkbenchTemplateVersion(capabilities);
  const title = `AI-E2E-故事-${runId}`;
  const argumentsValue = { title, templateVersionId };
  await operationPreview(client, "story.create", {
    arguments: argumentsValue,
    context: { id: "global:pms", version: "v1" },
  });
  const result = await operationExecute(client, "story.create", `story-create-${runId}`, {
    arguments: argumentsValue,
    context: { id: "global:pms", version: "v1" },
  });
  if (result.status !== "SUCCEEDED") throw new Error("故事夹具创建未成功");
  const storyId = readStoryId(result);
  if (storyId === null) throw new Error("故事夹具创建成功响应缺少故事 ID");

  await advanceToDevelopmentNode(client, runId, storyId);

  const context = await client.context(
    { type: "story", id: storyId },
    { view: "focused" },
  );
  const target = currentWorkbenchNode(context);
  if (context.version === null || target === null) {
    throw new Error("故事夹具当前节点没有可写 story-node-workbench，无法继续验收");
  }
  const contract = workbenchSaveContract(target);
  if (contract?.variant !== "development") {
    throw new Error(`故事夹具未推进到 development 节点: ${contract?.variant}`);
  }
  return {
    storyId,
    nodeId: target.id!,
    version: context.version,
    title,
    templateVersionId,
    created: true,
  };
}

interface SaveContractShape {
  variant?: unknown;
  itemId?: unknown;
  nodeId?: unknown;
  version?: unknown;
}

function workbenchSaveContract(node: FixtureNode): SaveContractShape | null {
  const component = node.components.find((candidate) => candidate.key === "story-node-workbench");
  return component?.saveContract && typeof component.saveContract === "object"
    ? component.saveContract as SaveContractShape
    : null;
}

function saveContractNumber(value: unknown, allowZero = false): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    && (allowZero || value > 0) ? value : null;
}

/**
 * 新故事默认停在没有必填字段的第一个节点；只有 development 变体声明了必填写字段。
 * 通过既有命令链（owner.update -> schedule.update -> node.complete）推进流程，
 * 不引入任何新的写入协议。
 */
async function advanceToDevelopmentNode(client: PmsClient, runId: string, storyId: number) {
  const viewer = await client.capabilities().then((catalog) => catalog.viewer).catch(() => null);
  const ownerId = saveContractNumber((viewer as Record<string, unknown> | null)?.id);
  if (ownerId === null) throw new Error("故事夹具推进需要管理员 ownerId");

  for (let attempt = 0; attempt < 15; attempt++) {
    const context = await client.context({ type: "story", id: storyId }, { view: "focused" });
    const node = currentWorkbenchNode(context);
    if (node === null) throw new Error("故事夹具当前节点没有 story-node-workbench");
    const contract = workbenchSaveContract(node);
    const itemId = saveContractNumber(contract?.itemId);
    const currentNodeId = saveContractNumber(contract?.nodeId);
    const version = saveContractNumber(contract?.version, true);
    if (itemId === null || currentNodeId === null || version === null) {
      throw new Error("故事夹具 saveContract 缺少推进所需的标识或版本");
    }
    if (contract?.variant === "development") return;

    const owned = await operationExecute(client, "development-item.node.owner.update",
      `${runId}-advance-owner-${attempt}`, {
        arguments: { itemType: "STORY", itemId, nodeId: currentNodeId, ownerId, version },
        context: { id: "global:pms", version: "v1" },
      });
    if (owned.status !== "SUCCEEDED") throw new Error("故事夹具推进节点负责人更新未成功");

    const scheduleContext = await client.context(
      { type: "story", id: storyId }, { view: "focused" },
    );
    const scheduleNode = currentWorkbenchNode(scheduleContext);
    const scheduleContract = scheduleNode === null ? null : workbenchSaveContract(scheduleNode);
    if (scheduleContract === null || saveContractNumber(scheduleContract?.nodeId) !== currentNodeId
      || saveContractNumber(scheduleContract?.version, true) === null) {
      throw new Error("故事夹具推进时流程节点版本读取失败");
    }
    const today = new Date().toISOString().slice(0, 10);
    const scheduled = await operationExecute(client, "development-item.node.schedule.update",
      `${runId}-advance-schedule-${attempt}`, {
        arguments: {
          itemType: "STORY", itemId, nodeId: currentNodeId,
          startDate: today, endDate: today,
          version: scheduleContract.version,
        },
        context: { id: "global:pms", version: "v1" },
      });
    if (scheduled.status !== "SUCCEEDED") throw new Error("故事夹具推进节点排期更新未成功");

    const advanced = await operationExecute(client, "development-item.node.complete",
      `${runId}-advance-complete-${attempt}`, {
        arguments: { itemType: "STORY", itemId, nodeId: currentNodeId },
        context: { id: "global:pms", version: "v1" },
      });
    if (advanced.status !== "SUCCEEDED") throw new Error("故事夹具节点完成推进未成功");
  }
  throw new Error(`故事流程推进 15 步后仍未到达 development 节点 (story=${storyId})`);
}

export function existingStoryFixture(client: PmsClient, storyId: number): Promise<StoryFixture> {
  return client.context({ type: "story", id: storyId }, { view: "focused" }).then((context) => {
    const target = currentWorkbenchNode(context);
    if (context.version === null || target === null) {
      throw new Error("PMS_E2E_STORY_ID 当前节点没有可写 story-node-workbench");
    }
    return {
      storyId,
      nodeId: target.id!,
      version: context.version,
      title: String(context.resourceDetails?.title ?? `story-${storyId}`),
      templateVersionId: context.workflow?.templateVersionId ?? 0,
      created: false,
    };
  });
}

export function storyWorkbenchPatch(context: WorkflowContext, marker: string): Record<string, unknown> {
  const node = currentWorkbenchNode(context);
  const component = node?.components.find((candidate) => candidate.key === "story-node-workbench");
  const saveContract = component?.saveContract;
  const fieldContracts = saveContract?.fieldContracts;
  if (!Array.isArray(fieldContracts)) {
    throw new Error("故事工作台 saveContract 缺少 fieldContracts");
  }
  const writableFields = new Set(
    Array.isArray(saveContract?.writableFields)
      ? saveContract.writableFields.filter((field): field is string => typeof field === "string")
      : [],
  );
  const patch: Record<string, unknown> = {};
  const parsedFields = fieldContracts.filter((field): field is Record<string, unknown> =>
    Boolean(field) && typeof field === "object" && !Array.isArray(field));
  const requiredFields = parsedFields.filter((field) => field.required === true
    && typeof field.key === "string" && writableFields.has(field.key));
  const selectedFields = requiredFields.length > 0
    ? requiredFields
    : parsedFields.filter((field) => typeof field.key === "string" && writableFields.has(field.key)).slice(0, 1);
  for (const field of selectedFields) {
    const key = field.key as string;
    const type = field.type;
    patch[key] = type === "array" || type === "multiline" ? [`${marker} ${key}`]
      : type === "number" || type === "integer" ? 1
        : type === "boolean" ? true
          : `${marker} ${key}`;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("故事工作台没有可用于验收的必填可写字段");
  }
  return patch;
}

function storyWorkbenchTemplateVersion(catalog: CapabilityCatalog): number {
  const type = catalog.workflowTypes.find((entry) => entry.processType === "story-management");
  const candidates = type?.templates.filter((template) => template.nodes.some((node) =>
    node.components.some((component) => component.key === "story-node-workbench")));
  const selected = candidates?.find((template) => template.defaultTemplate) ?? candidates?.[0];
  if (!selected?.templateVersionId) {
    throw new Error("隔离故事夹具缺少带 story-node-workbench 的已发布模板");
  }
  return selected.templateVersionId;
}

function currentWorkbenchNode(context: WorkflowContext) {
  const node = context.currentNode?.id === null || context.currentNode?.id === undefined
    ? null
    : context.workflow?.nodes.map(asFixtureNode)
      .find((candidate): candidate is FixtureNode => candidate !== null
        && candidate.id === context.currentNode?.id) ?? null;
  if (!node || !node.components.some((component) => component.key === "story-node-workbench")) return null;
  return node;
}

function asFixtureNode(value: unknown): FixtureNode | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.id) || (raw.id as number) <= 0 || !Array.isArray(raw.components)) return null;
  const components = raw.components
    .map(asFixtureComponent)
    .filter((component): component is FixtureComponent => component !== null);
  return { id: raw.id as number, components };
}

function asFixtureComponent(value: unknown): FixtureComponent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.key !== "string") return null;
  return {
    key: raw.key,
    saveContract: raw.saveContract && typeof raw.saveContract === "object"
      && !Array.isArray(raw.saveContract)
      ? raw.saveContract as Record<string, unknown>
      : null,
  };
}

function readStoryId(result: OperationResult): number | null {
  const story = result.data.story;
  const rawId = story && typeof story === "object" && !Array.isArray(story)
    ? (story as Record<string, unknown>).id
    : result.data.storyId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
