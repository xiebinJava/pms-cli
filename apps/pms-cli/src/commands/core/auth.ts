import { BrowserAuth } from "../../auth/BrowserAuth.js";
import { AuthStore, type Account } from "../../auth/AuthStore.js";

export interface AuthCommandOptions {
  baseUrl: string;
  authOrigin: string;
  store?: AuthStore;
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

export async function authLogout(options: AuthCommandOptions) {
  const store = options.store ?? new AuthStore();
  const account = await store.getActiveAccount();
  if (!account) return { loggedOut: true };
  await new BrowserAuth({ ...options, store }).logout(account);
  return { loggedOut: true };
}
