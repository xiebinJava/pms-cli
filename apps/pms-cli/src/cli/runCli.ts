import type { PmsClient } from "../../../../packages/pms-client/src/index.js";
import { PmsClientError, safeErrorMessage } from "../../../../packages/pms-client/src/index.js";
import {
  resourceScenarioContractVersion,
  agentProgressionContractVersion,
  agentProgressionDraftSchema,
  type AgentProgressionExecuteMode,
  type AgentProgressionIntent,
  type AgentProgressionResourceType,
  type AnalysisDraft,
  type ContextReadOptions,
  type QueryItem,
  type ResourceScenarioResourceType,
} from "../../../../packages/pms-contracts/src/index.js";
import { CliArgumentError, parseCliArguments, type CliInvocation } from "./parseArguments.js";
import { listCapabilities } from "../commands/core/capabilities.js";
import { getAgentContext, getContext } from "../commands/core/context.js";
import { getResource } from "../commands/core/get.js";
import { operationAuto, operationExecutePreview, operationPreview, type OperationOptions } from "../commands/core/operation.js";
import { search } from "../commands/core/search.js";
import { workflowAction } from "../commands/core/workflow.js";
import { dashboardSummary } from "../commands/shortcuts/dashboard.js";
import { createProjectWithReadback } from "../commands/shortcuts/project.js";
import { requirementAnalysisSave } from "../commands/shortcuts/requirement.js";
import { executeProjectCreateScenario, planProjectCreateScenario } from "../commands/scenarios/projectCreate.js";
import {
  executeResourceWriteScenario,
  planResourceWriteScenario,
  type ResourceWriteResourceType,
} from "../commands/scenarios/resourceWrite.js";
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
  readRequirementAnalysisSession,
} from "../commands/scenarios/requirementAnalysis.js";
import {
  appendStoryNodeTurn,
  confirmStoryNodePlan,
  createStoryNodeConversation,
  previewStoryNodePlan,
  readStoryNodeEvents,
  readStoryNodeSession,
} from "../commands/scenarios/storyOrchestrator.js";
import {
  executeStoryWorkbenchScenario,
  planStoryWorkbenchScenario,
  runStoryWorkbenchScenario,
} from "../commands/scenarios/storyWorkbench.js";
import {
  executeResourceScenario,
  planResourceScenario,
} from "../commands/scenarios/resourceScenarioExecutor.js";
import {
  executeAgentProgression,
  planAgentProgression,
} from "../commands/scenarios/agentProgression.js";
import { ResourceScenarioError } from "../commands/scenarios/resourceScenarioRegistry.js";
import "../commands/scenarios/requirementScenarioAdapter.js";
import "../commands/scenarios/topicScenarioAdapter.js";
import "../commands/scenarios/projectScenarioAdapter.js";
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
  "  pms operation auto <operation> --arguments-json <json> --idempotency-key <key>",
  "  pms operation execute --preview-operation-id <id> --idempotency-key <key>",
  "  pms project create --arguments-json <json> --preview-operation-id <id> --idempotency-key <key>",
  "  pms requirement analysis save <id> --node-id <id> --version <version> --context-id <id> --context-version <version> --arguments-json <patch-json> --preview-operation-id <id> --idempotency-key <key>",
  "  pms scenario project-create plan --arguments-json <json>",
  "  pms scenario project-create execute --arguments-json <json> --preview-operation-id <id> --idempotency-key <key>",
  "  pms scenario resource-write plan <project|topic|story> <operation> --arguments-json <json>",
  "  pms scenario resource-write execute <project|topic|story> <operation> --preview-operation-id <id> --idempotency-key <key>",
  "  pms scenario resource plan <requirement|topic|project> <operation> [id] --arguments-json <json>",
  "  pms scenario resource execute <requirement|topic|project> <operation> [id] --preview-operation-id <id> --idempotency-key <key>",
  "  pms scenario progression plan|execute <project|requirement|topic|story> <id> --intent <READ_CONTEXT|UPDATE_NODE_FIELDS|COMPLETE_NODE> [--draft-json <json>] [--execute-mode plan|auto|confirm] [--preview-operation-id <id>] [--idempotency-key <key>]",
  "  pms scenario project-update|topic-create|topic-update|story-create|story-update plan --arguments-json <json>",
  "  pms scenario project-update|topic-create|topic-update|story-create|story-update execute --preview-operation-id <id> --idempotency-key <key>",
  "  pms scenario requirement-analysis plan|execute <id> --node-id <id> --version <version> --arguments-json <patch-json> [--idempotency-key <key>] [--preview-operation-id <id>]",
  "  pms scenario requirement-analysis draft <id> --node-id <id> --version <version> --draft-json <draft-json>",
  "  pms scenario requirement-analysis plan|execute <id> --node-id <id> --version <version> --draft-json <draft-json> [--idempotency-key <key>] [--preview-operation-id <id>]",
  "  pms scenario requirement-analysis orchestrate create|turn|preview|confirm|events|session <id> [options]",
  "  pms scenario story-orchestrator create|turn|preview|confirm|events|session <id> [options]",
  "  pms scenario requirement-analysis shadow <id> --cases-file <path> [--provider mock|openai]",
  "  pms scenario story-workbench draft|plan|execute <id> --node-id <id> --version <version> --variant <variant> --patch-json <json> [--complete --owner-id <id> --start-date <YYYY-MM-DD> --end-date <YYYY-MM-DD>] [--idempotency-key <key>] [--preview-operation-id <id>]",
  "  pms workflow action <resourceType> <id> <action> --arguments-json <json> --preview-operation-id <id> --idempotency-key <key>",
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
    const code = error instanceof ResourceScenarioError
      ? error.code
      : error instanceof CliArgumentError
      ? error.code
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
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
    const runtime = await deps.createRuntime(requestId);
    return createProjectWithReadback(runtime.client, { ...options, idempotencyKey, previewOperationId });
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
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
    const runtime = await deps.createRuntime(requestId);
    return executeProjectCreateScenario(runtime.client, { ...options, idempotencyKey, previewOperationId });
  }
  if (invocation.group === "scenario" && invocation.command === "resource") {
    return dispatchResourceScenario(invocation, deps, requestId);
  }
  if (invocation.group === "scenario" && invocation.command === "progression") {
    return dispatchAgentProgression(invocation, deps, requestId);
  }
  if (invocation.group === "scenario" && isResourceWriteScenario(invocation.command)) {
    const scenario = resolveResourceWriteScenario(invocation.command, invocation.positionals);
    const phase = scenario.phase;
    if (phase === "plan") {
      if (invocation.options["arguments-json"] === undefined) {
        throw new CliArgumentError("资源写入 plan 必须提供 --arguments-json");
      }
      const options = operationOptions(invocation.options, requestId);
      const runtime = await deps.createRuntime(requestId);
      return planResourceWriteScenario(runtime.client, {
        ...options,
        resourceType: scenario.resourceType,
        operation: scenario.operation,
      });
    }
    if (phase !== "execute") {
      throw new CliArgumentError("资源写入场景需要 plan 或 execute");
    }
    if (invocation.options["arguments-json"] !== undefined) {
      throw new CliArgumentError("资源写入 execute 已绑定预览，不接受 --arguments-json；请先重新执行 plan");
    }
    const options = operationOptions(invocation.options, requestId);
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
    const runtime = await deps.createRuntime(requestId);
    return executeResourceWriteScenario(runtime.client, {
      ...options,
      resourceType: scenario.resourceType,
      operation: scenario.operation,
      idempotencyKey,
      previewOperationId,
    });
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
      if (action === "session") {
        const conversationId = requireId(invocation.positionals[2]);
        const afterSequence = invocation.options["after-sequence"] === undefined
          ? 0
          : nonNegativeInteger(invocation.options["after-sequence"], "after-sequence");
        const runtime = await deps.createRuntime(requestId);
        return readRequirementAnalysisSession(runtime.client, conversationId, afterSequence);
      }
      throw new CliArgumentError("orchestrate 需要 create、turn、preview、confirm、events 或 session");
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
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
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
      previewOperationId,
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
  if (invocation.group === "scenario" && invocation.command === "story-orchestrator") {
    const action = invocation.positionals[0];
    if (action === "create") {
      const storyId = requireId(invocation.positionals[1]);
      const runtime = await deps.createRuntime(requestId);
      return createStoryNodeConversation(runtime.client, storyId);
    }
    if (action === "turn") {
      const conversationId = requireId(invocation.positionals[1]);
      const nodeId = positiveInteger(requiredOption(invocation.options, "node-id"), "node-id");
      const contextVersion = nonNegativeInteger(requiredOption(invocation.options, "version"), "version");
      const draft = parseAgentDraftJson(requiredOption(invocation.options, "draft-json"));
      const message = requiredOption(invocation.options, "message");
      const runtime = await deps.createRuntime(requestId);
      return appendStoryNodeTurn(runtime.client, {
        conversationId, message, draft, nodeId, contextVersion, requestId,
      });
    }
    if (action === "preview") {
      const planId = requireId(invocation.positionals[1]);
      const runtime = await deps.createRuntime(requestId);
      return previewStoryNodePlan(runtime.client, planId, requestId);
    }
    if (action === "confirm") {
      const planId = requireId(invocation.positionals[1]);
      const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
      const runtime = await deps.createRuntime(requestId);
      return confirmStoryNodePlan(runtime.client, planId, idempotencyKey, requestId);
    }
    if (action === "events" || action === "session") {
      const conversationId = requireId(invocation.positionals[1]);
      const afterSequence = invocation.options["after-sequence"] === undefined
        ? 0 : nonNegativeInteger(invocation.options["after-sequence"], "after-sequence");
      const runtime = await deps.createRuntime(requestId);
      return action === "events"
        ? readStoryNodeEvents(runtime.client, conversationId, afterSequence)
        : readStoryNodeSession(runtime.client, conversationId, afterSequence);
    }
    throw new CliArgumentError("story-orchestrator 需要 create、turn、preview、confirm、events 或 session");
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
    const complete = invocation.options.complete === "true";
    const ownerId = invocation.options["owner-id"] === undefined
      ? undefined : positiveInteger(invocation.options["owner-id"], "owner-id");
    const startDate = optionalIsoDate(invocation.options["start-date"], "start-date");
    const endDate = optionalIsoDate(invocation.options["end-date"], "end-date");
    const common = {
      contractVersion: "story-workbench/v1" as const,
      resourceType: "story" as const,
      resourceId: storyId,
      nodeId,
      version,
      variant,
      patch,
      ...(complete ? { complete: true as const } : {}),
      ...(ownerId === undefined ? {} : { ownerId }),
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
      requestId,
    };
    if (phase === "execute") {
      const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
      const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
      const runtime = await deps.createRuntime(requestId);
      const result = await executeStoryWorkbenchScenario(runtime.client, {
        ...common,
        save: true,
        idempotencyKey,
        previewOperationId,
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
          input: { ...common, save: true, idempotencyKey, previewOperationId },
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
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
    const runtime = await deps.createRuntime(requestId);
    return requirementAnalysisSave(runtime.client, requirementId, {
      ...options,
      nodeId,
      version,
      idempotencyKey,
      previewOperationId,
    });
  }
  if (invocation.group === "operation") {
    const operation = invocation.positionals[0];
    const previewOptions = invocation.command === "preview" || invocation.command === "auto"
      ? operationOptions(invocation.options, requestId)
      : undefined;
    const idempotencyKey = invocation.command === "execute" || invocation.command === "auto"
      ? requiredOption(invocation.options, "idempotency-key")
      : undefined;
    const previewOperationId = invocation.command === "execute"
      ? requiredOption(invocation.options, "preview-operation-id")
      : undefined;
    if (invocation.command === "execute" && invocation.options["arguments-json"] !== undefined) {
      throw new CliArgumentError("operation execute 已绑定预览，不接受 --arguments-json；请先重新执行 operation preview");
    }
    if (invocation.command === "preview" && !operation) throw new CliArgumentError("缺少操作名");
    if (invocation.command === "execute" && operation) {
      throw new CliArgumentError("operation execute 不接受操作名；预览 ID 已绑定具体操作");
    }
    if (invocation.command === "auto" && !operation) {
      throw new CliArgumentError("operation auto 需要操作名");
    }
    if (invocation.command !== "preview" && invocation.command !== "execute" && invocation.command !== "auto") {
      throw new CliArgumentError("未知操作命令: " + (invocation.command ?? ""));
    }
    if (invocation.command === "auto" && invocation.options["preview-operation-id"] !== undefined) {
      throw new CliArgumentError("operation auto 不接受 preview-operation-id；它会在服务端内部校验");
    }
    const runtime = await deps.createRuntime(requestId);
    if (invocation.command === "preview") return operationPreview(runtime.client, operation!, previewOptions);
    if (invocation.command === "auto") return operationAuto(runtime.client, operation!, idempotencyKey!, previewOptions);
    return operationExecutePreview(runtime.client, previewOperationId!, idempotencyKey!);
  }
  if (invocation.group === "workflow" && invocation.command === "action") {
    const [resourceType, rawId, action] = invocation.positionals;
    if (!resourceType || !rawId || !action) {
      throw new CliArgumentError("workflow action 需要 resourceType、id 和 action");
    }
    const resolvedResourceType = requireResourceType(resourceType);
    const resolvedResourceId = requireId(rawId);
    const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
    const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
    const options = operationOptions(invocation.options, requestId);
    const runtime = await deps.createRuntime(requestId);
    return workflowAction(
      runtime.client,
      resolvedResourceType,
      resolvedResourceId,
      action,
      idempotencyKey,
      options,
      previewOperationId,
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

async function dispatchResourceScenario(
  invocation: CliInvocation,
  deps: CliDependencies,
  requestId: string,
): Promise<unknown> {
  const [phase, rawResourceType, operation, rawResourceId] = invocation.positionals;
  if (phase !== "plan" && phase !== "execute") {
    throw new CliArgumentError("scenario resource 需要 plan 或 execute");
  }
  const resourceType = requireResourceScenarioResourceType(rawResourceType);
  if (!operation) throw new CliArgumentError("scenario resource 需要 operation");
  const resourceId = rawResourceId === undefined ? undefined : requireId(rawResourceId);
  if (phase === "plan") {
    const draft = optionalAgentDraft(invocation.options);
    if (draft === undefined && invocation.options["arguments-json"] === undefined) {
      throw new CliArgumentError("资源场景 plan 必须提供 --arguments-json 或 --draft-json");
    }
    const argumentsValue = draft?.patch ?? parseJsonObject(
      requiredOption(invocation.options, "arguments-json"),
      "arguments-json",
    );
    const rawNodeId = invocation.options["node-id"];
    const rawVersion = invocation.options.version;
    const runtime = await deps.createRuntime(requestId);
    return planResourceScenario(runtime.client, {
      contractVersion: resourceScenarioContractVersion,
      resourceType,
      ...(resourceId === undefined ? {} : { resourceId }),
      operation,
      ...(rawNodeId === undefined ? {} : { nodeId: positiveInteger(rawNodeId, "node-id") }),
      ...(rawVersion === undefined ? {} : { contextVersion: nonNegativeInteger(rawVersion, "version") }),
      arguments: argumentsValue,
      ...(draft === undefined ? {} : { draft }),
      requestId,
    });
  }
  if (invocation.options["arguments-json"] !== undefined || invocation.options["draft-json"] !== undefined) {
    throw new CliArgumentError("资源场景 execute 已绑定预览，不接受 arguments 或 draft；请先重新执行 plan");
  }
  const previewOperationId = requiredResourceScenarioOption(invocation.options, "preview-operation-id");
  const idempotencyKey = requiredResourceScenarioOption(invocation.options, "idempotency-key");
  const runtime = await deps.createRuntime(requestId);
  return executeResourceScenario(runtime.client, {
    resourceType,
    ...(resourceId === undefined ? {} : { resourceId }),
    operation,
    previewOperationId,
    idempotencyKey,
    requestId,
  });
}

async function dispatchAgentProgression(
  invocation: CliInvocation,
  deps: CliDependencies,
  requestId: string,
): Promise<unknown> {
  const [phase, rawResourceType, rawResourceId] = invocation.positionals;
  if (phase !== "plan" && phase !== "execute") {
    throw new CliArgumentError("scenario progression 需要 plan 或 execute");
  }
  const resourceType = parseAgentProgressionResourceType(rawResourceType);
  const resourceId = requireId(rawResourceId);
  const intent = parseAgentProgressionIntent(requiredOption(invocation.options, "intent"));
  const executeMode = parseAgentProgressionExecuteMode(invocation.options["execute-mode"] ?? "auto");
  const draft = parseProgressionDraft(invocation.options["draft-json"]);
  if (phase === "plan") {
    if (intent !== "READ_CONTEXT" && draft === undefined) {
      throw new CliArgumentError("progression plan 的写入意图必须提供 --draft-json");
    }
    const runtime = await deps.createRuntime(requestId);
    return planAgentProgression(runtime.client, {
      contractVersion: agentProgressionContractVersion,
      resourceType,
      resourceId,
      intent,
      executeMode,
      ...(draft === undefined ? {} : { draft }),
      ...(invocation.options["node-id"] === undefined
        ? {} : { nodeId: positiveInteger(invocation.options["node-id"], "node-id") }),
      ...(invocation.options.version === undefined
        ? {} : { contextVersion: nonNegativeInteger(invocation.options.version, "version") }),
      requestId,
    });
  }
  const previewOperationId = requiredOption(invocation.options, "preview-operation-id");
  const idempotencyKey = requiredOption(invocation.options, "idempotency-key");
  const runtime = await deps.createRuntime(requestId);
  return executeAgentProgression(runtime.client, {
    contractVersion: agentProgressionContractVersion,
    resourceType,
    resourceId,
    intent,
    executeMode,
    previewOperationId,
    idempotencyKey,
    ...(draft === undefined ? {} : { draft }),
    ...(invocation.options["node-id"] === undefined
      ? {} : { nodeId: positiveInteger(invocation.options["node-id"], "node-id") }),
    ...(invocation.options.version === undefined
      ? {} : { contextVersion: nonNegativeInteger(invocation.options.version, "version") }),
    requestId,
  });
}

function parseProgressionDraft(raw: string | undefined) {
  if (raw === undefined) return undefined;
  try {
    return agentProgressionDraftSchema.parse(JSON.parse(raw));
  } catch (error) {
    throw new CliArgumentError(error instanceof Error ? error.message : "--draft-json 无效");
  }
}

function parseAgentProgressionResourceType(raw: string | undefined): AgentProgressionResourceType {
  if (raw !== "project" && raw !== "requirement" && raw !== "topic" && raw !== "story") {
    throw new CliArgumentError("progression 仅支持 project、requirement、topic、story");
  }
  return raw;
}

function parseAgentProgressionIntent(raw: string): AgentProgressionIntent {
  if (raw !== "READ_CONTEXT" && raw !== "UPDATE_NODE_FIELDS" && raw !== "COMPLETE_NODE") {
    throw new CliArgumentError("progression intent 仅支持 READ_CONTEXT、UPDATE_NODE_FIELDS、COMPLETE_NODE");
  }
  return raw;
}

function parseAgentProgressionExecuteMode(raw: string): AgentProgressionExecuteMode {
  if (raw !== "plan" && raw !== "auto" && raw !== "confirm") {
    throw new CliArgumentError("progression execute-mode 仅支持 plan、auto、confirm");
  }
  return raw;
}

function requiredResourceScenarioOption(
  options: Record<string, string>,
  name: "preview-operation-id" | "idempotency-key",
): string {
  const value = options[name]?.trim();
  if (!value) {
    throw new CliArgumentError(
      `必须提供 --${name}`,
      name === "preview-operation-id" ? "PREVIEW_REQUIRED" : "IDEMPOTENCY_REQUIRED",
    );
  }
  return value;
}

function requireResourceScenarioResourceType(raw: string | undefined): ResourceScenarioResourceType {
  if (raw !== "requirement" && raw !== "topic" && raw !== "project") {
    throw new CliArgumentError("资源场景仅支持 requirement、topic、project");
  }
  return raw;
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

function optionalIsoDate(raw: string | undefined, name: string): string | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new CliArgumentError("--" + name + " 必须是 YYYY-MM-DD");
  }
  const parsed = new Date(raw + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new CliArgumentError("--" + name + " 必须是有效日期");
  }
  return raw;
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

type ResourceWritePhase = "plan" | "execute";

const RESOURCE_WRITE_ALIASES: Record<string, {
  resourceType: ResourceWriteResourceType;
  operation: string;
}> = {
  "project-update": { resourceType: "project", operation: "project.update" },
  "topic-create": { resourceType: "topic", operation: "topic.create" },
  "topic-update": { resourceType: "topic", operation: "topic.update" },
  "story-create": { resourceType: "story", operation: "story.create" },
  "story-update": { resourceType: "story", operation: "story.update" },
};

function isResourceWriteScenario(command: string | undefined): boolean {
  return command === "resource-write"
    || command !== undefined && Object.hasOwn(RESOURCE_WRITE_ALIASES, command);
}

function resolveResourceWriteScenario(
  command: string | undefined,
  positionals: string[],
): { phase: ResourceWritePhase | string; resourceType: ResourceWriteResourceType; operation: string } {
  if (command && command !== "resource-write") {
    const alias = RESOURCE_WRITE_ALIASES[command];
    if (!alias) throw new CliArgumentError("未知资源写入场景: " + command);
    return {
      phase: positionals[0] ?? "",
      ...alias,
    };
  }
  const resourceType = positionals[1];
  const operation = positionals[2];
  if (!positionals[0] || !resourceType || !operation) {
    throw new CliArgumentError("scenario resource-write 需要 phase、resourceType 和 operation");
  }
  if (resourceType !== "project" && resourceType !== "topic" && resourceType !== "story") {
    throw new CliArgumentError("资源写入场景仅支持 project、topic、story");
  }
  return {
    phase: positionals[0],
    resourceType,
    operation,
  };
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
