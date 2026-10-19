import { describe, expect, it } from "vitest";
import { AuthStore, type Keyring } from "../../apps/pms-cli/src/auth/AuthStore.js";
import { doctor } from "../../apps/pms-cli/src/commands/core/doctor.js";

function memoryKeyring(): Keyring {
  const values = new Map<string, string>();
  return {
    async get(key) { return values.get(key) ?? null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

describe("pms doctor", () => {
  it("reports an explicit process-local access token without exposing it", async () => {
    const report = await doctor({
      PMS_BASE_URL: "http://127.0.0.1:5173/api",
      PMS_AUTH_TOKEN: "short-lived-token",
    });

    expect(report.credentials).toEqual({ ok: true, source: "PMS_AUTH_TOKEN" });
    expect(JSON.stringify(report)).not.toContain("short-lived-token");
  });

  it("reports credentials stored in the OS keyring", async () => {
    const store = new AuthStore(memoryKeyring(), { service: "pms-cli-doctor-test" });
    await store.save({
      accountId: "2",
      baseUrl: "http://127.0.0.1:5173/api",
      displayName: "管理员",
      refreshToken: "refresh-token",
    });

    const report = await doctor(
      { PMS_BASE_URL: "http://127.0.0.1:5173/api" },
      { store },
    );

    expect(report.credentials).toEqual({ ok: true, source: "OS keyring" });
  });
});
