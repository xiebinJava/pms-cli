import type { PmsClient } from "../../../../packages/pms-client/src/index.js";
import { PmsClientError, safeErrorMessage } from "../../../../packages/pms-client/src/index.js";
import type { AnalysisDraft, ContextReadOptions, QueryItem } from "../../../../packages/pms-contracts/src/index.js";
import { CliArgumentError, parseCliArguments, type CliInvocation } from "./parseArguments.js";
import { listCapabilities } from "../commands/core/capabilities.js";
import { getAgentContext, getContext } from "../commands/core/context.js";
import { getResource } from "../commands/core/get.js";
import { operationExecute, operationPreview, type OperationOptions } from "../commands/core/operation.js";
import { search } from "../commands/core/search.js";
import { workflowAction } from "../commands/core/workflow.js";
import { dashboardSummary } from "../commands/shortcuts/dashboard.js";
import { createProjectWithReadback } from "../commands/shortcuts/project.js";
import { requirementAnalysisSave } from "../commands/shortcuts/requirement.js";
import { executeProjectCreateScenario, planProjectCreateScenario } from "../commands/scenarios/projectCreate.js";
import {
  fixedMockDraftForContext,
  readAnalysisShadowCases,
  runAnalysisShadowCases,
} from "../commands/scenarios/analysisShadow.js";
import {
  agentDraftContractVersion,
  parseAgentDraftJson,
} from "../commands/scenarios/AgentDraftContract.js";
import {
  FixedAnalysisDraftProvider,
  OpenAICompatibleAnalysisDraftProvider,
} from "../commands/scenarios/AnalysisDraftProvider.js";
import {
  executeRequirementAnalysisScenario,
  planRequirementAnalysisScenario,
  runRequirementAnalysisScenario,
  appendRequirementAnalysisTurn,
  confirmRequirementAnalysisPlan,
  createRequirementAnalysisConversation,
  previewRequirementAnalysisPlan,
  readRequirementAnalysisEvents,
} from "../commands/scenarios/requirementAnalysis.js";
import {
  executeStoryWorkbenchScenario,
  planStoryWorkbenchScenario,
  runStoryWorkbenchScenario,
} from "../commands/scenarios/storyWorkbench.js";
import {
  toRequirementAnalysisWorkSession,
  toStoryWorkbenchWorkSession,
} from "../commands/scenarios/agentWorkSession.js";

const HELP = [
  "PMS CLI",
  "",
  "  pms auth login|status|logout",
  "  pms capabilities [--scope <scope>]",
  "  pms search <resourceType> [--keyword <text>] [--filter key=value]",
  "  pms get <resourceType> <id>",
  "  pms context <resourceType> <id> [--format json|agent] [--view legacy|focused] [--node-id <id>] [--component <key>]",
  "  pms operation preview <operation> --arguments-json <json>",
  "  pms operation execute <operation> --arguments-json <json> --idempotency-key <key>",
  "  pms project create --arguments-json <json> --idempotency-key <key>",
  "  pms requirement analysis save <id> --node-id <id> --version <version> --context-id <id> --context-version <version> --arguments-json <patch-json> --idempotency-key <key>",
  "  pms scenario project-create plan|execute --arguments-json <json> [--idempotency-key <key>]",
  "  pms scenario requirement-analysis plan|execute <id> --node-id <id> --version <version> --arguments-json <patch-json> [--idempotency-key <key>]",
  "  pms scenario requirement-analysis draft <id> --node-id <id> --version <version> --draft-json <draft-json>",
  "  pms scenario requirement-analysis plan|execute <id> --node-id <id> --version <version> --draft-json <draft-json> [--idempotency-key <key>]",
  "  pms scenario requirement-analysis orchestrate create|turn|preview|confirm|events <id> [options]",
  "  pms scenario requirement-analysis shadow <id> --cases-file <path> [--provider mock|openai]",
  "  pms scenario story-workbench draft|plan|execute <id> --node-id <id> --version <version> --variant <variant> --patch-json <json> [--idempotency-key <key>]",
  "  pms workflow action <resourceType> <id> <action> --arguments-json <json> --idempotency-key <key>",
  "  pms dashboard summary",
  "  pms setup | pms doctor --format json",
  "  pms skill install --global",
  "",
  "Options accept both --name value and --name=value forms.",
  "",
].join("\n");
const VERSION = "0.1.1";

export interface CliRuntime {
  client: PmsClient;
}

export interface CliDependencies {
  createRuntime(requestId: string): Promise<CliRuntime>;
  runAuth(command: string | undefined, args: string[], requestId: string): Promise<unknown>;
  writeStdout(text: string): void;
  writeStderr(text: string): void;
  setExitCode(code: number): void;
  exitProcess?(code: number): void;
  requestIdFactory(): string;
  runDoctor?(): unknown;
  runSetup?(): unknown;
  installSkill?(): unknown;
}

