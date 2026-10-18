import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth, type CliSession } from "../../apps/pms-cli/src/auth/BrowserAuth.js";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";
import { createRequirementFixture } from "./support/requirementFixture.js";
import { advanceStoryToVariant, createStoryFixture } from "./support/storyFixture.js";

const enabled = process.env.PMS_E2E_CLI_NAME_PROGRESSION === "true"
  && process.env.PMS_E2E_CREATE_REQUIREMENT_FIXTURE === "true"
  && process.env.PMS_E2E_CREATE_STORY_FIXTURE === "true"
  && isolatedE2EEnabled(process.env);

interface CliOutput {
  ok: boolean;
  data?: any;
  error?: { code?: string; message?: string };
}

describe.skipIf(!enabled)("PMS CLI name-based progression isolated E2E", () => {
  it("uses names for context and progression run, then verifies ID-free userFacing output", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const cliPath = resolve(process.cwd(), "dist/pms-cli.js");
    if (!existsSync(cliPath)) throw new Error("dist/pms-cli.js 不存在，请先执行 pnpm build:cli");

    const keyringService = config.keyringService + "-name-progression";
    const auth = new BrowserAuth({
      baseUrl: config.baseUrl,
      authOrigin: config.authOrigin,
      store: new AuthStore(undefined, { service: keyringService }),
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
        throw new Error("浏览器批准身份与隔离 E2E 账号不一致，停止名称推进验收");
      }

      const requirement = await createRequirementFixture(client, `${config.runId}-cli-name-requirement`);
      const story = await createStoryFixture(client, `${config.runId}-cli-name-story`);
      const acceptance = await advanceStoryToVariant(
        client,
        `${config.runId}-cli-name-story-acceptance`,
        story.storyId,
        "acceptance",
      );
      const run = (args: string[]) => runBuiltCli(cliPath, args, keyringService);

      const requirementRead = await run([
        "scenario", "progression", "run", "requirement",
        "--name", requirement.title,
        "--intent", "READ_CONTEXT",
      ]);
      assertSuccessful(requirementRead);
      expect(requirementRead.data.status).toBe("CONTEXT_READY");
      expect(requirementRead.data.userFacing.resourceName).toBe(requirement.title);
      expect(requirementRead.data.userFacing).not.toHaveProperty("resourceId");

      const requirementContext = await client.context(
        { type: "requirement", id: requirement.requirementId },
        { nodeId: requirement.nodeId, view: "focused" },
      );
      const requirementRun = await run([
        "scenario", "progression", "run", "requirement",
        "--name", requirement.title,
        "--intent", "COMPLETE_NODE",
        "--execute-mode", "auto",
        "--node-id", String(requirement.nodeId),
        "--version", String(requirementContext.version),
        "--draft-json", JSON.stringify(requirementDraft(requirementContext, config.runId)),
        "--idempotency-key", `${config.runId}-cli-name-requirement-complete`,
      ]);
      assertSuccessful(requirementRun);
      expect(requirementRun.data.status).toBe("SUCCEEDED");
      expect(requirementRun.data.userFacing.resourceName).toBe(requirement.title);
      expect(requirementRun.data.userFacing).not.toHaveProperty("resourceId");
      expect(requirementRun.data.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      });

      const storyContext = await client.context(
        { type: "story", id: story.storyId },
        { nodeId: acceptance.nodeId, view: "focused", component: "story-node-workbench" },
      );
      const storyRun = await run([
        "scenario", "progression", "run", "story",
        "--name", story.title,
        "--intent", "COMPLETE_NODE",
        "--execute-mode", "auto",
        "--node-id", String(acceptance.nodeId),
        "--version", String(storyContext.version),
        "--draft-json", JSON.stringify(storyDraft(config.runId)),
        "--idempotency-key", `${config.runId}-cli-name-story-complete`,
      ]);
      assertSuccessful(storyRun);
      expect(storyRun.data.status).toBe("SUCCEEDED");
      expect(storyRun.data.userFacing.resourceName).toBe(story.title);
      expect(storyRun.data.userFacing).not.toHaveProperty("resourceId");
      expect(storyRun.data.verification).toMatchObject({
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      });

      const requirementReadback = await run([
        "context", "requirement", "--name", requirement.title,
        "--view", "focused", "--node-id", String(requirement.nodeId),
      ]);
      assertSuccessful(requirementReadback);
      expect(requirementReadback.data.resource).toEqual({
        type: "requirement",
        id: requirement.requirementId,
      });

      const storyReadback = await run([
        "context", "story", "--name", story.title,
        "--view", "focused", "--node-id", String(acceptance.nodeId),
      ]);
      assertSuccessful(storyReadback);
      expect(storyReadback.data.resource).toEqual({ type: "story", id: story.storyId });
    } finally {
      if (session) await auth.logout(session.account);
    }
  }, 300_000);
});

