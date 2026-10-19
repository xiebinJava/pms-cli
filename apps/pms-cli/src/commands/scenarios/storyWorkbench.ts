import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import type {
  OperationPreview,
  OperationResult,
  StoryWorkbenchInput,
  StoryWorkbenchResult,
  WorkflowContext,
} from "../../../../../packages/pms-contracts/src/index.js";
import {
  storyWorkbenchInputSchema,
  storyWorkbenchContractVersion,
} from "../../../../../packages/pms-contracts/src/index.js";
import { operationExecutePreview, operationPreview } from "../core/operation.js";
import { buildUserFacingDisplay } from "../../output/userFacing.js";
import { ComponentResolutionError, resolveWorkflowComponent } from "../core/componentResolver.js";
import { ResourceScenarioError } from "./resourceScenarioRegistry.js";
import { buildVerificationResult, publicVerification } from "./readbackVerification.js";

export type StoryWorkbenchScenarioClient = PmsClient;

interface SaveContract {
  command: string;
  itemType: string;
  itemId: number;
  nodeId: number;
  version: number;
  componentKey: string;
  variant: string;
  fieldValuesPath: string;
  writableFields: string[];
  completionCommand?: string;
  completionSupported?: boolean;
  completionRequiredMetadata?: string[];
  completionMode?: string;
  completionAutomaticConfirmation?: boolean;
  completionBlockReason?: string;
}

interface PreparedStoryWorkbenchWrite {
  input: StoryWorkbenchInput;
  context: WorkflowContext;
  saveContract: SaveContract;
  arguments: Record<string, unknown>;
  operationContext: { id: string; version: string };
  operationCommand: string;
}

export interface StoryWorkbenchScenarioPlan {
  scenario: "story-workbench";
  phase: "plan";
  contractVersion: typeof storyWorkbenchContractVersion;
  resourceId: number;
  nodeId: number;
  version: number;
  componentKey?: string;
  variant: StoryWorkbenchInput["variant"];
  patch: Record<string, unknown>;
  complete?: boolean;
  ownerId?: number;
  startDate?: string;
  endDate?: string;
  saveContract: SaveContract;
  preview: OperationPreview;
  userFacing?: ReturnType<typeof buildUserFacingDisplay>;
}

export async function planStoryWorkbenchScenario(
  client: StoryWorkbenchScenarioClient,
  input: StoryWorkbenchInput,
): Promise<StoryWorkbenchScenarioPlan> {
  const prepared = await prepare(client, input);
  const preview = await operationPreview(client, prepared.operationCommand, {
    arguments: prepared.arguments,
    context: prepared.operationContext,
    requestId: prepared.input.requestId,
  });
  return {
    scenario: "story-workbench",
    phase: "plan",
    contractVersion: storyWorkbenchContractVersion,
    resourceId: prepared.input.resourceId,
    nodeId: prepared.input.nodeId,
    version: prepared.input.version,
    componentKey: prepared.saveContract.componentKey,
    variant: prepared.input.variant,
    patch: prepared.input.patch,
    complete: prepared.input.complete,
    ownerId: prepared.input.ownerId,
    startDate: prepared.input.startDate,
    endDate: prepared.input.endDate,
    saveContract: prepared.saveContract,
    preview,
    userFacing: buildUserFacingDisplay({
      resourceType: "story",
      context: prepared.context,
      resourceDetails: prepared.context.resourceDetails,
      operationStatus: "PREVIEWED",
      actualChange: "已生成待执行预览",
    }),
  };
}

export async function executeStoryWorkbenchScenario(
  client: StoryWorkbenchScenarioClient,
  input: StoryWorkbenchInput,
): Promise<StoryWorkbenchResult> {
  const prepared = await prepare(client, input);
  const preview = input.previewOperationId ? undefined : await previewForWrite(client, prepared);
  return executeAfterPreview(client, prepared, preview, input.previewOperationId);
}

