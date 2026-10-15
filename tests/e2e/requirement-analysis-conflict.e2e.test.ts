import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { executeRequirementAnalysisScenario } from "../../apps/pms-cli/src/commands/scenarios/requirementAnalysis.js";
import { PmsClientError, PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
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

describe.skipIf(!enabled)("PMS CLI real requirement analysis version conflict", () => {
  it("rejects a new stale-version operation without adding a second business change", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService + "-conflict" });
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
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止冲突验收");
      }

      const fixture = createFixture
        ? await createRequirementFixture(client, `${config.runId}-conflict`)
        : null;
      const requirementId = fixture?.requirementId ?? configuredRequirementId;
      const nodeId = fixture?.nodeId ?? configuredNodeId;
      if (requirementId === null || nodeId === null) {
        throw new Error("隔离 E2E 缺少需求 ID 或节点 ID");
      }

      const beforeContext = await client.context({ type: "requirement", id: requirementId });
      if (beforeContext.currentNode?.id !== nodeId || beforeContext.version === null) {
        throw new Error("冲突验收目标缺少当前节点或版本");
      }
      const before = await client.get({ type: "requirement", id: requirementId });
      const baseOptions = {
        nodeId,
        version: beforeContext.version,
        arguments: {
          interpretation: `AI-E2E 首次保存 ${config.runId}-conflict`,
          analysisConclusion: `AI-E2E 首次结论 ${config.runId}-conflict`,
        },
        context: { id: `requirement:${requirementId}`, version: String(beforeContext.version) },
      } as const;
      const first = await executeRequirementAnalysisScenario(client, requirementId, {
        ...baseOptions,
        idempotencyKey: `analysis-conflict-first-${config.runId}`,
      });
      expect(first.result.status).toBe("SUCCEEDED");

      let staleError: unknown;
      try {
        await executeRequirementAnalysisScenario(client, requirementId, {
          ...baseOptions,
          arguments: {
            interpretation: `AI-E2E 不应保存 ${config.runId}-conflict`,
            analysisConclusion: `AI-E2E 不应保存的结论 ${config.runId}-conflict`,
          },
          idempotencyKey: `analysis-conflict-stale-${config.runId}`,
        });
      } catch (error) {
        staleError = error;
      }
      expect(staleError).toBeInstanceOf(PmsClientError);
      expect(staleError).toMatchObject({ kind: "conflict", status: 409 });

      const after = await client.get({ type: "requirement", id: requirementId });
      const afterContext = await client.context({ type: "requirement", id: requirementId });
      const readback = JSON.stringify({
        details: after.details,
        resourceDetails: afterContext.resourceDetails,
        workflow: afterContext.workflow,
      });
      expect(readback).toContain(baseOptions.arguments.interpretation);
      expect(readback).not.toContain("不应保存");
      expect(afterContext.version).not.toBe(beforeContext.version);
      for (const key of ["systemId", "targetType", "targetId", "ownerId", "status", "startDate", "endDate"]) {
        if (Object.prototype.hasOwnProperty.call(before.details, key)) {
          expect(after.details[key]).toEqual(before.details[key]);
        }
      }
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
