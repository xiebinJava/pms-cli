import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeDraftDigest,
  draftDigestInputSchema,
  draftProvenanceSchema,
  draftProvenanceContractVersion,
  agentProgressionInputSchema,
  resourceScenarioInputSchema,
  resourceScenarioExecuteInputSchema,
  provenanceRefSchema,
  validateDraftProvenance,
  verifyDraftDigest,
} from "../../packages/pms-contracts/src/index.js";

const fixture = (name: string) => JSON.parse(readFileSync(
  resolve(process.cwd(), "tests/fixtures/provenance", name),
  "utf8",
));

const digestInput = fixture("digest-input.json");

describe("draft provenance contract", () => {
  it("accepts the frozen wire shape and operation provenance reference", () => {
    const parsed = draftProvenanceSchema.parse(fixture("valid.json"));

    expect(parsed.contractVersion).toBe(draftProvenanceContractVersion);
    expect(provenanceRefSchema.parse("operation:preview-123")).toBe("operation:preview-123");
  });

  it("is optional on preview inputs but cannot be introduced at execute", () => {
    const provenance = fixture("valid.json");
    expect(agentProgressionInputSchema.parse({
      contractVersion: "agent-progression/v2",
      resourceType: "requirement",
      resourceId: 12,
      intent: "READ_CONTEXT",
      provenance,
    }).provenance?.contractVersion).toBe(draftProvenanceContractVersion);
    expect(resourceScenarioInputSchema.parse({
      contractVersion: "resource-scenario/v1",
      resourceType: "requirement",
      resourceId: 12,
      operation: "requirement.update",
      provenance,
    }).provenance?.contractVersion).toBe(draftProvenanceContractVersion);
    expect(() => resourceScenarioExecuteInputSchema.parse({
      resourceType: "requirement",
      resourceId: 12,
      operation: "requirement.update",
      previewOperationId: "preview-1",
      idempotencyKey: "idem-1",
      provenance,
    })).toThrow();
    expect(agentProgressionInputSchema.parse({
      contractVersion: "agent-progression/v2",
      resourceType: "requirement",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      executeMode: "auto",
      provenance,
    }).provenance?.contractVersion).toBe(draftProvenanceContractVersion);
    expect(() => agentProgressionInputSchema.parse({
      contractVersion: "agent-progression/v2",
      resourceType: "requirement",
      resourceId: 12,
      intent: "UPDATE_NODE_FIELDS",
      executeMode: "auto",
      previewOperationId: "preview-1",
      provenance,
    })).toThrow(/不能提交新的 provenance/);
  });

  it("rejects conversation and pms namespace refs from persisted provenance", () => {
    const invalid = fixture("invalid-source-ref.json");
    const result = validateDraftProvenance(invalid);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROVENANCE_INVALID");
    }
    expect(() => draftProvenanceSchema.parse(invalid)).toThrow(/PROVENANCE_INVALID/);
    expect(() => draftProvenanceSchema.parse({
      ...invalid,
      fieldSources: {
        testResult: {
          ...invalid.fieldSources.testResult,
          sourceRefs: ["pms:context:requirement:12"],
        },
      },
    })).toThrow(/PROVENANCE_INVALID/);
  });

  it("requires every version axis and writes unknown versions as null", () => {
    const parsed = draftDigestInputSchema.parse({
      ...digestInput,
      versionSnapshot: {
        nodeVersion: null,
        entityVersion: null,
        workflowInstanceVersion: null,
        componentVersion: null,
        contextVersion: null,
      },
    });

    expect(parsed.versionSnapshot).toEqual({
      nodeVersion: null,
      entityVersion: null,
      workflowInstanceVersion: null,
      componentVersion: null,
      contextVersion: null,
    });
    expect(() => draftDigestInputSchema.parse({
      ...digestInput,
      versionSnapshot: { nodeVersion: 1 },
    })).toThrow(/entityVersion/);
  });

  it("produces a stable digest independent of object and sourceRef order", () => {
    const first = computeDraftDigest(digestInput);
    const reordered = draftDigestInputSchema.parse({
      fieldSources: {
        testResult: {
          confidence: "high",
          sourceRefs: ["requirement:12", "requirement-node:3"],
          sourceType: "pms_context",
        },
      },
      patch: { testResult: "PASS" },
      unresolvedDecisions: [],
      assumptions: [],
      inferences: [],
      facts: [{ sourceRefs: ["requirement:12"], text: "测试已通过" }],
      versionSnapshot: digestInput.versionSnapshot,
      requestedCompletion: false,
      intent: "UPDATE_NODE_FIELDS",
      componentKey: "requirement-node-workbench",
      nodeId: 3,
      resourceId: 12,
      resourceType: "requirement",
      contractVersion: "draft-provenance/v1",
    });

    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeDraftDigest(reordered)).toBe(first);
  });

  it("changes when any version axis changes and rejects a mismatched digest", () => {
    const original = computeDraftDigest(digestInput);
    const changed = computeDraftDigest({
      ...digestInput,
      versionSnapshot: { ...digestInput.versionSnapshot, componentVersion: 5 },
    });

    expect(changed).not.toBe(original);
    const provenance = { ...fixture("valid.json"), draftDigest: original };
    expect(validateDraftProvenance({ ...provenance, draftDigest: changed }).success).toBe(true);
    expect(verifyDraftDigest(digestInput, { ...provenance, draftDigest: changed })).toBe(false);
    expect(verifyDraftDigest(digestInput, provenance)).toBe(true);
  });

  it("rejects more than 200 fields, more than 20 refs, or a payload over 64 KiB", () => {
    const tooManyFields = {
      ...fixture("valid.json"),
      fieldSources: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
        `field-${index}`,
        {
          sourceType: "pms_context",
          sourceRefs: ["requirement:12"],
          confidence: "high",
        },
      ])),
    };
    const tooManyRefs = {
      ...fixture("valid.json"),
      fieldSources: {
        testResult: {
          sourceType: "pms_context",
          sourceRefs: Array.from({ length: 21 }, (_, index) => `requirement:${index + 1}`),
          confidence: "high",
        },
      },
    };
    const tooLarge = {
      ...fixture("valid.json"),
      fieldSources: {
        testResult: {
          sourceType: "pms_context",
          sourceRefs: [`requirement:${"1".repeat(65 * 1024)}`],
          confidence: "high",
        },
      },
    };

    expect(validateDraftProvenance(tooManyFields)).toMatchObject({ success: false, code: "PROVENANCE_TOO_LARGE" });
    expect(validateDraftProvenance(tooManyRefs)).toMatchObject({ success: false, code: "PROVENANCE_TOO_LARGE" });
    expect(validateDraftProvenance(tooLarge)).toMatchObject({ success: false, code: "PROVENANCE_TOO_LARGE" });
  });
});
