import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import { resourceScenarioContractVersion, type ResourceScenarioResourceType } from "../../packages/pms-contracts/src/index.js";
import { auditOperations } from "./support/operationAudit.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";

const requested = process.env.PMS_E2E_RESOURCE_SCENARIO === "true";
const enabled = requested;

/**
 * This is an explicit write gate. The default test suite does not touch a PMS;
 * setting PMS_E2E_RESOURCE_SCENARIO=true turns missing safety configuration into
 * a failing preflight instead of a false green result.
 */
describe.skipIf(!enabled)("PMS resource-scenario isolated E2E", () => {
  it("runs requirement, topic, and project through plan/execute/readback", async () => {
    const config = assertResourceScenarioConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService + "-resource-scenario" });
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store,
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
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止资源场景验收");
      }

      await runUpdateScenario(client, "requirement", config.requirementId, "requirement.update", {
        title: `${await titleOf(client, "requirement", config.requirementId)} [AI-E2E-${config.runId}]`,
      }, `resource-requirement-${config.runId}`);
      await runUpdateScenario(client, "topic", config.topicId, "topic.update", {
        title: `${await titleOf(client, "topic", config.topicId)} [AI-E2E-${config.runId}]`,
      }, `resource-topic-${config.runId}`);
      await runUpdateScenario(client, "project", config.projectId, "project.update", {
        name: `${await titleOf(client, "project", config.projectId)} [AI-E2E-${config.runId}]`,
      }, `resource-project-${config.runId}`);

      const audit = await auditOperations(config.runId, startedAt);
      const commands = audit.map((record) => record.commandName.toLowerCase());
      expect(commands.some((command) => command.includes("requirement.update"))).toBe(true);
      expect(commands.some((command) => command.includes("topic.update"))).toBe(true);
      expect(commands.some((command) => command.includes("project.update"))).toBe(true);
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 180_000);
});

async function runUpdateScenario(
  client: PmsHttpClient,
  resourceType: ResourceScenarioResourceType,
  resourceId: number,
  operation: string,
  argumentsValue: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const beforeResource = await client.get({ type: resourceType, id: resourceId });
  const beforeContext = await client.context({ type: resourceType, id: resourceId });
  const contextVersion = beforeContext.entityVersion ?? beforeContext.version;
  if (contextVersion === null || contextVersion === undefined) {
    throw new Error(`${resourceType}:${resourceId} 缺少可用于写入的实体版本`);
  }

  const plan = await planResourceScenario(client, {
    contractVersion: resourceScenarioContractVersion,
    resourceType,
    resourceId,
    operation,
    contextVersion,
    arguments: argumentsValue,
  });
  expect(plan.phase).toBe("plan");
  expect(plan.preview.command).toBe(operation);

  const afterPlanResource = await client.get({ type: resourceType, id: resourceId });
  expect(afterPlanResource.entityVersion).toBe(beforeResource.entityVersion);
  expect(afterPlanResource.details).toEqual(beforeResource.details);

  const first = await executeResourceScenario(client, {
    resourceType,
    resourceId,
    operation,
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(first.status).toBe("SUCCEEDED");
  expect(first.previewOperationId).toBe(plan.preview.operationId);
  expect(first.operation.operationId).toBeTruthy();
  expect(first.operation.auditId).toBeTruthy();
  expect(first.verification).toEqual({
    resourceReadback: true,
    contextReadback: true,
    patchApplied: true,
    protectedFieldsUnchanged: true,
  });

  const replay = await executeResourceScenario(client, {
    resourceType,
    resourceId,
    operation,
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(replay.status).toBe("SUCCEEDED");
  expect(replay.operation.operationId).toBe(first.operation.operationId);
  expect(replay.readback.context?.entityVersion).not.toBe(beforeContext.entityVersion);
}

async function titleOf(client: PmsHttpClient, resourceType: ResourceScenarioResourceType, resourceId: number): Promise<string> {
  const resource = await client.get({ type: resourceType, id: resourceId });
  const key = resourceType === "project" ? "name" : "title";
  const value = resource.details[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${resourceType}:${resourceId} 缺少 ${key}，无法生成隔离写入值`);
  }
  return value;
}

function assertResourceScenarioConfig(env: NodeJS.ProcessEnv) {
  if (!requested) throw new Error("真实资源场景验收必须设置 PMS_E2E_RESOURCE_SCENARIO=true");
  if (!isolatedE2EEnabled(env)) {
    throw new Error("真实资源场景验收缺少隔离 PMS 配置；请设置 PMS_E2E_WRITE、PMS_E2E_ISOLATED、允许目标和一次性数据库");
  }
  const config = assertIsolatedE2EConfig(env);
  if (!env.PMS_E2E_DB_URL?.trim()) throw new Error("真实资源场景验收缺少 PMS_E2E_DB_URL");
  const projectId = positiveEnvNumber(env.PMS_E2E_PROJECT_ID, "PMS_E2E_PROJECT_ID");
  const topicId = positiveEnvNumber(env.PMS_E2E_TOPIC_ID, "PMS_E2E_TOPIC_ID");
  const requirementId = positiveEnvNumber(env.PMS_E2E_REQUIREMENT_ID, "PMS_E2E_REQUIREMENT_ID");
  return { ...config, projectId, topicId, requirementId };
}

function positiveEnvNumber(raw: string | undefined, name: string): number {
  if (!raw || !/^[1-9]\d*$/.test(raw.trim())) throw new Error(`真实资源场景验收缺少有效的 ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} 超出安全整数范围`);
  return value;
}
