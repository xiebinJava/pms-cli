export interface IsolatedE2EEnvironment {
  PMS_E2E_WRITE?: string;
  PMS_E2E_ISOLATED?: string;
  PMS_E2E_BASE_URL?: string;
  PMS_E2E_ALLOWED_BASE_URL?: string;
  PMS_E2E_AUTH_ORIGIN?: string;
  PMS_E2E_ACCOUNT_ID?: string;
  PMS_E2E_RUN_ID?: string;
  [key: string]: string | undefined;
}

export interface IsolatedE2EConfig {
  baseUrl: string;
  authOrigin: string;
  accountId: string;
  runId: string;
  keyringService: string;
}

const REQUIRED_KEYS = [
  "PMS_E2E_BASE_URL",
  "PMS_E2E_ALLOWED_BASE_URL",
  "PMS_E2E_AUTH_ORIGIN",
  "PMS_E2E_ACCOUNT_ID",
  "PMS_E2E_RUN_ID",
] as const;

export function isolatedE2EEnabled(env: IsolatedE2EEnvironment): boolean {
  if (env.PMS_E2E_WRITE !== "true" || env.PMS_E2E_ISOLATED !== "true") return false;
  if (!REQUIRED_KEYS.every((key) => Boolean(env[key]?.trim()))) return false;
  try {
    return normalizeWriteTarget(env.PMS_E2E_BASE_URL!) === normalizeWriteTarget(env.PMS_E2E_ALLOWED_BASE_URL!);
  } catch {
    return false;
  }
}

export function assertIsolatedE2EConfig(env: IsolatedE2EEnvironment): IsolatedE2EConfig {
  if (env.PMS_E2E_WRITE !== "true") throw new Error("隔离 E2E 必须显式设置 PMS_E2E_WRITE=true");
  if (env.PMS_E2E_ISOLATED !== "true") throw new Error("隔离 E2E 必须显式设置 PMS_E2E_ISOLATED=true");

  for (const key of REQUIRED_KEYS) {
    if (!env[key]?.trim()) throw new Error("隔离 E2E 缺少配置: " + key);
  }

  const runId = env.PMS_E2E_RUN_ID!.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(runId)) {
    throw new Error("隔离 E2E run ID 只允许 3-64 位字母、数字、下划线和连字符");
  }
  const accountId = env.PMS_E2E_ACCOUNT_ID!.trim();
  if (!/^[1-9]\d*$/.test(accountId)) throw new Error("隔离 E2E account ID 必须是正整数");
  const baseUrl = normalizeWriteTarget(env.PMS_E2E_BASE_URL!);
  const allowedBaseUrl = normalizeWriteTarget(env.PMS_E2E_ALLOWED_BASE_URL!);
  if (baseUrl !== allowedBaseUrl) {
    throw new Error("隔离 E2E 目标不在允许写入的目标清单中");
  }

  return {
    baseUrl,
    authOrigin: env.PMS_E2E_AUTH_ORIGIN!.trim(),
    accountId,
    runId,
    keyringService: "pms-cli-e2e-" + runId,
  };
}

function normalizeWriteTarget(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("隔离 E2E 写入目标 URL 无效");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("隔离 E2E 写入目标 URL 不安全");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${pathname}`;
}

export function expectedViewerId(viewer: { id?: unknown }, expectedAccountId: string): boolean {
  return String(viewer.id ?? "") === expectedAccountId;
}

export function projectNameForRun(runId: string): string {
  return "AI-E2E-" + runId;
}

export interface CleanupResult {
  deletedIds: number[];
  remainingIds: number[];
}

export async function cleanupRecordedProjectIds(
  projectIds: readonly number[],
  deleteProject: (projectId: number) => Promise<void>,
  failures: Array<{ id: number; error: string }> = [],
): Promise<CleanupResult> {
  const recorded = Array.from(new Set(projectIds));
  if (recorded.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("清理清单包含无效项目 ID");
  }

  const deletedIds: number[] = [];
  const remainingIds: number[] = [];
  for (const id of recorded) {
    try {
      await deleteProject(id);
      deletedIds.push(id);
    } catch (error) {
      remainingIds.push(id);
      failures.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deletedIds, remainingIds };
}
