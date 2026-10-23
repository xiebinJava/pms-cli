import { describe, it, expect } from 'vitest';
import { projectScenarioAdapter } from '../../apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.js';
const contract = { command: 'project.update', contractVersion: 'project-profile/v1', projectId: 42, nodeId: 301, nodeVersion: 4, projectVersion: 9, fieldValuesPath: '$', writableFields: ['description'], completionSupported: false };
const snapshot = { resource: { type: 'project', id: 42 }, entityVersion: 9, currentNode: { id: 301 }, workflow: { nodes: [{ id: 301, version: 4, saveContract: contract }] } };
const context: any = { snapshot };
const input: any = { resourceType: 'project', operation: 'project.update', resourceId: 42, nodeId: 301, arguments: {}, draft: { patch: { description: 'new' }, fieldSources: { description: { sourceType: 'conversation', sourceRefs: ['conversation:latest'], confidence: 'high' } } } };
describe('project profile SAVE contract', () => {
 it('normalizes draft patch as canonical project.update arguments', async () => {
  expect(await projectScenarioAdapter.normalizeArguments(input, context)).toEqual({ projectId: 42, description: 'new' });
 });
 it('rejects protected member writes', async () => {
  await expect(projectScenarioAdapter.normalizeArguments({ ...input, draft: { patch: { members: [1] } } }, context)).rejects.toThrow();
 });
 it('rejects mismatched node versions', async () => {
  const stale = structuredClone(context); stale.snapshot.workflow.nodes[0].version = 5;
  await expect(projectScenarioAdapter.normalizeArguments(input, stale)).rejects.toThrow();
 });
});

import { vi } from 'vitest';
import { planAgentProgression, executeAgentProgression } from '../../apps/pms-cli/src/commands/scenarios/agentProgression.js';
import { agentProgressionContractVersion } from '../../packages/pms-contracts/src/index.js';
import { extractComponentContent } from '../../apps/pms-cli/src/commands/scenarios/readbackVerification.js';
const request: any = { contractVersion: agentProgressionContractVersion, resourceType: 'project', resourceId: 42, nodeId: 301, intent: 'UPDATE_NODE_FIELDS', executeMode: 'auto', draft: { facts: [], inferences: [], assumptions: [], unresolvedDecisions: [], patch: { description: 'new' }, fieldSources: { description: { sourceType: 'conversation', sourceRefs: ['conversation:latest'], confidence: 'high' } } } };
function profileClient() {
 return { context: vi.fn(async () => snapshot), capabilities: vi.fn(async () => ({ version: 'ai-v1', resources: [{ type: 'project', actions: [{ name: 'project.update', label: '保存', description: '保存', mode: 'automatic', risk: 'high', scopes: [], inputSchema: { projectId: { type: 'integer', required: true, label: '项目' }, description: { type: 'string', required: false, label: '描述' } }, requiresContext: true, refreshScopes: [] }] }], scopes: [], workflowTypes: [] })), preview: vi.fn(), executePreview: vi.fn() } as any;
}
describe('project profile progression', () => {
 it('selects high-risk project.update and requires confirmation during plan', async () => {
  const client = profileClient(); const plan = await planAgentProgression(client, request);
  expect(plan.operation).toBe('project.update'); expect(plan.requiresConfirmation).toBe(true);
  expect(client.preview).not.toHaveBeenCalled();
 });
 it('does not auto execute profile SAVE', async () => {
  const client = profileClient(); const result = await executeAgentProgression(client, { ...request, previewOperationId: 'p1', idempotencyKey: 'i1' });
  expect(result.status).toBe('WAITING_CONFIRMATION'); expect(client.executePreview).not.toHaveBeenCalled();
 });
 it('rejects completion of SAVE-only profile before preview', async () => {
  const client = profileClient(); await expect(planAgentProgression(client, { ...request, intent: 'COMPLETE_NODE', draft: { ...request.draft, requestedCompletion: true } })).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
  expect(client.preview).not.toHaveBeenCalled();
 });
 it('reads selected node canonical field values', () => {
  const context: any = structuredClone(snapshot); context.workflow.nodes[0].fieldValues = { description: 'new' };
  expect(extractComponentContent({ context, resource: null } as any, 'project', undefined, 301)).toEqual({ description: 'new' });
 });
});

import { buildNodeContract } from '../../apps/pms-cli/src/commands/core/agentContext.js';
describe('project profile discovery and readonly policy', () => {
 it('exposes canonical field metadata and existing values', () => {
  const context: any = structuredClone(snapshot);
  Object.assign(context.workflow.nodes[0], { key: 'kickoff', label: '立项', position: 0, components: [],
   fieldValues: { description: 'saved' }, fields: [{ key: 'project-description', label: '项目描述', type: 'TEXTAREA', required: true }],
   saveContract: { ...contract, fieldContracts: [{ key: 'description', label: '项目描述', type: 'textarea', required: false }] } });
  context.allowedActions = ['project.update'];
  expect(buildNodeContract(context).requiredFields).toEqual([{ key: 'description', label: '项目描述', type: 'textarea', required: false, currentValue: 'saved' }]);
 });
 it('rejects historical readonly profile saves', async () => {
  const readonly = structuredClone(context); readonly.snapshot.workflow.nodes[0].permissions = { readOnly: true };
  await expect(projectScenarioAdapter.normalizeArguments(input, readonly)).rejects.toThrow();
 });
});
