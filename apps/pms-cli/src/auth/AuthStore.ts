import { createHash } from "node:crypto";

export interface Account {
  accountId: string;
  baseUrl: string;
  displayName: string;
  refreshToken: string;
}

export interface Keyring {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AuthStoreOptions {
  service?: string;
  keyringTimeoutMs?: number;
}

const DEFAULT_SERVICE = "pms-cli";
const DEFAULT_KEYRING_TIMEOUT_MS = 5_000;

class KeytarKeyring implements Keyring {
  constructor(private readonly service: string) {}

  private async module() {
    const imported = await import("keytar") as typeof import("keytar") & {
      default?: typeof import("keytar");
    };
    return imported.default ?? imported;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await (await this.module()).getPassword(this.service, key);
    } catch (error) {
      throw nativeKeyringError(error);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await (await this.module()).setPassword(this.service, key, value);
    } catch (error) {
      throw nativeKeyringError(error);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await (await this.module()).deletePassword(this.service, key);
    } catch (error) {
      throw nativeKeyringError(error);
    }
  }
}

export class AuthStore {
  private readonly service: string;
  private readonly keyring: Keyring;
  private readonly keyringTimeoutMs: number;

  constructor(keyring?: Keyring, options: AuthStoreOptions = {}) {
    this.service = options.service?.trim() || DEFAULT_SERVICE;
    this.keyring = keyring ?? new KeytarKeyring(this.service);
    this.keyringTimeoutMs = Math.max(1, options.keyringTimeoutMs ?? DEFAULT_KEYRING_TIMEOUT_MS);
  }

  get serviceName(): string {
    return this.service;
  }

  static normalizeBaseUrl(baseUrl: string): string {
    const url = new URL(baseUrl.trim());
    if (url.username || url.password) throw new Error("PMS 地址不能包含用户信息");
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, "");
  }

  static identity(baseUrl: string, accountId: string): string {
    return AuthStore.normalizeBaseUrl(baseUrl) + "\\u0000" + accountId.trim();
  }

  async getActiveAccount(): Promise<Account | null> {
    const active = await this.keyringGet(this.activeKey());
    if (!active) return null;
    try {
      const reference = JSON.parse(active) as { accountId?: string; baseUrl?: string };
      if (reference.accountId && reference.baseUrl) {
        return this.getAccount(reference.baseUrl, reference.accountId);
      }
    } catch {
      // Legacy active keys contain only the account id and are read below.
    }
    return this.readStoredAccount(this.legacyAccountKey(active.trim()));
  }

  async getAccount(baseUrl: string, accountId: string): Promise<Account | null> {
    const normalizedBaseUrl = AuthStore.normalizeBaseUrl(baseUrl);
    const normalizedAccountId = accountId.trim();
    if (!normalizedAccountId) return null;
    const current = await this.readStoredAccount(this.accountKey(normalizedBaseUrl, normalizedAccountId));
    if (current) return current;
    const legacy = await this.readStoredAccount(this.legacyAccountKey(normalizedAccountId));
    if (!legacy) return null;
    return AuthStore.normalizeBaseUrl(legacy.baseUrl) === normalizedBaseUrl ? legacy : null;
  }

  async save(account: Account): Promise<void> {
    if (!account.accountId?.trim() || !account.baseUrl?.trim() || !account.refreshToken?.trim()) {
      throw new Error("账号凭据不完整");
    }
    const normalized = {
      ...account,
      accountId: account.accountId.trim(),
      baseUrl: AuthStore.normalizeBaseUrl(account.baseUrl),
    } satisfies Account;
    await this.keyringSet(this.accountKey(normalized.baseUrl, normalized.accountId), JSON.stringify(normalized));
    await this.keyringSet(this.activeKey(), JSON.stringify({
      accountId: normalized.accountId,
      baseUrl: normalized.baseUrl,
    }));
  }

  async remove(accountId: string, baseUrl?: string): Promise<void> {
    const normalizedBaseUrl = baseUrl ? AuthStore.normalizeBaseUrl(baseUrl) : undefined;
    const normalizedAccountId = accountId.trim();
    if (normalizedBaseUrl) {
      await this.keyringDelete(this.accountKey(normalizedBaseUrl, normalizedAccountId));
    } else {
      await this.keyringDelete(this.legacyAccountKey(normalizedAccountId));
    }
    const active = await this.keyringGet(this.activeKey());
    if (!active) return;
    try {
      const reference = JSON.parse(active) as { accountId?: string; baseUrl?: string };
      if (reference.accountId === normalizedAccountId
        && (!normalizedBaseUrl || AuthStore.normalizeBaseUrl(reference.baseUrl ?? "") === normalizedBaseUrl)) {
        await this.keyringDelete(this.activeKey());
      }
    } catch {
      if (!normalizedBaseUrl && active === normalizedAccountId) await this.keyringDelete(this.activeKey());
    }
  }

  private async readStoredAccount(key: string): Promise<Account | null> {
    const raw = await this.keyringGet(key);
    if (!raw) return null;
    try {
      const account = JSON.parse(raw) as Account;
      if (!account.accountId || !account.baseUrl || !account.refreshToken) return null;
      return {
        ...account,
        accountId: account.accountId.trim(),
        baseUrl: AuthStore.normalizeBaseUrl(account.baseUrl),
        displayName: account.displayName?.trim() || "PMS 用户",
        refreshToken: account.refreshToken.trim(),
      };
    } catch {
      return null;
    }
  }

  private keyringGet(key: string): Promise<string | null> {
    return withKeyringTimeout(this.keyring.get(key), this.keyringTimeoutMs);
  }

  private keyringSet(key: string, value: string): Promise<void> {
    return withKeyringTimeout(this.keyring.set(key, value), this.keyringTimeoutMs);
  }

  private keyringDelete(key: string): Promise<void> {
    return withKeyringTimeout(this.keyring.delete(key), this.keyringTimeoutMs);
  }

  private activeKey(): string {
    return this.service + ":active-account";
  }

  private legacyAccountKey(accountId: string): string {
    return this.service + ":account:" + accountId;
  }

  private accountKey(baseUrl: string, accountId: string): string {
    const identity = AuthStore.identity(baseUrl, accountId);
    const hash = createHash("sha256").update(identity).digest("hex");
    return this.service + ":account:" + hash;
  }
}

function withKeyringTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error("OS 凭据存储访问超时，请检查系统钥匙串权限或重新执行 pms auth login"));
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function nativeKeyringError(error: unknown): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  return new Error(
    "OS 凭据存储访问失败，请在普通终端重新执行 pms auth login，并允许终端访问登录钥匙串",
    { cause },
  );
}
