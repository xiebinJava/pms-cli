import { describe, expect, it } from "vitest";
import { AuthStore, type Keyring } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { authDoctor } from "../../apps/pms-cli/src/commands/core/auth.js";

function memoryKeyring(values = new Map<string, string>()): Keyring {
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

describe("pms auth doctor", () => {
  it("reports a healthy keyring and login guidance without exposing credentials", async () => {
    const store = new AuthStore(memoryKeyring(), { service: "pms-cli-doctor-test" });
    const report = await authDoctor(store);

    expect(report.status).toBe("NOT_AUTHENTICATED");
    expect(report.keyring).toMatchObject({ ok: true, service: "pms-cli-doctor-test" });
    expect(report.remediation.some((item) => item.includes("pms auth login"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain("refreshToken");
  });

  it("distinguishes a keyring timeout and gives an actionable repair", async () => {
    const hangingKeyring: Keyring = {
      async get() { return new Promise<string | null>(() => undefined); },
      async set() { return undefined; },
      async delete() { return undefined; },
    };
    const store = new AuthStore(hangingKeyring, {
      service: "pms-cli-timeout-test",
      keyringTimeoutMs: 5,
    });

    const report = await authDoctor(store);

    expect(report.status).toBe("KEYRING_UNAVAILABLE");
    expect(report.keyring).toMatchObject({
      ok: false,
      service: "pms-cli-timeout-test",
      code: "KEYRING_TIMEOUT",
    });
    expect(report.remediation.some((item) => item.includes("在普通终端重新执行 pms auth login"))).toBe(true);
  });
});
