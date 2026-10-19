import type { CapabilityCatalog, OperationResult } from "../../../packages/pms-contracts/src/index.js";
import type { PmsClient } from "../../../packages/pms-client/src/index.js";
import { operationExecutePreview, operationPreview } from "../../../apps/pms-cli/src/commands/core/operation.js";

export interface ProjectFixture {
  projectId: number;
  name: string;
  created: true;
}

/**
 * Creates a project in the disposable E2E database using the registered
 * project.create command. There is no implicit cleanup here: the fixture is
 * intentionally scoped to the disposable database teardown.
 */
export async function createProjectFixture(
  client: PmsClient,
  runId: string,
): Promise<ProjectFixture> {
  const capabilities = await client.capabilities();
  const selected = selectProjectTemplate(capabilities);
  const name = `AI-E2E-项目-${runId}`;
  const preview = await operationPreview(client, "project.create", {
    arguments: {
      name,
      projectTypeId: selected.projectTypeId,
      workflowTemplateVersionId: selected.templateVersionId,
    },
    context: { id: "global:pms", version: "v1" },
  });
  const result = await operationExecutePreview(client, preview.operationId, `project-fixture-${runId}`);
  if (result.status !== "SUCCEEDED") throw new Error("项目夹具创建未成功");
  const projectId = readProjectId(result);
  if (projectId === null) throw new Error("项目夹具创建成功响应缺少项目 ID");
  const readback = await client.get({ type: "project", id: projectId });
  if (readback.resourceId !== projectId) throw new Error("项目夹具回读资源 ID 不一致");
  return { projectId, name, created: true };
}

function selectProjectTemplate(catalog: CapabilityCatalog): { projectTypeId: number; templateVersionId: number } {
  const type = catalog.workflowTypes.find((candidate) =>
    candidate.templates.some((template) => template.defaultTemplate && template.templateVersionId),
  ) ?? catalog.workflowTypes.find((candidate) =>
    candidate.templates.some((template) => template.templateVersionId),
  );
  const template = type?.templates.find((candidate) => candidate.defaultTemplate && candidate.templateVersionId)
    ?? type?.templates.find((candidate) => candidate.templateVersionId);
  if (!type?.projectTypeId || !template?.templateVersionId) {
    throw new Error("项目夹具能力目录缺少可用项目类型和流程模板");
  }
  return { projectTypeId: type.projectTypeId, templateVersionId: template.templateVersionId };
}

function readProjectId(result: OperationResult): number | null {
  const project = result.data.project;
  const rawId = project && typeof project === "object" && !Array.isArray(project)
    ? (project as Record<string, unknown>).id
    : result.data.projectId;
  return typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
}
