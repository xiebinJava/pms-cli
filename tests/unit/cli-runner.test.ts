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
    expect(version.stdout[0]).toBe("0.1.0\n");
  });
});
