import { describe, expect, it } from "vitest";
import { PmsHttpClient, StaticTokenProvider } from "../../packages/pms-client/src/index.js";
import {
  agentProgressionRunResultSchema,
  canonicalizeDraftDigestInput,
  computeDraftDigest,
  orchestratorConversationSchema,
  orchestratorDraftSchema,
  orchestratorPlanSchema,
  orchestratorSessionSchema,
  resourceNodeDraftSchema,
} from "../../packages/pms-contracts/src/index.js";
import type { DraftDigestInput, OrchestratorDraft } from "../../packages/pms-contracts/src/index.js";

const envelope = (data: unknown) => new Response(
  JSON.stringify({ code: 200, msg: "操作成功", data, requestId: "project-topic-1" }),
  { status: 200, headers: { "content-type": "application/json" } },
);

const resourceNodeDraft: OrchestratorDraft = {
  contractVersion: "resource-node/v1",
  draft: {
    facts: [{ text: "测试结果为通过", sourceRefs: ["project-node:301#component:solution-design"], confidence: "high" }],
    inferences: [],
    assumptions: [],
    unresolvedDecisions: [],
    patch: { testResult: "PASS" },
  },
};

const projectPlan = {
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
  contextSnapshot: { resourceType: "project", resourceId: 42, nodeId: 301, version: 3 },
  draft: resourceNodeDraft,
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
    writableFields: ["testResult"],
    protectedFields: ["projectId", "nodeId", "workbench"],
    writeCapable: true,
  },
  missingFields: [],
  questions: [],
};

