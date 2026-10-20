import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../../apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import "../../apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.js";
import "../../apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.js";
import "../../apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.js";
import { resourceScenarioContractVersion, type ResourceScenarioResourceType } from "../../packages/pms-contracts/src/index.js";
import { auditOperationsInWindow } from "./support/operationAudit.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import { createProjectFixture, type ProjectFixture, type WritableNodeFixture } from "./support/projectFixture.js";
import { createTopicFixture } from "./support/topicFixture.js";
import type { TopicFixture } from "./support/topicFixture.js";

const requested = process.env.PMS_E2E_RESOURCE_SCENARIO === "true";
const createFixtures = process.env.PMS_E2E_CREATE_RESOURCE_FIXTURES === "true";
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

      const project = createFixtures
        ? await createProjectFixture(client, config.runId)
        : null;
      const topic = createFixtures
        ? await createTopicFixture(client, config.runId)
        : null;
      const requirementId = config.requirementId;
      const topicId = topic?.topicId ?? config.topicId;
      const projectId = project?.projectId ?? config.projectId;
      if (requirementId === null || topicId === null || projectId === null) {
        throw new Error("资源场景 E2E 没有解析出需求、专题和项目夹具 ID");
      }

      await runUpdateScenario(client, "requirement", requirementId, "requirement.update", {
        title: `AI-E2E-需求-${config.runId}`,
      }, `resource-requirement-${config.runId}`);
      await runUpdateScenario(client, "topic", topicId, "topic.update", {
        title: `AI-E2E-专题-${config.runId}`,
      }, `resource-topic-${config.runId}`);
      await runUpdateScenario(client, "project", projectId, "project.update", {
        name: `AI-E2E-项目-${config.runId}`,
      }, `resource-project-${config.runId}`);

      if (project?.node) {
        await runNodeUpdateScenario(client, "project", projectId, project.node,
          "node.field.update", `resource-project-node-${config.runId}`);
      }
      const projectCompletionExecuted = project?.node
        ? await runNodeCompletionScenario(client, "project", projectId, project.node,
          "node.complete-with-data", `resource-project-complete-${config.runId}`)
        : false;
      if (topic?.node) {
        await runNodeUpdateScenario(client, "topic", topicId, topic.node,
          "development-item.node.field.update", `resource-topic-node-${config.runId}`);
      }
      const topicCompletionExecuted = topic?.node
        ? await runNodeCompletionScenario(client, "topic", topicId, topic.node,
          "development-item.node.complete-with-data", `resource-topic-complete-${config.runId}`)
        : false;

      const audit = await auditOperationsInWindow(startedAt);
      const commands = audit.map((record) => record.commandName.toLowerCase());
      expect(commands.some((command) => command.includes("requirement.update"))).toBe(true);
      expect(commands.some((command) => command.includes("topic.update"))).toBe(true);
      expect(commands.some((command) => command.includes("project.update"))).toBe(true);
      if (createFixtures) {
        if (topic?.node) {
          expect(commands.some((command) => command.includes("development-item.node.field.update"))).toBe(true);
          if (topicCompletionExecuted) expect(commands).toContain("development-item.node.complete-with-data");
        }
        if (project?.node) {
          expect(commands).toContain("node.field.update");
          if (projectCompletionExecuted) expect(commands).toContain("node.complete-with-data");
        }
      }
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
  // Keep the E2E input aligned with each adapter's context contract: the
  // workflow version guards requirement/topic plans, while project updates
  // guard the project entity version.
  const contextVersion = scenarioContextVersion(resourceType, beforeContext);

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
  const updatedField = resourceType === "project" ? "name" : "title";
  const expectedPatch = { [updatedField]: argumentsValue[updatedField] };

  const afterPlanResource = await client.get({ type: resourceType, id: resourceId });
  expect(afterPlanResource.entityVersion).toBe(beforeResource.entityVersion);
  expect(afterPlanResource.details).toEqual(beforeResource.details);

  const first = await executeResourceScenario(client, {
    resourceType,
    resourceId,
    operation,
    expectedPatch,
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
    expectedPatch,
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(replay.status).toBe("SUCCEEDED");
  expect(replay.operation.operationId).toBe(first.operation.operationId);
  expect(replay.readback.resource?.details[updatedField]).toBe(argumentsValue[updatedField]);
  if (beforeResource.entityVersion !== null && replay.readback.resource?.entityVersion !== null) {
    expect(replay.readback.resource?.entityVersion).not.toBe(beforeResource.entityVersion);
  }
}

async function runNodeUpdateScenario(
  client: PmsHttpClient,
  resourceType: "project" | "topic",
  resourceId: number,
  node: WritableNodeFixture,
  operation: "node.field.update" | "development-item.node.field.update",
  idempotencyKey: string,
): Promise<void> {
  const argumentsValue = resourceType === "project"
    ? { fields: { [node.fieldKey]: node.fieldValue } }
    : { fieldValues: { [node.fieldKey]: node.fieldValue } };
  const context = await client.context(
    { type: resourceType, id: resourceId },
    { nodeId: node.nodeId, view: "focused", component: node.componentKey },
  );
  const contextVersion = resourceType === "project"
    ? context.entityVersion ?? context.version
    : context.version;
  if (contextVersion === null || contextVersion === undefined) {
    throw new Error(`${resourceType} 节点夹具缺少当前并发版本`);
  }
  const plan = await planResourceScenario(client, {
    contractVersion: resourceScenarioContractVersion,
    resourceType,
    resourceId,
    operation,
    nodeId: node.nodeId,
    componentKey: node.componentKey,
    contextVersion,
    arguments: argumentsValue,
  });
  expect(plan.phase).toBe("plan");
  expect(plan.preview.command).toBe(operation);

  const first = await executeResourceScenario(client, {
    resourceType,
    resourceId,
    operation,
    nodeId: node.nodeId,
    componentKey: node.componentKey,
    expectedPatch: { [node.fieldKey]: node.fieldValue },
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(first.status).toBe("SUCCEEDED");
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
    nodeId: node.nodeId,
    componentKey: node.componentKey,
    expectedPatch: { [node.fieldKey]: node.fieldValue },
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(replay.status).toBe("SUCCEEDED");
  expect(replay.operation.operationId).toBe(first.operation.operationId);
}

async function runNodeCompletionScenario(
  client: PmsHttpClient,
  resourceType: "project" | "topic",
  resourceId: number,
  node: WritableNodeFixture,
  operation: "node.complete-with-data" | "development-item.node.complete-with-data",
  idempotencyKey: string,
): Promise<boolean> {
  const argumentsValue = resourceType === "project"
    ? {
      fields: { ...node.requiredFieldValues, [node.fieldKey]: node.fieldValue },
      ownerId: node.ownerId,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    }
    : {
      fieldValues: { ...node.requiredFieldValues, [node.fieldKey]: node.fieldValue },
      ownerId: node.ownerId,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    };
  const context = await client.context(
    { type: resourceType, id: resourceId },
    { nodeId: node.nodeId, view: "focused", component: node.componentKey },
  );
  const contextVersion = resourceType === "project"
    ? context.entityVersion ?? context.version
    : context.version;
  if (contextVersion === null || contextVersion === undefined) {
    throw new Error(`${resourceType} 节点夹具缺少完成操作所需的并发版本`);
  }
  if (!node.completionSupported) {
    await expect(planResourceScenario(client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType,
      resourceId,
      operation,
      nodeId: node.nodeId,
      componentKey: node.componentKey,
      contextVersion,
      arguments: argumentsValue,
    })).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
    return false;
  }
  if (node.completionMode === null) {
    throw new Error(`${resourceType} 节点完成能力缺少 completionMode，无法判断执行风险`);
  }
  const missingMetadata = node.completionRequiredMetadata.filter((key) =>
    !Object.prototype.hasOwnProperty.call(argumentsValue, key));
  if (missingMetadata.length > 0) {
    throw new Error(`${resourceType} 节点完成夹具缺少后端声明的元数据：${missingMetadata.join(", ")}`);
  }
  const plan = await planResourceScenario(client, {
    contractVersion: resourceScenarioContractVersion,
    resourceType,
    resourceId,
    operation,
    nodeId: node.nodeId,
    componentKey: node.componentKey,
    contextVersion,
    arguments: argumentsValue,
  });
  expect(plan.phase).toBe("plan");
  expect(plan.preview.command).toBe(operation);

  const blocked = plan.preview.preconditions.some((precondition) =>
    typeof precondition === "object" && precondition !== null && "blocking" in precondition
      && (precondition as { blocking?: unknown }).blocking === true);
  if (node.completionMode !== "AUTO_CONFIRM" || blocked) return false;

  const first = await executeResourceScenario(client, {
    resourceType,
    resourceId,
    operation,
    nodeId: node.nodeId,
    componentKey: node.componentKey,
    expectedPatch: { [node.fieldKey]: node.fieldValue },
    previewOperationId: plan.preview.operationId,
    idempotencyKey,
  });
  expect(first.status).toBe("SUCCEEDED");
  expect(first.verification).toEqual({
    resourceReadback: true,
    contextReadback: true,
    patchApplied: true,
    protectedFieldsUnchanged: true,
  });
  return true;
}

function scenarioContextVersion(
  resourceType: ResourceScenarioResourceType,
  context: { version: number | null; entityVersion?: number | null },
): number {
  const value = resourceType === "project"
    ? context.entityVersion ?? context.version
    : context.version;
  if (value === null || value === undefined) {
    throw new Error(`${resourceType} 上下文缺少可用于计划的版本`);
  }
  return value;
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
  const projectId = createFixtures ? null : positiveEnvNumber(env.PMS_E2E_PROJECT_ID, "PMS_E2E_PROJECT_ID");
  const topicId = createFixtures ? null : positiveEnvNumber(env.PMS_E2E_TOPIC_ID, "PMS_E2E_TOPIC_ID");
  const requirementId = positiveEnvNumber(env.PMS_E2E_REQUIREMENT_ID, "PMS_E2E_REQUIREMENT_ID");
  return { ...config, projectId, topicId, requirementId };
}

function positiveEnvNumber(raw: string | undefined, name: string): number {
  if (!raw || !/^[1-9]\d*$/.test(raw.trim())) throw new Error(`真实资源场景验收缺少有效的 ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} 超出安全整数范围`);
  return value;
}
