import { spawn } from "node:child_process";

export interface OperationAuditRecord {
  id: string;
  commandName: string;
  argumentsJson: string;
  status: string;
  createdAt: string | null;
  executedAt: string | null;
}

/**
 * Reads the existing operation audit table with a read-only MySQL account.
 * The helper deliberately shells out to the configured mysql client instead
 * of adding a second application database driver to the CLI package.
 */
export async function auditOperations(
  runId: string,
  windowStart: Date,
  windowEnd = new Date(),
): Promise<OperationAuditRecord[]> {
  return queryAuditOperations(windowStart, windowEnd, `%${escapeLike(runId)}%`);
}

/**
 * Reads all operation audit records in a bounded E2E window. Write commands
 * do not repeat the fixture run ID in their arguments, so tests that need to
 * verify the actual mutation must scope by time and then assert operation ID
 * and command name explicitly.
 */
export async function auditOperationsInWindow(
  windowStart: Date,
  windowEnd = new Date(),
): Promise<OperationAuditRecord[]> {
  return queryAuditOperations(windowStart, windowEnd);
}

async function queryAuditOperations(
  windowStart: Date,
  windowEnd: Date,
  runIdPattern?: string,
): Promise<OperationAuditRecord[]> {
  const rawUrl = process.env.PMS_E2E_DB_URL?.trim();
  if (!rawUrl) throw new Error("真实故事编排器验收缺少 PMS_E2E_DB_URL");
  const url = parseDatabaseUrl(rawUrl);
  // created_at 由 MySQL CURRENT_TIMESTAMP 填充，JVM 填充值使用主机挂钟，
  // 两者时区可能不同；窗口必须用数据库自身的 NOW() 推导，避免 UTC/本地错位。
  const windowMinutes = Number.isFinite(windowEnd.getTime()) && Number.isFinite(windowStart.getTime())
    ? Math.min(120, Math.max(2, Math.ceil((windowEnd.getTime() - windowStart.getTime()) / 60000) + 2))
    : 30;
  const sqlParts = [
    "SELECT id, command_name, arguments_json, status, created_at, executed_at",
    "FROM pms_ai_operation",
    "WHERE created_at >= NOW() - INTERVAL ? MINUTE",
    "AND created_at <= NOW()",
  ];
  const parameters = [String(windowMinutes)];
  if (runIdPattern !== undefined) {
    sqlParts.push("AND arguments_json LIKE ?");
    parameters.push(runIdPattern);
  }
  sqlParts.push("ORDER BY created_at ASC");
  const output = await runMysql(url, sqlParts.join(" "), parameters);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.split("\t");
      if (columns.length !== 6) throw new Error("操作审计查询返回列数不符合预期");
      return {
        id: columns[0]!,
        commandName: columns[1]!,
        argumentsJson: columns[2]!,
        status: columns[3]!,
        createdAt: columns[4] === "NULL" ? null : columns[4]!,
        executedAt: columns[5] === "NULL" ? null : columns[5]!,
      };
    });
}

function parseDatabaseUrl(raw: string): {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
} {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("PMS_E2E_DB_URL 必须是 mysql:// URL");
  }
  if (url.protocol !== "mysql:") throw new Error("PMS_E2E_DB_URL 只支持 mysql:// URL");
  if (!url.hostname || !url.pathname.slice(1) || !url.username) {
    throw new Error("PMS_E2E_DB_URL 缺少主机、数据库或只读用户");
  }
  return {
    host: url.hostname,
    port: url.port || "3306",
    database: url.pathname.slice(1),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

function runMysql(
  url: { host: string; port: string; database: string; username: string; password: string },
  sql: string,
  parameters: string[],
): Promise<string> {
  const mysql = process.env.PMS_E2E_MYSQL_CLIENT?.trim() || "mysql";
  const renderedSql = parameters.reduce(
    (value, parameter) => value.replace("?", `'${parameter.replaceAll("'", "''")}'`),
    sql,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(mysql, [
      "--batch", "--skip-column-names", "--raw",
      "--host", url.host,
      "--port", url.port,
      "--user", url.username,
      "--database", url.database,
      "--execute", renderedSql,
    ], {
      env: { ...process.env, MYSQL_PWD: url.password },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => reject(new Error(`无法启动 MySQL 客户端：${error.message}`)));
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`操作审计查询失败(${code}): ${stderr.trim()}`));
      else resolve(stdout);
    });
  });
}


function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
