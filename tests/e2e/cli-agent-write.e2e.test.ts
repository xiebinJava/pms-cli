import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  assertIsolatedE2EConfig,
  expectedViewerId,
  isolatedE2EEnabled,
} from "./support/isolatedSession.js";

const enabled = process.env.PMS_E2E_CLI === "true" && isolatedE2EEnabled(process.env);

interface CliOutput {
  ok: boolean;
  data?: any;
  error?: { code?: string; message?: string };
}

describe.skipIf(!enabled)("PMS CLI real agent boundary", () => {
  it("drives the built CLI through plan, preview-bound execute, readback, and cleanup", async () => {
    const config = assertIsolatedE2EConfig(process.env);
    const cliPath = resolve(process.cwd(), "dist/pms-cli.js");
    if (!existsSync(cliPath)) throw new Error("dist/pms-cli.js 不存在，请先执行 npm run build:cli");

    const keyringService = config.keyringService + "-cli";
    const testNonce = `${config.runId}-${Date.now()}`;
    const authUrlFile = resolve(tmpdir(), `pms-cli-auth-${config.runId}-${process.pid}.url`);
    try { unlinkSync(authUrlFile); } catch { /* stale test artifact */ }
    let loginProcess: SpawnedCliProcess | undefined;
    let projectId: number | undefined;
    let projectContextVersion: string | undefined;
    let createPreviewOperationId: string | undefined;
    let createIdempotencyKey: string | undefined;
    let cleanupError: Error | undefined;

    const run = (args: string[]) => runBuiltCli(cliPath, args, keyringService);

    try {
      const login = spawnBuiltCliLogin(cliPath, {
        baseUrl: config.baseUrl,
        authOrigin: config.authOrigin,
        keyringService,
        authUrlFile,
      });
      loginProcess = login.process;
      const authUrl = await waitForAuthUrl(authUrlFile, login.completion);
      console.log(`PMS_E2E_AUTH_URL=${authUrl}`);
      // The test runner pauses here while the operator approves this URL in
      // the browser. The CLI process owns the callback and token exchange.
      const loginOutput = await login.completion;
      expect(loginOutput.ok, loginOutput.error?.message ?? JSON.stringify(loginOutput)).toBe(true);

      const capabilitiesOutput = await run(["capabilities"]);
      expect(capabilitiesOutput.ok, capabilitiesOutput.error?.message ?? JSON.stringify(capabilitiesOutput)).toBe(true);
      if (!capabilitiesOutput.data.viewer || !expectedViewerId(capabilitiesOutput.data.viewer, config.accountId)) {
        throw new Error("浏览器批准身份与 PMS_E2E_ACCOUNT_ID 不一致，停止 CLI 写入");
      }
      const workflowTypes = capabilitiesOutput.data.workflowTypes as Array<{
        projectTypeId?: number;
        templates?: Array<{ templateVersionId?: number; defaultTemplate?: boolean }>;
      }>;
      const selectedType = workflowTypes?.find((type) =>
        type.templates?.some((template) => template.defaultTemplate));
      const selectedTemplate = selectedType?.templates?.find((template) => template.defaultTemplate)
        ?? selectedType?.templates?.[0];
      if (!selectedType?.projectTypeId || !selectedTemplate?.templateVersionId) {
        throw new Error("CLI 能力目录没有返回可用于项目创建的类型和流程模板");
      }

      const argumentsValue = {
        name: `AI-CLI-${testNonce}`,
        projectTypeId: selectedType.projectTypeId,
        workflowTemplateVersionId: selectedTemplate.templateVersionId,
      };
      const planOutput = await run([
        "scenario", "project-create", "plan",
        "--arguments-json", JSON.stringify(argumentsValue),
      ]);
      expect(planOutput.ok).toBe(true);
      expect(planOutput.data.preview.command).toBe("project.create");
      const previewOperationId = String(planOutput.data.preview.operationId);
      expect(previewOperationId).toBeTruthy();
      createPreviewOperationId = previewOperationId;

      const idempotencyKey = `agent-cli-${testNonce}`;
      createIdempotencyKey = idempotencyKey;
      const executeOutput = await run([
        "scenario", "project-create", "execute",
        "--arguments-json", JSON.stringify(argumentsValue),
        "--preview-operation-id", previewOperationId,
        "--idempotency-key", idempotencyKey,
      ]);
      projectId = readProjectId(executeOutput.data?.result?.data?.project ?? executeOutput.data?.result?.data);
      expect(executeOutput.ok, executeOutput.error?.message ?? JSON.stringify(executeOutput)).toBe(true);
      expect(executeOutput.data.previewOperationId).toBe(previewOperationId);
      expect(executeOutput.data.result.status).toBe("SUCCEEDED");
      if (!projectId) throw new Error("CLI 项目创建响应缺少项目 ID");

      const getOutput = await run(["get", "project", String(projectId)]);
      expect(getOutput.ok).toBe(true);
      expect(getOutput.data.resourceId).toBe(projectId);
      const resolveOutput = await run(["resolve", "project", "--name", argumentsValue.name]);
      expect(resolveOutput.ok, resolveOutput.error?.message ?? JSON.stringify(resolveOutput)).toBe(true);
      expect(resolveOutput.data).toEqual({
        resourceType: "project",
        resourceId: projectId,
        resourceName: argumentsValue.name,
      });
      // The built-in JSON context is available independently of the optional
      // agent-context feature flags. The latter are intentionally disabled in
      // some real PMS environments, so this E2E verifies the stable readback
      // contract before testing any feature-gated agent projection.
      const contextOutput = await run(["context", "project", String(projectId)]);
      expect(contextOutput.ok, contextOutput.error?.message ?? JSON.stringify(contextOutput)).toBe(true);
      expect(contextOutput.data.resource).toEqual({ type: "project", id: projectId });
      const namedContextOutput = await run(["context", "project", "--name", argumentsValue.name]);
      expect(namedContextOutput.ok, namedContextOutput.error?.message ?? JSON.stringify(namedContextOutput)).toBe(true);
      expect(namedContextOutput.data.resource).toEqual({ type: "project", id: projectId });
      projectContextVersion = String(contextOutput.data.version ?? "");
      expect(projectContextVersion).not.toBe("");

      const deletePlan = await run([
        "operation", "preview", "project.delete",
        "--arguments-json", JSON.stringify({ projectId, reason: "真实 CLI E2E 清理" }),
        "--context-id", `project:${projectId}`,
        "--context-version", projectContextVersion,
      ]);
      expect(deletePlan.ok).toBe(true);
      const deleteExecute = await run([
        "operation", "execute",
        "--preview-operation-id", String(deletePlan.data.operationId),
            "--idempotency-key", `agent-cli-delete-${testNonce}`,
      ]);
      expect(deleteExecute.ok).toBe(true);
      expect(deleteExecute.data.status).toBe("SUCCEEDED");
      const deletedReadback = await run(["get", "project", String(projectId)]);
      if (deletedReadback.ok || deletedReadback.error?.code !== "NOT_FOUND") {
        throw new Error(
          `删除回读未确认资源不存在: ${JSON.stringify(deletedReadback)}`,
        );
      }
      projectId = undefined;
    } finally {
      // If the process timed out after PMS committed the write, replay the
      // same preview + idempotency pair so cleanup can still discover the
      // created project without risking a duplicate create.
      if (!projectId && createPreviewOperationId && createIdempotencyKey) {
        try {
          const replay = await run([
            "scenario", "project-create", "execute",
            "--arguments-json", JSON.stringify({
              name: `AI-CLI-${testNonce}`,
              // The preview binds the actual arguments, so the replay only
              // needs the same idempotency pair to recover its result.
            }),
            "--preview-operation-id", createPreviewOperationId,
            "--idempotency-key", createIdempotencyKey,
          ]);
          if (replay.ok) {
            projectId = readProjectId(replay.data?.result?.data?.project ?? replay.data?.result?.data);
          }
        } catch {
          // Preserve the original failure; cleanup below will report if the
          // project cannot be safely located.
        }
      }
      if (projectId) {
        try {
          const currentContext = await run(["context", "project", String(projectId)]);
          if (!currentContext.ok && currentContext.error?.code === "NOT_FOUND") {
            // A previous delete may have committed even if its response was
            // lost. Treat a confirmed missing resource as already cleaned.
            projectId = undefined;
          } else if (!currentContext.ok) {
            throw new Error(currentContext.error?.message ?? "无法读取项目最新上下文版本");
          }
          if (projectId) {
            const currentVersion = String(currentContext.data.version ?? "");
            if (!currentVersion) throw new Error("项目上下文缺少当前版本");
            const deletePlan = await run([
              "operation", "preview", "project.delete",
              "--arguments-json", JSON.stringify({ projectId, reason: "真实 CLI E2E 清理" }),
              "--context-id", `project:${projectId}`,
              "--context-version", currentVersion,
            ]);
            if (!deletePlan.ok) throw new Error(deletePlan.error?.message ?? "项目清理预览失败");
            const deleteExecute = await run([
              "operation", "execute",
              "--preview-operation-id", String(deletePlan.data.operationId),
              "--idempotency-key", `agent-cli-cleanup-${testNonce}-${projectId}`,
            ]);
            if (!deleteExecute.ok || deleteExecute.data.status !== "SUCCEEDED") {
              throw new Error(deleteExecute.error?.message ?? "项目清理执行失败");
            }
          }
        } catch (error) {
          cleanupError = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (loginProcess && !loginProcess.killed) {
        try {
          loginProcess.kill("SIGTERM");
        } catch (error) {
          cleanupError ??= error instanceof Error ? error : new Error(String(error));
        }
      }
      try {
        const logout = await run(["auth", "logout"]);
        if (!logout.ok && logout.error?.message !== "尚未登录，请先执行 pms auth login") {
          cleanupError ??= new Error(logout.error?.message ?? "CLI logout 失败");
        }
      } catch (error) {
        cleanupError ??= error instanceof Error ? error : new Error(String(error));
      }
      try { unlinkSync(authUrlFile); } catch { /* already removed */ }
      if (cleanupError) throw cleanupError;
    }
  }, 300_000);
});

function runBuiltCli(cliPath: string, args: string[], keyringService: string): Promise<CliOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: resolve(cliPath, "..", ".."),
      env: {
        ...process.env,
        PMS_CLI_KEYRING_SERVICE: keyringService,
      },
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
        const parsed = JSON.parse(raw) as CliOutput;
        resolvePromise(parsed);
      } catch (error) {
        reject(new Error(`CLI 输出不是 JSON（退出码 ${code}）：${raw || stdout || stderr}`, { cause: error }));
      }
    });
  });
}

