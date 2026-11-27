import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import packageMetadata from "../../package.json" with { type: "json" };

const root = process.cwd();

// npm.cmd is a shell wrapper. On Windows invoke its JavaScript entry point directly.
function npm(args: string[], cwd: string, env = process.env): string {
  const options = { cwd, env, encoding: "utf8" as const };
  if (process.platform === "win32") {
    const shim = execFileSync("where.exe", ["npm.cmd"], options).trim().split(/\r?\n/)[0];
    return execFileSync(process.execPath, [join(dirname(shim), "node_modules/npm/bin/npm-cli.js"), ...args], options);
  }
  return execFileSync("npm", args, options);
}

function checkTarball(source: string, destination: string, expectedVersion: string) {
  mkdirSync(destination);
  npm(["run", "build:cli"], source);
  const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", destination], source));
  const archive = join(destination, packed.filename);
  const metadata = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" }));
  expect(metadata.version).toBe(expectedVersion);
  expect(metadata.bin.pms).toBe("dist/pms-cli.js");
  expect(packed.files.map((file: { path: string }) => file.path)).toContain(metadata.bin.pms);

  const installEnv = { ...process.env };
  if (installEnv.npm_config_allow_scripts) {
    // npm run exports this setting. Modern npm accepts the very same allowlist
    // in a project .npmrc and rejects it when passed as an install-time flag.
    writeFileSync(join(destination, ".npmrc"), "allow-scripts=${PMS_TEST_NPM_ALLOW_SCRIPTS}\n");
    installEnv.PMS_TEST_NPM_ALLOW_SCRIPTS = installEnv.npm_config_allow_scripts;
    delete installEnv.npm_config_allow_scripts;
  }
  npm(["install", "--no-audit", "--no-fund", "--prefix", destination, archive], destination, installEnv);
  const installed = join(destination, "node_modules", metadata.name);
  expect(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version).toBe(expectedVersion);
  expect(readFileSync(join(installed, "skills/pms-project-management/SKILL.md"), "utf8")).toContain("pms capabilities");
  const executable = join(destination, "node_modules/.bin/pms");
  const options = { cwd: destination, encoding: "utf8" as const, env: { ...process.env, PMS_AUTH_TOKEN: "" } };
  const invoke = (args: string[], env = options.env) => process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/c", "node_modules\\.bin\\pms.cmd", ...args], { ...options, env })
    : execFileSync(executable, args, { ...options, env });
  expect(invoke(["--version"])).toBe(expectedVersion + "\n");
  expect(invoke(["--help"])).toContain("pms capabilities");
  const report = JSON.parse(invoke(["doctor", "--format", "json"], { ...options.env, PMS_AUTH_TOKEN: "install-test-only" }));
  expect(report.node.ok).toBe(true);
  expect(report.baseUrl).toHaveProperty("value");
  const evidence = `${metadata.name}@${expectedVersion} | ${packed.integrity} | --version, --help, doctor --format json passed`;
  console.info(evidence);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${process.env.GITHUB_SHA} | ${evidence}\n`);
  }
}

describe("pms CLI installation surface", () => {
  it("installs the packed CLI outside the checkout and follows a version-only change", () => {
    const workspace = mkdtempSync(join(tmpdir(), "pms-package-"));
    try {
      checkTarball(root, join(workspace, "release"), packageMetadata.version);
      const copy = join(workspace, "source");
      mkdirSync(copy);
      // Copy build inputs and shipping files. Only the root package version differs.
      for (const entry of ["apps", "packages", "tsconfig.json", "skills", "scripts", "docs/installation.md", "README.md"]) {
        const target = join(copy, entry);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(join(root, entry), target, { recursive: true });
      }
      symlinkSync(join(root, "node_modules"), join(copy, "node_modules"), "junction");
      const testVersion = packageMetadata.version === "0.0.0-smoke.1" ? "0.0.0-smoke.2" : "0.0.0-smoke.1";
      writeFileSync(join(copy, "package.json"), JSON.stringify({ ...packageMetadata, version: testVersion }));
      checkTarball(copy, join(workspace, "changed"), testVersion);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 240_000);
});
