import { describe, expect, it } from "vitest";
import {
  agentDraftSchema,
  agentTaskSchema,
  contextSnapshotSchema,
  nodeContractSchema,
} from "../../packages/pms-contracts/src/index.js";

const snapshot = {
  snapshotId: "snapshot-34-390-v1",
  resource: { type: "story", id: 34 },
  contextVersion: "1",
  capturedAt: "2026-10-15T12:00:00.000Z",
  currentNode: { id: 390, key: "writing", label: "故事写卡" },
  workflowNodes: [],
  relations: [],
  allowedActions: ["development-item.node.field.update"],
  sourceRefs: ["story:34", "story:34/node:390"],
  warnings: [],
};

const nodeContract = {
  nodeId: 390,
  key: "writing",
  label: "故事写卡",
  version: 1,
  requiredFields: [
    { key: "descriptionAndAcceptance", label: "描述与验收", type: "TEXT", required: true },
  ],
  writableFields: ["descriptionAndAcceptance"],
  protectedFields: ["title", "status", "ownerId"],
  allowedActions: ["development-item.node.field.update"],
  allowedTransitions: [],
  missingInputRules: ["缺少验收标准时先询问用户"],
  writeCapable: true,
};

describe("External Agent Contract v1", () => {
  it("accepts the shared context, node and task shapes", () => {
    expect(contextSnapshotSchema.parse(snapshot)).toMatchObject(snapshot);
    expect(nodeContractSchema.parse(nodeContract)).toMatchObject(nodeContract);
    expect(agentTaskSchema.parse({
      taskId: "task-child-1",
      parentTaskId: "task-root-1",
      role: "acceptance-reviewer",
      objective: "检查验收标准是否完整",
      resource: snapshot.resource,
      contextSnapshotId: snapshot.snapshotId,
      permissionMode: "read-only",
    })).toMatchObject({ permissionMode: "read-only" });
  });

  it("requires the complete structured draft shape", () => {
    const draft = agentDraftSchema.parse({
      facts: [{ text: "故事当前在写卡节点", sourceRefs: ["story:34/node:390"] }],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      proposedFieldValues: { descriptionAndAcceptance: "完成验收标准" },
      missingFields: [],
      questions: [],
      evidenceRefs: ["story:34/node:390"],
      confidence: "high",
    });
    expect(draft.proposedFieldValues).toEqual({ descriptionAndAcceptance: "完成验收标准" });
  });

  it("rejects a write-capable node without writable fields", () => {
    expect(() => nodeContractSchema.parse({
      ...nodeContract,
      writableFields: [],
    })).toThrow(/writableFields/);
  });

  it("allows a read-only node without writable fields", () => {
    expect(nodeContractSchema.parse({
      ...nodeContract,
      allowedActions: [],
      writableFields: [],
      writeCapable: false,
    })).toMatchObject({ writeCapable: false, writableFields: [] });
  });
});
