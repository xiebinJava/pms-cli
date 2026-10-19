import { describe, expect, it, vi } from "vitest";
import { createProjectFixture } from "../../tests/e2e/support/projectFixture.js";
import { createTopicFixture } from "../../tests/e2e/support/topicFixture.js";

function client() {
  const preview = vi.fn(async (request: { operation: string }) => ({
    operationId: `preview-${request.operation}`,
    command: request.operation,
    expiresAt: "2099-01-01T00:00:00Z",
    contextVersion: "v1",
    warnings: [],
    changes: [],
    refreshScopes: [],
    preconditions: [],
  }));
  const executePreview = vi.fn(async (operationId: string) => ({
    operationId: `operation-${operationId}`,
    status: "SUCCEEDED" as const,
    data: operationId.includes("project.create")
      ? { project: { id: 42 } }
      : { topicId: 19 },
    warnings: [],
    refreshScopes: [],
  }));
  return {
    capabilities: vi.fn(async () => ({
      viewer: { id: 7 },
      workflowTypes: [{
        projectTypeId: 3,
        templates: [{ templateVersionId: 8, defaultTemplate: true }],
      }],
      resources: [{ type: "project", actions: [{
        name: "project.create",
        label: "创建项目",
        description: "创建项目",
        mode: "automatic",
        risk: "medium",
        scopes: [],
        inputSchema: { name: { type: "string", required: true } },
        requiresContext: false,
        refreshScopes: [],
      }] }, {
        type: "topic",
        actions: [{
          name: "topic.create",
          label: "创建专题",
          description: "创建专题",
          mode: "automatic",
          risk: "medium",
          scopes: [],
          inputSchema: { title: { type: "string", required: true } },
          requiresContext: false,
          refreshScopes: [],
        }] },
      ],
      scopes: [],
    })),
    preview,
    executePreview,
    get: vi.fn(async ({ type, id }: { type: string; id: number }) => ({
      resourceType: type,
      resourceId: id,
      entityVersion: 1,
      details: {},
    })),
    context: vi.fn(async ({ type, id }: { type: string; id: number }, options?: { nodeId?: number }) => ({
      resource: { type, id },
      version: 4,
      entityVersion: type === "project" ? 1 : null,
      currentNode: { id: options?.nodeId ?? 301, key: "intake", label: "录入" },
      workflow: {
        nodes: [{
          id: options?.nodeId ?? 301,
          key: "intake",
          label: "录入",
          version: 2,
          components: [{
            key: type === "project" ? "project-intake" : "topic-intake",
            label: "录入信息",
            content: { summary: "旧值" },
            saveContract: {
              command: type === "project" ? "node.field.update" : "development-item.node.field.update",
              projectId: type === "project" ? id : undefined,
              itemType: type === "topic" ? "TOPIC" : undefined,
              itemId: type === "topic" ? id : undefined,
              nodeId: options?.nodeId ?? 301,
              version: 2,
              workbench: type === "project" ? "project-intake" : undefined,
              componentKey: type === "topic" ? "topic-intake" : undefined,
              fieldValuesPath: type === "topic" ? "__components.topic-intake" : "fields",
              writableFields: ["summary"],
              protectedFields: ["status"],
              completionSupported: true,
              completionCommand: type === "project" ? "node.complete-with-data" : "development-item.node.complete-with-data",
              completionRequiredMetadata: ["ownerId", "startDate", "endDate"],
              completionMode: "AUTO_CONFIRM",
              fieldContracts: [{ key: "summary", type: "string" }],
            },
          }],
        }],
      },
      relations: [],
      allowedActions: [],
      meta: {
        formatVersion: 2,
        pureRead: true,
        loadedAt: "2026-10-16T00:00:00Z",
        businessTimezone: "Asia/Shanghai",
        view: options ? "focused" : "legacy",
        fieldValuesScope: options ? "selected-node" : "all-nodes",
        componentContentScope: options ? "selected-component" : "selected-node",
        workflowConfigured: true,
        workflowStatus: "ACTIVE",
        permissionsScope: "business-user",
        referencesScope: "readable-only",
        warnings: [],
      },
    })),
  } as any;
}

describe("isolated resource fixtures", () => {
  it("creates a project through the registered preview and execute commands", async () => {
    const pms = client();
    const fixture = await createProjectFixture(pms, "run-project");

    expect(fixture).toMatchObject({
      projectId: 42,
      name: "AI-E2E-项目-run-project",
      created: true,
      node: {
        nodeId: 301,
        componentKey: "project-intake",
        fieldKey: "summary",
        contextVersion: 1,
        completionSupported: true,
        completionMode: "AUTO_CONFIRM",
      },
    });
    expect(pms.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "project.create",
      arguments: {
        name: "AI-E2E-项目-run-project",
        projectTypeId: 3,
        workflowTemplateVersionId: 8,
      },
    }));
    expect(pms.executePreview).toHaveBeenCalledWith("preview-project.create", "project-fixture-run-project");
  });

  it("creates a standalone topic with the approved viewer as owner", async () => {
    const pms = client();
    const fixture = await createTopicFixture(pms, "run-topic");

    expect(fixture).toMatchObject({
      topicId: 19,
      title: "AI-E2E-专题-run-topic",
      created: true,
      node: {
        nodeId: 301,
        componentKey: "topic-intake",
        fieldKey: "summary",
        contextVersion: 4,
        completionSupported: true,
        completionMode: "AUTO_CONFIRM",
      },
    });
    expect(pms.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "topic.create",
      arguments: { title: "AI-E2E-专题-run-topic", ownerId: 7 },
    }));
    expect(pms.executePreview).toHaveBeenCalledWith("preview-topic.create", "topic-fixture-run-topic");
  });
});
