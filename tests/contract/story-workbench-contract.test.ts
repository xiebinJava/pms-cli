import { describe, expect, it } from "vitest";
import {
  storyWorkbenchContractVersion,
  storyWorkbenchInputSchema,
  storyWorkbenchResultSchema,
} from "../../packages/pms-contracts/src/index.js";

const baseInput = {
  contractVersion: storyWorkbenchContractVersion,
  resourceType: "story" as const,
  resourceId: 34,
  nodeId: 384,
  version: 1,
  variant: "iteration" as const,
  patch: { meetingNote: "确认进入本周迭代" },
  save: false,
};

describe("story workbench write contract", () => {
  it("accepts a read-only draft without an idempotency key", () => {
    expect(storyWorkbenchInputSchema.parse(baseInput)).toMatchObject(baseInput);
  });

  it("requires an idempotency key only for a write", () => {
    expect(() => storyWorkbenchInputSchema.parse({
      ...baseInput,
      save: true,
    })).toThrow(/idempotencyKey/);

    expect(storyWorkbenchInputSchema.parse({
      ...baseInput,
      save: true,
      idempotencyKey: "story-34-node-384-v1",
    })).toMatchObject({ save: true, idempotencyKey: "story-34-node-384-v1" });
  });

  it("accepts acceptance completion metadata while keeping it outside the patch", () => {
    const parsed = storyWorkbenchInputSchema.parse({
      ...baseInput,
      variant: "acceptance",
      patch: { acceptanceConclusion: "PASS", acceptanceNote: "通过" },
      save: true,
      complete: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
      idempotencyKey: "story-34-acceptance-complete",
    });
    expect(parsed).toMatchObject({
      complete: true,
      ownerId: 2,
      startDate: "2026-10-10",
      endDate: "2026-10-20",
    });
    expect(storyWorkbenchInputSchema.parse({
      ...baseInput,
      variant: "acceptance",
      complete: true,
      save: false,
    }).complete).toBe(true);
  });

  it("rejects an empty patch and an unsupported workbench variant", () => {
    expect(() => storyWorkbenchInputSchema.parse({
      ...baseInput,
      patch: {},
    })).toThrow(/patch/);
    expect(() => storyWorkbenchInputSchema.parse({
      ...baseInput,
      variant: "unknown",
    })).toThrow();
  });

  it("keeps the result status and verification fields machine-readable", () => {
    const result = storyWorkbenchResultSchema.parse({
      contractVersion: storyWorkbenchContractVersion,
      status: "SUCCEEDED",
      resourceId: 34,
      nodeId: 384,
      version: 1,
      variant: "iteration",
      patch: { meetingNote: "确认进入本周迭代" },
      complete: false,
      operationId: "operation-1",
      operation: {
        operationId: "operation-1",
        previewOperationId: "preview-1",
        status: "SUCCEEDED",
        data: { saved: true },
        warnings: ["已写入"],
        refreshScopes: ["story-detail"],
        auditId: "audit-1",
      },
      verification: {
        resourceReadback: true,
        contextReadback: true,
        patchApplied: true,
        protectedFieldsUnchanged: true,
      },
      readback: { resource: {}, context: {} },
      currentNode: { id: 385, key: "testing", label: "测试中" },
    });

    expect(result.verification?.patchApplied).toBe(true);
    expect(result.operation?.auditId).toBe("audit-1");
    expect(result.operation?.refreshScopes).toEqual(["story-detail"]);
  });
});
