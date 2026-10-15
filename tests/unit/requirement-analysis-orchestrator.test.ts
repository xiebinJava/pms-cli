import { describe, expect, it, vi } from "vitest";
import type { PmsClient } from "../../packages/pms-client/src/index.js";
import {
  executeRequirementAnalysisScenario,
  runRequirementAnalysisScenario,
  type RequirementAnalysisScenarioClient,
} from "../../apps/pms-cli/src/commands/scenarios/requirementAnalysis.js";
import { toRequirementAnalysisWorkSession } from "../../apps/pms-cli/src/commands/scenarios/agentWorkSession.js";
import type { AnalysisDraft } from "../../packages/pms-contracts/src/index.js";

const draft: AnalysisDraft = {
  facts: [{ text: "当前需求属于订单域", sourceRefs: ["requirement:23"] }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { background: "补充用户场景" },
};

function fakeClient() {
  const calls: string[] = [];
  const client = {
    capabilities: vi.fn(async () => ({
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
      version: "ai-v1",
    })),
    get: vi.fn(async () => ({
      resourceType: "requirement",
      resourceId: 23,
      entityVersion: 7,
      details: { id: 23, title: "报表导出", systemId: 9 },
    })),
    context: vi.fn(async () => ({
      resource: { type: "requirement", id: 23 },
      version: 7,
      currentNode: { id: 301, key: "analysis", label: "需求分析" },
      workflow: { templateVersionId: 88, templateVersionNo: 3, nodes: [] },
      relations: [],
      allowedActions: ["requirement.analysis.save"],
    })),
    preview: vi.fn(async () => {
      calls.push("preview");
      return {
        operationId: "preview-1",
        command: "requirement.analysis.save",
        expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "7",
        warnings: [],
        changes: [{ action: "update", entity: "requirement" }],
        refreshScopes: [],
      };
    }),
    execute: vi.fn(async () => {
      calls.push("execute");
      return {
        operationId: "operation-1",
        status: "SUCCEEDED",
        data: {},
        warnings: [],
        refreshScopes: [],
      };
    }),
    executePreview: vi.fn(async (operationId: string, idempotencyKey: string) => {
      calls.push("execute-preview");
      expect(operationId).toBe("preview-1");
      expect(idempotencyKey).toBeTruthy();
      return {
        operationId: "operation-1",
        status: "SUCCEEDED",
        data: {},
        warnings: [],
        refreshScopes: [],
      };
    }),
  } as unknown as PmsClient;
  return { client, calls };
}

describe("requirement analysis orchestration", () => {
  it("returns a draft without preview or execute when save is false", async () => {
    const { client, calls } = fakeClient();

    const result = await runRequirementAnalysisScenario(client as RequirementAnalysisScenarioClient, {
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 301,
      contextVersion: 7,
      draft,
      save: false,
    }, async () => true);

    expect(result.status).toBe("DRAFT");
    expect(calls).toEqual([]);
  });

  it("previews before asking for approval and never executes after rejection", async () => {
    const { client, calls } = fakeClient();

    const result = await runRequirementAnalysisScenario(client as RequirementAnalysisScenarioClient, {
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 301,
      contextVersion: 7,
      draft,
      save: true,
      idempotencyKey: "analysis-1",
    }, async () => false);

    expect(result.status).toBe("REJECTED");
    expect(calls).toEqual(["preview"]);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("executes after approval and verifies resource and context readback", async () => {
    const { client, calls } = fakeClient();

    const result = await runRequirementAnalysisScenario(client as RequirementAnalysisScenarioClient, {
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 301,
      contextVersion: 7,
      draft,
      save: true,
      idempotencyKey: "analysis-2",
    }, async () => true);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.operationId).toBe("operation-1");
    expect(result.verification).toEqual({
      resourceReadback: true,
      contextReadback: true,
      protectedFieldsUnchanged: true,
    });
    expect(calls).toEqual(["preview", "execute-preview"]);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it("rejects a draft that cites a resource outside the readable context", async () => {
    const { client } = fakeClient();
    const invalidDraft = {
      ...draft,
      facts: [{ text: "越权引用", sourceRefs: ["project:999"] }],
    } satisfies AnalysisDraft;

    await expect(runRequirementAnalysisScenario(client as RequirementAnalysisScenarioClient, {
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 301,
      contextVersion: 7,
      draft: invalidDraft,
      save: true,
      idempotencyKey: "analysis-3",
    }, async () => true)).rejects.toThrow("未授权");
    expect(client.preview).not.toHaveBeenCalled();
  });

  it("rejects a write that does not reference a persisted preview", async () => {
    const { client } = fakeClient();

    await expect(executeRequirementAnalysisScenario(client, 23, {
      nodeId: 301,
      version: 7,
      arguments: draft.patch,
      idempotencyKey: "analysis-without-preview",
    })).rejects.toThrow("操作预览");
    expect(client.execute).not.toHaveBeenCalled();
    expect(client.executePreview).not.toHaveBeenCalled();
  });

  it("reports an unknown write result when requirement readback fails", async () => {
    const { client } = fakeClient();
    const getMock = client.get as unknown as ReturnType<typeof vi.fn>;
    getMock
      .mockImplementationOnce(async () => ({
        resourceType: "requirement",
        resourceId: 23,
        entityVersion: 7,
        details: { id: 23, title: "报表导出", systemId: 9 },
      }))
      .mockRejectedValueOnce(new Error("readback unavailable"));

    const execution = await executeRequirementAnalysisScenario(client, 23, {
      nodeId: 301,
      version: 7,
      arguments: draft.patch,
      idempotencyKey: "analysis-readback-unknown",
      previewOperationId: "preview-1",
    });

    expect(execution.result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(execution.readback).toEqual({ resource: null, context: null });
    const sessionContext = await client.context({ type: "requirement", id: 23 });
    sessionContext.workflow = {
      nodes: [{
        id: 301,
        key: "analysis",
        label: "需求分析",
        position: 0,
        components: [],
        fields: [],
        fieldValues: {},
      }],
    };
    const session = toRequirementAnalysisWorkSession({
      sessionId: "session-unknown",
      taskId: "task-unknown",
      context: sessionContext,
      draft,
      result: execution,
    });
    expect(session.operation?.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(session.verification).toMatchObject({
      status: "UNKNOWN",
      resourceReadback: false,
      contextReadback: false,
      patchApplied: false,
      protectedFieldsUnchanged: false,
    });
  });

  it("keeps the high-level scenario status unknown when readback fails", async () => {
    const { client } = fakeClient();
    const getMock = client.get as unknown as ReturnType<typeof vi.fn>;
    getMock
      .mockImplementationOnce(async () => ({
        resourceType: "requirement",
        resourceId: 23,
        entityVersion: 7,
        details: { id: 23, title: "报表导出", systemId: 9 },
      }))
      .mockImplementationOnce(async () => ({
        resourceType: "requirement",
        resourceId: 23,
        entityVersion: 7,
        details: { id: 23, title: "报表导出", systemId: 9 },
      }))
      .mockRejectedValueOnce(new Error("readback unavailable"));

    const result = await runRequirementAnalysisScenario(client as RequirementAnalysisScenarioClient, {
      resourceType: "requirement",
      resourceId: 23,
      nodeId: 301,
      contextVersion: 7,
      draft,
      save: true,
      idempotencyKey: "analysis-readback-unknown-high-level",
    }, async () => true);

    expect(result.status).toBe("WRITE_RESULT_UNKNOWN");
    expect(result.verification).toEqual({
      resourceReadback: false,
      contextReadback: false,
      protectedFieldsUnchanged: false,
    });
  });
});
