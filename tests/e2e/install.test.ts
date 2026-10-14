import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("pms CLI installation surface", () => {
  it("declares a PATH executable and exposes help without the source tree", () => {
    const packageJson = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
    expect(packageJson.bin.pms).toBe("dist/pms-cli.js");
    execFileSync(process.execPath, [
      join(root, "node_modules", "esbuild", "bin", "esbuild"),
      "apps/pms-cli/src/main.ts",
      "--bundle", "--platform=node", "--target=node22", "--format=esm", "--packages=external",
      "--outfile=dist/pms-cli.js",
    ], { cwd: root, stdio: "ignore" });
    const help = execFileSync(process.execPath, ["dist/pms-cli.js", "--help"], { cwd: root, encoding: "utf8" });
    expect(help).toContain("pms capabilities");
    const version = execFileSync(process.execPath, ["dist/pms-cli.js", "--version"], { cwd: root, encoding: "utf8" }).trim();
    expect(version).toMatch(/^0\.1\.1$/);
  });

  it("returns machine-readable doctor output and ships an agent skill", () => {
    const raw = execFileSync(process.execPath, ["dist/pms-cli.js", "doctor", "--format", "json"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PMS_BASE_URL: "http://localhost:5173/api" },
    });
    const report = JSON.parse(raw);
    expect(report).toHaveProperty("node");
    expect(report).toHaveProperty("baseUrl");
    expect(readFileSync(`${root}/skills/pms-project-management/SKILL.md`, "utf8")).toContain("pms capabilities");
  });
});
