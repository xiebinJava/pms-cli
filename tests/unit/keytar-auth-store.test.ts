import { describe, expect, it, vi } from "vitest";
import { AuthStore } from "../../apps/pms-cli/src/auth/AuthStore.js";

const keytarValues = new Map<string, string>();
let keytarReadHangs = false;
let keytarReadError: Error | undefined;

vi.mock("keytar", () => ({
  default: {
    async getPassword(_service: string, key: string) {
      if (keytarReadError) throw keytarReadError;
      if (keytarReadHangs) return new Promise<string | null>(() => {});
      return keytarValues.get(key) ?? null;
    },
    async setPassword(_service: string, key: string, value: string) {
      keytarValues.set(key, value);
    },
    async deletePassword(_service: string, key: string) {
      keytarValues.delete(key);
      return true;
    },
  },
}));

describe("PMS CLI keytar integration", () => {
  it("supports the CommonJS default export returned by dynamic import", async () => {
    keytarValues.clear();
    keytarReadHangs = false;
    keytarReadError = undefined;
    const store = new AuthStore(undefined, { service: "pms-cli-test" });

    await store.save({
      accountId: "7",
      baseUrl: "http://localhost:5173/api",
      displayName: "Admin",
      refreshToken: "refresh-token",
    });

    expect((await store.getActiveAccount())?.refreshToken).toBe("refresh-token");
  });

  it("fails fast when the OS keyring read does not return", async () => {
    keytarValues.clear();
    keytarReadHangs = true;
    keytarReadError = undefined;
    const store = new AuthStore(undefined, { service: "pms-cli-test", keyringTimeoutMs: 20 });

    const result = await Promise.race([
      store.getActiveAccount().catch((error: unknown) => error),
      new Promise<Error>((resolve) => setTimeout(() => resolve(new Error("test timeout")), 80)),
    ]);

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain("OS 凭据存储访问超时");
    keytarReadHangs = false;
  });

  it("explains when the native keyring rejects access", async () => {
    keytarReadHangs = false;
    keytarReadError = new Error("An unknown error occurred.");
    const store = new AuthStore(undefined, { service: "pms-cli-test", keyringTimeoutMs: 20 });

    await expect(store.getActiveAccount()).rejects.toThrow("OS 凭据存储访问失败");
    keytarReadError = undefined;
  });

  it("does not turn an account-read failure into a false logged-out state", async () => {
    const store = new AuthStore({
      async get(key) {
        if (key === "pms-cli-test:active-account") {
          return JSON.stringify({ accountId: "7", baseUrl: "http://localhost:5173/api" });
        }
        throw new Error("keyring read failed");
      },
      async set() {},
      async delete() {},
    }, { service: "pms-cli-test", keyringTimeoutMs: 20 });

    await expect(store.getActiveAccount()).rejects.toThrow("keyring read failed");
  });
});
