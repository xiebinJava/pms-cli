#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PmsHttpClient, StaticTokenProvider } from "../../../packages/pms-client/src/index.js";
import { AuthStore } from "./auth/AuthStore.js";
import { BrowserAuth } from "./auth/BrowserAuth.js";
import { authDoctor, authLogin, authLogout, authStatus } from "./commands/core/auth.js";
import { doctor } from "./commands/core/doctor.js";
import { setup } from "./commands/core/setup.js";
import { runCli } from "./cli/runCli.js";
import { OutputWriter } from "./output/OutputWriter.js";

interface CliRuntime {
  client: PmsHttpClient;
  account: Awaited<ReturnType<AuthStore["getActiveAccount"]>>;
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  await runCli(argv.length > 0 ? argv : ["--help"], {
    createRuntime: (requestId) => authenticatedRuntime(requestId),
    runAuth: (command, args) => runAuth(command, args),
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
    setExitCode: (value) => { process.exitCode = value; },
    exitProcess,
    requestIdFactory: randomUUID,
    runDoctor: () => doctor(),
    runSetup: () => setup(),
    installSkill,
  });
}

async function runAuth(command: string | undefined, args: string[]) {
  const store = createAuthStore();
  if (command === "status") return authStatus(store);
  if (command === "doctor") return authDoctor(store);
  const rawBaseUrl = process.env.PMS_BASE_URL?.trim() || "http://localhost:5173/api";
  const baseUrl = AuthStore.normalizeBaseUrl(rawBaseUrl);
  const authOrigin = process.env.PMS_AUTH_ORIGIN?.trim() || originFromBase(baseUrl);
  if (command === "login") {
    const authUrlFile = process.env.PMS_CLI_AUTH_URL_FILE?.trim();
    return authLogin({
      baseUrl,
      authOrigin,
      store,
      ...(authUrlFile ? {
        openBrowser: async (url: string) => {
          appendFileSync(authUrlFile, url + "\n", { encoding: "utf8", mode: 0o600 });
        },
      } : {}),
    });
  }
  if (command === "logout") return authLogout({ baseUrl, authOrigin, store });
  throw new Error("未知认证命令: " + (command ?? args.join(" ")));
}

async function authenticatedRuntime(requestId: string): Promise<CliRuntime> {
  const store = createAuthStore();
  const account = await store.getActiveAccount();
  if (!account) throw new Error("尚未登录，请先执行 pms auth login");
  const auth = new BrowserAuth({ baseUrl: account.baseUrl, authOrigin: originFromBase(account.baseUrl), store });
  const session = await auth.refresh(account);
  return {
    account: session.account,
    client: new PmsHttpClient({
      baseUrl: session.account.baseUrl,
      auth: new StaticTokenProvider(session.accessToken),
      clientId: "pms-cli",
      requestIdFactory: () => requestId,
    }),
  };
}

function createAuthStore(): AuthStore {
  return new AuthStore(undefined, {
    service: process.env.PMS_CLI_KEYRING_SERVICE?.trim() || undefined,
  });
}

function originFromBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function installSkill(): { installed: string } {
  const source = fileURLToPath(new URL("../skills/pms-project-management/SKILL.md", import.meta.url));
  const destination = join(homedir(), ".codex", "skills", "pms-project-management", "SKILL.md");
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return { installed: destination };
}

main().catch((error: unknown) => {
  const writer = new OutputWriter();
  writer.failure({
    code: "CLI_ERROR",
    message: error instanceof Error ? error.message : String(error),
    requestId: randomUUID(),
  });
  exitProcess(1);
});

function exitProcess(value: number): never {
  process.exitCode = value;
  // A native keyring request can keep the event loop inside keytar after its
  // timeout has already been reported. A signal is the only reliable way to
  // terminate that process instead of leaving the CLI hanging indefinitely.
  process.kill(process.pid, "SIGTERM");
  return undefined as never;
}