export async function runStoryWorkbenchScenario(
  client: StoryWorkbenchScenarioClient,
  input: StoryWorkbenchInput,
  approve: () => Promise<boolean>,
): Promise<StoryWorkbenchResult> {
  const parsed = storyWorkbenchInputSchema.parse(input);
  const prepared = await prepare(client, parsed);
  if (!parsed.save) {
    return baseResult(parsed, "DRAFT");
  }

  const preview = await previewForWrite(client, prepared);
  if (!preview) return executeAfterPreview(client, prepared, undefined, parsed.previewOperationId);
  if (!(await approve())) {
    return {
      ...baseResult(parsed, "REJECTED"),
      operationId: preview.operationId,
      preview,
      warnings: preview.warnings,
    };
  }
  return executeAfterPreview(client, prepared, preview, parsed.previewOperationId);
}

async function prepare(
  client: StoryWorkbenchScenarioClient,
  input: StoryWorkbenchInput,
): Promise<PreparedStoryWorkbenchWrite> {
  const parsed = storyWorkbenchInputSchema.parse(input);
  const context = await client.context(
    { type: "story", id: parsed.resourceId },
    {
      nodeId: parsed.nodeId,
      view: "focused",
      component: parsed.componentKey ?? "story-node-workbench",
    },
  );
  const allowIdempotentReplay = parsed.save && Boolean(parsed.idempotencyKey);
  if (context.version !== parsed.version && !allowIdempotentReplay) {
    throw new Error(`故事上下文版本 ${context.version ?? "无"} 与请求版本 ${parsed.version} 不一致`);
  }
  const saveContract = readSaveContract(context, parsed.nodeId, parsed.componentKey);
  validateSaveContract(saveContract, parsed, allowIdempotentReplay);
  const unknownField = Object.keys(parsed.patch).find(
    (key) => !saveContract.writableFields.includes(key),
  );
  if (unknownField) {
    throw new Error(`草稿字段 ${unknownField} 不在 saveContract.writableFields 中`);
  }
  const argumentsValue: Record<string, unknown> = {
    itemType: saveContract.itemType,
    itemId: saveContract.itemId,
    nodeId: saveContract.nodeId,
    version: parsed.version,
    fieldValues: fieldValuesAtPath(saveContract.fieldValuesPath, parsed.patch),
  };
  const complete = parsed.complete === true;
  if (complete) {
    if (!saveContract.completionSupported || !saveContract.completionCommand) {
      throw new Error("当前故事节点没有可用的完成命令");
    }
    if (parsed.ownerId !== undefined) argumentsValue.ownerId = parsed.ownerId;
    if (parsed.startDate !== undefined) argumentsValue.startDate = parsed.startDate;
    if (parsed.endDate !== undefined) argumentsValue.endDate = parsed.endDate;
  }
  return {
    input: parsed,
    context,
    saveContract,
    arguments: argumentsValue,
    operationCommand: complete ? saveContract.completionCommand! : saveContract.command,
    operationContext: {
      id: `story:${parsed.resourceId}`,
      version: String(parsed.version),
    },
  };
}

