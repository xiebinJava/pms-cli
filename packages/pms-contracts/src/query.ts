import { z } from "zod";

/** Resource types currently supported by the PMS read facade. */
export const queryResourceTypeSchema = z.enum([
  "requirement",
  "project",
  "topic",
  "story",
  "task",
  "subtask",
  "iteration_plan",
]);
export type QueryResourceType = z.infer<typeof queryResourceTypeSchema>;

export const workflowResourceTypeSchema = z.enum([
  "requirement",
  "project",
  "topic",
  "story",
]);

export const queryRequestSchema = z.object({
  resourceType: queryResourceTypeSchema,
  keyword: z.string().trim().max(200).optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});

export const queryItemSchema = z.object({
  type: queryResourceTypeSchema,
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string().optional(),
  version: z.number().int().nonnegative().nullable().optional(),
  summary: z.record(z.string(), z.unknown()).default({}),
});

export const queryResultSchema = z.object({
  resourceType: queryResourceTypeSchema,
  items: z.array(queryItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalPage: z.number().int().nonnegative(),
  queryScope: z.string().min(1),
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryItem = z.infer<typeof queryItemSchema>;
export type QueryResult = z.infer<typeof queryResultSchema>;

export const resourceDetailSchema = z.object({
  resourceType: queryResourceTypeSchema,
  resourceId: z.number().int().positive(),
  entityVersion: z.number().int().nonnegative().nullable(),
  details: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type ResourceDetail = z.infer<typeof resourceDetailSchema>;

export interface ResourceRef {
  type: QueryItem["type"];
  id: number;
}

export interface WorkflowContext {
  resource: ResourceRef;
  version: number | null;
  entityVersion?: number | null;
  resourceDetails?: Record<string, unknown>;
  meta?: ContextMeta;
  currentNode?: {
    id: number | null;
    key: string;
    label: string;
  };
  workflow?: {
    templateVersionId?: number;
    templateVersionNo?: number;
    nodes: unknown[];
  };
  relations?: Array<{
    resourceType: QueryResourceType;
    resourceId: number;
    label: string;
    readable: boolean;
  }>;
  allowedActions: string[];
}

export const workflowContextResponseSchema = z.object({
  resourceType: workflowResourceTypeSchema,
  resourceId: z.number().int().positive(),
  version: z.number().int().nonnegative().nullable(),
  entityVersion: z.number().int().nonnegative().nullable().optional(),
  resourceDetails: z.record(z.string(), z.unknown()).optional(),
  currentNode: z.object({
    id: z.number().int().positive().nullable(),
    key: z.string().min(1),
    label: z.string().min(1),
  }).nullable().optional(),
  workflow: z.object({
    templateVersionId: z.number().int().positive().nullable().optional(),
    templateVersionNo: z.number().int().positive().nullable().optional(),
    nodes: z.array(z.unknown()),
  }).nullable().optional(),
  relations: z.array(z.object({
    resourceType: queryResourceTypeSchema,
    resourceId: z.number().int().positive(),
    label: z.string().min(1),
    readable: z.boolean(),
  })).optional(),
  allowedActions: z.array(z.string()).default([]),
}).passthrough();

export interface ContextReadOptions {
  /** JS-safe positive id of the actual node to select ( Shall reject > MAX_SAFE_INTEGER ). */
  nodeId?: number;
  /** Explicit view; defaults to legacy on both sides. */
  view?: "legacy" | "focused";
  /** Exact component key; only valid with the focused view. */
  component?: string;
}

export const workflowContextFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.string().nullable().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  visible: z.boolean().nullable().optional(),
  binding: z.string().nullable().optional(),
  fullWidth: z.boolean().nullable().optional(),
});

/** Field-level write metadata published by PMS for external Agent drafts. */
export const workflowContextFieldContractSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
  type: z.string().trim().min(1).optional(),
  required: z.boolean().optional(),
  nullable: z.boolean().optional(),
  collection: z.boolean().optional(),
  options: z.array(z.string()).optional(),
}).catchall(z.unknown());

/**
 * Additive save-contract envelope. Older PMS versions may still return arbitrary records, so
 * unknown keys remain accepted while the node-detail fields get a stable typed surface.
 */
export const workflowContextSaveContractSchema = z.object({
  contractVersion: z.string().trim().min(1).optional(),
  componentContractVersion: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
  itemType: z.string().trim().min(1).optional(),
  itemId: z.number().int().positive().optional(),
  nodeId: z.number().int().positive().optional(),
  version: z.number().int().nonnegative().optional(),
  componentKey: z.string().trim().min(1).optional(),
  variant: z.string().trim().min(1).optional(),
  fieldValuesPath: z.string().trim().min(1).optional(),
  writableFields: z.array(z.string().trim().min(1)).optional(),
  effectiveWritableFields: z.array(z.string().trim().min(1)).optional(),
  protectedFields: z.array(z.string().trim().min(1)).optional(),
  requiredFields: z.array(z.string().trim().min(1)).optional(),
  fieldContracts: z.array(workflowContextFieldContractSchema).optional(),
  completionSupported: z.boolean().optional(),
  completionCommand: z.string().trim().min(1).optional(),
  completionRequiredMetadata: z.array(z.string().trim().min(1)).optional(),
}).catchall(z.unknown());

export const workflowContextComponentSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(workflowContextFieldSchema).default([]),
  actions: z.array(z.string()).default([]),
  config: z.unknown().nullable().optional(),
  content: z.unknown().nullable().optional(),
  contentState: z.enum(["LOADED", "EMPTY", "NOT_REQUESTED", "UNSUPPORTED"]).nullable().optional(),
  versions: z.record(z.string(), z.number().int().nullable()).nullable().optional(),
  saveContract: workflowContextSaveContractSchema.nullable().optional(),
});

