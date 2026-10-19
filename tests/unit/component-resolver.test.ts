import { describe, expect, it } from "vitest";
import type { ContextNode } from "../../packages/pms-contracts/src/index.js";
import {
  ComponentResolutionError,
  resolveWorkflowComponent,
} from "../../apps/pms-cli/src/commands/core/componentResolver.js";

function node(components: ContextNode["components"]): ContextNode {
  return {
    id: 101,
    key: "development",
    label: "开发",
    position: 0,
    components,
    fields: [],
    fieldValues: {},
    version: 3,
  };
}

function component(
  key: string,
  saveContract?: Record<string, unknown> | null,
): ContextNode["components"][number] {
  return {
    key,
    label: key,
    fields: [],
    actions: [],
    saveContract,
  };
}

describe("workflow component resolver", () => {
  it("selects the only writable component when the caller omits componentKey", () => {
    const result = resolveWorkflowComponent(node([
      component("readonly", { command: "read", writableFields: [] }),
      component("workbench", { command: "update", writableFields: ["summary"] }),
    ]), { mode: "write" });

    expect(result.componentKey).toBe("workbench");
    expect(result.writeCapable).toBe(true);
  });

  it("rejects an unqualified write when multiple writable components exist", () => {
    expect(() => resolveWorkflowComponent(node([
      component("one", { command: "update-one", writableFields: ["summary"] }),
      component("two", { command: "update-two", writableFields: ["summary"] }),
    ]), { mode: "write" })).toThrowError(ComponentResolutionError);

    try {
      resolveWorkflowComponent(node([
        component("one", { command: "update-one", writableFields: ["summary"] }),
        component("two", { command: "update-two", writableFields: ["summary"] }),
      ]), { mode: "write" });
    } catch (error) {
      expect(error).toMatchObject({ code: "COMPONENT_SELECTION_REQUIRED" });
    }
  });

  it("keeps read context readable but writeCapable false when multiple writable components are unqualified", () => {
    const result = resolveWorkflowComponent(node([
      component("one", { command: "update-one", writableFields: ["summary"] }),
      component("two", { command: "update-two", writableFields: ["summary"] }),
    ]), { mode: "read" });

    expect(result.component).toBeUndefined();
    expect(result.componentKey).toBeUndefined();
    expect(result.writeCapable).toBe(false);
    expect(result.reason).toBe("MULTIPLE_WRITABLE_COMPONENTS");
  });

  it("allows an explicitly selected read-only component for context reads", () => {
    const result = resolveWorkflowComponent(node([
      component("readonly", { command: "read", writableFields: [] }),
    ]), { componentKey: "readonly", mode: "read" });

    expect(result.componentKey).toBe("readonly");
    expect(result.writeCapable).toBe(false);
    expect(result.reason).toBe("SELECTED_COMPONENT_NOT_WRITABLE");
  });

  it("rejects a write explicitly targeted at a read-only component", () => {
    expect(() => resolveWorkflowComponent(node([
      component("readonly", { command: "read", writableFields: [] }),
    ]), { componentKey: "readonly", mode: "write" })).toThrowError(
      /COMPONENT_NOT_WRITABLE/,
    );
  });

  it("keeps a node with no writable contracts readable and rejects writes", () => {
    const readable = resolveWorkflowComponent(node([
      component("readonly-one", { command: "read-one", writableFields: [] }),
      component("readonly-two", null),
    ]), { mode: "read" });
    expect(readable.writeCapable).toBe(false);
    expect(readable.component).toBeUndefined();

    expect(() => resolveWorkflowComponent(node([
      component("readonly-one", { command: "read-one", writableFields: [] }),
      component("readonly-two", null),
    ]), { mode: "write" })).toThrowError(/COMPONENT_NOT_WRITABLE/);
  });

  it("rejects an unsupported explicit component", () => {
    expect(() => resolveWorkflowComponent(node([
      component("workbench", { command: "update", writableFields: ["summary"] }),
    ]), { componentKey: "missing", mode: "read" })).toThrowError(ComponentResolutionError);
  });

  it("normalizes project workbench as the same component selector", () => {
    const result = resolveWorkflowComponent(node([
      component("project-workbench", {
        workbench: "project-workbench",
        command: "node.field.update",
        writableFields: ["summary"],
      }),
    ]), { workbench: "project-workbench", mode: "write" });

    expect(result.componentKey).toBe("project-workbench");
    expect(result.requestedComponentKey).toBe("project-workbench");
  });

  it("rejects conflicting componentKey and workbench aliases", () => {
    expect(() => resolveWorkflowComponent(node([
      component("one", { command: "update", writableFields: ["summary"] }),
    ]), { componentKey: "one", workbench: "two", mode: "read" })).toThrowError(
      /componentKey 与 workbench 不一致/,
    );
  });
});