function readSaveContract(
  context: WorkflowContext,
  nodeId: number,
  componentKey?: string,
): SaveContract {
  const nodes = Array.isArray(context.workflow?.nodes) ? context.workflow.nodes : [];
  const node = nodes.find((candidate) => isRecord(candidate) && candidate.id === nodeId);
  if (!isRecord(node)) throw new Error(`故事上下文中不存在节点 ${nodeId}`);
  let component: Record<string, any> | undefined;
  try {
    component = resolveWorkflowComponent(node as any, {
      componentKey: componentKey ?? "story-node-workbench",
      mode: "write",
    }).component as Record<string, any> | undefined;
  } catch (error) {
    if (error instanceof ComponentResolutionError) {
      throw new ResourceScenarioError("CAPABILITY_UNAVAILABLE", error.message);
    }
    throw error;
  }
  if (!isRecord(component) || !isRecord(component.saveContract)) {
    throw new Error("所选故事节点没有可写的 story-node-workbench saveContract");
  }
  const raw = component.saveContract;
  const writableFields = raw.writableFields;
  if (!Array.isArray(writableFields) || !writableFields.every((field) => typeof field === "string")) {
    throw new Error("saveContract.writableFields 无效");
  }
  if (!isPositiveInteger(raw.itemId) || !isPositiveInteger(raw.nodeId)
    || !isNonNegativeInteger(raw.version)
    || typeof raw.command !== "string" || typeof raw.itemType !== "string"
    || typeof raw.componentKey !== "string" || typeof raw.variant !== "string"
    || typeof raw.fieldValuesPath !== "string") {
    throw new Error("story-node-workbench saveContract 不完整");
  }
  return {
    command: raw.command,
    itemType: raw.itemType,
    itemId: raw.itemId,
    nodeId: raw.nodeId,
    version: raw.version,
    componentKey: raw.componentKey,
    variant: raw.variant,
    fieldValuesPath: raw.fieldValuesPath,
    writableFields,
    ...(typeof raw.completionCommand === "string" ? { completionCommand: raw.completionCommand } : {}),
    ...(typeof raw.completionSupported === "boolean"
      ? { completionSupported: raw.completionSupported } : {}),
    ...(Array.isArray(raw.completionRequiredMetadata)
      && raw.completionRequiredMetadata.every((field) => typeof field === "string")
      ? { completionRequiredMetadata: raw.completionRequiredMetadata } : {}),
    ...(typeof raw.completionMode === "string" ? { completionMode: raw.completionMode } : {}),
    ...(typeof raw.completionAutomaticConfirmation === "boolean"
      ? { completionAutomaticConfirmation: raw.completionAutomaticConfirmation } : {}),
    ...(typeof raw.completionBlockReason === "string" ? { completionBlockReason: raw.completionBlockReason } : {}),
  };
}

function validateSaveContract(
  contract: SaveContract,
  input: StoryWorkbenchInput,
  allowIdempotentReplay: boolean,
): void {
  if (contract.command !== "development-item.node.field.update") {
    throw new Error(`saveContract command 不支持: ${contract.command}`);
  }
  if (contract.itemType !== "STORY" || contract.itemId !== input.resourceId) {
    throw new Error("saveContract 的故事标识与请求不一致");
  }
  if (contract.nodeId !== input.nodeId || (!allowIdempotentReplay && contract.version !== input.version)) {
    throw new Error("saveContract 的节点或版本与请求不一致");
  }
  if (input.componentKey !== undefined && contract.componentKey !== input.componentKey) {
    throw new Error(`saveContract componentKey ${contract.componentKey} 与请求 ${input.componentKey} 不一致`);
  }
  if (contract.fieldValuesPath.trim() === "") {
    throw new Error("saveContract 的组件路径不受支持");
  }
  if (contract.variant !== input.variant) {
    throw new Error(`saveContract variant ${contract.variant} 与请求 ${input.variant} 不一致`);
  }
  if (input.complete === true && (!contract.completionSupported || !contract.completionCommand)) {
    throw new Error("saveContract 未声明故事节点完成能力");
  }
}

