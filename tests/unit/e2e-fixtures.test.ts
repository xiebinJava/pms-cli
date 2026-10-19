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
  } as any;
}

describe("isolated resource fixtures", () => {
  it("creates a project through the registered preview and execute commands", async () => {
    const pms = client();
    const fixture = await createProjectFixture(pms, "run-project");

    expect(fixture).toEqual({ projectId: 42, name: "AI-E2E-项目-run-project", created: true });
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

    expect(fixture).toEqual({ topicId: 19, title: "AI-E2E-专题-run-topic", created: true });
    expect(pms.preview).toHaveBeenCalledWith(expect.objectContaining({
      operation: "topic.create",
      arguments: { title: "AI-E2E-专题-run-topic", ownerId: 7 },
    }));
    expect(pms.executePreview).toHaveBeenCalledWith("preview-topic.create", "topic-fixture-run-topic");
  });
});
