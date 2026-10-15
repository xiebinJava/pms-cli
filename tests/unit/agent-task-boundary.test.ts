import { describe, expect, it } from "vitest";
import {
  buildChildAgentTask,
  buildChildAgentTaskPayload,
  validateChildDraft,
} from "../../apps/pms-cli/src/commands/scenarios/AgentDraftContract.js";
import type {
  AgentDraft,
  ContextSnapshot,
} from "../../packages/pms-contracts/src/index.js";

function snapshot(): ContextSnapshot {
  return {
    snapshotId: "story:34@story:34:entity:5",
    resource: { type: "story", id: 34 },
    contextVersion: "story:34:entity:5",
    capturedAt: "2026-10-15T08:00:00Z",
    currentNode: { id: 701, key: "writing", label: "编写" },
    workflowNodes: [],
    relations: [{ resource: { type: "requirement", id: 42 }, label: "来源需求", readable: true }],
    allowedActions: ["development-item.node.field.update"],
    sourceRefs: ["story:34", "requirement:42"],
    warnings: [],
  };
}

function draft(evidenceRefs: string[]): AgentDraft {
  return {
    facts: [],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    proposedFieldValues: { summary: "草稿" },
    missingFields: [],
    questions: [],
    evidenceRefs,
    confidence: "medium",
  };
}

describe("child Agent boundary", () => {
  it("builds a read-only task from the snapshot and cannot be elevated by extra fields", () => {
    const task = buildChildAgentTask(Object.assign({
      parentTaskId: "parent-1",
      taskId: "child-1",
      role: "事实核验",
      objective: "整理当前节点事实",
      snapshot: snapshot(),
    }, {
      permissionMode: "write",
    }) as never);

    expect(task).toMatchObject({
      taskId: "child-1",
      parentTaskId: "parent-1",
      resource: { type: "story", id: 34 },
      contextSnapshotId: "story:34@story:34:entity:5",
      permissionMode: "read-only",
    });
    expect(task).not.toHaveProperty("accessToken");
    expect(task).not.toHaveProperty("authStorePath");
    expect(task).not.toHaveProperty("writeCallback");
  });

  it("rejects credential-shaped keys and executable callbacks instead of forwarding them", () => {
    expect(() => buildChildAgentTask(Object.assign({
      parentTaskId: "parent-1",
      taskId: "child-1",
      role: "事实核验",
      objective: "整理当前节点事实",
      snapshot: snapshot(),
    }, { apiKey: "secret" }) as never)).toThrow(/凭据|credential|apiKey/i);

    expect(() => buildChildAgentTask(Object.assign({
      parentTaskId: "parent-1",
      taskId: "child-1",
      role: "事实核验",
      objective: "整理当前节点事实",
      snapshot: snapshot(),
    }, { executeCallback: () => undefined }) as never)).toThrow(/回调|callback|executable/i);
  });

  it("allows evidence only from the parent snapshot source references", () => {
    expect(() => validateChildDraft(draft(["story:34", "requirement:42"]), snapshot())).not.toThrow();
    expect(() => validateChildDraft(draft(["project:999"]), snapshot())).toThrow(/证据|source|引用/);

    const unreadable = snapshot();
    unreadable.relations = [{
      resource: { type: "project", id: 999 },
      label: "不可读关联",
      readable: false,
    }];
    unreadable.sourceRefs = ["story:34", "project:999"];
    expect(() => validateChildDraft(draft(["project:999"]), unreadable)).toThrow(/证据|source|引用/);
  });

  it("rejects credential-shaped draft content", () => {
    const unsafe = draft(["story:34"]);
    unsafe.proposedFieldValues = { summary: "草稿", apiKey: "secret" };
    expect(() => validateChildDraft(unsafe, snapshot())).toThrow(/凭据|credential|apiKey/i);
  });

  it("hands a child only the immutable snapshot and read-only task", () => {
    const payload = buildChildAgentTaskPayload({
      parentTaskId: "parent-1",
      taskId: "child-1",
      role: "事实核验",
      objective: "整理当前节点事实",
      snapshot: snapshot(),
    });

    expect(Object.keys(payload).sort()).toEqual(["contextSnapshot", "task"]);
    expect(payload.task.permissionMode).toBe("read-only");
    expect(payload.contextSnapshot.snapshotId).toBe(payload.task.contextSnapshotId);
  });
});
