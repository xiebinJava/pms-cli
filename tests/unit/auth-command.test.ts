import { describe, expect, it, vi } from "vitest";
import { authLogin } from "../../apps/pms-cli/src/commands/core/auth.js";
import { AuthStore, type Account, type Keyring } from "../../apps/pms-cli/src/auth/AuthStore.js";

const login = vi.fn(async () => ({
  accessToken: "access-token-must-not-leak",
  account: {
    accountId: "7",
    baseUrl: "http://localhost:5173/api",
    displayName: "管理员（admin）",
    refreshToken: "refresh-token-must-not-leak",
  } satisfies Account,
}));

vi.mock("../../apps/pms-cli/src/auth/BrowserAuth.js", () => ({
  BrowserAuth: class {
    login = login;
  },
}));

function memoryKeyring(): Keyring {
  const values = new Map<string, string>();
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

describe("CLI auth command output", () => {
  it("returns only the public account summary after login", async () => {
    const result = await authLogin({
      baseUrl: "http://localhost:5173/api",
      authOrigin: "http://localhost:5173",
      store: new AuthStore(memoryKeyring()),
    });

    expect(result).toEqual({
      accountId: "7",
      displayName: "管理员（admin）",
      baseUrl: "http://localhost:5173/api",
    });
    expect(result).not.toHaveProperty("accessToken");
    expect(result).not.toHaveProperty("refreshToken");
  });
});
