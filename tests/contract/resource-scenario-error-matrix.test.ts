import { describe, expect, it, vi } from "vitest";
import { PmsClientError } from "../../packages/pms-client/src/index.js";
import { resourceScenarioContractVersion } from "../../packages/pms-contracts/src/index.js";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

const resourceTypes = ["requirement", "topic", "project"] as const;

function deps(client: never = {} as never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const dependencies: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({})),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "scenario-error-1"),
  };
  return { dependencies, stdout, stderr };
}

function errorFrom(stderr: string[]): Record<string, any> {
  return JSON.parse(stderr[0] ?? "{}").error;
}

function capabilityClient(resourceType: string, operation: string, context: unknown) {
  const allArguments = [
    "requirementId", "requirementVersion", "version", "topicId", "projectId",
    "name", "title", "ownerId", "fields", "workbench",
  ];
  const inputSchema = Object.fromEntries(allArguments.map((key) => [key, {
    type: key === "fields" ? "object" : key === "name" || key === "title" || key === "workbench" ? "string" : "integer",
    label: key,
    required: false,
  }]));
  return {
    capabilities: vi.fn(async () => ({
      version: "ai-v1",
      resources: [{
        type: resourceType,
        actions: [{
          name: operation,
          label: operation,
          description: operation,
          mode: "automatic",
          risk: "high",
          scopes: [],
          inputSchema,
          requiresContext: true,
          refreshScopes: [],
        }],
      }],
      scopes: [],
      workflowTypes: [],
    })),
    context: vi.fn(async () => context),
  } as never;
}

