import { describe, expect, it } from "vitest";
import {
  CapabilityResolutionError,
  DynamicCapabilityResolver,
} from "../../packages/pms-capabilities/src/index.js";
import { capabilityCatalogSchema } from "../../packages/pms-contracts/src/index.js";

describe("dynamic capability resolver", () => {
  it("resolves a published template and its custom component without hardcoded node names", () => {
    const catalog = capabilityCatalogSchema.parse({
      version: "ai-v1",
      resources: [{
        type: "topic",
        actions: [{
          name: "topic.create",
          label: "创建专题",
          description: "创建一个专题",
          mode: "automatic",
          risk: "medium",
          scopes: ["pms:development:write"],
          inputSchema: {},
          requiresContext: false,
          refreshScopes: ["topic-list"],
        }],
      }],
      scopes: ["pms:query:read", "pms:development:write"],
      workflowTypes: [{
        processType: "topic-management",
        label: "专题管理",
        templates: [{
          templateVersionId: 9,
          versionNo: 2,
          name: "专题流程 v2",
          defaultTemplate: true,
          nodes: [{
            key: "custom-node",
            label: "自定义节点",
            position: 0,
            components: [{
              key: "custom-review",
              label: "自定义评审",
              fields: [{ key: "review-note", type: "text", label: "评审结论", required: true }],
            }],
          }],
        }],
      }],
    });
    const resolver = new DynamicCapabilityResolver(catalog);

    expect(resolver.actionsFor("topic")).toHaveLength(1);
    expect(resolver.template("topic-management")?.templateVersionId).toBe(9);
    expect(resolver.component({
      processType: "topic-management",
      nodeKey: "custom-node",
      componentKey: "custom-review",
    })).toMatchObject({ key: "custom-review", label: "自定义评审" });
    expect(resolver.fields({
      processType: "topic-management",
      nodeKey: "custom-node",
      componentKey: "custom-review",
    })[0]?.key).toBe("review-note");
  });

  it("fails explicitly when a dynamic component is not present", () => {
    const resolver = new DynamicCapabilityResolver(capabilityCatalogSchema.parse({
      version: "ai-v1",
      resources: [],
      scopes: [],
      workflowTypes: [],
    }));

    expect(() => resolver.component({
      processType: "topic-management",
      nodeKey: "missing-node",
      componentKey: "development-control",
    })).toThrow(CapabilityResolutionError);
  });

  it("does not select the first template when the default is ambiguous", () => {
    const catalog = capabilityCatalogSchema.parse({
      version: "ai-v1",
      resources: [],
      scopes: [],
      workflowTypes: [{
        processType: "project-management",
        label: "项目管理",
        templates: [
          { templateVersionId: 1, versionNo: 1, name: "项目流程", defaultTemplate: true, nodes: [] },
          { templateVersionId: 2, versionNo: 2, name: "项目流程", defaultTemplate: true, nodes: [] },
        ],
      }],
    });
    const resolver = new DynamicCapabilityResolver(catalog);

    expect(resolver.template("project-management")).toBeUndefined();
    expect(resolver.templateCandidates("project-management", "项目流程").map((item) => item.templateVersionId))
      .toEqual([1, 2]);
  });
});
