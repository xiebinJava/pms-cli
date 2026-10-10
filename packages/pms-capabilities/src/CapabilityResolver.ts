import type {
  ActionCapability,
  CapabilityCatalog,
  FieldSchema,
  WorkflowComponent,
  WorkflowNode,
  WorkflowTypeCapability,
  WorkflowCapability,
} from "../../pms-contracts/src/index.js";

export class CapabilityResolutionError extends Error {
  readonly name = "CapabilityResolutionError";
}

export interface ComponentLocator {
  processType: string;
  templateVersionId?: number;
  nodeKey: string;
  componentKey: string;
}

export class DynamicCapabilityResolver {
  constructor(private readonly catalog: CapabilityCatalog) {}

  actionsFor(resourceType: string): ActionCapability[] {
    return this.catalog.resources.find((resource) => resource.type === resourceType)?.actions ?? [];
  }

  action(resourceType: string, actionName: string): ActionCapability {
    const action = this.actionsFor(resourceType).find((candidate) => candidate.name === actionName);
    if (!action) {
      throw new CapabilityResolutionError(`能力目录中不存在动作: ${resourceType}.${actionName}`);
    }
    return action;
  }

  workflowType(processType: string): WorkflowTypeCapability {
    const workflow = this.catalog.workflowTypes.find((candidate) => candidate.processType === processType);
    if (!workflow) throw new CapabilityResolutionError(`能力目录中不存在流程类型: ${processType}`);
    return workflow;
  }

  template(processType: string, templateVersionId?: number): WorkflowCapability | undefined {
    const templates = this.workflowType(processType).templates;
    if (templateVersionId !== undefined) {
      return templates.find((candidate) => candidate.templateVersionId === templateVersionId);
    }
    const defaults = templates.filter((candidate) => candidate.defaultTemplate === true);
    return defaults.length === 1 ? defaults[0] : undefined;
  }

  templateCandidates(processType: string, name: string): WorkflowCapability[] {
    const normalizedName = name.trim();
    if (!normalizedName) return [];
    return this.workflowType(processType).templates.filter((candidate) => candidate.name?.trim() === normalizedName);
  }

  node(locator: Omit<ComponentLocator, "componentKey">): WorkflowNode {
    const template = this.requireTemplate(locator.processType, locator.templateVersionId);
    const node = template.nodes.find((candidate) => candidate.key === locator.nodeKey);
    if (!node) throw new CapabilityResolutionError(
      `流程模板中不存在节点: ${locator.processType}/${locator.nodeKey}`,
    );
    return node;
  }

  component(locator: ComponentLocator): WorkflowComponent {
    const node = this.node(locator);
    const component = node.components.find((candidate) => candidate.key === locator.componentKey);
    if (!component) throw new CapabilityResolutionError(
      `流程节点中不存在组件: ${locator.processType}/${locator.nodeKey}/${locator.componentKey}`,
    );
    return component;
  }

  fields(locator: ComponentLocator): FieldSchema[] {
    const fields = this.component(locator).fields;
    return Array.isArray(fields) ? fields : Object.entries(fields).map(([key, field]) => ({ key, ...field }));
  }

  private requireTemplate(processType: string, templateVersionId?: number): WorkflowCapability {
    const template = this.template(processType, templateVersionId);
    if (!template) throw new CapabilityResolutionError(
      `流程类型没有可用模板: ${processType}${templateVersionId === undefined ? "" : `/${templateVersionId}`}`,
    );
    return template;
  }
}