describe("resource scenario CLI error matrix", () => {
  it.each(resourceTypes)("uses RESOURCE_NOT_FOUND for missing %s context resource", async (resourceType) => {
    const { dependencies, stderr } = deps();
    const operation = resourceType === "requirement" ? "requirement.update"
      : resourceType === "topic" ? "topic.update" : "project.update";

    await runCli([
      "scenario", "resource", "plan", resourceType, operation,
      "--arguments-json", "{}",
    ], dependencies);

    expect(errorFrom(stderr)).toMatchObject({
      code: "RESOURCE_NOT_FOUND",
      requestId: "scenario-error-1",
    });
  });

  it.each(resourceTypes)("uses CAPABILITY_UNAVAILABLE for an unsupported %s operation", async (resourceType) => {
    const { dependencies, stderr } = deps();

    await runCli([
      "scenario", "resource", "plan", resourceType, "unsupported.operation",
      "--arguments-json", "{}",
    ], dependencies);

    expect(errorFrom(stderr)).toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      requestId: "scenario-error-1",
    });
  });

  it.each(resourceTypes)("uses CONTEXT_CONFLICT for a stale %s context", async (resourceType) => {
    const operation = resourceType === "requirement" ? "requirement.update"
      : resourceType === "topic" ? "topic.update" : "project.update";
    const client = capabilityClient(resourceType, operation, {
      resource: { type: "wrong", id: 999 },
      version: 1,
      entityVersion: 1,
      allowedActions: [],
    });
    const { dependencies, stderr } = deps(client);

    await runCli([
      "scenario", "resource", "plan", resourceType, operation, "1",
      "--arguments-json", "{}",
    ], dependencies);

    expect(errorFrom(stderr)).toMatchObject({
      code: "CONTEXT_CONFLICT",
      requestId: "scenario-error-1",
    });
  });

  it("keeps forbidden errors and request identity in the same envelope", async () => {
    const { dependencies, stderr } = deps();
    dependencies.createRuntime = vi.fn(async () => {
      throw new PmsClientError("forbidden", "无权访问", { status: 403, requestId: "server-forbidden-1" });
    });

    await runCli([
      "scenario", "resource", "plan", "project", "project.update", "1",
      "--arguments-json", "{}",
    ], dependencies);

    expect(errorFrom(stderr)).toMatchObject({ code: "FORBIDDEN", requestId: "server-forbidden-1" });
  });

  it.each([
    ["preview", "PREVIEW_REQUIRED", ["--idempotency-key", "idem-1"]],
    ["idempotency", "IDEMPOTENCY_REQUIRED", ["--preview-operation-id", "preview-1"]],
  ] as const)("returns %s-specific error before creating a runtime", async (_name, code, options) => {
    const { dependencies, stderr } = deps();
    await runCli([
      "scenario", "resource", "execute", "project", "project.update", "1", ...options,
    ], dependencies);

    expect(errorFrom(stderr)).toMatchObject({ code, requestId: "scenario-error-1" });
    expect(dependencies.createRuntime).not.toHaveBeenCalled();
  });

  it("keeps plan and execute envelopes distinct", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{ type: "project", actions: [{
          name: "project.create", label: "创建项目", description: "创建项目", mode: "automatic", risk: "high",
          scopes: [], inputSchema: { name: { type: "string", label: "名称", required: true } },
          requiresContext: false, refreshScopes: ["project-list"],
        }] }],
        scopes: [], workflowTypes: [],
      })),
      preview: vi.fn(async () => ({
        operationId: "preview-project-1", command: "project.create", expiresAt: "2099-01-01T00:00:00Z",
        contextVersion: "v1", warnings: [], changes: [], refreshScopes: ["project-list"], preconditions: [],
      })),
      executePreview: vi.fn(async () => ({
        operationId: "operation-project-1", status: "SUCCEEDED" as const,
        data: { projectId: 42 }, warnings: [], refreshScopes: ["project-list"],
      })),
      get: vi.fn(async () => ({ resourceType: "project", resourceId: 42, entityVersion: 1, details: { id: 42 } })),
      context: vi.fn(async () => ({ resource: { type: "project", id: 42 }, version: 1, allowedActions: [] })),
    } as never;

    const planned = deps(client);
    await runCli([
      "scenario", "resource", "plan", "project", "project.create",
      "--arguments-json", JSON.stringify({ name: "PMS" }),
    ], planned.dependencies);
    const plan = JSON.parse(planned.stdout[0] ?? "{}").data;
    expect(plan).toMatchObject({ scenario: "resource-scenario", phase: "plan", contractVersion: resourceScenarioContractVersion });
    expect(plan.operation).toBe("project.create");
    expect(plan.operation.status).toBeUndefined();

    const executed = deps(client);
    await runCli([
      "scenario", "resource", "execute", "project", "project.create",
      "--preview-operation-id", "preview-project-1", "--idempotency-key", "project-create-1",
    ], executed.dependencies);
    const execute = JSON.parse(executed.stdout[0] ?? "{}").data;
    expect(execute).toMatchObject({
      scenario: "resource-scenario",
      phase: "execute",
      previewOperationId: "preview-project-1",
      verification: expect.any(Object),
      warnings: expect.any(Array),
      refreshScopes: expect.any(Array),
    });
  });

  it("returns WRITE_RESULT_UNKNOWN instead of retrying when execute readback fails", async () => {
    let reads = 0;
    const executePreview = vi.fn(async () => ({
      operationId: "operation-project-2", status: "SUCCEEDED" as const,
      data: { projectId: 42 }, warnings: [], refreshScopes: ["project-detail"],
    }));
    const client = {
      executePreview,
      get: vi.fn(async () => {
        reads += 1;
        if (reads > 1) throw new Error("detail timeout");
        return { resourceType: "project", resourceId: 42, entityVersion: 1, details: { id: 42 } };
      }),
      context: vi.fn(async () => ({ resource: { type: "project", id: 42 }, version: 1, allowedActions: [] })),
    } as never;
    const { dependencies, stdout } = deps(client);

    await runCli([
      "scenario", "resource", "execute", "project", "project.update", "42",
      "--preview-operation-id", "preview-project-2", "--idempotency-key", "project-update-2",
    ], dependencies);

    const result = JSON.parse(stdout[0] ?? "{}").data;
    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(result.warnings.join(" ")).toMatch(/回读失败/);
    expect(executePreview).toHaveBeenCalledTimes(1);
  });
});
