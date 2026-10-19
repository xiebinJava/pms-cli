import { describe, expect, it } from "vitest";
import { environmentAuth } from "../../apps/pms-cli/src/auth/RuntimeAuth.js";

describe("PMS CLI environment authentication", () => {
  it("does not activate without an explicit short-lived access token", () => {
    expect(environmentAuth({ PMS_BASE_URL: "http://localhost:5173/api" })).toBeNull();
  });

  it("normalizes the base URL and keeps the token process-local", async () => {
    const runtime = environmentAuth({
      PMS_BASE_URL: "http://localhost:5173/api/",
      PMS_AUTH_TOKEN: "short-lived-token",
    });

    expect(runtime).toMatchObject({
      baseUrl: "http://localhost:5173/api",
      source: "PMS_AUTH_TOKEN",
    });
    expect(await runtime?.auth.getToken()).toBe("short-lived-token");
  });
});
