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
import { createRequirementFixture } from "./support/requirementFixture.js";

const createFixture = process.env.PMS_E2E_CREATE_REQUIREMENT_FIXTURE === "true";
const enabled = process.env.PMS_E2E_NODE_AUTOFILL_REQUIREMENT === "true"
  && isolatedE2EEnabled(process.env)
  && (createFixture || (positiveEnvNumber("PMS_E2E_REQUIREMENT_ID") !== null
    && positiveEnvNumber("PMS_E2E_NODE_ID") !== null));

describe.skipIf(!enabled)("PMS CLI requirement node detail autofill", () => {
  it("plans, atomically completes, and verifies a requirement node", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store: new AuthStore(undefined, { service: config.keyringService + "-node-autofill" }),
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
        throw new Error("浏览器批准身份与隔离 E2E 账号不一致，停止需求节点写入");
      }
      const fixture = createFixture
        ? await createRequirementFixture(client, config.runId + "-node-autofill")
        : null;
      const requirementId = fixture?.requirementId ?? positiveEnvNumber("PMS_E2E_REQUIREMENT_ID")!;
      const nodeId = fixture?.nodeId ?? positiveEnvNumber("PMS_E2E_NODE_ID")!;
      const before = await client.context(
        { type: "requirement", id: requirementId },
        { nodeId, view: "focused" },
      );
      if (before.version === null) throw new Error("需求节点上下文缺少版本");
      const draft = draftForContext(before, config.runId);
      const base = {
        contractVersion: agentProgressionContractVersion,
        resourceType: "requirement" as const,
        resourceId: requirementId,
        nodeId,
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
        idempotencyKey: `${config.runId}-requirement-node-autofill`,
      });
      expect(result.status).toBe("SUCCEEDED");
      expect(result.readback?.resource?.resourceId).toBe(requirementId);
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

function draftForContext(context: any, runId: string) {
  const node = (context.workflow?.nodes ?? []).find((candidate: any) => candidate?.id === context.currentNode?.id);
  const component = (node?.components ?? []).find((candidate: any) => candidate?.saveContract);
  const contract = component?.saveContract;
  if (!contract?.completionSupported || contract.completionCommand !== "development-item.node.complete-with-data") {
    throw new Error("需求测试节点没有声明原子完成能力");
  }
  const patch: Record<string, unknown> = {};
  const fieldSources: Record<string, unknown> = {};
  const nodeId = context.currentNode?.id;
  if (!nodeId) throw new Error("需求测试上下文缺少当前节点");
  for (const field of contract.fieldContracts ?? []) {
    if (!field.required || !contract.writableFields.includes(field.key)) continue;
    patch[field.key] = Array.isArray(field.options) && field.options.length > 0
      ? field.options[0]
      : field.type === "number" ? 4
      : field.type === "boolean" ? true
      : field.type === "array" ? [`AI-E2E-${runId}`]
      : `AI-E2E-${runId}`;
    fieldSources[field.key] = {
      sourceType: "pms_context",
      sourceRefs: [`requirement-node:${nodeId}#component:${component.key}`],
      confidence: "high",
    };
  }
  return {
    facts: [{ text: "需求节点来自隔离 PMS 上下文", sourceRefs: [`requirement:${context.resource.id}`], confidence: "high" as const }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
    fieldSources,
    requestedCompletion: true,
    ownerId: Number(process.env.PMS_E2E_ACCOUNT_ID),
    startDate: "2026-10-10",
    endDate: "2026-10-20",
  };
}

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
