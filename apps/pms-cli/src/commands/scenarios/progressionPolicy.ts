import type {
  ActionCapability,
  AgentProgressionExecuteMode,
  AgentProgressionExecutionMode,
} from "../../../../../packages/pms-contracts/src/index.js";

export function deriveProgressionExecutionMode(
  action: ActionCapability,
): AgentProgressionExecutionMode {
  if (action.mode === "read") return "read";
  if (action.risk === "high") return "confirmation";
  return "automatic";
}

export function mayExecuteProgression(
  action: ActionCapability,
  requestedMode: AgentProgressionExecuteMode,
): boolean {
  if (requestedMode === "plan") return false;
  if (requestedMode === "confirm") return action.mode !== "read";
  return deriveProgressionExecutionMode(action) === "automatic";
}
