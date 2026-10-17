import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { runAgentProgression } from "../../apps/pms-cli/src/commands/scenarios/agentProgressionRun.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import { agentProgressionContractVersion, type WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import { auditOperations } from "./support/operationAudit.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import { createRequirementFixture } from "./support/requirementFixture.js";

const requested = process.env.PMS_E2E_AGENT_PROGRESSION === "true";
const createFixture = process.env.PMS_E2E_CREATE_AGENT_PROGRESSION_FIXTURE === "true";
const cleanupConfirmed = process.env.PMS_E2E_DATABASE_CLEANUP_CONFIRMED === "true";
const configuredRequirementId = positiveEnvNumber("PMS_E2E_REQUIREMENT_ID");
const configuredNodeId = positiveEnvNumber("PMS_E2E_NODE_ID");
const enabled = requested
  && isolatedE2EEnabled(process.env)
  && (createFixture ? cleanupConfirmed : configuredRequirementId !== null && configuredNodeId !== null);

/**
 * This test is intentionally off by default. When enabled, it needs a
 * disposable PMS/MySQL database and either a run-scoped fixture or an
 * explicitly configured isolated requirement/node pair.
 */
describe.skipIf(!enabled)("PMS Agent progression run isolated E2E", () => {
  it("runs one external-agent draft through preview, execute, readback, audit, and replay", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    if (!process.env.PMS_E2E_DB_URL?.trim()) {
      throw new Error("真实 Agent progression E2E 缺少 PMS_E2E_DB_URL");
    }
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store: new AuthStore(undefined, { service: config.keyringService + "-agent-progression" }),
      callbackHost: process.env.PMS_E2E_CALLBACK_HOST === "localhost" ? "localhost" : undefined,
      openBrowser: async (url) => console.log(`PMS_E2E_AUTH_URL=${url}`),
    });
    let session: CliSession | undefined;
    const startedAt = new Date();

    try {
      session = await auth.login();
      const client = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });
      const capabilities = await client.capabilities();
      if (!capabilities.viewer || !expectedViewerId(capabilities.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止 Agent progression 验收");
      }

      const fixture = createFixture
        ? await createRequirementFixture(client, `${config.runId}-agent-progression`)
        : null;
      const requirementId = fixture?.requirementId ?? configuredRequirementId;
      const nodeId = fixture?.nodeId ?? configuredNodeId;
      if (requirementId === null || nodeId === null) {
        throw new Error("Agent progression E2E 缺少隔离需求或节点 ID");
      }

      const before = await client.context(
        { type: "requirement", id: requirementId },
        { nodeId, view: "focused" },
      );
      if (before.version === null || before.currentNode?.id !== nodeId) {
        throw new Error("Agent progression E2E 目标节点没有可用版本或不是当前节点");
      }
      const draft = draftForContext(before, config.runId);
      const base = {
        contractVersion: agentProgressionContractVersion,
        resourceType: "requirement" as const,
        resourceId: requirementId,
        nodeId,
        contextVersion: before.version,
        intent: "UPDATE_NODE_FIELDS" as const,
        executeMode: "auto" as const,
        draft,
        idempotencyKey: `${config.runId}-agent-progression-write`,
      };

      const first = await runAgentProgression(client, base);
      expect(first.status).toBe("SUCCEEDED");
      expect(first.previewOperationId).toBeTruthy();
      expect(first.operationId).toBeTruthy();
      expect(first.auditId).toBeTruthy();
      expect(first.readback?.resource?.resourceId).toBe(requirementId);
      expect(first.verification).toEqual({
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      });

      const afterFirst = await client.context(
        { type: "requirement", id: requirementId },
        { nodeId, view: "focused" },
      );
      if (afterFirst.version === null) throw new Error("Agent progression replay 缺少最新上下文版本");
      const replay = await runAgentProgression(client, {
        ...base,
        contextVersion: afterFirst.version,
      });
      expect(replay.status).toBe("SUCCEEDED");
      expect(replay.operationId).toBe(first.operationId);
      expect(replay.auditId).toBe(first.auditId);

      const audit = await auditOperations(config.runId, startedAt);
      expect(audit.some((record) => record.id === first.auditId)).toBe(true);
      expect(audit.some((record) => record.commandName.includes("development-item.node.field.update"))).toBe(true);
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 180_000);
});

function draftForContext(context: WorkflowContext, runId: string) {
  const node = (context.workflow?.nodes ?? []).find((candidate) => isRecord(candidate)
    && candidate.id === context.currentNode?.id);
  const component = isRecord(node) && Array.isArray(node.components)
    ? node.components.find((candidate) => isRecord(candidate) && isRecord(candidate.saveContract))
    : undefined;
  const contract = isRecord(component) && isRecord(component.saveContract)
    ? component.saveContract
    : undefined;
  const writableFields = stringArray(contract?.writableFields)
    .filter((field) => !stringArray(contract?.protectedFields).includes(field));
  const fieldKey = writableFields[0];
  if (!fieldKey) throw new Error("Agent progression E2E 当前节点没有可写字段");
  const fieldContract = Array.isArray(contract?.fieldContracts)
    ? contract.fieldContracts.find((candidate) => isRecord(candidate) && candidate.key === fieldKey)
    : undefined;
  const marker = `AI-E2E-${runId}`;
  const patch = { [fieldKey]: valueForField(fieldContract, marker) };
  return {
    facts: [{ text: "字段来自隔离 PMS 当前节点上下文", sourceRefs: [`requirement:${context.resource.id}`], confidence: "high" as const }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
    fieldSources: {
      [fieldKey]: {
        sourceType: "conversation" as const,
        sourceRefs: [`conversation:${runId}`],
        confidence: "high" as const,
      },
    },
    requestedCompletion: false,
  };
}

function valueForField(field: unknown, marker: string): unknown {
  if (!isRecord(field)) return marker;
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length > 0) return options[0];
  if (field.type === "number" || field.type === "integer") return 1;
  if (field.type === "boolean") return true;
  if (field.type === "array") return [marker];
  if (field.type === "date") return "2026-10-10";
  return marker;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveEnvNumber(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
