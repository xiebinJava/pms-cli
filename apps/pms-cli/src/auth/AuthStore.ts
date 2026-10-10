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
}

const DEFAULT_SERVICE = "pms-cli";

class KeytarKeyring implements Keyring {
  constructor(private readonly service: string) {}

  private async module() {
    return import("keytar");
  }

  async get(key: string): Promise<string | null> {
    return (await this.module()).getPassword(this.service, key);
  }

  async set(key: string, value: string): Promise<void> {
    await (await this.module()).setPassword(this.service, key, value);
  }

  async delete(key: string): Promise<void> {
    await (await this.module()).deletePassword(this.service, key);
  }
}

export class AuthStore {
  private readonly service: string;
  private readonly keyring: Keyring;

  constructor(keyring?: Keyring, options: AuthStoreOptions = {}) {
    this.service = options.service?.trim() || DEFAULT_SERVICE;
    this.keyring = keyring ?? new KeytarKeyring(this.service);
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
    const active = await this.keyring.get(this.activeKey());
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
    await this.keyring.set(this.accountKey(normalized.baseUrl, normalized.accountId), JSON.stringify(normalized));
    await this.keyring.set(this.activeKey(), JSON.stringify({
      accountId: normalized.accountId,
      baseUrl: normalized.baseUrl,
    }));
  }

  async remove(accountId: string, baseUrl?: string): Promise<void> {
    const normalizedBaseUrl = baseUrl ? AuthStore.normalizeBaseUrl(baseUrl) : undefined;
    const normalizedAccountId = accountId.trim();
    if (normalizedBaseUrl) {
      await this.keyring.delete(this.accountKey(normalizedBaseUrl, normalizedAccountId));
    } else {
      await this.keyring.delete(this.legacyAccountKey(normalizedAccountId));
    }
    const active = await this.keyring.get(this.activeKey());
    if (!active) return;
    try {
      const reference = JSON.parse(active) as { accountId?: string; baseUrl?: string };
      if (reference.accountId === normalizedAccountId
        && (!normalizedBaseUrl || AuthStore.normalizeBaseUrl(reference.baseUrl ?? "") === normalizedBaseUrl)) {
        await this.keyring.delete(this.activeKey());
      }
    } catch {
      if (!normalizedBaseUrl && active === normalizedAccountId) await this.keyring.delete(this.activeKey());
    }
  }

  private async readStoredAccount(key: string): Promise<Account | null> {
    const raw = await this.keyring.get(key);
    if (!raw) return null;
    try {
      const account = JSON.parse(raw) as Account;
      if (!account.accountId || !account.baseUrl || !account.refreshToken) return null;
      return account;
    } catch {
      return null;
    }
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
