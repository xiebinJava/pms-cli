import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { PmsClientError, PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import type { AnalysisDraft } from "../../packages/pms-contracts/src/index.js";
import {
  appendStoryNodeTurn,
  confirmStoryNodePlan,
  createStoryNodeConversation,
  previewStoryNodePlan,
  readStoryNodeSession,
} from "../../apps/pms-cli/src/commands/scenarios/storyOrchestrator.js";
import { operationExecutePreview, operationPreview } from "../../apps/pms-cli/src/commands/core/operation.js";
import { assertIsolatedE2EConfig, expectedViewerId, isolatedE2EEnabled } from "./support/isolatedSession.js";
import { auditOperations } from "./support/operationAudit.js";
import { createStoryFixture, existingStoryFixture, storyWorkbenchPatch } from "./support/storyFixture.js";

const explicitlyRequested = process.env.PMS_E2E_STORY_ORCHESTRATOR === "true";
const createStoryFixtureRequested = process.env.PMS_E2E_CREATE_STORY_FIXTURE === "true";
const cleanupConfirmed = process.env.PMS_E2E_DATABASE_CLEANUP_CONFIRMED === "true";

describe.skipIf(!explicitlyRequested)("PMS AI story-node orchestrator isolated acceptance", () => {
  it("runs story read, NEEDS_INPUT, preview, confirm, replay, recovery and readback", async () => {
    if (!isolatedE2EEnabled(process.env)) {
      throw new Error("故事编排器真实验收必须同时满足 PMS_E2E_WRITE=true、PMS_E2E_ISOLATED=true 和隔离目标配置");
    }
    // story 没有声明 delete 命令，夹具随一次性数据库销毁；创建夹具前必须显式确认销毁路径。
    if (createStoryFixtureRequested && !cleanupConfirmed) {
      throw new Error("创建不可删除的故事夹具前必须设置 PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true");
    }
    const config = assertIsolatedE2EConfig(process.env);
    if (!process.env.PMS_E2E_DB_URL?.trim()) {
      throw new Error("故事编排器真实验收缺少只读数据库配置 PMS_E2E_DB_URL");
    }
    const runStart = new Date();
    const store = new AuthStore(undefined, { service: config.keyringService + "-story-orchestrator" });
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store,
      callbackHost: process.env.PMS_E2E_CALLBACK_HOST === "localhost" ? "localhost" : undefined,
      openBrowser: async (url) => console.log(`PMS_E2E_AUTH_URL=${url}`),
    });
    let session: CliSession | undefined;
    let fixtureId: number | undefined;

    try {
      session = await auth.login();
      const client = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });
      const capabilities = await client.capabilities();
      if (!capabilities.viewer || !expectedViewerId(capabilities.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止故事编排器验收");
      }

      const fixture = process.env.PMS_E2E_CREATE_STORY_FIXTURE === "true"
        ? await createStoryFixture(client, config.runId)
        : await existingStoryFixture(client, requireStoryId());
      fixtureId = fixture.created ? fixture.storyId : undefined;
      const before = await client.context(
        { type: "story", id: fixture.storyId },
        { nodeId: fixture.nodeId, view: "focused", component: "story-node-workbench" },
      );
      if (before.version === null) throw new Error("故事上下文缺少可写版本");
      const patch = storyWorkbenchPatch(before, `AI-ORCH-STORY-${config.runId}`);
      const draft: AnalysisDraft = {
        facts: [{
          text: `故事 ${fixture.storyId} 当前节点来自 PMS 上下文`,
          sourceRefs: [`story-node:${fixture.nodeId}`, `story-node:${fixture.nodeId}#component:story-node-workbench`],
          confidence: "high",
        }],
        inferences: [],
        assumptions: [{
          text: "本次写入只更新当前节点工作台字段",
          sourceRefs: [`story:${fixture.storyId}`],
          confidence: "medium",
        }],
        unresolvedDecisions: [],
        patch,
      };

      if (Object.keys(patch).length >= 2) {
        const missingField = Object.keys(patch)[0]!;
        const incompleteConversation = await createStoryNodeConversation(client, fixture.storyId);
        const incomplete = await appendStoryNodeTurn(client, {
          conversationId: incompleteConversation.conversationId,
          message: "先识别当前节点还缺哪些必填信息",
          draft: { ...draft, patch: Object.fromEntries(
            Object.entries(patch).filter(([key]) => key !== missingField),
          ) },
          nodeId: fixture.nodeId,
          contextVersion: before.version,
          requestId: `${config.runId}-missing-input`,
        });
        expect(incomplete.status).toBe("NEEDS_INPUT");
        expect(incomplete).toMatchObject({ missingFields: expect.arrayContaining([missingField]) });
        expect(incomplete.preview).toBeNull();
      }

      const conversation = await createStoryNodeConversation(client, fixture.storyId);
      const firstTurn = await appendStoryNodeTurn(client, {
        conversationId: conversation.conversationId,
        message: "先只补 implementationNote，应缺 selfTestResult",
        draft: { ...draft, patch: { implementationNote: patch.implementationNote } },
        nodeId: fixture.nodeId,
        contextVersion: before.version,
        requestId: `${config.runId}-story-turn-needs-input`,
      });
      expect(firstTurn.status).toBe("NEEDS_INPUT");
      if (firstTurn.intent !== "STORY_NODE_FIELD_UPDATE") throw new Error("故事 turn 应返回 story 计划");
      expect(firstTurn.missingFields).toEqual(["selfTestResult"]);
      expect(firstTurn.nodeContract?.nodeId).toBe(fixture.nodeId);
      expect(firstTurn.preview ?? null).toBeNull();

      const prepared = await appendStoryNodeTurn(client, {
        conversationId: conversation.conversationId,
        message: "补齐 selfTestResult，与此前增量合并后应生成 PLAN_READY",
        draft: { ...draft, patch: { selfTestResult: patch.selfTestResult } },
        nodeId: fixture.nodeId,
        contextVersion: before.version,
        requestId: `${config.runId}-story-turn`,
      });
      expect(prepared.status).toBe("PLAN_READY");
      if (prepared.intent !== "STORY_NODE_FIELD_UPDATE") throw new Error("故事 turn 应返回 story 计划");
      expect(prepared.missingFields).toEqual([]);

      const preview = await previewStoryNodePlan(client, prepared.planId, `${config.runId}-story-preview`);
      expect(preview.status).toBe("WAITING_CONFIRMATION");
      expect(preview.preview?.operationId).toBeTruthy();

      const idempotencyKey = `${config.runId}-story-save`;
      const first = await confirmStoryNodePlan(client, prepared.planId, idempotencyKey,
        `${config.runId}-story-confirm`);
      expect(first.status).toBe("SUCCEEDED");
      expect(first.operation?.operationId).toBe(preview.preview?.operationId);
      expect(first.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        protectedFieldsUnchanged: true,
        patchApplied: true,
        status: "SUCCEEDED",
      });

      const replay = await confirmStoryNodePlan(client, prepared.planId, idempotencyKey,
        `${config.runId}-story-replay`);
      expect(replay.status).toBe("SUCCEEDED");
      expect(replay.operation?.operationId).toBe(first.operation?.operationId);

      // 同一 Operation 的不同幂等键必须返回冲突，不得再次执行写入。
      await expect(confirmStoryNodePlan(client, prepared.planId,
        `${config.runId}-story-save-other`, `${config.runId}-story-confirm-other`))
        .rejects.toMatchObject({ kind: "conflict", status: 409 });

      // 无效 sourceRef 的草稿必须在读取上下文阶段就被拒绝，不产生任何写操作。
      const badRefConversation = await createStoryNodeConversation(client, fixture.storyId);
      await expect(appendStoryNodeTurn(client, {
        conversationId: badRefConversation.conversationId,
        message: "引用不可读资源",
        draft: {
          ...draft,
          facts: [{
            text: `引用不存在的需求资源`,
            sourceRefs: [`requirement:999999`],
            confidence: "high",
          }],
        },
        nodeId: fixture.nodeId,
        contextVersion: (await client.context(
          { type: "story", id: fixture.storyId },
          { nodeId: fixture.nodeId, view: "focused", component: "story-node-workbench" },
        )).version!,
        requestId: `${config.runId}-invalid-source-ref`,
      })).rejects.toBeInstanceOf(PmsClientError);

      // 预览之后节点版本被并发修改：旧 preview 不能强行写入，confirm 返回冲突。
      const conflictConversation = await createStoryNodeConversation(client, fixture.storyId);
      const conflictTurn = await appendStoryNodeTurn(client, {
        conversationId: conflictConversation.conversationId,
        message: "预览后再并发推进节点版本",
        draft: { ...draft, patch: { codeLink: `https://example.test/pms/${config.runId}` } },
        nodeId: fixture.nodeId,
        contextVersion: (await client.context(
          { type: "story", id: fixture.storyId },
          { nodeId: fixture.nodeId, view: "focused", component: "story-node-workbench" },
        )).version!,
        requestId: `${config.runId}-preview-conflict`,
      });
      expect(conflictTurn.status).toBe("PLAN_READY");
      const conflictPreview = await previewStoryNodePlan(client, conflictTurn.planId,
        `${config.runId}-preview-conflict-preview`);
      expect(conflictPreview.status).toBe("WAITING_CONFIRMATION");
      const concurrentOwnerOptions = {
        arguments: {
          itemType: "STORY", itemId: fixture.storyId, nodeId: fixture.nodeId,
          ownerId: Number(config.accountId), version: (await client.context(
            { type: "story", id: fixture.storyId },
            { nodeId: fixture.nodeId, view: "focused", component: "story-node-workbench" },
          )).version!,
        },
        context: { id: "global:pms", version: "v1" },
      };
      const concurrentOwnerPreview = await operationPreview(client,
        "development-item.node.owner.update", concurrentOwnerOptions);
      await operationExecutePreview(client, concurrentOwnerPreview.operationId,
        `${config.runId}-concurrent-owner-bump`);
      await expect(confirmStoryNodePlan(client, conflictTurn.planId,
        `${config.runId}-conflict-confirm`, `${config.runId}-conflict-confirm-request`))
        .resolves.toMatchObject({ status: "CONFLICT", verification: null });
      const conflictSession = await readStoryNodeSession(client, conflictConversation.conversationId, 0);
      expect(conflictSession.latestPlan?.status).toBe("CONFLICT");

      // A second client represents a fresh CLI process. No local plan or
      // operation state is passed to it; all facts come from the PMS session.
      const freshProcessClient = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });
      const sessionSnapshot = await readStoryNodeSession(
        freshProcessClient, conversation.conversationId, 0,
      );
      expect(sessionSnapshot.latestPlan?.operation?.operationId).toBe(first.operation?.operationId);
      expect(sessionSnapshot.latestPlan?.verification?.status).toBe("SUCCEEDED");
      expect(sessionSnapshot.events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        "CONTEXT_READ", "DRAFT_VALIDATED", "PLAN_CREATED", "PREVIEW_CREATED",
        "WAITING_CONFIRMATION", "EXECUTION_STARTED", "EXECUTION_FINISHED", "VERIFICATION_FINISHED",
      ]));

      const invalidConversation = await createStoryNodeConversation(client, fixture.storyId);
      await expect(appendStoryNodeTurn(client, {
        conversationId: invalidConversation.conversationId,
        message: "写入未声明字段",
        draft: { ...draft, patch: { __notWritable: "不得保存" } },
        nodeId: fixture.nodeId,
        contextVersion: (await client.context(
          { type: "story", id: fixture.storyId },
          { nodeId: fixture.nodeId, view: "focused", component: "story-node-workbench" },
        )).version!,
        requestId: `${config.runId}-invalid-field`,
      })).rejects.toBeInstanceOf(PmsClientError);

      const staleConversation = await createStoryNodeConversation(client, fixture.storyId);
      await expect(appendStoryNodeTurn(client, {
        conversationId: staleConversation.conversationId,
        message: "使用旧上下文版本再次写入",
        draft,
        nodeId: fixture.nodeId,
        contextVersion: before.version,
        requestId: `${config.runId}-stale`,
      })).rejects.toMatchObject({ kind: "conflict", status: 409 });

      const audit = await auditOperations(config.runId, runStart);
      // 夹具重放时 story.create 的 created_at 更早，可能落在本窗口之外；
      // 夹具命令成功已由 createStoryFixture 校验，这里只断言本轮的 story 字段写入审计。
      expect(audit.length).toBeGreaterThan(0);
      const succeededFieldUpdates = audit.filter((record) =>
        record.commandName === "development-item.node.field.update"
        && record.status === "SUCCEEDED");
      expect(succeededFieldUpdates).toHaveLength(1);
    } finally {
      if (fixtureId) {
        console.log(`PMS_E2E_STORY_FIXTURE_ID=${fixtureId}; story.delete 未声明，随隔离数据库销毁`);
      }
      if (session) await auth.logout(session.account);
    }
  }, 300_000);
});

function requireStoryId(): number {
  const raw = process.env.PMS_E2E_STORY_ID?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) {
    throw new Error("未创建故事夹具时必须设置 PMS_E2E_STORY_ID");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("PMS_E2E_STORY_ID 超出安全整数范围");
  return value;
}
