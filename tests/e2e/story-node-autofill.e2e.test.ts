import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import {
  executeAgentProgression,
  planAgentProgression,
} from "../../apps/pms-cli/src/commands/scenarios/agentProgression.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import { agentProgressionContractVersion } from "../../packages/pms-contracts/src/index.js";
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

const enabled = process.env.PMS_E2E_NODE_AUTOFILL_STORY === "true" && isolatedE2EEnabled(process.env);

describe.skipIf(!enabled)("PMS CLI story node detail autofill", () => {
  it("plans, atomically completes, and verifies a story acceptance node", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store: new AuthStore(undefined, { service: config.keyringService + "-story-node-autofill" }),
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
        throw new Error("浏览器批准身份与隔离 E2E 账号不一致，停止故事节点写入");
      }
      const fixture = process.env.PMS_E2E_CREATE_STORY_FIXTURE === "true"
        ? await createStoryFixture(client, config.runId + "-node-autofill")
        : await existingStoryFixture(client, requireStoryId());
      const acceptance = await advanceStoryToVariant(
        client,
        config.runId + "-node-autofill",
        fixture.storyId,
        "acceptance",
      );
      const before = await client.context(
        { type: "story", id: fixture.storyId },
        { nodeId: acceptance.nodeId, view: "focused", component: "story-node-workbench" },
      );
      if (before.version === null) throw new Error("故事验收节点上下文缺少版本");
      const draft = {
        facts: [{ text: "故事验收节点来自隔离 PMS 上下文", sourceRefs: [`story:${fixture.storyId}`], confidence: "high" as const }],
        inferences: [],
        assumptions: [],
        unresolvedDecisions: [],
        patch: { acceptanceConclusion: "PASS", acceptanceNote: `AI-E2E ${config.runId}` },
        fieldSources: {
          acceptanceConclusion: { sourceType: "conversation" as const, sourceRefs: [`conversation:${config.runId}`], confidence: "high" as const },
          acceptanceNote: { sourceType: "conversation" as const, sourceRefs: [`conversation:${config.runId}`], confidence: "high" as const },
        },
        requestedCompletion: true,
        ownerId: Number(config.accountId),
        startDate: "2026-10-10",
        endDate: "2026-10-20",
      };
      const base = {
        contractVersion: agentProgressionContractVersion,
        resourceType: "story" as const,
        resourceId: fixture.storyId,
        nodeId: acceptance.nodeId,
        contextVersion: before.version,
        intent: "COMPLETE_NODE" as const,
        executeMode: "auto" as const,
        draft,
      };
      const plan = await planAgentProgression(client, base);
      expect(plan.writeDecision).toBe("READY");
      expect(plan.operation).toBe("development-item.node.complete-with-data");
      expect(plan.preview?.operationId).toBeTruthy();
      const result = await executeAgentProgression(client, {
        ...base,
        previewOperationId: plan.preview!.operationId,
        idempotencyKey: `${config.runId}-story-node-autofill`,
      });
      expect(result.status).toBe("SUCCEEDED");
      expect(result.readback?.resource?.resourceId).toBe(fixture.storyId);
      expect(result.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      });
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 120_000);
});

function requireStoryId(): number {
  const raw = process.env.PMS_E2E_STORY_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) throw new Error("未创建夹具时必须设置 PMS_E2E_STORY_ID");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("PMS_E2E_STORY_ID 无效");
  return value;
}