type SpawnedCliProcess = ChildProcessByStdio<null, Readable, Readable>;

function spawnBuiltCliLogin(
  cliPath: string,
  options: { baseUrl: string; authOrigin: string; keyringService: string; authUrlFile: string },
): { process: SpawnedCliProcess; completion: Promise<CliOutput> } {
  const child = spawn(process.execPath, [cliPath, "auth", "login"], {
    cwd: resolve(cliPath, "..", ".."),
    env: {
      ...process.env,
      PMS_BASE_URL: options.baseUrl,
      PMS_AUTH_ORIGIN: options.authOrigin,
      PMS_CLI_KEYRING_SERVICE: options.keyringService,
      PMS_CLI_AUTH_URL_FILE: options.authUrlFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completion = collectCliOutput(child, "pms auth login");
  return { process: child, completion };
}

function collectCliOutput(child: SpawnedCliProcess, label: string): Promise<CliOutput> {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      reject(new Error(`CLI 命令超时: ${label}`));
    }, 120_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => { settled = true; clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      settled = true;
      clearTimeout(timeout);
      const raw = (code === 0 ? stdout : stderr).trim();
      try {
        resolvePromise(JSON.parse(raw) as CliOutput);
      } catch (error) {
        reject(new Error(`CLI 输出不是 JSON（${label}，退出码 ${code}）：${raw || stdout || stderr}`, { cause: error }));
      }
    });
  });
}

async function waitForAuthUrl(path: string, completion?: Promise<CliOutput>): Promise<string> {
  const poll = (async () => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (existsSync(path)) {
        const url = readFileSync(path, "utf8").trim().split("\n")[0]?.trim();
        if (url) return url;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error("等待 CLI 授权 URL 超时");
  })();
  if (!completion) return poll;
  const earlyFailure = completion.then<never>((output) => {
    if (output.ok) return new Promise<never>(() => { });
    throw new Error(output.error?.message ?? "CLI 登录失败");
  }, (error) => {
    throw error instanceof Error ? error : new Error(String(error));
  });
  return Promise.race([poll, earlyFailure]);
}

function readProjectId(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.projectId;
  if (typeof id === "number" && Number.isSafeInteger(id) && id > 0) return id;
  return readProjectId(record.project);
}
