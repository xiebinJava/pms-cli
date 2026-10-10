import { describe, expect, it } from "vitest";
import { AuthStore, type Keyring } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { BrowserAuth } from "../../apps/pms-cli/src/auth/BrowserAuth.js";

function memoryKeyring(): Keyring & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

const account = (baseUrl: string, refreshToken: string) => ({
  accountId: "7",
  baseUrl,
  displayName: "Brad",
  refreshToken,
});

describe("PMS CLI credential isolation and refresh", () => {
  it("isolates the same account id by PMS base URL", async () => {
    const keyring = memoryKeyring();
    const store = new AuthStore(keyring);

    await store.save(account("https://one.example/api", "refresh-one"));
    await store.save(account("https://two.example/api", "refresh-two"));

    expect((await store.getAccount("https://one.example/api/", "7"))?.refreshToken).toBe("refresh-one");
    expect((await store.getAccount("https://two.example/api?tenant=two#ignored", "7"))?.refreshToken).toBe("refresh-two");
  });

  it("uses a separate service namespace without changing the default account", async () => {
    const keyring = memoryKeyring();
    const defaultStore = new AuthStore(keyring);
    const e2eStore = new AuthStore(keyring, { service: "pms-cli-e2e-run-1" });

    await defaultStore.save(account("https://pms.example/api", "default-refresh"));
    await e2eStore.save(account("https://pms.example/api", "e2e-refresh"));

    expect((await defaultStore.getActiveAccount())?.refreshToken).toBe("default-refresh");
    expect((await e2eStore.getActiveAccount())?.refreshToken).toBe("e2e-refresh");
  });

  it("reads legacy credentials without migrating or deleting them", async () => {
    const keyring = memoryKeyring();
    const store = new AuthStore(keyring);
    const legacy = account("https://pms.example/api", "legacy-refresh");
    await keyring.set("pms-cli:account:7", JSON.stringify(legacy));
    await keyring.set("pms-cli:active-account", "7");

    expect((await store.getActiveAccount())?.refreshToken).toBe("legacy-refresh");
    expect((await store.getAccount("https://pms.example/api", "7"))?.refreshToken).toBe("legacy-refresh");
    expect([...keyring.values.keys()]).toEqual(["pms-cli:account:7", "pms-cli:active-account"]);
  });

  it("serializes concurrent refreshes and uses the rotated credential", async () => {
    const keyring = memoryKeyring();
    const store = new AuthStore(keyring);
    await store.save(account("https://pms.example/api", "refresh-1"));
    const usedTokens: string[] = [];
    let sequence = 1;
    const auth = new BrowserAuth({
      baseUrl: "https://pms.example/api",
      authOrigin: "https://pms.example",
      store,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { refreshToken: string };
        usedTokens.push(body.refreshToken);
        sequence += 1;
        return new Response(JSON.stringify({
          code: 200,
          data: { accessToken: "access-" + sequence, refreshToken: "refresh-" + sequence },
        }), { status: 200 });
      },
    });

    await Promise.all([auth.refresh(account("https://pms.example/api", "refresh-1")), auth.refresh(account("https://pms.example/api", "refresh-1"))]);

    expect(usedTokens).toEqual(["refresh-1", "refresh-2"]);
    expect((await store.getAccount("https://pms.example/api", "7"))?.refreshToken).toBe("refresh-3");
  });
});
