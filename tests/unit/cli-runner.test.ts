import { describe, expect, it, vi } from "vitest";
import { PmsClientError } from "../../packages/pms-client/src/index.js";
import type { CliDependencies } from "../../apps/pms-cli/src/cli/runCli.js";
import { runCli } from "../../apps/pms-cli/src/cli/runCli.js";

function makeDeps(client: never = {} as never) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: CliDependencies = {
    createRuntime: vi.fn(async () => ({ client })),
    runAuth: vi.fn(async () => ({ authenticated: true })),
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value),
    setExitCode: vi.fn(),
    requestIdFactory: vi.fn(() => "req-1"),
    runDoctor: () => ({ ok: true }),
    runSetup: () => ({ ready: true }),
    installSkill: () => ({ installed: "test" }),
  };
  return { deps, stdout, stderr };
}

describe("CLI runner", () => {
  it("normalizes separated and inline filters before authentication", async () => {
    const requests: unknown[] = [];
    const client = { query: async (request: unknown) => { requests.push(request); return { items: [] }; } } as never;
    const inline = makeDeps(client);
    await runCli(["search", "topic", "--filter=status=ACTIVE", "--filter=projectId=7"], inline.deps);
    const separated = makeDeps(client);
    await runCli(["search", "topic", "--filter", "status=ACTIVE", "--filter", "projectId=7"], separated.deps);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ filters: { status: "ACTIVE", projectId: "7" } });
    expect(requests[1]).toMatchObject({ filters: { status: "ACTIVE", projectId: "7" } });
  });

  it("rejects invalid requests before creating an authenticated runtime", async () => {
    for (const args of [
      ["search", "topic", "--filter", "status=ACTIVE", "--filter", "status=DONE"],
      ["operation", "execute", "project.create", "--arguments-json", "{}"],
      ["project", "create", "--arguments-json", "{}"],
      ["scenario", "project-create", "execute", "--arguments-json", "{\"name\":\"x\"}"],
      ["get", "project", "9007199254740993"],
      ["operation", "preview", "project.create", "--arguments-json", "{bad"],
      ["operation", "preview", "project.create", "--context-id", "project:7"],
    ]) {
      const { deps, stderr } = makeDeps();
      await runCli(args, deps);
      expect(deps.createRuntime).not.toHaveBeenCalled();
      expect(stderr[0]).toContain('"ok":false');
    }
  });

  it("preserves PMS error classification and server request identity", async () => {
    const { deps, stderr } = makeDeps();
    deps.createRuntime = vi.fn(async () => {
      throw new PmsClientError("forbidden", "无权访问", { status: 403, requestId: "server-req-9" });
    });

    await runCli(["get", "project", "7"], deps);

    const output = JSON.parse(stderr[0] ?? "{}");
    expect(output.error.code).toBe("FORBIDDEN");
    expect(output.error.requestId).toBe("server-req-9");
    expect(output.meta.requestId).toBe("server-req-9");
    expect(deps.setExitCode).toHaveBeenCalledWith(1);
  });

  it("requests process exit after a runtime error", async () => {
    const { deps } = makeDeps();
    const exitProcess = vi.fn();
    (deps as CliDependencies & { exitProcess?: (code: number) => void }).exitProcess = exitProcess;
    deps.createRuntime = vi.fn(async () => {
      throw new Error("OS 凭据存储访问超时");
    });

    await runCli(["get", "project", "7"], deps);

    expect(exitProcess).toHaveBeenCalledWith(1);
  });

  it("does not emulate exact get when the server omits the capability", async () => {
    const get = vi.fn();
    const client = {
      capabilities: async () => ({ version: "ai-v1", resources: [], scopes: [], workflowTypes: [] }),
      get,
    } as never;
    const { deps, stderr } = makeDeps(client);

    await runCli(["get", "topic", "19"], deps);

    expect(get).not.toHaveBeenCalled();
    expect(stderr[0]).toContain("features.resourceGet");
  });

  it("does not authenticate for help or version", async () => {
    const help = makeDeps();
    await runCli(["--help"], help.deps);
    expect(help.deps.createRuntime).not.toHaveBeenCalled();
    expect(help.stdout[0]).toContain("pms get");

    const version = makeDeps();
    await runCli(["--version"], version.deps);
    expect(version.deps.createRuntime).not.toHaveBeenCalled();
    expect(version.stdout[0]).toBe("0.1.1\n");
  });

  it("runs the requirement-analysis shadow command with the fixed provider", async () => {
    const client = {
      context: vi.fn(async () => ({
        resource: { type: "requirement", id: 33 },
        version: 4,
        currentNode: { id: 701, key: "receiving", label: "需求接收" },
        workflow: { templateVersionId: 88, templateVersionNo: 1, nodes: [] },
        relations: [],
        allowedActions: ["requirement.analysis.save"],
      })),
      preview: vi.fn(),
      execute: vi.fn(),
    };
    const { deps, stdout } = makeDeps(client as never);

    await runCli([
      "scenario", "requirement-analysis", "shadow", "33",
      "--cases-file", "tests/fixtures/requirement-analysis-shadow-cases.json",
      "--provider", "mock",
    ], deps);

    const output = JSON.parse(stdout[0] ?? "{}");
    expect(output.data.mode).toBe("read-only");
    expect(output.data.summary).toEqual({ total: 12, generated: 12, failed: 0, validationFailed: 0 });
    expect(client.preview).not.toHaveBeenCalled();
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("rejects model providers because the CLI is model-agnostic", async () => {
    const client = {
      context: vi.fn(async () => ({
        resource: { type: "requirement", id: 33 },
        version: 4,
        currentNode: { id: 701, key: "receiving", label: "需求接收" },
        relations: [],
        allowedActions: ["requirement.analysis.save"],
      })),
    };
    const { deps, stderr } = makeDeps(client as never);
    await runCli([
      "scenario", "requirement-analysis", "shadow", "33",
      "--cases-file", "tests/fixtures/requirement-analysis-shadow-cases.json",
      "--provider", "openai",
    ], deps);

    const error = JSON.parse(stderr[0] ?? "{}");
    expect(error.error.code).toBe("CLI_USAGE");
    expect(error.error.message).toContain("模型由外部 Agent 提供");
  });

  it("routes project-create scenario plan without executing a write", async () => {
    const execute = vi.fn();
    const client = {
      capabilities: async () => ({
        version: "ai-v1",
        resources: [{
          type: "project",
          actions: [{
            name: "project.create",
            label: "创建项目",
            description: "创建项目",
            mode: "automatic",
            risk: "medium",
            scopes: ["pms:project:write"],
            inputSchema: { name: { type: "string", label: "项目名称", required: true } },
            requiresContext: false,
            refreshScopes: ["project-list"],
          }],
        }],
        scopes: ["pms:project:write"],
        workflowTypes: [],
      }),
      preview: async () => ({
        operationId: "preview-1",
        command: "project.create",
        expiresAt: "2026-10-13T12:00:00Z",
        contextVersion: "1",
        warnings: [],
        changes: [],
        refreshScopes: [],
      }),
      execute,
    } as never;
    const { deps, stdout } = makeDeps(client);

    await runCli(["scenario", "project-create", "plan", "--arguments-json", "{\"name\":\"AI Native PMS\"}"], deps);

    const output = JSON.parse(stdout[0] ?? "{}");
    expect(output.ok).toBe(true);
    expect(output.data.scenario).toBe("project-create");
    expect(output.data.phase).toBe("plan");
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts entity version zero for requirement analysis planning", async () => {
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        features: { resourceGet: true },
        resources: [{
          type: "requirement",
          actions: [{
            name: "requirement.analysis.save",
            label: "保存需求分析",
            description: "保存需求分析",
            mode: "automatic",
            risk: "high",
            scopes: ["pms:requirement:write"],
            inputSchema: {
              requirementId: { type: "integer", label: "需求 ID", required: true },
              nodeId: { type: "integer", label: "节点 ID", required: true },
              version: { type: "integer", label: "版本", required: true },
              patch: { type: "object", label: "分析成果", required: true },
            },
            requiresContext: true,
            refreshScopes: ["requirement-detail"],
          }],
        }],
        scopes: ["pms:requirement:write"],
        workflowTypes: [],
      })),
      get: vi.fn(async () => ({
        resourceType: "requirement",
        resourceId: 27,
        entityVersion: 0,
        details: { id: 27, title: "项目管理自动化需求" },
      })),
      context: vi.fn(async () => ({
        resource: { type: "requirement", id: 27 },
        version: 0,
        currentNode: { id: 375, key: "stage-1", label: "需求录入" },
        workflow: { templateVersionId: 50, templateVersionNo: 1, nodes: [{ id: 375, key: "stage-1", label: "需求录入" }] },
        allowedActions: ["requirement.analysis.save"],
      })),
      preview: vi.fn(async () => ({
        operationId: "preview-analysis-0",
        command: "requirement.analysis.save",
        expiresAt: "2026-10-14T12:00:00Z",
        contextVersion: "0",
        warnings: [],
        changes: [],
        refreshScopes: ["requirement-detail"],
      })),
    } as never;
    const { deps, stdout, stderr } = makeDeps(client);

    await runCli([
      "scenario", "requirement-analysis", "plan", "27",
      "--node-id", "375", "--version", "0", "--arguments-json", "{}",
    ], deps);

    expect(stderr).toHaveLength(0);
    expect(JSON.parse(stdout[0] ?? "{}").data.preview.operationId).toBe("preview-analysis-0");
  });

  it("validates an Agent Draft before returning a PMS preview", async () => {
    const draft = {
      facts: [{ text: "需求目标是减少人工录入", sourceRefs: ["requirement:33"] }],
      inferences: [],
      assumptions: [],
      unresolvedDecisions: [],
      patch: { analysis: "需求目标是减少人工录入" },
    };
    const action = {
      name: "requirement.analysis.save",
      label: "保存需求分析",
      description: "保存需求分析",
      mode: "automatic",
      risk: "medium",
      scopes: ["pms:requirement:write"],
      inputSchema: {
        requirementId: { type: "integer", label: "需求 ID", required: true },
        nodeId: { type: "integer", label: "节点 ID", required: true },
        version: { type: "integer", label: "版本", required: true },
        patch: { type: "object", label: "分析成果", required: true },
      },
      requiresContext: true,
      refreshScopes: ["requirement-detail"],
    };
    const client = {
      capabilities: vi.fn(async () => ({
        version: "ai-v1",
        resources: [{ type: "requirement", actions: [action] }],
        scopes: ["pms:requirement:write"],
        workflowTypes: [],
      })),
      get: vi.fn(async () => ({
        resourceType: "requirement",
        resourceId: 33,
        entityVersion: 4,
        details: { id: 33, title: "批量导入" },
      })),
      context: vi.fn(async () => ({
        resource: { type: "requirement", id: 33 },
        version: 4,
        currentNode: { id: 701, key: "receiving", label: "需求接收" },
        workflow: { templateVersionId: 88, templateVersionNo: 1, nodes: [] },
        relations: [],
        allowedActions: ["requirement.analysis.save"],
      })),
      preview: vi.fn(async () => ({
        operationId: "preview-agent-draft-1",
        command: "requirement.analysis.save",
        expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "4",
        warnings: [],
        changes: [{ action: "update", entity: "requirement" }],
        refreshScopes: ["requirement-detail"],
      })),
    };
    const { deps, stdout } = makeDeps(client as never);

    await runCli([
      "scenario", "requirement-analysis", "plan", "33",
      "--node-id", "701", "--version", "4",
      "--draft-json", JSON.stringify(draft),
    ], deps);

    const output = JSON.parse(stdout[0] ?? "{}");
    expect(output.data.contractVersion).toBe("requirement-analysis/v1");
    expect(output.data.draft).toEqual(draft);
    expect(output.data.plan.preview.operationId).toBe("preview-agent-draft-1");
    expect(client.preview).toHaveBeenCalledTimes(1);
  });

  it("uses an explicitly supplied request id for the runtime and success envelope", async () => {
    const { deps, stdout } = makeDeps({
      query: async () => ({
        resourceType: "topic",
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPage: 0,
        queryScope: "readable",
      }),
    } as never);
    await runCli(["search", "topic", "--request-id", "caller-req-7"], deps);

    expect(deps.createRuntime).toHaveBeenCalledWith("caller-req-7");
    expect(JSON.parse(stdout[0] ?? "{}").meta.requestId).toBe("caller-req-7");
  });
});
