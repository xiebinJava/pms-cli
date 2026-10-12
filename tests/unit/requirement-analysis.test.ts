import { describe, expect, it } from "vitest";
import { requirementAnalysisSave } from "../../apps/pms-cli/src/commands/shortcuts/requirement.js";

const catalog = {
  version: "ai-v1",
  features: { resourceGet: true, richWorkflowContext: true },
  resources: [{
    type: "requirement",
    actions: [{
      name: "requirement.analysis.save",
      label: "保存需求分析",
      description: "追加需求分析成果",
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
    }],
  }],
  scopes: ["pms:requirement:write"],
  workflowTypes: [],
};

describe("requirement analysis shortcut", () => {
  it("maps the requirement id and node patch to the backend save command", async () => {
    const calls: unknown[] = [];
    const client = {
      capabilities: async () => catalog,
      execute: async (request: unknown) => {
        calls.push(request);
        return { operationId: "analysis-save-1", status: "SUCCEEDED", data: {}, warnings: [], refreshScopes: [] };
      },
    } as never;

    await requirementAnalysisSave(client, 23, {
      nodeId: 301,
      version: 7,
      arguments: { background: "用户需要导出报表" },
      idempotencyKey: "analysis-save-23-7",
      context: { id: "requirement:23", version: "7" },
      contract: { id: "requirement-analysis", version: "1" },
      requestId: "req-analysis-1",
    });

    expect(calls[0]).toMatchObject({
      operation: "requirement.analysis.save",
      idempotencyKey: "analysis-save-23-7",
      context: { id: "requirement:23", version: "7" },
      contract: { id: "requirement-analysis", version: "1" },
      requestId: "req-analysis-1",
      arguments: {
        requirementId: 23,
        nodeId: 301,
        version: 7,
        patch: { background: "用户需要导出报表" },
      },
    });
  });
});
