import type { PmsClient } from "../../../../../packages/pms-client/src/index.js";
import { PmsClientError } from "../../../../../packages/pms-client/src/index.js";
import {
  agentContractVersion,
  type ContextReadOptions,
  type QueryItem,
  type AgentWorkSession,
} from "../../../../../packages/pms-contracts/src/index.js";
import { buildAgentContext } from "./agentContext.js";

export function getContext(
  client: PmsClient,
  resourceType: QueryItem["type"],
  resourceId: number,
  options?: ContextReadOptions,
) {
  return client.context({ type: resourceType, id: resourceId }, options);
}

export async function getAgentContext(
  client: PmsClient,
  resourceType: Extract<QueryItem["type"], "project" | "requirement" | "topic" | "story">,
  resourceId: number,
  options?: ContextReadOptions,
): Promise<AgentWorkSession> {
  const capabilities = await client.capabilities();
  if (capabilities.agentContractVersion !== agentContractVersion) {
    throw new PmsClientError(
      "validation",
      `AGENT_CONTRACT_VERSION_UNSUPPORTED: PMS 宣布的 Agent 合约 ${capabilities.agentContractVersion ?? "未声明"} 与客户端 ${agentContractVersion} 不兼容`,
      {
        details: {
          code: "AGENT_CONTRACT_VERSION_UNSUPPORTED",
          expected: agentContractVersion,
          advertised: capabilities.agentContractVersion ?? null,
        },
      },
    );
  }
  const feature = options?.view === "focused" ? "focusedWorkflowContext" : "readonlyWorkflowContext";
  if (capabilities.features?.[feature] !== true) {
    throw new PmsClientError("validation", `AGENT_CONTEXT_UNAVAILABLE: PMS 未声明 ${feature} 能力`, {
      details: { code: "AGENT_CONTEXT_UNAVAILABLE", feature },
    });
  }
  const context = await getContext(client, resourceType, resourceId, options);
  return buildAgentContext(context, {
    ...(options?.nodeId === undefined ? {} : { nodeId: options.nodeId }),
    ...(options?.component === undefined ? {} : { component: options.component }),
  });
}
