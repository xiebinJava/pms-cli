import type { PmsClient } from "../../../../packages/pms-client/src/index.js";
import { PmsClientError, safeErrorMessage } from "../../../../packages/pms-client/src/index.js";
import type { QueryItem } from "../../../../packages/pms-contracts/src/index.js";
import { CliArgumentError, parseCliArguments, type CliInvocation } from "./parseArguments.js";
import { listCapabilities } from "../commands/core/capabilities.js";
import { getContext } from "../commands/core/context.js";
import { getResource } from "../commands/core/get.js";
import { operationExecute, operationPreview, type OperationOptions } from "../commands/core/operation.js";
import { search } from "../commands/core/search.js";
import { workflowAction } from "../commands/core/workflow.js";
import { dashboardSummary } from "../commands/shortcuts/dashboard.js";
import { createProjectWithReadback } from "../commands/shortcuts/project.js";
import { requirementAnalysisSave } from "../commands/shortcuts/requirement.js";

const HELP = [
  "PMS CLI",
  "",
  "  pms auth login|status|logout",
  "  pms capabilities [--scope <scope>]",
  "  pms search <resourceType> [--keyword <text>] [--filter key=value]",
  "  pms get <resourceType> <id>",
  "  pms context <resourceType> <id>",
  "  pms operation preview <operation> --arguments-json <json>",
  "  pms operation execute <operation> --arguments-json <json> --idempotency-key <key>",
  "  pms project create --arguments-json <json> --idempotency-key <key>",
  "  pms requirement analysis save <id> --node-id <id> --version <version> --context-id <id> --context-version <version> --arguments-json <patch-json> --idempotency-key <key>",
  "  pms workflow action <resourceType> <id> <action> --arguments-json <json> --idempotency-key <key>",
  "  pms dashboard summary",
  "  pms setup | pms doctor --format json",
  "  pms skill install --global",
  "",
  "Options accept both --name value and --name=value forms.",
  "",
].join("\n");
const VERSION = "0.1.0";

export interface CliRuntime {
  client: PmsClient;
}

export interface CliDependencies {
  createRuntime(requestId: string): Promise<CliRuntime>;
  runAuth(command: string | undefined, args: string[], requestId: string): Promise<unknown>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  setExitCode(code: number): void;
  requestIdFactory(): string;
  runDoctor?(): unknown;
  runSetup?(): unknown;
  installSkill?(): unknown;
}

export async function runCli(argv: string[], deps: CliDependencies): Promise<void> {
  const requestId = deps.requestIdFactory();
  try {
    const invocation = parseCliArguments(argv);
    if (invocation.options.help !== undefined || invocation.options.h !== undefined) {
      deps.writeStdout(HELP);
      return;
    }
    if (invocation.options.version === "true" || invocation.options.v !== undefined) {
      deps.writeStdout(VERSION + "\n");
      return;
    }

    const result = await dispatch(invocation, deps, requestId);
    if (result !== undefined) {
      deps.writeStdout(JSON.stringify({
        ok: true,
        data: result,
        meta: { clientId: "pms-cli", refreshScopes: [], requestId },
      }) + "\n");
    }
  } catch (error) {
    const pmsError = error instanceof PmsClientError ? error : undefined;
    const code = error instanceof CliArgumentError
      ? "CLI_USAGE"
      : pmsError
        ? pmsError.kind.toUpperCase()
        : "CLI_ERROR";
    const message = safeErrorMessage(error instanceof Error ? error.message : String(error), "CLI 执行失败");
    const effectiveRequestId = pmsError?.requestId ?? requestId;
    deps.writeStderr(JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        requestId: effectiveRequestId,
        ...(pmsError?.details ? { details: pmsError.details } : {}),
      },
      meta: { clientId: "pms-cli", refreshScopes: [], requestId: effectiveRequestId },
    }) + "\n");
    deps.setExitCode(1);
  }
}

