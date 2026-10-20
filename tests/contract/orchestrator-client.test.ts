import { describe, expect, it } from "vitest";
import {
  PmsClientError,
  PmsHttpClient,
  StaticTokenProvider,
} from "../../packages/pms-client/src/index.js";
import type { AnalysisDraft } from "../../packages/pms-contracts/src/index.js";

const draft: AnalysisDraft = {
  facts: [{ text: "需求属于订单域", sourceRefs: ["requirement:33"] }],
  inferences: [],
  assumptions: [],
  unresolvedDecisions: [],
  patch: { analysis: "补充后的分析" },
};

const envelope = (data: unknown, code = 200, status = 200) => new Response(
  JSON.stringify({ code, msg: code === 200 ? "操作成功" : "版本已变化", data, requestId: "server-1" }),
  { status, headers: { "content-type": "application/json" } },
);

const conversation = {
  conversationId: 10,
  resourceType: "requirement",
  resourceId: 33,
  status: "ACTIVE",
  latestPlan: null,
};

const plan = {
  planId: 30,
  turnId: 20,
  intent: "REQUIREMENT_ANALYSIS_SAVE",
  status: "PLAN_READY",
  resourceType: "requirement",
  resourceId: 33,
  nodeId: 375,
  contextVersion: 4,
  contextSnapshot: {},
  draft: { contractVersion: "requirement-analysis/v1", draft },
  preview: null,
  operation: null,
  verification: null,
  validationErrors: [],
  errorCode: null,
  errorMessage: null,
};

const resourceNodePlan = {
  planId: 31,
  turnId: 21,
  intent: "RESOURCE_NODE_FIELD_UPDATE",
  status: "PLAN_READY",
  resourceType: "project",
  resourceId: 42,
  nodeId: 301,
  nodeVersion: 6,
  componentKey: "solution-design",
  contextVersion: 3,
  contextSnapshot: {},
  draft: {
    contractVersion: "resource-node/v1" as const,
    draft: {
      facts: [], inferences: [], assumptions: [], unresolvedDecisions: [],
      patch: { evidence: "通过" }, requestedCompletion: false,
      fieldSources: {
        evidence: {
          sourceType: "pms_context",
          sourceRefs: ["project-node:301#component:solution-design"],
          confidence: "high",
        },
      },
    },
  },
  preview: null,
  operation: null,
  verification: null,
  validationErrors: [],
  errorCode: null,
  errorMessage: null,
  nodeContract: {
    nodeId: 301,
    key: "solution-design",
    label: "方案设计",
    version: 6,
    writableFields: ["evidence"],
    protectedFields: [],
    writeCapable: true,
  },
  missingFields: [],
  questions: [],
};

