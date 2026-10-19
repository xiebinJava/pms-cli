import { BrowserAuth } from "../../auth/BrowserAuth.js";
import { AuthStore, type Account } from "../../auth/AuthStore.js";

export interface AuthCommandOptions {
  baseUrl: string;
  authOrigin: string;
  store?: AuthStore;
}

export interface AuthDoctorReport {
  status: "HEALTHY" | "NOT_AUTHENTICATED" | "KEYRING_UNAVAILABLE";
  credentialSource?: "PMS_AUTH_TOKEN" | "OS keyring";
  keyring: {
    ok: boolean;
    service: string;
    code?: "KEYRING_TIMEOUT" | "KEYRING_ACCESS";
    message?: string;
  };
  account?: Pick<Account, "accountId" | "displayName" | "baseUrl">;
  remediation: string[];
}

export async function authLogin(options: AuthCommandOptions) {
  const store = options.store ?? new AuthStore();
  const session = await new BrowserAuth({ ...options, store }).login();
  return publicAccount(session.account);
}

export function publicAccount(account: Account): Pick<Account, "accountId" | "displayName" | "baseUrl"> {
  return {
    accountId: account.accountId.trim(),
    displayName: account.displayName.trim() || "PMS 用户",
    baseUrl: AuthStore.normalizeBaseUrl(account.baseUrl),
  };
}

export async function authStatus(store = new AuthStore()) {
  const account = await store.getActiveAccount();
  return account ? { loggedIn: true, accountId: account.accountId, displayName: account.displayName, baseUrl: account.baseUrl } : { loggedIn: false };
}

export async function authDoctor(
  store = new AuthStore(),
  env: Record<string, string | undefined> = process.env,
): Promise<AuthDoctorReport> {
  const service = store.serviceName;
  if (env.PMS_AUTH_TOKEN?.trim()) {
    return {
      status: "HEALTHY",
      credentialSource: "PMS_AUTH_TOKEN",
      keyring: { ok: true, service },
      remediation: [],
    };
  }
  try {
    const account = await store.getActiveAccount();
    if (!account) {
      return {
        status: "NOT_AUTHENTICATED",
        credentialSource: "OS keyring",
        keyring: { ok: true, service },
        remediation: ["请执行 pms auth login 完成浏览器授权"],
      };
    }
    return {
      status: "HEALTHY",
      credentialSource: "OS keyring",
      keyring: { ok: true, service },
      account: publicAccount(account),
      remediation: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timeout = message.includes("超时");
    return {
      status: "KEYRING_UNAVAILABLE",
      credentialSource: "OS keyring",
      keyring: {
        ok: false,
        service,
        code: timeout ? "KEYRING_TIMEOUT" : "KEYRING_ACCESS",
        message,
      },
      remediation: [
        "请在普通终端重新执行 pms auth login，并允许终端访问登录钥匙串",
        "若仍失败，请检查 macOS 钥匙串中的 pms-cli 凭据项和终端权限",
      ],
    };
  }
}

export async function authLogout(options: AuthCommandOptions) {
  const store = options.store ?? new AuthStore();
  const account = await store.getActiveAccount();
  if (!account) return { loggedOut: true };
  await new BrowserAuth({ ...options, store }).logout(account);
  return { loggedOut: true };
}