export const workflowContextNodeSchema = z.object({
  id: z.number().int().positive().nullable(),
  key: z.string().min(1),
  label: z.string().min(1),
  position: z.number().int().nonnegative(),
  status: z.number().int().nonnegative().nullable().optional(),
  components: z.array(workflowContextComponentSchema).default([]),
  fields: z.array(workflowContextFieldSchema).default([]),
  fieldValues: z.record(z.string(), z.unknown()).default({}),
  version: z.number().int().nonnegative().nullable().optional(),
  description: z.string().nullable().optional(),
  deliverable: z.string().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  fieldValueVersions: z.record(z.string(), z.number().int().nonnegative()).nullable().optional(),
  fieldValuesState: z.enum(["LOADED", "NOT_REQUESTED", "UNAVAILABLE"]).nullable().optional(),
  permissions: z.unknown().nullable().optional(),
  taskSummary: z.object({
    total: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
  }).nullable().optional(),
});

export const workflowContextMetaSchema = z.object({
  formatVersion: z.literal(2),
  pureRead: z.literal(true),
  loadedAt: z.string().min(1),
  businessTimezone: z.string().min(1),
  view: z.enum(["legacy", "focused"]),
  fieldValuesScope: z.enum(["all-nodes", "selected-node"]),
  componentContentScope: z.enum(["selected-node", "selected-component"]),
  selectedNodeId: z.number().int().positive().nullable().optional(),
  selectedComponentKey: z.string().min(1).nullable().optional(),
  workflowConfigured: z.boolean(),
  workflowStatus: z.string().min(1),
  terminalStatus: z.string().nullable().optional(),
  workflowInstanceVersion: z.number().int().nonnegative().nullable().optional(),
  permissionsScope: z.string().min(1),
  referencesScope: z.string().min(1),
  contextVersion: z.string().min(1).optional(),
  warnings: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  })).default([]),
});

export type ContextMeta = z.infer<typeof workflowContextMetaSchema>;
export type ContextNode = z.infer<typeof workflowContextNodeSchema>;
export type ContextComponent = z.infer<typeof workflowContextComponentSchema>;
export type ContextFieldContract = z.infer<typeof workflowContextFieldContractSchema>;
export type ContextSaveContract = z.infer<typeof workflowContextSaveContractSchema>;

export const workflowContextV2ResponseSchema = workflowContextResponseSchema.extend({
  meta: workflowContextMetaSchema,
  workflow: z.object({
    templateVersionId: z.number().int().positive().nullable().optional(),
    templateVersionNo: z.number().int().positive().nullable().optional(),
    nodes: z.array(workflowContextNodeSchema),
  }).nullable().optional(),
});