describe("AI orchestrator client contract", () => {
  it("maps the conversation lifecycle to the documented routes and bodies", async () => {
    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    const responses = [
      envelope(conversation),
      envelope(plan),
      envelope({ ...plan, status: "WAITING_CONFIRMATION", preview: {
        operationId: "op-1", command: "requirement.analysis.save", expiresAt: "2026-10-15T12:00:00Z",
        contextVersion: "4", warnings: [], changes: [], refreshScopes: ["requirement-detail"],
        expectedVersions: { contextVersion: 4, requirementVersion: 7 },
        provenanceRef: "operation:op-1",
        draftDigest: "sha256:deadbeef",
        preconditions: [{
          code: "CONTEXT_CURRENT",
          message: "上下文仍然有效",
          blocking: false,
          suggestedAction: "继续确认",
          details: {},
        }],
      } }),
      envelope({ ...plan, status: "SUCCEEDED", operation: {
        operationId: "op-1", status: "SUCCEEDED", message: "已保存", data: {}, refreshScopes: [], auditId: "audit-1",
        warnings: [],
      }, verification: {
        resourceReadback: true, contextReadback: true, protectedFieldsUnchanged: true,
        patchApplied: true, status: "SUCCEEDED", message: "写入并回读验证成功",
      } }),
      envelope({ ...conversation, latestPlan: plan }),
      envelope([{ sequenceNo: 1, eventType: "CONTEXT_READ", operationId: null, detail: {}, createdAt: null }]),
    ];
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      requestIdFactory: () => "request-1",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return responses.shift()!;
      },
    });

    const created = await client.createConversation({ resourceType: "requirement", resourceId: 33 });
    const prepared = await client.appendTurn({
      conversationId: created.conversationId,
      message: "请分析并保存",
      contractVersion: "requirement-analysis/v1",
      draft: { contractVersion: "requirement-analysis/v1", draft },
      nodeId: 375,
      contextVersion: 4,
      requestId: "turn-1",
    });
    const previewed = await client.previewPlan(prepared.planId);
    const confirmed = await client.confirmPlan({ planId: previewed.planId, idempotencyKey: "idem-1" });
    const loaded = await client.getConversation(created.conversationId);
    const events = await client.listConversationEvents(created.conversationId, 0);

    expect(created.conversationId).toBe(10);
    expect(prepared.turnId).toBe(20);
    expect(previewed.preview?.operationId).toBe("op-1");
    expect(previewed.preview?.expectedVersions).toEqual({ contextVersion: 4, requirementVersion: 7 });
    expect(previewed.preview?.provenanceRef).toBe("operation:op-1");
    expect(previewed.preview?.draftDigest).toBe("sha256:deadbeef");
    expect(previewed.preview?.preconditions[0]?.code).toBe("CONTEXT_CURRENT");
    expect(confirmed.verification?.status).toBe("SUCCEEDED");
    expect(confirmed.operation?.auditId).toBe("audit-1");
    expect(loaded.latestPlan?.planId).toBe(30);
    expect(events[0]?.sequenceNo).toBe(1);
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      "POST /integration/ai/v1/orchestrator/conversations",
      "POST /integration/ai/v1/orchestrator/conversations/10/turns",
      "POST /integration/ai/v1/orchestrator/plans/30/preview",
      "POST /integration/ai/v1/orchestrator/plans/30/confirm",
      "GET /integration/ai/v1/orchestrator/conversations/10",
      "GET /integration/ai/v1/orchestrator/conversations/10/events",
    ]);
    expect(requests[1]?.body).toMatchObject({ message: "请分析并保存", contractVersion: "requirement-analysis/v1" });
    expect(requests[1]?.body).not.toHaveProperty("nodeVersion");
    expect(requests[1]?.body).not.toHaveProperty("componentKey");
    expect(requests[3]?.body).toEqual({ idempotencyKey: "idem-1" });
  });

  it("maps 409 to conflict and does not retry confirmation", async () => {
    let attempts = 0;
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      maxRetries: 3,
      retryDelayMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        return envelope(null, 409);
      },
    });

    const error = await client.confirmPlan({ planId: 30, idempotencyKey: "idem-conflict" }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PmsClientError);
    expect((error as PmsClientError).kind).toBe("conflict");
    expect(attempts).toBe(1);
  });

  it("serializes project resource-node turn bindings", async () => {
    const requests: Array<{ url: string; body?: unknown }> = [];
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      requestIdFactory: () => "resource-request-1",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
        return requests.length === 1 ? envelope({
          conversationId: 12, resourceType: "project", resourceId: 42, status: "ACTIVE", latestPlan: null,
        }) : envelope(resourceNodePlan);
      },
    });

    const conversation = await client.createConversation({ resourceType: "project", resourceId: 42 });
    const result = await client.appendTurn({
      conversationId: conversation.conversationId,
      message: "补充项目节点",
      contractVersion: "resource-node/v1",
      draft: resourceNodePlan.draft,
      nodeId: 301,
      nodeVersion: 6,
      componentKey: "solution-design",
      contextVersion: 3,
    });

    expect(result.resourceType).toBe("project");
    expect(requests[1]?.body).toMatchObject({
      nodeId: 301,
      nodeVersion: 6,
      componentKey: "solution-design",
      contextVersion: 3,
      contractVersion: "resource-node/v1",
    });
  });
});