export async function runCli(argv: string[], deps: CliDependencies): Promise<void> {
  const generatedRequestId = deps.requestIdFactory();
  let requestId = generatedRequestId;
  try {
    const invocation = parseCliArguments(argv);
    requestId = invocation.options["request-id"]?.trim() || generatedRequestId;
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
        meta: successMeta(result, requestId),
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
    deps.exitProcess?.(1);
  }
}

function successMeta(result: unknown, requestId: string): Record<string, unknown> {
  if (isOperationResult(result)) {
    return {
      clientId: "pms-cli",
      requestId,
      refreshScopes: result.refreshScopes,
      ...(result.auditId ? { auditId: result.auditId } : {}),
    };
  }
  return { clientId: "pms-cli", refreshScopes: [], requestId };
}

function isOperationResult(value: unknown): value is {
  refreshScopes: string[];
  auditId?: string;
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { refreshScopes?: unknown };
  return Array.isArray(candidate.refreshScopes)
      && candidate.refreshScopes.every((scope) => typeof scope === "string");
}

async function dispatch(invocation: CliInvocation, deps: CliDependencies, requestId: string): Promise<unknown> {
  if (invocation.group === "doctor") {
    const report = await deps.runDoctor?.();
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
    const options = contextOptions(invocation.options);
    const format = invocation.options.format ?? "json";
    if (format !== "json" && format !== "agent") {
      throw new CliArgumentError("context --format 仅支持 json 或 agent");
    }
    const runtime = await deps.createRuntime(requestId);
    if (format === "agent") return getAgentContext(runtime.client, resourceType, resourceId, options);
    return getContext(runtime.client, resourceType, resourceId, options);
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
  if (invocation.group === "scenario" && invocation.command === "project-create") {
    const phase = invocation.positionals[0];
    if (phase !== "plan" && phase !== "execute") {
      throw new CliArgumentError("scenario project-create 需要 plan 或 execute");
    }
    if (invocation.options["arguments-json"] === undefined) {
      throw new CliArgumentError("项目创建场景必须提供 --arguments-json");
    }
    const options = operationOptions(invocation.options, requestId);
    if (phase === "plan") {
      const runtime = await deps.createRuntime(requestId);
      return planProjectCreateScenario(runtime.client, options);
    }
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const runtime = await deps.createRuntime(requestId);
    return executeProjectCreateScenario(runtime.client, { ...options, idempotencyKey });
  }
  if (invocation.group === "scenario" && invocation.command === "requirement-analysis") {
    const phase = invocation.positionals[0];
    if (phase === "orchestrate") {
      const action = invocation.positionals[1];
      if (action === "create") {
        const requirementId = requireId(invocation.positionals[2]);
        const runtime = await deps.createRuntime(requestId);
        return createRequirementAnalysisConversation(runtime.client, requirementId);
      }
      if (action === "turn") {
        const conversationId = requireId(invocation.positionals[2]);
        const draft = parseAgentDraftJson(requiredOption(invocation.options, "draft-json"));
        const message = requiredOption(invocation.options, "message");
        const rawNodeId = invocation.options["node-id"];
        const rawVersion = invocation.options.version;
        const runtime = await deps.createRuntime(requestId);
        return appendRequirementAnalysisTurn(runtime.client, {
          conversationId,
          message,
          draft,
          ...(rawNodeId === undefined ? {} : { nodeId: positiveInteger(rawNodeId, "node-id") }),
          ...(rawVersion === undefined ? {} : { contextVersion: nonNegativeInteger(rawVersion, "version") }),
          requestId,
        });
      }
      if (action === "preview") {
        const planId = requireId(invocation.positionals[2]);
        const runtime = await deps.createRuntime(requestId);
        return previewRequirementAnalysisPlan(runtime.client, planId, requestId);
      }
      if (action === "confirm") {
        const planId = requireId(invocation.positionals[2]);
        const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
        const runtime = await deps.createRuntime(requestId);
        return confirmRequirementAnalysisPlan(runtime.client, planId, idempotencyKey, requestId);
      }
      if (action === "events") {
        const afterSequence = invocation.options["after-sequence"] === undefined
          ? 0
          : nonNegativeInteger(invocation.options["after-sequence"], "after-sequence");
        const conversationId = requireId(invocation.positionals[2]);
        const runtime = await deps.createRuntime(requestId);
        return readRequirementAnalysisEvents(runtime.client, conversationId, afterSequence);
      }
      throw new CliArgumentError("orchestrate 需要 create、turn、preview、confirm 或 events");
    }
    if (phase === "shadow") {
      const requirementId = requireId(invocation.positionals[1]);
      const casesPath = requiredOption(invocation.options, "cases-file");
      const providerName = invocation.options.provider ?? "mock";
      const runtime = await deps.createRuntime(requestId);
      const context = await runtime.client.context({ type: "requirement", id: requirementId });
      const cases = await readAnalysisShadowCases(casesPath);
      const provider = providerName === "mock"
        ? new FixedAnalysisDraftProvider(fixedMockDraftForContext(context))
        : providerName === "openai"
          ? new OpenAICompatibleAnalysisDraftProvider({
            baseUrl: requiredEnvironment("PMS_SHADOW_MODEL_BASE_URL"),
            apiKey: requiredEnvironment("PMS_SHADOW_MODEL_API_KEY"),
            model: requiredEnvironment("PMS_SHADOW_MODEL_NAME"),
          })
          : (() => { throw new CliArgumentError("--provider 只支持 mock 或 openai"); })();
      return runAnalysisShadowCases({ cases, context, provider });
    }
    if (phase !== "plan" && phase !== "execute" && phase !== "draft") {
      throw new CliArgumentError("scenario requirement-analysis 需要 draft、plan 或 execute");
    }
    const requirementId = requireId(invocation.positionals[1]);
    const nodeId = positiveInteger(requiredOption(invocation.options, "node-id"), "node-id");
    const version = nonNegativeInteger(requiredOption(invocation.options, "version"), "version");
    const draft = optionalAgentDraft(invocation.options);
    if (phase === "draft") {
      if (!draft) throw new CliArgumentError("draft 阶段必须提供 --draft-json");
      const runtime = await deps.createRuntime(requestId);
      const validation = await runRequirementAnalysisScenario(runtime.client, {
        resourceType: "requirement",
        resourceId: requirementId,
        nodeId,
        contextVersion: version,
        draft,
        save: false,
      }, async () => false);
      return { contractVersion: agentDraftContractVersion, ...validation };
    }
    if (!draft && invocation.options["arguments-json"] === undefined) {
      throw new CliArgumentError("需求分析场景必须提供 --arguments-json");
    }
    const options = operationOptions(invocation.options, requestId);
    if (phase === "plan") {
      const runtime = await deps.createRuntime(requestId);
      if (draft) {
        await validateAgentDraftForScenario(runtime.client, requirementId, nodeId, version, draft);
        const plan = await planRequirementAnalysisScenario(runtime.client, requirementId, {
          ...options,
          arguments: draft.patch,
          nodeId,
          version,
        });
        if (invocation.options.format === "agent") {
          const context = await runtime.client.context({ type: "requirement", id: requirementId }, { nodeId });
          return toRequirementAnalysisWorkSession({
            sessionId: requestId,
            taskId: `${requestId}:requirement-analysis`,
            context,
            draft,
            plan,
          });
        }
        return { contractVersion: agentDraftContractVersion, draft, plan };
      }
      const plan = await planRequirementAnalysisScenario(runtime.client, requirementId, { ...options, nodeId, version });
      if (invocation.options.format === "agent") {
        const context = await runtime.client.context({ type: "requirement", id: requirementId }, { nodeId });
        return toRequirementAnalysisWorkSession({
          sessionId: requestId,
          taskId: `${requestId}:requirement-analysis`,
          context,
          draft: null,
          plan,
        });
      }
      return plan;
    }
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const runtime = await deps.createRuntime(requestId);
    if (draft) {
      await validateAgentDraftForScenario(runtime.client, requirementId, nodeId, version, draft);
    }
    const execution = await executeRequirementAnalysisScenario(runtime.client, requirementId, {
      ...options,
      ...(draft ? { arguments: draft.patch } : {}),
      nodeId,
      version,
      idempotencyKey,
    });
    if (invocation.options.format === "agent") {
      const context = execution.readback.context
        ?? await runtime.client.context({ type: "requirement", id: requirementId }, { nodeId });
      return toRequirementAnalysisWorkSession({
        sessionId: requestId,
        taskId: `${requestId}:requirement-analysis`,
        context,
        draft: draft ?? draftFromPatch(options.arguments ?? {}),
        result: execution,
      });
    }
    return draft
      ? { contractVersion: agentDraftContractVersion, draft, execution }
      : execution;
  }
  if (invocation.group === "scenario" && invocation.command === "story-workbench") {
    const phase = invocation.positionals[0];
    if (phase !== "draft" && phase !== "plan" && phase !== "execute") {
      throw new CliArgumentError("scenario story-workbench 需要 draft、plan 或 execute");
    }
    const storyId = requireId(invocation.positionals[1]);
    const nodeId = positiveInteger(requiredOption(invocation.options, "node-id"), "node-id");
    const version = nonNegativeInteger(requiredOption(invocation.options, "version"), "version");
    const variant = requiredOption(invocation.options, "variant") as "writing" | "iteration" | "development" | "acceptance" | "release" | "launch";
    const patch = parseJsonObject(requiredOption(invocation.options, "patch-json"), "patch-json");
    const common = {
      contractVersion: "story-workbench/v1" as const,
      resourceType: "story" as const,
      resourceId: storyId,
      nodeId,
      version,
      variant,
      patch,
      requestId,
    };
    if (phase === "execute") {
      const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
      const runtime = await deps.createRuntime(requestId);
      const result = await executeStoryWorkbenchScenario(runtime.client, {
        ...common,
        save: true,
        idempotencyKey,
      });
      if (invocation.options.format === "agent") {
        const context = await runtime.client.context(
          { type: "story", id: storyId },
          { nodeId, view: "focused", component: "story-node-workbench" },
        );
        return toStoryWorkbenchWorkSession({
          sessionId: requestId,
          taskId: `${requestId}:story-workbench`,
          context,
          input: { ...common, save: true, idempotencyKey },
          result,
        });
      }
      return result;
    }
    const runtime = await deps.createRuntime(requestId);
    if (phase === "draft") {
      const result = await runStoryWorkbenchScenario(runtime.client, { ...common, save: false }, async () => false);
      if (invocation.options.format === "agent") {
        const context = await runtime.client.context(
          { type: "story", id: storyId },
          { nodeId, view: "focused", component: "story-node-workbench" },
        );
        return toStoryWorkbenchWorkSession({
          sessionId: requestId,
          taskId: `${requestId}:story-workbench`,
          context,
          input: { ...common, save: false },
          result,
        });
      }
      return result;
    }
    const plan = await planStoryWorkbenchScenario(runtime.client, { ...common, save: false });
    if (invocation.options.format === "agent") {
      const context = await runtime.client.context(
        { type: "story", id: storyId },
        { nodeId, view: "focused", component: "story-node-workbench" },
      );
      return toStoryWorkbenchWorkSession({
        sessionId: requestId,
        taskId: `${requestId}:story-workbench`,
        context,
        input: { ...common, save: false },
        plan,
      });
    }
    return plan;
  }
  if (invocation.group === "requirement" && invocation.command === "analysis" && invocation.positionals[0] === "save") {
    if (invocation.positionals.length !== 2) {
      throw new CliArgumentError("requirement analysis save 需要一个需求 ID");
    }
    const requirementId = requireId(invocation.positionals[1]);
    const nodeId = positiveInteger(requiredOption(invocation.options, "node-id"), "node-id");
    const version = nonNegativeInteger(requiredOption(invocation.options, "version"), "version");
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

function optionalAgentDraft(options: Record<string, string>) {
  const rawDraft = options["draft-json"];
  if (rawDraft === undefined) return undefined;
  if (options["arguments-json"] !== undefined) {
    throw new CliArgumentError("--draft-json 与 --arguments-json 不能同时提供");
  }
  try {
    return parseAgentDraftJson(rawDraft);
  } catch (error) {
    throw new CliArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function draftFromPatch(patch: Record<string, unknown>): AnalysisDraft {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch,
  };
}

function parseJsonObject(raw: string, optionName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new CliArgumentError(`--${optionName} 必须是 JSON 对象`);
  }
}

async function validateAgentDraftForScenario(
  client: PmsClient,
  requirementId: number,
  nodeId: number,
  version: number,
  draft: NonNullable<ReturnType<typeof optionalAgentDraft>>,
): Promise<void> {
  await runRequirementAnalysisScenario(client, {
    resourceType: "requirement",
    resourceId: requirementId,
    nodeId,
    contextVersion: version,
    draft,
    save: false,
  }, async () => false);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new CliArgumentError(`外部模型需要环境变量 ${name}`);
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

function nonNegativeInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) throw new CliArgumentError("--" + name + " 必须是非负整数");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new CliArgumentError("--" + name + " 必须是非负整数");
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

function contextOptions(options: Record<string, string>): ContextReadOptions {
  const contextReadOptions: ContextReadOptions = {};
  const rawNodeId = options["node-id"];
  if (rawNodeId !== undefined) {
    if (!/^[1-9][0-9]*$/.test(rawNodeId) || BigInt(rawNodeId) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CliArgumentError("node-id 必须为安全范围内的正整数");
    }
    contextReadOptions.nodeId = Number(rawNodeId);
  }
  const rawView = options.view;
  if (rawView !== undefined) {
    if (rawView !== "legacy" && rawView !== "focused") {
      throw new CliArgumentError("view 仅支持 legacy 或 focused");
    }
    contextReadOptions.view = rawView;
  }
  const rawComponent = options.component;
  if (rawComponent !== undefined) {
    if (!rawComponent.trim()) throw new CliArgumentError("component 不能为空白");
    if (rawView !== "focused") throw new CliArgumentError("component 仅允许在 focused 视图下使用");
    contextReadOptions.component = rawComponent;
  }
  return contextReadOptions;
}
