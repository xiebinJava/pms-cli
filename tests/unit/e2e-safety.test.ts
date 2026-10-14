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
      PMS_E2E_ALLOWED_BASE_URL: "http://localhost:5173/api",
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
      PMS_E2E_ALLOWED_BASE_URL: "http://localhost:5173/api",
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

  it("requires an exact write-target allowlist and rejects a different production target", () => {
    const base = {
      PMS_E2E_WRITE: "true",
      PMS_E2E_ISOLATED: "true",
      PMS_E2E_BASE_URL: "https://pms.example.com/api",
      PMS_E2E_AUTH_ORIGIN: "https://pms.example.com",
      PMS_E2E_ACCOUNT_ID: "7",
      PMS_E2E_RUN_ID: "run-20261010",
    };

    expect(isolatedE2EEnabled(base)).toBe(false);
    expect(() => assertIsolatedE2EConfig({
      ...base,
      PMS_E2E_ALLOWED_BASE_URL: "https://isolated.example.com/api",
    })).toThrow(/允许写入的目标/);
    expect(() => assertIsolatedE2EConfig({
      ...base,
      PMS_E2E_ALLOWED_BASE_URL: "https://pms.example.com/api/",
    })).not.toThrow();
  });

  it("readonly context helper never fabricates targets and never calls the network", async () => {
    const { requireReadonlyContextCase } = await import(
      "../../tests/e2e/support/readonlyContextSession.js",
    );
    // Missing id: scenario is NOT RUN — never the first search row.
    const missing = requireReadonlyContextCase("project", {});
    expect(missing.skipReason).toContain("未提供");
    // Invalid id is rejected before any network or auth.
    const invalid = requireReadonlyContextCase("project", { PROJECT_SR_ID: "0" });
    expect(invalid.skipReason).toContain("非法");
    const unsafeNodeId = requireReadonlyContextCase("project", {
      PROJECT_SR_ID: "7",
      PROJECT_SR_NODE_ID: String(Number.MAX_SAFE_INTEGER + 1),
    });
    expect(unsafeNodeId.skipReason).toContain("SR_NODE_ID 非法");
    // Valid config resolves into an exact typed case with explicit options only.
    const ok = requireReadonlyContextCase("requirement", {
      REQUIREMENT_SR_ID: "23",
      REQUIREMENT_SR_NODE_ID: "299",
      REQUIREMENT_SR_VIEW: "focused",
      REQUIREMENT_SR_COMPONENT: "requirement-node-workbench",
    });
    expect(ok.skipReason).toBeUndefined();
    expect(ok.case).toEqual({
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 299,
      view: "focused",
      component: "requirement-node-workbench",
    });
  });
});