describe("project and topic orchestrator contract", () => {
  it("accepts project and topic conversations", () => {
    expect(orchestratorConversationSchema.parse({
      conversationId: 10, resourceType: "project", resourceId: 42, status: "ACTIVE", latestPlan: null,
    }).resourceType).toBe("project");
    expect(orchestratorConversationSchema.parse({
      conversationId: 11, resourceType: "topic", resourceId: 43, status: "ACTIVE", latestPlan: null,
    }).resourceType).toBe("topic");
  });

  it("parses resource-node/v1 drafts with optional extensions and without them", () => {
    expect(orchestratorDraftSchema.parse(resourceNodeDraft).contractVersion).toBe("resource-node/v1");
    const withExtensions = orchestratorDraftSchema.parse({
      contractVersion: "resource-node/v1",
      draft: {
        ...resourceNodeDraft.draft,
        requestedCompletion: true,
        fieldSources: {
          testResult: {
            sourceType: "pms_context",
            sourceRefs: ["project-node:301#component:solution-design"],
            confidence: "high",
          },
        },
      },
    });
    if (withExtensions.contractVersion === "resource-node/v1") {
      expect(withExtensions.draft.requestedCompletion).toBe(true);
    }
    expect(resourceNodeDraftSchema.safeParse({ ...resourceNodeDraft.draft, patch: undefined }).success).toBe(false);
  });

  it("parses project and topic plans with nodeVersion and componentKey", () => {
    const project = orchestratorPlanSchema.parse(projectPlan);
    expect(project.resourceType).toBe("project");
    expect(project.nodeVersion).toBe(6);
    expect(project.componentKey).toBe("solution-design");
    expect("nodeContract" in project ? project.nodeContract?.writeCapable : undefined).toBe(true);

    const topic = orchestratorPlanSchema.parse({
      ...projectPlan,
      planId: 32,
      intent: "RESOURCE_NODE_COMPLETE",
      resourceType: "topic",
      resourceId: 43,
      nodeContract: {
        nodeId: 511,
        key: "topic-design-review",
        label: "专题设计评审",
        version: 4,
        writableFields: ["conclusion"],
        protectedFields: ["status"],
        writeCapable: true,
        variant: "design-review",
        fieldContracts: [
          { key: "conclusion", label: "评审结论", type: "string", required: true, nullable: false, collection: false },
        ],
      },
    });
    expect(topic.intent).toBe("RESOURCE_NODE_COMPLETE");
    expect(topic.resourceType).toBe("topic");
  });

  it("keeps nodeContract optional fields optional and rejects a missing required field", () => {
    const minimal = orchestratorPlanSchema.parse(projectPlan);
    if ("nodeContract" in minimal) {
      expect(minimal.nodeContract).toMatchObject({ nodeId: 301, writeCapable: true });
      expect(minimal.nodeContract).not.toHaveProperty("allowedActions");
      expect(minimal.nodeContract).not.toHaveProperty("fieldContracts");
    }
    const { writeCapable: _omitted, ...nodeContractWithoutRequired } = projectPlan.nodeContract;
    const withoutWriteCapable = { ...projectPlan, nodeContract: nodeContractWithoutRequired };
    expect(orchestratorPlanSchema.safeParse(withoutWriteCapable).success).toBe(false);
  });

  it("maps REJECTED only at the progression-run boundary, never into plan parsing", () => {
    const run = agentProgressionRunResultSchema.parse({
      contractVersion: "agent-progression-run/v2",
      phase: "run",
      status: "REJECTED",
      resourceType: "project",
      resourceId: 42,
      intent: "COMPLETE_NODE",
      writeDecision: "NEEDS_INPUT",
      plan: null,
      result: null,
      previewOperationId: null,
      operationId: null,
      auditId: null,
      readback: null,
      verification: null,
      warnings: [],
      rejectionReason: "COMPLETION_NOT_REQUESTED",
    });
    expect(run.status).toBe("REJECTED");
    expect(run.rejectionReason).toBe("COMPLETION_NOT_REQUESTED");

    const planWithRejectedIntent = { ...projectPlan, intent: "REJECTED" };
    expect(orchestratorPlanSchema.safeParse(planWithRejectedIntent).success).toBe(false);
  });

  it("reconstructs a project session from durable conversation and events", () => {
    const session = orchestratorSessionSchema.parse({
      sessionId: 10,
      conversation: {
        conversationId: 10,
        resourceType: "project",
        resourceId: 42,
        status: "WAITING_CONFIRMATION",
        latestPlan: null,
      },
      latestPlan: {
        ...projectPlan,
        status: "WAITING_CONFIRMATION",
        preview: {
          operationId: "op-proj-1",
          command: "node.field.update",
          expiresAt: "2026-10-20T12:00:00Z",
          contextVersion: "3",
          expectedVersions: { nodeVersion: 6, entityVersion: 3 },
          provenanceRef: "operation:op-proj-1",
          draftDigest: "sha256:7ac3abb8bf87462f93e1e71a1e096c14ae99188e79ebf726e0c75c039c3e91af",
          warnings: [],
          changes: [],
          refreshScopes: [],
          preconditions: [],
        },
      },
      events: [{ sequenceNo: 4, eventType: "WAITING_CONFIRMATION", operationId: "op-proj-1", detail: {}, createdAt: null }],
      afterSequence: 3,
      nextSequence: 5,
    });
    expect(session.conversation.resourceType).toBe("project");
    expect(session.latestPlan?.preview?.expectedVersions).toEqual({ nodeVersion: 6, entityVersion: 3 });
    expect(session.latestPlan?.preview?.provenanceRef).toBe("operation:op-proj-1");
    expect(session.latestPlan?.preview?.draftDigest).toBe("sha256:7ac3abb8bf87462f93e1e71a1e096c14ae99188e79ebf726e0c75c039c3e91af");
  });

  it("sends project turns with nodeVersion and componentKey only when defined", async () => {
    const requests: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    const responses = [
      envelope({ conversationId: 10, resourceType: "project", resourceId: 42, status: "ACTIVE", latestPlan: null }),
      envelope(projectPlan),
      envelope({ ...projectPlan, planId: 33, nodeVersion: undefined, componentKey: undefined }),
    ];
    const client = new PmsHttpClient({
      baseUrl: "https://pms.example.test",
      auth: new StaticTokenProvider("token"),
      clientId: "pms-cli",
      fetchImpl: async (input, init) => {
        requests.push({
          method: init?.method ?? "GET",
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return responses.shift()!;
      },
    });

    const created = await client.createConversation({ resourceType: "project", resourceId: 42 });
    const turned = await client.appendTurn({
      conversationId: created.conversationId,
      message: "填写方案设计测试结果",
      contractVersion: "resource-node/v1",
      draft: resourceNodeDraft,
      nodeId: 301,
      nodeVersion: 6,
      componentKey: "solution-design",
      contextVersion: 3,
    });
    expect(turned.nodeVersion).toBe(6);

    await client.appendTurn({
      conversationId: created.conversationId,
      message: "旧调用方不携带节点绑定",
      contractVersion: "resource-node/v1",
      draft: resourceNodeDraft,
      nodeId: 301,
    });

    expect(requests[1]?.body).toMatchObject({
      nodeId: 301,
      nodeVersion: 6,
      componentKey: "solution-design",
      contextVersion: 3,
    });
    expect(requests[2]?.body).toMatchObject({ nodeId: 301 });
    expect(requests[2]?.body).not.toHaveProperty("nodeVersion");
    expect(requests[2]?.body).not.toHaveProperty("componentKey");
  });

  it("validates the frozen digest against the shared golden vector", async () => {
    const { readFile } = await import("node:fs/promises");
    const { default: path } = await import("node:path");
    const fixture = JSON.parse(await readFile(
      path.join(process.cwd(), "tests/fixtures/provenance/draft-provenance-v1.json"),
      "utf8",
    )) as DraftDigestInput & { expectedDraftDigest: string; expectedProvenanceRef: string };

    const { expectedDraftDigest, expectedProvenanceRef, ...digestInput } = fixture;
    expect(computeDraftDigest(digestInput)).toBe(expectedDraftDigest);
    expect(canonicalizeDraftDigestInput(digestInput)).toBe(canonicalizeDraftDigestInput(JSON.parse(JSON.stringify(digestInput))));
    expect(expectedDraftDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(expectedProvenanceRef).toBe("operation:preview-op-42");

    const changedAxis = {
      ...digestInput,
      versionSnapshot: { ...digestInput.versionSnapshot, nodeVersion: 7 },
    };
    expect(computeDraftDigest(changedAxis)).not.toBe(expectedDraftDigest);
  });
});
