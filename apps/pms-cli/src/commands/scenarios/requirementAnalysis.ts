import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import type {
  ActionCapability,
  OperationPreview,
  OperationResult,
  ResourceDetail,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../capabilities/CapabilityResolver.js";
import { operationPreview, type OperationOptions } from "../core/operation.js";
import { requirementAnalysisSave, type RequirementAnalysisSaveOptions } from "../shortcuts/requirement.js";
import type { ScenarioTrace } from "./projectCreate.js";

export interface RequirementAnalysisScenarioOptions extends OperationOptions {
  nodeId: number;
  version: number;
  idempotencyKey?: string;
}

interface RequirementAnalysisBase {
  resource: ResourceDetail;
  context: WorkflowContext;
  action: ActionCapability;
  contextId: string;
  contextVersion: string;
}

export interface RequirementAnalysisScenarioPlan {
  scenario: "requirement-analysis";
  phase: "plan";
  requirementId: number;
  analysisPatch: Record<string, unknown>;
  facts: {
    resource: ResourceDetail;
    currentNode: NonNullable<WorkflowContext["currentNode"]>;
    workflow: NonNullable<WorkflowContext["workflow"]>;
    allowedActions: string[];
  };
  declaredFields: string[];
  inferences: string[];
  assumptions: string[];
  preview: OperationPreview;
  trace: ScenarioTrace;
}

export interface RequirementAnalysisScenarioResult {
  scenario: "requirement-analysis";
  phase: "execute";
  requirementId: number;
  analysisPatch: Record<string, unknown>;
  facts: RequirementAnalysisScenarioPlan["facts"];
  result: OperationResult;
  readback: {
    resource: ResourceDetail | null;
    context: WorkflowContext | null;
  };
  protectedFieldsUnchanged: Record<string, boolean>;
  warnings: string[];
  trace: ScenarioTrace;
}

export async function planRequirementAnalysisScenario(
  client: PmsClient,
  requirementId: number,
  options: RequirementAnalysisScenarioOptions,
): Promise<RequirementAnalysisScenarioPlan> {
  const base = await loadBase(client, requirementId, options);
  const preview = await operationPreview(client, "requirement.analysis.save", {
    ...options,
    context: { id: base.contextId, version: base.contextVersion },
    arguments: analysisArguments(requirementId, options),
  });
  return {
    scenario: "requirement-analysis",
    phase: "plan",
    requirementId,
    analysisPatch: options.arguments ?? {},
    facts: factsOf(base),
    declaredFields: Object.keys(base.action.inputSchema),
    inferences: [],
    assumptions: [],
    preview,
    trace: { requestId: options.requestId },
  };
}

export async function executeRequirementAnalysisScenario(
  client: PmsClient,
  requirementId: number,
  options: RequirementAnalysisScenarioOptions & { idempotencyKey: string },
): Promise<RequirementAnalysisScenarioResult> {
  // Keep the caller's context/version on the execute request. A successful
  // first save increments the node version, but an idempotent replay must be
  // allowed to return the original operation result with that same context.
  // The backend remains responsible for rejecting a stale *new* idempotency
  // key when the command reaches execution.
  const before = await loadBase(client, requirementId, options, false);
  const contextId = `requirement:${requirementId}`;
  const contextVersion = options.context?.version ?? String(before.context.version);
  const saveOptions: RequirementAnalysisSaveOptions = {
    ...options,
    context: { id: contextId, version: contextVersion },
  };
  const result = await requirementAnalysisSave(client, requirementId, saveOptions);
  const warnings = [...result.warnings];
  let resource: ResourceDetail | null = null;
  let context: WorkflowContext | null = null;
  try {
    resource = await client.get({ type: "requirement", id: requirementId });
    context = await client.context({ type: "requirement", id: requirementId });
  } catch (error) {
    warnings.push("需求分析已保存，但结果回读失败：" + (error instanceof Error ? error.message : String(error)));
  }
  return {
    scenario: "requirement-analysis",
    phase: "execute",
    requirementId,
    analysisPatch: options.arguments ?? {},
    facts: factsOf(before),
    result,
    readback: { resource, context },
    protectedFieldsUnchanged: compareProtectedFields(before.resource, resource),
    warnings,
    trace: {
      requestId: options.requestId,
      operationId: result.operationId,
      idempotencyKey: options.idempotencyKey,
      ...(result.auditId ? { auditId: result.auditId } : {}),
    },
  };
}

async function loadBase(
  client: PmsClient,
  requirementId: number,
  options: RequirementAnalysisScenarioOptions,
  validateVersion = true,
): Promise<RequirementAnalysisBase> {
  const resolver = new CapabilityResolver(client);
  await resolver.list();
  const action = await resolver.action("requirement.analysis.save");
  const resource = await client.get({ type: "requirement", id: requirementId });
  const context = await client.context({ type: "requirement", id: requirementId });
  assertTarget(context, options, validateVersion);
  return {
    resource,
    context,
    action,
    contextId: `requirement:${requirementId}`,
    contextVersion: String(context.version),
  };
}

function assertTarget(
  context: WorkflowContext,
  options: RequirementAnalysisScenarioOptions,
  validateVersion = true,
): void {
  if (context.currentNode?.id !== options.nodeId) {
    throw new Error(`当前节点 ${context.currentNode?.id ?? "无"} 与指定节点 ${options.nodeId} 不一致`);
  }
  if (validateVersion && context.version !== options.version) {
    throw new Error(`需求上下文版本 ${context.version ?? "无"} 与指定版本 ${options.version} 不一致`);
  }
}

function analysisArguments(
  requirementId: number,
  options: RequirementAnalysisScenarioOptions,
): Record<string, unknown> {
  return {
    requirementId,
    nodeId: options.nodeId,
    version: options.version,
    patch: options.arguments ?? {},
  };
}

function factsOf(base: RequirementAnalysisBase): RequirementAnalysisScenarioPlan["facts"] {
  if (!base.context.currentNode || !base.context.workflow) {
    throw new Error("需求上下文缺少当前节点或流程定义");
  }
  return {
    resource: base.resource,
    currentNode: base.context.currentNode,
    workflow: base.context.workflow,
    allowedActions: base.context.allowedActions,
  };
}

function compareProtectedFields(before: ResourceDetail, after: ResourceDetail | null): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!after) return result;
  for (const key of ["systemId", "targetType", "targetId", "ownerId", "status", "startDate", "endDate"]) {
    if (Object.prototype.hasOwnProperty.call(before.details, key)) {
      result[key] = after.details[key] === before.details[key];
    }
  }
  return result;
}
