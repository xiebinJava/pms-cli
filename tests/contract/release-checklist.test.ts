import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checklist = readFileSync(new URL("../../docs/release-checklist.md", import.meta.url), "utf8");

describe("release checklist contract", () => {
  it("keeps the release gates aligned with the frozen progression safety rules", () => {
    for (const requiredText of [
      "agent-progression/v2",
      "agent-progression-run/v2",
      "draft-provenance/v1",
      "PMS_E2E_WRITE=true",
      "PMS_E2E_ISOLATED=true",
      "WRITE_RESULT_UNKNOWN",
      "PROVENANCE_NOT_AUDITED",
      "auditId` 与 `operationId",
      "同一 conversation、同一 preview、同一 `draftDigest`",
    ]) {
      expect(checklist).toContain(requiredText);
    }
  });

  it("documents both the standard progression path and compatibility boundaries", () => {
    expect(checklist).toContain("scenario progression run");
    expect(checklist).toContain("旧 `operation auto`、`operation execute` 和 `resource-write`");
    expect(checklist).toContain("不生成 preview、不写入");
  });
});
