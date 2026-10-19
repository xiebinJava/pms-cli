import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import type { OperationResult } from "../../../packages/pms-contracts/src/index.js";
import { operationExecutePreview, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";

export interface TopicFixture {
  topicId: number;
  title: string;
  created: true;
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
  return { topicId, title, created: true };
}

function readTopicId(result: OperationResult): number | null {
  const rawId = result.data.topicId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