async function dispatch(invocation: CliInvocation, deps: CliDependencies, requestId: string): Promise<unknown> {
  if (invocation.group === "doctor") {
    const report = deps.runDoctor?.();
    if (invocation.options.format === "json") {
      deps.writeStdout(JSON.stringify(report ?? {}) + "\n");
      return undefined;
    }
    return report;
  }
  if (invocation.group === "setup") return deps.runSetup?.();
  if (invocation.group === "skill" && invocation.command === "install") {
    if (invocation.options.global !== "true") throw new CliArgumentError("skill install 必须提供 --global");
    return deps.installSkill?.();
  }
  if (invocation.group === "auth") return deps.runAuth(invocation.command, invocation.positionals, requestId);

  if (invocation.group === "capabilities") {
    const runtime = await deps.createRuntime(requestId);
    return listCapabilities(runtime.client, invocation.options.scope);
  }
  if (invocation.group === "search") {
    const resourceType = requireResourceType(invocation.command);
    const page = positiveInteger(invocation.options.page ?? "1", "page");
    const pageSize = boundedInteger(invocation.options["page-size"] ?? "20", "page-size", 100);
    const runtime = await deps.createRuntime(requestId);
    return search(runtime.client, {
      resourceType,
      keyword: invocation.options.keyword,
      filters: invocation.filters,
      page,
      pageSize,
    });
  }
  if (invocation.group === "get") {
    const resourceType = requireResourceType(invocation.command);
    const resourceId = requireId(invocation.positionals[0]);
    const runtime = await deps.createRuntime(requestId);
    return getResource(runtime.client, resourceType, resourceId);
  }
  if (invocation.group === "context") {
    const resourceType = requireContextResourceType(invocation.command);
    const resourceId = requireId(invocation.positionals[0]);
    const runtime = await deps.createRuntime(requestId);
    return getContext(runtime.client, resourceType, resourceId);
  }
  if (invocation.group === "dashboard" && invocation.command === "summary") {
    const runtime = await deps.createRuntime(requestId);
    return dashboardSummary(runtime.client);
  }
  if (invocation.group === "project" && invocation.command === "create") {
    const options = operationOptions(invocation.options, requestId);
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const runtime = await deps.createRuntime(requestId);
    return createProjectWithReadback(runtime.client, { ...options, idempotencyKey });
  }
  if (invocation.group === "requirement" && invocation.command === "analysis" && invocation.positionals[0] === "save") {
    if (invocation.positionals.length !== 2) {
      throw new CliArgumentError("requirement analysis save 需要一个需求 ID");
    }
    const requirementId = requireId(invocation.positionals[1]);
    const nodeId = positiveInteger(requiredOption(invocation.options, "node-id"), "node-id");
    const version = positiveInteger(requiredOption(invocation.options, "version"), "version");
    if (!invocation.options["context-id"] || !invocation.options["context-version"]) {
      throw new CliArgumentError("需求分析保存必须提供 --context-id 与 --context-version");
    }
    if (invocation.options["arguments-json"] === undefined) {
      throw new CliArgumentError("必须提供 --arguments-json");
    }
    const options = operationOptions(invocation.options, requestId);
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const runtime = await deps.createRuntime(requestId);
    return requirementAnalysisSave(runtime.client, requirementId, {
      ...options,
      nodeId,
      version,
      idempotencyKey,
    });
  }
  if (invocation.group === "operation") {
    const operation = invocation.positionals[0];
    if (!operation) throw new CliArgumentError("缺少操作名");
    const options = operationOptions(invocation.options, requestId);
    const idempotencyKey = invocation.command === "execute"
      ? requiredOption(invocation.options, "idempotency-key")
      : undefined;
    if (invocation.command !== "preview" && invocation.command !== "execute") {
      throw new CliArgumentError("未知操作命令: " + (invocation.command ?? ""));
    }
    const runtime = await deps.createRuntime(requestId);
    return invocation.command === "preview"
      ? operationPreview(runtime.client, operation, options)
      : operationExecute(runtime.client, operation, idempotencyKey!, options);
  }
  if (invocation.group === "workflow" && invocation.command === "action") {
    const [resourceType, rawId, action] = invocation.positionals;
    if (!resourceType || !rawId || !action) {
      throw new CliArgumentError("workflow action 需要 resourceType、id 和 action");
    }
    const resolvedResourceType = requireResourceType(resourceType);
    const resolvedResourceId = requireId(rawId);
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const options = operationOptions(invocation.options, requestId);
    const runtime = await deps.createRuntime(requestId);
    return workflowAction(
      runtime.client,
      resolvedResourceType,
      resolvedResourceId,
      action,
      idempotencyKey,
      options,
    );
  }
  throw new CliArgumentError("未知命令，请执行 pms --help: " + [invocation.group, invocation.command].filter(Boolean).join(" "));
}

function operationOptions(options: Record<string, string>, requestId: string): OperationOptions {
  const contextId = options["context-id"];
  const contextVersion = options["context-version"];
  if (Boolean(contextId) !== Boolean(contextVersion)) {
    throw new CliArgumentError("--context-id 与 --context-version 必须成对提供");
  }
  const contractId = options["contract-id"];
  const contractVersion = options["contract-version"];
  if (Boolean(contractId) !== Boolean(contractVersion)) {
    throw new CliArgumentError("--contract-id 与 --contract-version 必须成对提供");
  }
  const rawArguments = options["arguments-json"];
  let argumentsValue: Record<string, unknown> = {};
  if (rawArguments !== undefined) {
    try {
      const parsed = JSON.parse(rawArguments) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
      argumentsValue = parsed as Record<string, unknown>;
    } catch {
      throw new CliArgumentError("--arguments-json 必须是 JSON 对象");
    }
  }
  return {
    arguments: argumentsValue,
    context: contextId && contextVersion ? { id: contextId, version: contextVersion } : undefined,
    contract: contractId && contractVersion ? { id: contractId, version: contractVersion } : undefined,
    requestId,
  };
}

function requiredOption(options: Record<string, string>, name: string): string {
  const value = options[name]?.trim();
  if (!value) throw new CliArgumentError("必须提供 --" + name);
  return value;
}

function requireId(raw: string | undefined): number {
  if (!raw || !/^[1-9]\d*$/.test(raw)) throw new CliArgumentError("需要正整数 ID");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new CliArgumentError("ID 超出 JavaScript 安全整数范围");
  return value;
}

function positiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new CliArgumentError("--" + name + " 必须是正整数");
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new CliArgumentError("--" + name + " 必须是正整数");
  return value;
}

function boundedInteger(raw: string, name: string, max: number): number {
  const value = positiveInteger(raw, name);
  if (value > max) throw new CliArgumentError("--" + name + " 不能超过 " + max);
  return value;
}

function requireResourceType(raw: string | undefined): QueryItem["type"] {
  const types: QueryItem["type"][] = ["requirement", "project", "topic", "story", "task", "subtask", "iteration_plan"];
  if (!raw || !types.includes(raw as QueryItem["type"])) throw new CliArgumentError("不支持的资源类型: " + (raw ?? ""));
  return raw as QueryItem["type"];
}

function requireContextResourceType(raw: string | undefined): Extract<QueryItem["type"], "requirement" | "project" | "topic" | "story"> {
  if (!["requirement", "project", "topic", "story"].includes(raw ?? "")) {
    throw new CliArgumentError("context 不支持该资源类型: " + (raw ?? ""));
  }
  return raw as Extract<QueryItem["type"], "requirement" | "project" | "topic" | "story">;
}