async function executeAfterPreview(
  client: StoryWorkbenchScenarioClient,
  prepared: PreparedStoryWorkbenchWrite,
  preview: OperationPreview | undefined,
  previewOperationId?: string,
): Promise<StoryWorkbenchResult> {
  let operation: OperationResult;
  try {
    const operationId = preview?.operationId ?? previewOperationId;
    if (!operationId) throw new Error("执行写入前必须先取得操作预览");
    operation = await operationExecutePreview(client, operationId, prepared.input.idempotencyKey!);
  } catch (error) {
    if (!isConflict(error)) throw error;
    return {
      ...baseResult(prepared.input, "CONFLICT"),
      ...(preview ? { preview } : {}),
      warnings: [error.message],
    };
  }
  if (operation.status !== "SUCCEEDED") {
    return {
      ...baseResult(prepared.input, operation.status === "CONFLICT" ? "CONFLICT" : "REJECTED"),
      operationId: operation.operationId,
      operation: {
        ...operation,
        previewOperationId: preview?.operationId ?? prepared.input.previewOperationId,
      },
      complete: prepared.input.complete,
      ...(preview ? { preview } : {}),
      warnings: operation.warnings,
    };
  }

  const warnings = [...operation.warnings];
  try {
    const resource = await client.get({ type: "story", id: prepared.input.resourceId });
    const context = await client.context(
      { type: "story", id: prepared.input.resourceId },
      {
        nodeId: prepared.input.nodeId,
        view: "focused",
        component: prepared.saveContract.componentKey,
      },
    );
    const builtVerification = buildVerificationResult({
      resourceType: "story",
      resourceId: prepared.input.resourceId,
      nodeId: prepared.input.nodeId,
      componentKey: prepared.saveContract.componentKey,
      expectedPatch: prepared.input.patch,
      protectedFields: ["status"],
    }, { resource: null, context: prepared.context }, { resource, context }, operation);
    const verification = publicVerification(builtVerification);
    if (!verification.patchApplied || !verification.protectedFieldsUnchanged) {
      warnings.push("故事节点回读结果未完全匹配预期，写入结果需要人工核验");
    }
    const resultStatus = verification.patchApplied && verification.protectedFieldsUnchanged
      ? "SUCCEEDED" as const
      : "WRITE_RESULT_UNKNOWN" as const;
    const resultOperation = resultStatus === "SUCCEEDED"
      ? operation
      : { ...operation, status: "WRITE_RESULT_UNKNOWN" as const };
    return {
      ...baseResult(prepared.input, resultStatus),
      operationId: operation.operationId,
      operation: {
        ...resultOperation,
        previewOperationId: preview?.operationId ?? prepared.input.previewOperationId,
      },
      ...(preview ? { preview } : {}),
      readback: { resource, context },
      currentNode: context.currentNode ?? null,
      verification,
      userFacing: buildUserFacingDisplay({
        resourceType: "story",
        context,
        resourceDetails: resource.details,
        operationStatus: resultStatus,
        actualChange: resultStatus === "SUCCEEDED"
          ? "写入已完成并通过回读验证"
          : "写入结果无法完全确认，需要回读核验",
        blockers: warnings,
      }),
      warnings,
    };
  } catch (error) {
    warnings.push("故事节点已执行，但结果回读失败：" + (error instanceof Error ? error.message : String(error)));
    return {
      ...baseResult(prepared.input, "WRITE_RESULT_UNKNOWN"),
      operationId: operation.operationId,
      operation: {
        ...operation,
        status: "WRITE_RESULT_UNKNOWN" as const,
        previewOperationId: preview?.operationId ?? prepared.input.previewOperationId,
      },
      ...(preview ? { preview } : {}),
      readback: { resource: null, context: null },
      currentNode: null,
      verification: {
        resourceReadback: false,
        contextReadback: false,
        patchApplied: false,
        protectedFieldsUnchanged: false,
      },
      warnings,
    };
  }
}

async function previewForWrite(
  client: StoryWorkbenchScenarioClient,
  prepared: PreparedStoryWorkbenchWrite,
): Promise<OperationPreview | undefined> {
  try {
    return await operationPreview(client, prepared.operationCommand, {
      arguments: prepared.arguments,
      context: prepared.operationContext,
      requestId: prepared.input.requestId,
    });
  } catch (error) {
    // A conflict during preview can mean that the caller is replaying an
    // already completed write with the same explicit idempotency key. Let the
    // execute endpoint resolve that key; all other conflicts remain errors.
    if (prepared.input.previewOperationId && isConflict(error)) return undefined;
    throw error;
  }
}

function isConflict(error: unknown): error is PmsClientError {
  return error instanceof PmsClientError && error.kind === "conflict";
}

function baseResult(input: StoryWorkbenchInput, status: StoryWorkbenchResult["status"]): StoryWorkbenchResult {
  return {
    contractVersion: storyWorkbenchContractVersion,
    status,
    resourceId: input.resourceId,
    nodeId: input.nodeId,
    version: input.version,
    ...(input.componentKey === undefined ? {} : { componentKey: input.componentKey }),
    variant: input.variant,
    patch: input.patch,
    ...(input.complete === undefined ? {} : { complete: input.complete }),
    warnings: [],
  };
}

function fieldValuesAtPath(path: string, patch: Record<string, unknown>): Record<string, unknown> {
  const segments = path.split(".").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) throw new Error("saveContract.fieldValuesPath 不能为空");
  let result: Record<string, unknown> = patch;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    result = { [segments[index]!]: result };
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
