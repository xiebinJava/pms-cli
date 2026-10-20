import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  appendResourceOrchestratorTurn,
  confirmResourceOrchestratorPlan,
  createResourceOrchestratorConversation,
} from "../../apps/pms-cli/src/commands/scenarios/resourceOrchestrator.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import { createTopicFixture, existingTopicFixture } from "./support/topicFixture.js";
import {
  focusedComponent,
  resourceNodeDraft,
  runHappyResourceNodeSession,
  writableComponentKeys,
} from "./support/resourceOrchestratorSession.js";

const requested = process.env.PMS_E2E_TOPIC_ORCHESTRATOR === "true";
const createFixture = process.env.PMS_E2E_CREATE_TOPIC_ORCHESTRATOR_FIXTURE === "true";

describe.skipIf(!requested)("PMS topic resource-node orchestrator isolated E2E", () => {
  it("runs focused context → turn → preview → confirm → readback → session reload", async () => {
    if (!isolatedE2EEnabled(process.env)) {
      throw new Error("专题 Orchestrator E2E 必须使用一次性隔离 PMS 和数据库");
    }
    const config = assertIsolatedE2EConfig(process.env);
    const topicId = positiveEnvNumber("PMS_E2E_TOPIC_ID");
    if (!createFixture && topicId === null) {
      throw new Error("专题 Orchestrator E2E 未创建夹具时必须设置 PMS_E2E_TOPIC_ID");
    }
    if (createFixture && process.env.PMS_E2E_DATABASE_CLEANUP_CONFIRMED !== "true") {
      throw new Error("创建专题 Orchestrator 夹具前必须设置 PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true");
    }
    const store = new AuthStore(undefined, { service: config.keyringService + "-topic-orchestrator" });
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
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止专题编排器验收");
      }

      const fixture = createFixture
        ? await createTopicFixture(client, config.runId + "-orchestrator")
        : await existingTopicFixture(client, topicId!);
      const node = fixture.node;
      const before = await client.context(
        { type: "topic", id: fixture.topicId },
        { nodeId: node.nodeId, view: "focused", component: node.componentKey },
      );
      expect(before.currentNode?.id).toBe(node.nodeId);
      expect(before.meta?.selectedComponentKey).toBe(node.componentKey);
      expect(before.version).toBe(node.contextVersion);

      const marker = `AI-ORCH-TOPIC-${config.runId}`;
      const noCompletionConversation = await createResourceOrchestratorConversation(
        client, "topic", fixture.topicId,
      );
      const noCompletion = await appendResourceOrchestratorTurn(client, {
        conversationId: noCompletionConversation.conversationId,
        message: "只保存专题节点字段，不推进流程",
        draft: resourceNodeDraft("topic", fixture.topicId, node, `${marker}-no-completion`),
        nodeId: node.nodeId,
        nodeVersion: node.nodeVersion,
        componentKey: node.componentKey,
        contextVersion: node.contextVersion,
        requestId: `${config.runId}-topic-no-completion`,
      });
      expect(noCompletion.intent).toBe("RESOURCE_NODE_FIELD_UPDATE");

      const result = await runHappyResourceNodeSession({
        client,
        resourceType: "topic",
        resourceId: fixture.topicId,
        node,
        marker,
        runId: config.runId + "-topic",
      });
      expect(result.prepared).toMatchObject({
        status: "PLAN_READY",
        intent: "RESOURCE_NODE_FIELD_UPDATE",
        resourceType: "topic",
        resourceId: fixture.topicId,
        nodeId: node.nodeId,
        nodeVersion: node.nodeVersion,
        componentKey: node.componentKey,
      });
      expect(result.preview.status).toBe("WAITING_CONFIRMATION");
      expect(result.preview.preview?.command).toBe("development-item.node.field.update");
      expect(result.preview.preview?.expectedVersions).toBeTruthy();
      expect(result.preview.preview?.provenanceRef).toMatch(/^operation:/);
      expect(result.preview.preview?.draftDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(result.confirmed.status).toBe("SUCCEEDED");
      expect(result.confirmed.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        protectedFieldsUnchanged: true,
        patchApplied: true,
        status: "SUCCEEDED",
      });

      const after = await client.context(
        { type: "topic", id: fixture.topicId },
        { nodeId: node.nodeId, view: "focused", component: node.componentKey },
      );
      expect(after.currentNode?.id).toBe(node.nodeId);
      expect(JSON.stringify(focusedComponent(after, node.nodeId, node.componentKey)?.content))
        .toContain(marker);

      const replay = await confirmResourceOrchestratorPlan(
        client,
        result.prepared.planId,
        `${config.runId}-topic-save`,
        `${config.runId}-topic-replay`,
      );
      expect(replay.status).toBe("SUCCEEDED");
      expect(replay.operation?.operationId).toBe(result.confirmed.operation?.operationId);
      expect(result.session.latestPlan?.verification?.status).toBe("SUCCEEDED");
      expect(result.session.events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        "CONTEXT_READ", "DRAFT_VALIDATED", "PLAN_CREATED", "PREVIEW_CREATED",
        "WAITING_CONFIRMATION", "EXECUTION_STARTED", "EXECUTION_FINISHED", "VERIFICATION_FINISHED",
      ]));

      await expect(appendResourceOrchestratorTurn(client, {
        conversationId: (await createResourceOrchestratorConversation(client, "topic", fixture.topicId)).conversationId,
        message: "使用错误的节点版本",
        draft: resourceNodeDraft("topic", fixture.topicId, node, `${marker}-stale`),
        nodeId: node.nodeId,
        nodeVersion: node.nodeVersion + 1,
        componentKey: node.componentKey,
        contextVersion: node.contextVersion,
        requestId: `${config.runId}-topic-stale-node`,
      })).rejects.toMatchObject({ kind: "conflict", status: 409 });

      await expect(appendResourceOrchestratorTurn(client, {
        conversationId: (await createResourceOrchestratorConversation(client, "topic", fixture.topicId)).conversationId,
        message: "拒绝非法 provenance 来源",
        draft: resourceNodeDraft("topic", fixture.topicId, node, `${marker}-bad-provenance`, {
          fieldSources: {
            [node.fieldKey]: {
              sourceType: "pms_context",
              sourceRefs: ["not-a-readable-ref"],
              confidence: "high",
            },
          },
        }),
        nodeId: node.nodeId,
        nodeVersion: node.nodeVersion,
        componentKey: node.componentKey,
        contextVersion: node.contextVersion,
        requestId: `${config.runId}-topic-bad-provenance`,
      })).rejects.toThrow();

      const allComponents = await client.context(
        { type: "topic", id: fixture.topicId },
        { nodeId: node.nodeId, view: "focused" },
      );
      const writable = writableComponentKeys(allComponents, node.nodeId);
      if (writable.length > 1) {
        const ambiguous = await createResourceOrchestratorConversation(client, "topic", fixture.topicId);
        await expect(appendResourceOrchestratorTurn(client, {
          conversationId: ambiguous.conversationId,
          message: "不指定组件时应拒绝多个可写组件",
          draft: resourceNodeDraft("topic", fixture.topicId, node, `${marker}-ambiguous`),
          nodeId: node.nodeId,
          nodeVersion: node.nodeVersion,
          contextVersion: node.contextVersion,
          requestId: `${config.runId}-topic-ambiguous-component`,
        })).rejects.toMatchObject({ kind: "validation", status: 400 });
      }
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 180_000);
});

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
