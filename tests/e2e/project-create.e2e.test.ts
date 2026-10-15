import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { operationExecute } from "../../apps/pms-cli/src/commands/core/operation.js";
import {
  executeProjectCreateScenario,
  planProjectCreateScenario,
} from "../../apps/pms-cli/src/commands/scenarios/projectCreate.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  assertIsolatedE2EConfig,
  cleanupRecordedProjectIds,
  expectedViewerId,
  isolatedE2EEnabled,
  projectNameForRun,
} from "./support/isolatedSession.js";

const enabled = isolatedE2EEnabled(process.env);

describe.skipIf(!enabled)("PMS CLI isolated project creation", () => {
  it("authenticates the approved user, creates once, replays, reads back, and cleans only recorded IDs", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const store = new AuthStore(undefined, { service: config.keyringService });
    const auth = new BrowserAuth({ baseUrl: config.baseUrl, authOrigin: config.authOrigin, store });
    let session: CliSession | undefined;
    let client: PmsHttpClient | undefined;
    const createdProjectIds: number[] = [];
    let cleanupFailure: Error | undefined;

    try {
      session = await auth.login();
      client = new PmsHttpClient({
        baseUrl: session.account.baseUrl,
        auth: new StaticTokenProvider(session.accessToken),
        clientId: "pms-cli",
      });

      const capabilities = await client.capabilities();
      if (!capabilities.viewer || !expectedViewerId(capabilities.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止创建");
      }

      const baseArguments = { name: projectNameForRun(config.runId) };
      const initialPlan = await planProjectCreateScenario(client, { arguments: baseArguments });
      const selectedType = initialPlan.capabilitiesSummary.workflowTypes.find((type) =>
        type.templates.some((template) => template.defaultTemplate));
      if (!selectedType?.projectTypeId) {
        throw new Error("能力目录没有返回可用于项目创建的项目类型 ID");
      }
      const selectedTemplate = selectedType.templates.find((template) => template.defaultTemplate)
        ?? selectedType.templates[0];
      if (!selectedTemplate?.templateVersionId) {
        throw new Error("能力目录没有返回可用于项目创建的流程模板版本");
      }
      const argumentsValue = {
        ...baseArguments,
        projectTypeId: selectedType.projectTypeId,
        workflowTemplateVersionId: selectedTemplate.templateVersionId,
      };
      const plan = await planProjectCreateScenario(client, { arguments: argumentsValue });
      expect(plan.preview.command).toBe("project.create");
      expect(plan.arguments).toEqual(argumentsValue);
      const idempotencyKey = "project-create-" + config.runId;
      const first = await executeProjectCreateScenario(client, {
        arguments: argumentsValue,
        idempotencyKey,
        previewOperationId: plan.preview.operationId,
      });
      expect(first.result.status).toBe("SUCCEEDED");
      expect(first.trace.operationId).toBe(first.result.operationId);

      const projectId = readProjectId(first.result.data.project);
      if (projectId === null) throw new Error("项目创建成功响应缺少项目 ID，停止重放和清理");
      createdProjectIds.push(projectId);
      expect(first.readback.resource?.resourceId).toBe(projectId);
      expect(first.readback.context?.resource).toEqual({ type: "project", id: projectId });

      const replay = await executeProjectCreateScenario(client, {
        arguments: argumentsValue,
        idempotencyKey,
        previewOperationId: plan.preview.operationId,
      });
      expect(replay.result.operationId).toBe(first.result.operationId);
      expect(readProjectId(replay.result.data.project)).toBe(projectId);
      expect(replay.trace.operationId).toBe(first.trace.operationId);

      const exact = await client.get({ type: "project", id: projectId });
      const context = await client.context({ type: "project", id: projectId });
      expect(exact.resourceId).toBe(projectId);
      expect(exact.details.workflowTemplateVersionId).toBe(selectedTemplate.templateVersionId);
      expect(context.resource).toEqual({ type: "project", id: projectId });
    } finally {
      if (client && createdProjectIds.length > 0) {
        try {
          const failures: Array<{ id: number; error: string }> = [];
          const cleanup = await cleanupRecordedProjectIds(createdProjectIds, async (projectId) => {
            const result = await operationExecute(client!, "project.delete", `${config.runId}-delete-${projectId}`, {
              arguments: { projectId },
            });
            if (result.status !== "SUCCEEDED") throw new Error(result.message ?? "项目删除未成功");
          }, failures);
          if (cleanup.remainingIds.length > 0) {
            cleanupFailure = new Error("项目清理失败，残留 ID: " + cleanup.remainingIds.join(", ") + "；" + failures.map((item) => item.error).join("；"));
          }
        } catch (error) {
          cleanupFailure = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (session) {
        try {
          await auth.logout(session.account);
        } catch (error) {
          cleanupFailure ??= error instanceof Error ? error : new Error(String(error));
        }
      }
      if (cleanupFailure) throw cleanupFailure;
    }
  });
});

function readProjectId(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
