import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { createRequirementFixture } from "./support/requirementFixture.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import {
  PmsClientError,
  PmsHttpClient,
  StaticTokenProvider,
} from "../../packages/pms-client/src/index.js";
import type { AnalysisDraft } from "../../packages/pms-contracts/src/index.js";

const configuredRequirementId = positiveEnvNumber("PMS_E2E_REQUIREMENT_ID");
const configuredNodeId = positiveEnvNumber("PMS_E2E_NODE_ID");
const createFixture = process.env.PMS_E2E_CREATE_FIXTURE === "true";
const cleanupConfirmed = process.env.PMS_E2E_DATABASE_CLEANUP_CONFIRMED === "true";
const enabled = isolatedE2EEnabled(process.env)
  && (createFixture ? cleanupConfirmed : configuredRequirementId !== null && configuredNodeId !== null);

describe.skipIf(!enabled)("PMS AI orchestrator isolated requirement analysis", () => {
  it("runs preview, confirm, replay and stale-version conflict with ordered events", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService + "-orchestrator" });
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
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止编排器验收");
      }

      const fixture = createFixture ? await createRequirementFixture(client, `${config.runId}-orchestrator`) : null;
      const requirementId = fixture?.requirementId ?? configuredRequirementId;
      const nodeId = fixture?.nodeId ?? configuredNodeId;
      if (requirementId === null || nodeId === null) throw new Error("隔离编排器 E2E 缺少需求或节点 ID");

      const beforeContext = await client.context({ type: "requirement", id: requirementId });
      const beforeResource = await client.get({ type: "requirement", id: requirementId });
      if (beforeContext.version === null || beforeContext.currentNode?.id !== nodeId) {
        throw new Error("编排器验收目标缺少当前节点或可写版本");
      }
      const marker = `AI-ORCH-E2E-${config.runId}`;
      const draft: AnalysisDraft = {
        facts: [{
          text: `需求标题来自 PMS：${String(beforeResource.details.title ?? "未命名")}`,
          sourceRefs: [`requirement:${requirementId}`],
          confidence: "high",
        }],
        inferences: [],
        assumptions: [{
          text: "本次保存只更新分析成果，不改变流程归属",
          sourceRefs: [`requirement:${requirementId}`],
          confidence: "medium",
        }],
        unresolvedDecisions: [],
        patch: {
          interpretation: `${marker} interpretation`,
          analysisConclusion: `${marker} conclusion`,
        },
      };

      const conversation = await client.createConversation({ resourceType: "requirement", resourceId: requirementId });
      const prepared = await client.appendTurn({
        conversationId: conversation.conversationId,
        message: "请分析并准备保存需求分析成果",
        contractVersion: "requirement-analysis/v1",
        draft: { contractVersion: "requirement-analysis/v1", draft },
        nodeId,
        contextVersion: beforeContext.version,
        requestId: `${config.runId}-turn`,
      });
      expect(prepared.status).toBe("PLAN_READY");

      const preview = await client.previewPlan(prepared.planId, `${config.runId}-preview`);
      expect(preview.status).toBe("WAITING_CONFIRMATION");
      expect(preview.preview?.operationId).toBeTruthy();

      const idempotencyKey = `${config.runId}-orchestrator-save`;
      const first = await client.confirmPlan({ planId: prepared.planId, idempotencyKey, requestId: `${config.runId}-confirm` });
      expect(first.status).toBe("SUCCEEDED");
      expect(first.operation?.operationId).toBe(preview.preview?.operationId);
      expect(first.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        protectedFieldsUnchanged: true,
        patchApplied: true,
        status: "SUCCEEDED",
      });

      const replay = await client.confirmPlan({ planId: prepared.planId, idempotencyKey, requestId: `${config.runId}-replay` });
      expect(replay.status).toBe("SUCCEEDED");
      expect(replay.operation?.operationId).toBe(first.operation?.operationId);

      const events = await client.listConversationEvents(conversation.conversationId, 0);
      expect(events.map((event) => event.sequenceNo)).toEqual(
        [...events].map((event) => event.sequenceNo).sort((a, b) => a - b),
      );
      expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
        "CONTEXT_READ", "DRAFT_VALIDATED", "PLAN_CREATED", "PREVIEW_CREATED",
        "WAITING_CONFIRMATION", "EXECUTION_STARTED", "EXECUTION_FINISHED", "VERIFICATION_FINISHED",
      ]));

      const sessionSnapshot = await client.getOrchestratorSession(conversation.conversationId, 0);
      expect(sessionSnapshot.sessionId).toBe(conversation.conversationId);
      expect(sessionSnapshot.conversation.conversationId).toBe(conversation.conversationId);
      expect(sessionSnapshot.latestPlan?.planId).toBe(prepared.planId);
      expect(sessionSnapshot.events.map((event) => event.sequenceNo)).toEqual(
        [...sessionSnapshot.events].map((event) => event.sequenceNo).sort((a, b) => a - b),
      );
      expect(sessionSnapshot.nextSequence).toBeGreaterThan(
        sessionSnapshot.events.at(-1)?.sequenceNo ?? 0,
      );
      const incrementalSnapshot = await client.getOrchestratorSession(
        conversation.conversationId,
        sessionSnapshot.nextSequence - 1,
      );
      expect(incrementalSnapshot.afterSequence).toBe(sessionSnapshot.nextSequence - 1);
      expect(incrementalSnapshot.events).toEqual([]);
      expect(incrementalSnapshot.nextSequence).toBe(sessionSnapshot.nextSequence);

      const afterResource = await client.get({ type: "requirement", id: requirementId });
      const afterContext = await client.context({ type: "requirement", id: requirementId });
      expect(JSON.stringify(first.operation?.data ?? {})).toContain(marker);
      expect(afterContext.currentNode?.id).toBe(beforeContext.currentNode?.id);
      for (const key of ["systemId", "targetType", "targetId", "ownerId", "status", "startDate", "endDate"]) {
        if (Object.prototype.hasOwnProperty.call(beforeResource.details, key)) {
          expect(afterResource.details[key]).toEqual(beforeResource.details[key]);
        }
      }

      const conflictConversation = await client.createConversation({ resourceType: "requirement", resourceId: requirementId });
      let conflict: unknown;
      try {
        await client.appendTurn({
          conversationId: conflictConversation.conversationId,
          message: "使用旧版本再次保存",
          contractVersion: "requirement-analysis/v1",
          draft: { contractVersion: "requirement-analysis/v1", draft: {
            ...draft,
            patch: { interpretation: `${marker} must not be written twice` },
          } },
          nodeId,
          contextVersion: beforeContext.version,
          requestId: `${config.runId}-stale`,
        });
      } catch (error) {
        conflict = error;
      }
      expect(conflict).toBeInstanceOf(PmsClientError);
      expect(conflict).toMatchObject({ kind: "conflict", status: 409 });
      expect(JSON.stringify((await client.get({ type: "requirement", id: requirementId })).details))
        .not.toContain("must not be written twice");
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 120_000);
});

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
