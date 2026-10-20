import { describe, expect, it } from "vitest";
import { buildUserFacingDisplay } from "../../apps/pms-cli/src/output/userFacing.js";

describe("user-facing resource display", () => {
  it("uses the project name and keeps the workflow label instead of exposing identifiers", () => {
    const display = buildUserFacingDisplay({
      resourceType: "project",
      context: {
        resource: { type: "project", id: 7 },
        resourceDetails: { name: "PMS 项目管理系统", status: "ACTIVE" },
        currentNode: { id: 10, key: "delivery", label: "交付中" },
        meta: { warnings: [] },
      },
      operationStatus: "SUCCEEDED",
      actualChange: "写入已完成并通过回读验证",
    });

    expect(display).toEqual({
      resourceType: "project",
      resourceName: "PMS 项目管理系统",
      resourceStatus: "ACTIVE",
      currentNode: "交付中",
      targetNode: "交付中",
      operationStatus: "SUCCEEDED",
      actualChange: "写入已完成并通过回读验证",
      fieldChanges: [],
      blockers: [],
    });
    expect(JSON.stringify(display)).not.toContain("7");
    expect(JSON.stringify(display)).not.toContain("10");
  });

  it("uses a story title and collects readable blockers", () => {
    const display = buildUserFacingDisplay({
      resourceType: "story",
      context: {
        resource: { type: "story", id: 34 },
        resourceDetails: { title: "项目管理标准", status: "IN_PROGRESS" },
        currentNode: { id: 387, key: "acceptance", label: "验收中" },
        meta: {
          warnings: [{ code: "MISSING_INPUT", message: "缺少测试报告" }],
        },
      },
      operationStatus: "NEEDS_INPUT",
    });

    expect(display.resourceName).toBe("项目管理标准");
    expect(display.currentNode).toBe("验收中");
    expect(display.blockers).toEqual(["缺少测试报告"]);
    expect(display.operationStatus).toBe("NEEDS_INPUT");
  });

  it("normalizes numeric project status from PMS context", () => {
    const display = buildUserFacingDisplay({
      resourceType: "project",
      context: {
        resource: { type: "project", id: 7 },
        resourceDetails: { name: "CLI 链路验证项目", status: 1 },
        meta: { workflowStatus: "IN_PROGRESS" },
      },
    });

    expect(display.resourceStatus).toBe("IN_PROGRESS");
  });

  it("does not guess a name when PMS did not return one", () => {
    const display = buildUserFacingDisplay({
      resourceType: "topic",
      context: { resource: { type: "topic", id: 19 }, resourceDetails: {} },
    });

    expect(display.resourceName).toBe("名称未返回");
    expect(JSON.stringify(display)).not.toContain("19");
  });

  it("projects the target node and named field changes without exposing identifier values", () => {
    const display = buildUserFacingDisplay({
      resourceType: "story",
      context: {
        resource: { type: "story", id: 34 },
        resourceDetails: { title: "项目管理标准", status: "IN_PROGRESS" },
        currentNode: { id: 387, key: "testing", label: "测试中" },
      },
      fieldChanges: [
        { key: "ownerId", label: "负责人", from: 11, to: 12 },
        { key: "testResult", label: "测试结果", from: "未测试", to: "通过" },
      ],
    });

    expect(display.targetNode).toBe("测试中");
    expect(display.fieldChanges).toEqual([
      { field: "负责人", from: "已设置", to: "已设置" },
      { field: "测试结果", from: "未测试", to: "通过" },
    ]);
    expect(JSON.stringify(display)).not.toContain("11");
    expect(JSON.stringify(display)).not.toContain("12");
  });
});
