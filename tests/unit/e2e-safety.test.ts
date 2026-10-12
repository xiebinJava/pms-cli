import { describe, expect, it } from "vitest";
import {
  assertIsolatedE2EConfig,
  cleanupRecordedProjectIds,
  expectedViewerId,
  isolatedE2EEnabled,
  projectNameForRun,
} from "../e2e/support/isolatedSession.js";

describe("isolated E2E safety gates", () => {
  it("requires explicit write, isolation, identity and namespace configuration", () => {
    expect(isolatedE2EEnabled({})).toBe(false);
    expect(() => assertIsolatedE2EConfig({
      PMS_E2E_WRITE: "true",
      PMS_E2E_ISOLATED: "true",
      PMS_E2E_BASE_URL: "http://localhost:5173/api",
      PMS_E2E_AUTH_ORIGIN: "http://localhost:5173",
      PMS_E2E_ACCOUNT_ID: "7",
      PMS_E2E_RUN_ID: "run-20261010",
    })).not.toThrow();
  });

  it("rejects unsafe run IDs before opening authentication", () => {
    expect(() => assertIsolatedE2EConfig({
      PMS_E2E_WRITE: "true",
      PMS_E2E_ISOLATED: "true",
      PMS_E2E_BASE_URL: "http://localhost:5173/api",
      PMS_E2E_AUTH_ORIGIN: "http://localhost:5173",
      PMS_E2E_ACCOUNT_ID: "7",
      PMS_E2E_RUN_ID: "../existing-project",
    })).toThrow(/run ID/);
  });

  it("only cleans project IDs recorded by this run", async () => {
    const deleted: number[] = [];
    const failures: Array<{ id: number; error: string }> = [];
    const result = await cleanupRecordedProjectIds([42, 43], async (id) => {
      deleted.push(id);
      if (id === 43) throw new Error("forbidden");
    }, failures);

    expect(deleted).toEqual([42, 43]);
    expect(result.remainingIds).toEqual([43]);
    expect(result.deletedIds).toEqual([42]);
    expect(failures).toEqual([{ id: 43, error: "forbidden" }]);
  });

  it("does not pretend the account id is a login bypass", () => {
    expect(expectedViewerId({ id: 7 }, "7")).toBe(true);
    expect(expectedViewerId({ id: 8 }, "7")).toBe(false);
    expect(projectNameForRun("run-20261010")).toBe("AI-E2E-run-20261010");
  });
});
