import { describe, expect, it } from "vitest";
import {
  resourceScenarioContractVersion,
  resourceScenarioExecuteInputSchema,
  resourceScenarioPlanSchema,
  resourceScenarioResultSchema,
  resourceScenarioInputSchema,
} from "../../packages/pms-contracts/src/index.js";

const baseInput = {
  contractVersion: resourceScenarioContractVersion,
  resourceType: "topic" as const,
  resourceId: 12,
  operation: "topic.update",
  arguments: { topicId: 12, title: "新的专题名称" },
};

describe("resource scenario contract", () => {
  it("accepts a self-contained plan request for requirement/topic/project resources", () => {
    expect(resourceScenarioInputSchema.parse(baseInput)).toMatchObject(baseInput);
    expect(resourceScenarioInputSchema.parse({
      ...baseInput,
      resourceType: "project",
      resourceId: undefined,
      operation: "project.create",
      arguments: { name: "AI Native PMS" },
    })).toMatchObject({ resourceType: "project", operation: "project.create" });
  });

  it("rejects unsupported resource types and invalid operation identities", () => {
    expect(() => resourceScenarioInputSchema.parse({ ...baseInput, resourceType: "story" })).toThrow();
    expect(() => resourceScenarioInputSchema.parse({ ...baseInput, operation: "" })).toThrow();
    expect(() => resourceScenarioInputSchema.parse({ ...baseInput, contractVersion: "resource-scenario/v0" })).toThrow();
  });

  it("requires preview and idempotency for execute and does not accept arguments", () => {
    expect(() => resourceScenarioExecuteInputSchema.parse({
      resourceType: "topic",
      operation: "topic.update",
      resourceId: 12,
    })).toThrow(/previewOperationId|idempotencyKey/);
    expect(() => resourceScenarioExecuteInputSchema.parse({
      resourceType: "topic",
      operation: "topic.update",
      resourceId: 12,
      previewOperationId: "preview-1",
      idempotencyKey: "idem-1",
      arguments: { title: "不应被接受" },
    })).toThrow();
  });

  it("keeps plan and execute verification fields machine-readable", () => {
    const plan = resourceScenarioPlanSchema.parse({
      scenario: "resource-scenario",
      phase: "plan",
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: "topic.update",
      context: { id: "topic:12", version: "4", entityVersion: 9 },
      normalizedArguments: { topicId: 12, title: "新的专题名称" },
      capability: { name: "topic.update", inputSchema: {} },
      preview: {
        operationId: "preview-1",
        command: "topic.update",
        expiresAt: "2099-01-01T00:00:00Z",
        contextVersion: "4",
        warnings: [],
        changes: [],
        refreshScopes: ["topic-detail"],
        preconditions: [],
      },
      requiresConfirmation: true,
      warnings: [],
    });
    expect(plan.preview.operationId).toBe("preview-1");

    const result = resourceScenarioResultSchema.parse({
      scenario: "resource-scenario",
      phase: "execute",
      contractVersion: resourceScenarioContractVersion,
      resourceType: "topic",
      resourceId: 12,
      operation: {
        operationId: "operation-1",
        status: "SUCCEEDED",
        data: { topicId: 12 },
        warnings: [],
        refreshScopes: ["topic-detail"],
      },
      previewOperationId: "preview-1",
      readback: { resource: null, context: null },
      verification: {
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      },
      status: "SUCCEEDED",
      warnings: [],
      refreshScopes: ["topic-detail"],
    });
    expect(result.verification.patchApplied).toBe(true);
  });
});
