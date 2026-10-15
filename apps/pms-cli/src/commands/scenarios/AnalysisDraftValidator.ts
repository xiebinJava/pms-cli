import type { AnalysisDraft, WorkflowContext } from "../../../../../packages/pms-contracts/src/index.js";

const PROTECTED_FIELDS = new Set([
  "systemId",
  "targetType",
  "targetId",
  "ownerId",
  "status",
  "startDate",
  "endDate",
]);

export const AnalysisDraftValidator = {
  validate(draft: AnalysisDraft, context: WorkflowContext): void {
    const readableReferences = new Set<string>([
      `${context.resource.type}:${context.resource.id}`,
      ...(context.relations ?? [])
        .filter((relation) => relation.readable)
        .map((relation) => `${relation.resourceType}:${relation.resourceId}`),
    ]);

    for (const item of [
      ...draft.facts,
      ...draft.inferences,
      ...draft.assumptions,
      ...draft.unresolvedDecisions,
    ]) {
      for (const sourceRef of item.sourceRefs) {
        if (!readableReferences.has(sourceRef)) {
          throw new Error(`未授权或不存在的引用: ${sourceRef}`);
        }
      }
    }

    const protectedField = Object.keys(draft.patch).find((key) => PROTECTED_FIELDS.has(key));
    if (protectedField) {
      throw new Error(`分析草稿不能覆盖受保护字段: ${protectedField}`);
    }
  },
};