function requirementDraft(context: any, runId: string) {
  const node = (context.workflow?.nodes ?? []).find((candidate: any) => candidate.id === context.currentNode?.id);
  const component = node?.components.find((candidate: any) => candidate.saveContract);
  const contract = component?.saveContract;
  if (!contract || contract.completionSupported !== true) {
    throw new Error("CLI 名称推进需求节点没有声明原子完成能力");
  }
  const patch: Record<string, unknown> = {};
  const fieldSources: Record<string, unknown> = {};
  for (const field of contract.fieldContracts ?? []) {
    if (!field.required || !contract.writableFields.includes(field.key)) continue;
    patch[field.key] = Array.isArray(field.options) && field.options.length > 0
      ? field.options[0]
      : field.type === "number" || field.type === "integer" ? 4
        : field.type === "boolean" ? true
          : field.type === "array" ? [`AI-E2E-${runId}`]
            : `AI-E2E-${runId}`;
    fieldSources[field.key] = {
      sourceType: "conversation",
      sourceRefs: [`conversation:${runId}`],
      confidence: "high",
    };
  }
  return {
    facts: [{ text: "需求详情来自当前 PMS 上下文", sourceRefs: [`conversation:${runId}`], confidence: "high" }],
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

function storyDraft(runId: string) {
  return {
    facts: [{ text: "故事验收详情来自当前 PMS 上下文", sourceRefs: [`conversation:${runId}`], confidence: "high" }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch: {
      acceptanceConclusion: "PASS",
      acceptanceNote: `CLI 名称推进 E2E ${runId}`,
    },
    fieldSources: {
      acceptanceConclusion: { sourceType: "conversation", sourceRefs: [`conversation:${runId}`], confidence: "high" },
      acceptanceNote: { sourceType: "conversation", sourceRefs: [`conversation:${runId}`], confidence: "high" },
    },
    requestedCompletion: true,
    ownerId: Number(process.env.PMS_E2E_ACCOUNT_ID),
    startDate: "2026-10-10",
    endDate: "2026-10-20",
  };
}

function assertSuccessful(output: CliOutput): asserts output is CliOutput & { data: any } {
  expect(output.ok, output.error?.message ?? JSON.stringify(output)).toBe(true);
  expect(output.data).toBeTruthy();
}

function runBuiltCli(cliPath: string, args: string[], keyringService: string): Promise<CliOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: resolve(cliPath, "..", ".."),
      env: { ...process.env, PMS_CLI_KEYRING_SERVICE: keyringService },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      reject(new Error(`CLI 命令超时: ${args.join(" ")}`));
    }, 120_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      settled = true;
      clearTimeout(timeout);
      const raw = (code === 0 ? stdout : stderr).trim();
      try {
        resolvePromise(JSON.parse(raw) as CliOutput);
      } catch (error) {
        reject(new Error(`CLI 输出不是 JSON（退出码 ${code}）：${raw || stdout || stderr}`, { cause: error }));
      }
    });
  });
}
