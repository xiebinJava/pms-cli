import { describe, expect, it } from "vitest";
import type { CapabilityCatalog, ResourceRef, WorkflowContext } from "../../packages/pms-contracts/src/index.js";
import { CapabilityResolver } from "../../apps/pms-cli/src/capabilities/CapabilityResolver.js";

const catalog: CapabilityCatalog = {
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
};

describe("CLI capability resolver", () => {
  it("loads the server-owned catalog and forwards resource context", async () => {
    const context: WorkflowContext = {
      resource: { type: "project", id: 7 },
      version: 3,
      allowedActions: ["project.update"],
    };
    const client = {
      capabilities: async () => catalog,
      context: async (_resource: ResourceRef) => context,
    } as never;
    const resolver = new CapabilityResolver(client);

    expect((await resolver.list()).resources[0]?.actions[0]?.name).toBe("project.create");
    expect(await resolver.context("project", 7)).toBe(context);
  });

  it("filters capabilities by an explicitly requested scope", async () => {
    const client = { capabilities: async () => ({
      ...catalog,
      scopes: ["pms:project:write", "pms:task:read"],
    }) } as never;
    const resolver = new CapabilityResolver(client);

    const filtered = await resolver.list("pms:task:read");
    expect(filtered.resources).toEqual([]);
  });

  it("checks the server-declared provenance contract before a write preview", async () => {
    const resolver = new CapabilityResolver({
      capabilities: async () => ({ ...catalog, provenanceVersions: ["draft-provenance/v1"] }),
    } as never);

    expect(await resolver.supportsProvenance()).toBe(true);
  });
});
