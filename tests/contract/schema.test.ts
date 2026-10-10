import { describe, expect, it } from "vitest";
import {
  automaticOperationRequestSchema,
  capabilityCatalogWireSchema,
  fieldSchema,
  operationResultSchema,
  resourceDetailSchema,
  queryResultSchema,
  resourceTypeSchema,
} from "../../packages/pms-contracts/src/index.js";

describe("PMS connector shared schemas", () => {
  it("rejects an operation request without required execution metadata", () => {
    const result = automaticOperationRequestSchema.safeParse({
      arguments: {},
      clientId: "pms-cli",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown resources and result statuses", () => {
    expect(resourceTypeSchema.safeParse("unknown").success).toBe(false);
    expect(
      operationResultSchema.safeParse({
        operationId: "op-1",
        status: "WAITING_FOR_CONFIRMATION",
        data: {},
        warnings: [],
        refreshScopes: [],
      }).success,
    ).toBe(false);
  });

  it("accepts an automatic operation with an optional page context", () => {
    const result = automaticOperationRequestSchema.parse({
      operation: "topic.create",
      arguments: { name: "订单中心" },
      idempotencyKey: "idem-1",
      clientId: "pms-cli",
      requestId: "req-1",
    });

    expect(result.operation).toBe("topic.create");
    expect(result.context).toBeUndefined();
  });

  it("keeps the PMS pagination envelope complete", () => {
    const result = queryResultSchema.parse({
      resourceType: "topic",
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPage: 0,
      queryScope: "current-user-readable",
    });

    expect(result.totalPage).toBe(0);
    expect(() => queryResultSchema.parse({
      resourceType: "topic",
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      queryScope: "current-user-readable",
    })).toThrow();
  });

  it("accepts exact resource details and preserves workflow metadata", () => {
    const detail = resourceDetailSchema.parse({
      resourceType: "story",
      resourceId: 27,
      entityVersion: 4,
      details: { title: "登录故事", topicId: 19 },
    });
    expect(detail.details).toEqual({ title: "登录故事", topicId: 19 });
  });

  it("keeps normalized fields strict while accepting the backend wire shape", () => {
    expect(fieldSchema.safeParse({ type: "string" }).success).toBe(false);
    expect(fieldSchema.safeParse({ type: "string", label: "标题" }).success).toBe(true);
    const catalog = capabilityCatalogWireSchema.parse({
      version: "ai-v1",
      resources: [{
        type: "topic",
        workflow: {
          nodes: [{
            key: "requirements",
            label: "需求",
            position: 0,
            components: [{
              key: "analysis",
              label: "分析",
              fields: [],
              actions: [],
              saveContract: { operation: "requirement.analysis.save" },
            }],
          }],
        },
        actions: [],
      }],
      scopes: [],
      workflowTypes: [],
      features: { richWorkflowContext: true },
    });
    expect(catalog.features?.richWorkflowContext).toBe(true);
    expect(catalog.resources[0]?.workflow?.nodes[0]?.components[0]?.saveContract).toEqual({
      operation: "requirement.analysis.save",
    });
  });
});
