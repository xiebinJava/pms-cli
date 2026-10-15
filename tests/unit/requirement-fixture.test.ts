import { describe, expect, it } from "vitest";
import {
  createRequirementFixture,
  fixtureScheduleDates,
  fixtureTitle,
} from "../../tests/e2e/support/requirementFixture.js";

const catalog = {
  version: "ai-v1",
  viewer: { id: 1, displayName: "E2E Admin" },
  features: { resourceGet: true, richWorkflowContext: true },
  resources: [{
    type: "requirement",
    actions: [{
      name: "requirement.create",
      label: "创建需求",
      description: "创建需求并初始化需求流程",
      mode: "automatic",
      risk: "high",
      scopes: ["pms:requirement:write"],
      inputSchema: {
        title: { type: "string", required: true },
        description: { type: "string" },
        priority: { type: "integer" },
        templateVersionId: { type: "integer" },
      },
      requiresContext: false,
      refreshScopes: ["requirement-list", "requirement-detail"],
    }],
  }, {
    type: "requirement",
    actions: [{
      name: "development-item.node.schedule.update",
      label: "更新研发事项流程节点排期",
      description: "更新节点排期",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:workflow:write"],
      inputSchema: {
        itemType: { type: "string", required: true },
        itemId: { type: "integer", required: true },
        nodeId: { type: "integer", required: true },
        startDate: { type: "string" },
        endDate: { type: "string" },
        version: { type: "integer", required: true },
      },
      requiresContext: true,
      refreshScopes: ["development-detail"],
    }, {
      name: "development-item.node.owner.update",
      label: "更新研发事项流程节点负责人",
      description: "更新节点负责人",
      mode: "automatic",
      risk: "high",
      scopes: ["pms:workflow:write"],
      inputSchema: {
        itemType: { type: "string", required: true },
        itemId: { type: "integer", required: true },
        nodeId: { type: "integer", required: true },
        ownerId: { type: "integer" },
        version: { type: "integer", required: true },
      },
      requiresContext: true,
      refreshScopes: ["development-detail"],
    }, {
      name: "development-item.node.field.update",
      label: "更新研发事项节点动态字段",
      description: "更新节点字段",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:workflow:write"],
      inputSchema: {
        itemType: { type: "string", required: true },
        itemId: { type: "integer", required: true },
        nodeId: { type: "integer", required: true },
        version: { type: "integer", required: true },
        fieldValues: { type: "object", required: true },
      },
      requiresContext: true,
      refreshScopes: ["development-detail"],
    }, {
      name: "development-item.node.complete",
      label: "完成研发事项流程节点",
      description: "完成节点",
      mode: "automatic",
      risk: "high",
      scopes: ["pms:workflow:write"],
      inputSchema: {
        itemType: { type: "string", required: true },
        itemId: { type: "integer", required: true },
        nodeId: { type: "integer", required: true },
      },
      requiresContext: true,
      refreshScopes: ["development-detail"],
    }],
  }],
  scopes: ["pms:requirement:write"],
  workflowTypes: [{
    processType: "requirement-management",
    label: "需求管理",
    templates: [{
      templateVersionId: 17,
      versionNo: 1,
      name: "需求接收模板",
      defaultTemplate: true,
      nodes: [{
        key: "receiving",
        label: "需求接收",
        position: 0,
        components: [{
          key: "requirement-receiving-analysis",
          label: "需求接收与分析",
          fields: [],
          actions: ["requirement.analysis.save"],
        }],
      }],
    }],
  }],
};

function clientFor(resultData: Record<string, unknown>, context: Record<string, unknown>) {
  const calls: Array<{ method: string; value: unknown }> = [];
  return {
    client: {
      capabilities: async () => catalog,
      preview: async (request: unknown) => {
        calls.push({ method: "preview", value: request });
        return {
          operationId: "preview-1",
          command: "requirement.create",
          expiresAt: "2026-10-15T04:00:00Z",
          contextVersion: "v1",
          warnings: [],
          changes: [],
          refreshScopes: [],
        };
      },
      execute: async (request: unknown) => {
        calls.push({ method: "execute", value: request });
        return { operationId: "create-1", status: "SUCCEEDED", data: resultData, warnings: [], refreshScopes: [] };
      },
      get: async () => ({
        resourceType: "requirement",
        resourceId: 42,
        entityVersion: 0,
        details: { title: "fixture" },
      }),
      context: async () => context,
    } as never,
    calls,
  };
}

describe("requirement fixture", () => {
  it("uses a deterministic run-scoped title", () => {
    expect(fixtureTitle("run-20261015")).toBe("AI-E2E-需求-run-20261015");
    expect(fixtureTitle("run-20261015")).toBe(fixtureTitle("run-20261015"));
  });

  it("generates schedule dates relative to the test run date", () => {
    expect(fixtureScheduleDates(new Date("2026-10-15T12:00:00Z"))).toEqual({
      startDate: "2026-10-15",
      endDate: "2026-10-16",
    });
  });

  it("rejects a successful create response without a requirement id", async () => {
    const { client } = clientFor({}, {
      resource: { type: "requirement", id: 42 },
      version: 0,
      currentNode: { id: 375, key: "stage-1", label: "需求录入" },
      allowedActions: [],
    });

    await expect(createRequirementFixture(client, "run-missing-id"))
      .rejects.toThrow(/需求 ID/);
  });

  it("rejects a created requirement without a readable current node or version", async () => {
    const { client } = clientFor({ requirement: { id: 42 } }, {
      resource: { type: "requirement", id: 42 },
      version: null,
      allowedActions: [],
    });

    await expect(createRequirementFixture(client, "run-missing-context"))
      .rejects.toThrow(/当前节点或版本/);
  });

  it("creates a run-scoped requirement and discovers its actual node and version", async () => {
    const { client, calls } = clientFor({ requirement: { id: 42 } }, {
      resource: { type: "requirement", id: 42 },
      version: 3,
      currentNode: { id: 375, key: "stage-1", label: "需求录入" },
      allowedActions: ["requirement.analysis.save"],
    });

    await expect(createRequirementFixture(client, "run-valid"))
      .resolves.toEqual({
        requirementId: 42,
        nodeId: 375,
        version: 3,
        title: "AI-E2E-需求-run-valid",
      });
    expect(calls[0]).toMatchObject({ method: "preview", value: {
      operation: "requirement.create",
      arguments: { title: "AI-E2E-需求-run-valid", templateVersionId: 17 },
    }});
    expect(calls[1]).toMatchObject({ method: "execute", value: {
      operation: "requirement.create",
      arguments: { title: "AI-E2E-需求-run-valid", templateVersionId: 17 },
      idempotencyKey: "requirement-create-run-valid",
    }});
  });
});
