import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { requirementAnalysisSave } from "../../apps/pms-cli/src/commands/shortcuts/requirement.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";

const requirementId = positiveEnvNumber("PMS_E2E_REQUIREMENT_ID");
const nodeId = positiveEnvNumber("PMS_E2E_NODE_ID");
const enabled = isolatedE2EEnabled(process.env) && requirementId !== null && nodeId !== null;

describe.skipIf(!enabled)("PMS CLI real requirement analysis save", () => {
  it("preserves the original request, appends only analysis text, and replays the same operation", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService });
    const auth = new BrowserAuth({ baseUrl: config.baseUrl, authOrigin: config.authOrigin, store });
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

      const beforeContext = await client.context({ type: "requirement", id: requirementId! });
      if (beforeContext.currentNode?.id !== nodeId) {
        throw new Error(`需求当前节点 ${beforeContext.currentNode?.id ?? "无"} 与 PMS_E2E_NODE_ID 不一致，停止写入`);
      }
      if (beforeContext.version === null) throw new Error("需求上下文缺少可用于保存的版本");
      const before = await client.get({ type: "requirement", id: requirementId! });
      const sourceText = `AI-E2E 来源标题 ${config.runId}；来源地址 https://example.invalid/${config.runId}；实际查阅日期 2026-10-10；支持结论 待业务确认`;
      const patch = {
        background: `AI-E2E 分析 ${config.runId}\n${sourceText}`,
        acceptanceCriteria: `AI-E2E 验收标准 ${config.runId}`,
      };
      const options = {
        nodeId: nodeId!,
        version: beforeContext.version,
        patch,
        idempotencyKey: "analysis-save-" + config.runId,
        context: { id: `requirement:${requirementId}`, version: String(beforeContext.version) },
      } as const;

      const first = await requirementAnalysisSave(client, requirementId!, options);
      expect(first.status).toBe("SUCCEEDED");
      expect(first.data.nodeId).toBe(nodeId);
      const replay = await requirementAnalysisSave(client, requirementId!, options);
      expect(replay.operationId).toBe(first.operationId);
      expect(replay.data.nodeId).toBe(nodeId);

      const after = await client.get({ type: "requirement", id: requirementId! });
      const afterContext = await client.context({ type: "requirement", id: requirementId! });
      const readback = JSON.stringify({ details: after.details, resourceDetails: afterContext.resourceDetails });
      expect(readback).toContain(sourceText);
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
  });
});

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
