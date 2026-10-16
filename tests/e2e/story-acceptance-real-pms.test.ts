import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import {
  executeStoryWorkbenchScenario,
  planStoryWorkbenchScenario,
} from "../../apps/pms-cli/src/commands/scenarios/storyWorkbench.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import {
  advanceStoryToVariant,
  createStoryFixture,
  existingStoryFixture,
} from "./support/storyFixture.js";

const explicitlyRequested = process.env.PMS_E2E_STORY_ACCEPTANCE === "true";
const createFixture = process.env.PMS_E2E_CREATE_STORY_FIXTURE === "true";
const cleanupConfirmed = process.env.PMS_E2E_DATABASE_CLEANUP_CONFIRMED === "true";

describe.skipIf(!explicitlyRequested)("PMS AI story acceptance isolated E2E", () => {
  it("plans, completes, reads back and replays an acceptance node", async () => {
    if (!isolatedE2EEnabled(process.env)) {
      throw new Error(
        "故事验收真实 E2E 必须同时满足 PMS_E2E_WRITE=true、PMS_E2E_ISOLATED=true 和隔离目标配置",
      );
    }
    if (createFixture && !cleanupConfirmed) {
      throw new Error(
        "创建不可删除的故事夹具前必须设置 PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true",
      );
    }

    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService + "-story-acceptance" });
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store,
      callbackHost: process.env.PMS_E2E_CALLBACK_HOST === "localhost" ? "localhost" : undefined,
      openBrowser: async (url) => console.log(`PMS_E2E_AUTH_URL=${url}`),
    });
    let session: CliSession | undefined;
    try {
      session = await auth.login();
      const client = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });
      const capabilities = await client.capabilities();
      if (!capabilities.viewer || !expectedViewerId(capabilities.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止故事验收写入");
      }

      const fixture = createFixture
        ? await createStoryFixture(client, config.runId + "-acceptance")
        : await existingStoryFixture(client, requireStoryId());
      const acceptance = await advanceStoryToVariant(
        client,
        config.runId + "-acceptance",
        fixture.storyId,
        "acceptance",
      );
      const beforeContext = await client.context(
        { type: "story", id: fixture.storyId },
        { nodeId: acceptance.nodeId, view: "focused", component: "story-node-workbench" },
      );
      if (beforeContext.version === null) throw new Error("验收节点缺少可用上下文版本");
      const before = await client.get({ type: "story", id: fixture.storyId });
      const patch = {
        acceptanceConclusion: "PASS",
        acceptanceNote: `AI-E2E 验收通过 ${config.runId}`,
      };
      const common = {
        contractVersion: "story-workbench/v1" as const,
        resourceType: "story" as const,
        resourceId: fixture.storyId,
        nodeId: acceptance.nodeId,
        version: beforeContext.version,
        variant: "acceptance" as const,
        patch,
        complete: true as const,
        ownerId: Number(config.accountId),
        startDate: "2026-10-10",
        endDate: "2026-10-20",
        requestId: `${config.runId}-story-acceptance`,
      };

      const staleVersion = beforeContext.version > 0
        ? beforeContext.version - 1
        : beforeContext.version + 1;
      await expect(planStoryWorkbenchScenario(client, {
        ...common,
        version: staleVersion,
        save: false,
      })).rejects.toThrow(/版本/);

      const plan = await planStoryWorkbenchScenario(client, { ...common, save: false });
      expect(plan.preview.command).toBe("development-item.node.complete-with-data");
      expect(plan.preview.operationId).toBeTruthy();

      const first = await executeStoryWorkbenchScenario(client, {
        ...common,
        save: true,
        idempotencyKey: `${config.runId}-story-acceptance`,
        previewOperationId: plan.preview.operationId,
      });
      expect(first.status).toBe("SUCCEEDED");
      expect(first.complete).toBe(true);
      expect(first.operation?.operationId).toBe(plan.preview.operationId);
      expect(first.readback?.resource).toBeTruthy();
      expect(first.readback?.context).toBeTruthy();
      expect(first.verification).toEqual({
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      });
      expect(first.currentNode?.id ?? null).not.toBe(acceptance.nodeId);

      const replay = await executeStoryWorkbenchScenario(client, {
        ...common,
        save: true,
        idempotencyKey: `${config.runId}-story-acceptance`,
        previewOperationId: plan.preview.operationId,
        requestId: `${config.runId}-story-acceptance-replay`,
      });
      expect(replay.status).toBe("SUCCEEDED");
      expect(replay.operation?.operationId).toBe(first.operation?.operationId);

      const after = await client.get({ type: "story", id: fixture.storyId });
      expect(after.details.title).toBe(before.details.title);
      expect(after.details.status).toBe(before.details.status);
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 120_000);
});

function requireStoryId(): number {
  const raw = process.env.PMS_E2E_STORY_ID?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new Error("未创建夹具时必须设置 PMS_E2E_STORY_ID");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("PMS_E2E_STORY_ID 超出安全整数范围");
  return value;
}
