import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import { AuthStore, type Account } from "./AuthStore.js";
import { withRefreshLock } from "./RefreshCoordinator.js";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(verifierFactory: () => string = () =>
  randomBytes(32).toString("base64url")): PkcePair {
  const verifier = verifierFactory();
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(
  authOrigin: string,
  redirectUri: string,
  pkce: PkcePair,
  state: string,
): string {
  const url = new URL("/cli/authorize", authOrigin);
  url.searchParams.set("client_id", "pms-cli");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface BrowserAuthOptions {
  baseUrl: string;
  authOrigin: string;
  store: AuthStore;
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  callbackHost?: "127.0.0.1" | "localhost";
}

export interface CliSession {
  accessToken: string;
  account: Account;
}

export class BrowserAuth {
  private readonly fetchImpl: typeof fetch;
  private readonly openBrowser: (url: string) => Promise<void>;

  constructor(private readonly options: BrowserAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openBrowser = options.openBrowser ?? openBrowser;
  }

  async login(): Promise<CliSession> {
    const pkce = createPkcePair();
    const state = randomBytes(24).toString("base64url");
    const listener = await this.listenForCallback(this.options.callbackHost ?? "127.0.0.1");
    try {
      await this.openBrowser(buildAuthorizeUrl(this.options.authOrigin, listener.redirectUri, pkce, state));
      const result = await listener.callback;
      if (result.state !== state) throw new Error("CLI 授权 state 校验失败");
      const response = await this.fetchImpl(new URL("integration/cli/v1/token", this.apiBase()).toString(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          grantType: "authorization_code",
          code: result.code,
          redirectUri: listener.redirectUri,
          clientId: "pms-cli",
          codeVerifier: pkce.verifier,
        }),
      });
      const data = await readPmsData(response);
      const account: Account = {
        accountId: String(data.user?.id ?? data.user?.username ?? "default"),
        baseUrl: this.apiBase(),
        displayName: String(data.user?.displayName ?? data.user?.nickname ?? "PMS 用户"),
        refreshToken: String(data.refreshToken),
      };
      await this.options.store.save(account);
      return { accessToken: String(data.accessToken), account };
    } finally {
      listener.close();
    }
  }

  async refresh(account: Account): Promise<CliSession> {
    const identity = AuthStore.identity(account.baseUrl, account.accountId);
    return withRefreshLock(identity, async () => {
      const latest = await this.options.store.getAccount(account.baseUrl, account.accountId) ?? account;
    const response = await this.fetchImpl(new URL("integration/cli/v1/token", account.baseUrl.endsWith("/") ? account.baseUrl : `${account.baseUrl}/`).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ grantType: "refresh_token", refreshToken: latest.refreshToken }),
    });
    const data = await readPmsData(response);
    const next = { ...latest, refreshToken: String(data.refreshToken) };
    await this.options.store.save(next);
    return { accessToken: String(data.accessToken), account: next };
    });
  }

  async logout(account: Account): Promise<void> {
    await this.fetchImpl(new URL("integration/cli/v1/revoke", account.baseUrl.endsWith("/") ? account.baseUrl : `${account.baseUrl}/`).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    });
    await this.options.store.remove(account.accountId, account.baseUrl);
  }

  private apiBase(): string {
    return this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
  }

  private async listenForCallback(callbackHost: "127.0.0.1" | "localhost"): Promise<{
    redirectUri: string;
    callback: Promise<{ code: string; state: string }>;
    close: () => void;
  }> {
    let resolveCallback!: (value: { code: string; state: string }) => void;
    let rejectCallback!: (error: Error) => void;
    const callback = new Promise<{ code: string; state: string }>((resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    });
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback" || !url.searchParams.get("code") || !url.searchParams.get("state")) {
          response.statusCode = 400;
          response.end("Invalid PMS CLI callback");
          return;
        }
        response.statusCode = 200;
        response.end("PMS CLI login complete. You can close this window.");
        resolveCallback({ code: url.searchParams.get("code")!, state: url.searchParams.get("state")! });
        close();
      } catch (error) {
        rejectCallback(error instanceof Error ? error : new Error("CLI 回调无效"));
        close();
      }
    });
    let closed = false;
    const close = () => {
      if (!closed) {
        closed = true;
        server.close();
      }
    };
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, callbackHost, () => resolve());
    });
    const address = server.address() as AddressInfo;
    return { redirectUri: `http://${callbackHost}:${address.port}/callback`, callback, close };
  }
}

async function readPmsData(response: Response): Promise<Record<string, any>> {
  const raw = await response.json() as { code?: number; msg?: string; data?: Record<string, any> };
  if (!response.ok || raw.code !== 200 || !raw.data) throw new Error(raw.msg || "PMS CLI 授权失败");
  return raw.data;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
