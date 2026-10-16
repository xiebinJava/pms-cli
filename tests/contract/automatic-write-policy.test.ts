import { describe, expect, it } from "vitest";
import type { ActionCapability } from "../../packages/pms-contracts/src/index.js";
import {
  deriveProgressionExecutionMode,
  mayExecuteProgression,
} from "../../apps/pms-cli/src/commands/scenarios/progressionPolicy.js";

function action(mode: ActionCapability["mode"], risk: ActionCapability["risk"]): ActionCapability {
  return {
    name: "test.operation",
    label: "测试操作",
    description: "测试操作",
    mode,
    risk,
    scopes: [],
    inputSchema: {},
    requiresContext: true,
    refreshScopes: [],
  };
}

describe("agent progression automatic write policy", () => {
  it("allows auto only for automatic low/medium risk capabilities", () => {
    expect(deriveProgressionExecutionMode(action("automatic", "low"))).toBe("automatic");
    expect(mayExecuteProgression(action("automatic", "medium"), "auto")).toBe(true);
    expect(mayExecuteProgression(action("automatic", "high"), "auto")).toBe(false);
    expect(mayExecuteProgression(action("read", "low"), "auto")).toBe(false);
  });

  it("allows explicit confirm for high-risk writes but never for reads", () => {
    expect(deriveProgressionExecutionMode(action("automatic", "high"))).toBe("confirmation");
    expect(mayExecuteProgression(action("automatic", "high"), "confirm")).toBe(true);
    expect(mayExecuteProgression(action("read", "low"), "confirm")).toBe(false);
  });

  it("never treats plan as an execution authorization", () => {
    expect(mayExecuteProgression(action("automatic", "low"), "plan")).toBe(false);
  });
});
