import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../../auth/AuthStore.js";

export interface DoctorReport {
  node: { ok: boolean; version: string; minimum: string };
  baseUrl: { ok: boolean; value: string; source: string };
  credentials: { ok: boolean; source: string };
  skill: { ok: boolean; path: string };
}

export interface DoctorOptions {
  store?: AuthStore;
}

export async function doctor(
  env: NodeJS.ProcessEnv = process.env,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const baseUrl = env.PMS_BASE_URL?.trim() || "http://localhost:5173/api";
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  const skillPath = join(homedir(), ".codex", "skills", "pms-project-management", "SKILL.md");
  const credentials = await credentialReport(env, options.store ?? new AuthStore());
  return {
    node: { ok: Number.isFinite(major) && major >= 22, version, minimum: ">=22" },
    baseUrl: { ok: Boolean(baseUrl), value: baseUrl, source: env.PMS_BASE_URL ? "PMS_BASE_URL" : "default" },
    credentials,
    skill: { ok: existsSync(skillPath), path: skillPath },
  };
}

async function credentialReport(
  env: NodeJS.ProcessEnv,
  store: AuthStore,
): Promise<DoctorReport["credentials"]> {
  if (env.PMS_AUTH_TOKEN) return { ok: true, source: "PMS_AUTH_TOKEN" };
  try {
    return { ok: Boolean(await store.getActiveAccount()), source: "OS keyring" };
  } catch {
    return { ok: false, source: "OS keyring" };
  }
}
