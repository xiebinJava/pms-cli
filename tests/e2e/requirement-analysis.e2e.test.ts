import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import {
  executeRequirementAnalysisScenario,
  planRequirementAnalysisScenario,
  runRequirementAnalysisScenario,
} from "../../apps/pms-cli/src/commands/scenarios/requirementAnalysis.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import { createRequirementFixture } from "./support/requirementFixture.js";

const configuredRequirementId = positiveEnvNumber("PMS_E2E_REQUIREMENT_ID");
const configuredNodeId = positiveEnvNumber("PMS_E2E_NODE_ID");
const createFixture = process.env.PMS_E2E_CREATE_FIXTURE === "true";
const enabled = isolatedE2EEnabled(process.env)
  && (createFixture || (configuredRequirementId !== null && configuredNodeId !== null));

describe.skipIf(!enabled)("PMS CLI real requirement analysis save", () => {
  it("preserves the original request, appends only analysis text, and replays the same operation", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService });
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store,
      callbackHost: process.env.PMS_E2E_CALLBACK_HOST === "localhost" ? "localhost" : undefined,
      openBrowser: async (url) => console.log(`PMS_E2E_AUTH_URL=${url}`),
    });
    let session: CliSession | undefined;
    let cleanupFailure: Error | undefined;

    try {
      session = await auth.login();
      const client = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });
      const capabilities = await client.capabilities();
      if (!capabilities.viewer || !expectedViewerId(capabilities.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止分析保存");
      }

      const fixture = createFixture
        ? await createRequirementFixture(client, config.runId)
        : null;
      const requirementId = fixture?.requirementId ?? configuredRequirementId;
      const nodeId = fixture?.nodeId ?? configuredNodeId;
      if (requirementId === null || nodeId === null) {
        throw new Error("隔离 E2E 缺少需求 ID 或节点 ID");
      }

      const beforeContext = await client.context({ type: "requirement", id: requirementId });
      if (beforeContext.currentNode?.id !== nodeId) {
        throw new Error(`需求当前节点 ${beforeContext.currentNode?.id ?? "无"} 与指定节点不一致，停止写入`);
      }
      if (beforeContext.version === null) throw new Error("需求上下文缺少可用于保存的版本");
      const before = await client.get({ type: "requirement", id: requirementId });
      const existingAnalysisText = collectAnalysisText({
        details: before.details,
        resourceDetails: beforeContext.resourceDetails,
        workflow: beforeContext.workflow,
      });
      const sourceText = `AI-E2E 需求解释 ${config.runId}；来源地址 https://example.invalid/${config.runId}；实际查阅日期 2026-10-10；支持结论 待业务确认`;
      const patch = {
        interpretation: `AI-E2E 分析 ${config.runId}\n${sourceText}`,
        analysisConclusion: `AI-E2E 分析结论 ${config.runId}`,
      };
      const draft = {
        facts: [{
          text: `需求标题来自 PMS 记录：${before.details.title ?? "未命名需求"}`,
          sourceRefs: [`requirement:${requirementId}`],
          confidence: "high" as const,
        }],
        inferences: [{
          text: "需求仍处于接收阶段，分析成果需要业务确认",
          sourceRefs: [`requirement:${requirementId}`],
          confidence: "medium" as const,
        }],
        assumptions: [{
          text: "分析结论不会改变需求负责人或执行对象",
          sourceRefs: [`requirement:${requirementId}`],
          confidence: "medium" as const,
        }],
        unresolvedDecisions: [{
          text: "业务方仍需确认需求价值和优先级",
          sourceRefs: [`requirement:${requirementId}`],
        }],
        patch,
      };
      const draftOnly = await runRequirementAnalysisScenario(client, {
        resourceType: "requirement",
        resourceId: requirementId,
        nodeId,
        contextVersion: beforeContext.version,
        draft,
        save: false,
      }, async () => false);
      expect(draftOnly.status).toBe("DRAFT");
      const options = {
        nodeId,
        version: beforeContext.version,
        arguments: patch,
        idempotencyKey: "analysis-save-" + config.runId,
        context: { id: `requirement:${requirementId}`, version: String(beforeContext.version) },
      } as const;

      const plan = await planRequirementAnalysisScenario(client, requirementId, options);
      expect(plan.preview.command).toBe("requirement.analysis.save");
      expect(plan.facts.currentNode.id).toBe(nodeId);
      const firstScenario = await runRequirementAnalysisScenario(client, {
        resourceType: "requirement",
        resourceId: requirementId,
        nodeId,
        contextVersion: beforeContext.version,
        draft,
        save: true,
        idempotencyKey: options.idempotencyKey,
      }, async () => true);
      expect(firstScenario.status).toBe("SUCCEEDED");
      expect(firstScenario.verification).toEqual({
        resourceReadback: true,
        contextReadback: true,
        protectedFieldsUnchanged: true,
      });
      expect(firstScenario.operationId).toBeTruthy();
      const first = await executeRequirementAnalysisScenario(client, requirementId, options);
      expect(first.result.status).toBe("SUCCEEDED");
      expect(first.result.data.nodeId).toBe(nodeId);
      expect(first.trace.operationId).toBe(firstScenario.operationId);
      const replay = await executeRequirementAnalysisScenario(client, requirementId, options);
      expect(replay.result.operationId).toBe(first.result.operationId);
      expect(replay.result.data.nodeId).toBe(nodeId);
      expect(replay.trace.operationId).toBe(first.trace.operationId);

      const after = await client.get({ type: "requirement", id: requirementId });
      const afterContext = await client.context({ type: "requirement", id: requirementId });
      const readback = JSON.stringify({
        details: after.details,
        resourceDetails: afterContext.resourceDetails,
        workflow: afterContext.workflow,
      });
      expect(readback).toContain(sourceText);
      for (const text of existingAnalysisText) {
        expect(readback).toContain(text);
      }
      expect(Object.values(first.protectedFieldsUnchanged).every(Boolean)).toBe(true);
      for (const key of ["systemId", "targetType", "targetId", "ownerId", "status", "startDate", "endDate"]) {
        if (Object.prototype.hasOwnProperty.call(before.details, key)) {
          expect(after.details[key]).toEqual(before.details[key]);
        }
      }
    } finally {
      if (session) {
        try {
          await auth.logout(session.account);
        } catch (error) {
          cleanupFailure = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (cleanupFailure) throw cleanupFailure;
    }
  }, 120_000);
});

function collectAnalysisText(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    return ["interpretation", "filterNote", "analysisConclusion", "supplementNote", "decisionReason"]
      .includes(key) && value.trim() ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectAnalysisText(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([entryKey, entryValue]) => collectAnalysisText(entryValue, entryKey));
}

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
