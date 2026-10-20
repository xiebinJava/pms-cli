# Project and Topic Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test and review gate.

**Goal:** Extend the existing `ai-orchestrator-v1` session flow to project and topic node updates/completions while preserving requirement/story behavior and the frozen `resource-scenario` safety contract.

**Architecture:** The existing Conversation, Plan, OperationEvent, PlanView, PMS preview/execute operation, and verification flow remain the single orchestration path. A resource adapter registry maps project/topic context and saveContracts into the existing flow; PMS remains the authority for permissions, field rules, versions, idempotency, and audit. External Claude/Codex/DeepSeek agents still produce structured drafts and the CLI remains stateless.

**Tech Stack:** Java 17/Spring Boot/MyBatis-Plus/Flyway, TypeScript, Zod, Vitest, existing `PmsClient`, PMS Connector operations, MySQL isolated E2E.

**Spec:** `docs/superpowers/specs/2026-10-20-project-topic-orchestrator-design.md`

**Repositories:** Connector changes are committed in `/Users/fs/Desktop/Project/pms-ai-connector`; backend changes are committed independently in `/Users/fs/Desktop/Project/pms-backend`. Never stage files from the sibling repository into the other repository's commit.

## Global Constraints

- Reuse the existing Orchestrator tables, routes, PlanView, event sequence, and recovery semantics; do not create a parallel session model.
- `contextVersion` keeps its existing requirement/story command meaning; on project/topic it is only a context snapshot label and never substitutes for `nodeVersion`.
- Project `nodeVersion` comes from the selected component `saveContract.nodeVersion`; topic `nodeVersion` comes from the selected node/nodeContract version.
- PMS preview `expectedVersions` is the concurrency authority; `draftDigest` must bind the five-axis version snapshot and the exact draft.
- Component selection is based on writable saveContracts: one may be implicit, multiple require explicit `componentKey`, zero is readable but not writable.
- `NEEDS_INPUT` continuation creates a new Plan and merges only still-valid patch fields; the previous Plan remains immutable and the state transition table is not relaxed.
- `COMPLETE_NODE` without `requestedCompletion=true` maps only at the `agent-progression-run/v2` boundary to `REJECTED + NEEDS_INPUT + COMPLETION_NOT_REQUESTED`; do not add `REJECTED` to `AiOrchestratorState` or Plan state.
- Invalid/oversized provenance maps to the run envelope as `REJECTED`; turn responses remain PlanView responses.
- Every write uses PMS preview, execute, idempotency, audit, and focused readback. No direct business Mapper access from the adapter.
- No model URL, API key, token, password, or complete chat transcript is stored in PMS or CLI.
- This phase uses a merge/release gate rather than a runtime feature flag: project/topic Orchestrator code may be exercised on the feature branch, but cannot merge to the release branch or be deployed until Task 7's isolated suite passes and Task 8 records the gate.

## Review Focus

- A project `context.version` must never be sent as the project node version; cover this in backend command mapping and digest tests.
- A project with multiple writable components must return `CAPABILITY_UNAVAILABLE` without selecting the first array element; cover one, many, zero, and non-writable selections.
- `REJECTED` must remain a progression-run envelope result and must not appear in the Orchestrator state enum; cover state and contract tests together.
- PMS-returned `expectedVersions`, `provenanceRef`, and `draftDigest` must be preserved and bound to the original preview; cover stale preview and replay.
- Missing project `fieldContracts/requiredFields` must be reported through preview preconditions rather than fabricated `missingFields`; cover project and topic separately.
- Project readback without a declared `fieldContracts` must use preview preconditions and returned focused values; verify that Task 5 does not fabricate a project field contract.
- A `NEEDS_INPUT` follow-up must create a new immutable Plan and re-filter the old patch against the current saveContract.

### Task 0: Freeze the cross-repository contract and test vectors

**Files:**
- Modify: `packages/pms-contracts/src/orchestrator.ts`
- Modify: `packages/pms-client/src/OrchestratorClientTypes.ts`
- Modify: `packages/pms-client/src/PmsClient.ts`
- Modify: `tests/contract/orchestrator-client.test.ts`
- Modify: `tests/contract/orchestrator-session.test.ts`
- Modify: `tests/contract/story-orchestrator-contract.test.ts`
- Create: `tests/contract/project-topic-orchestrator-contract.test.ts`
- Create: `tests/fixtures/provenance/draft-provenance-v1.json` (Connector canonical copy)
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/resources/fixtures/provenance/draft-provenance-v1.json` (Backend test-resource copy)
- Create: `scripts/verify-provenance-fixture-sync.mjs`

**Interfaces:** Extend existing orchestrator schemas with `resourceType: "project" | "topic"`, `RESOURCE_NODE_FIELD_UPDATE`, `RESOURCE_NODE_COMPLETE`, `nodeVersion`, `componentKey`, optional resource-node fields, and the resource-neutral node contract. Keep requirement/story literals and response parsing backward compatible.

- [ ] Write failing Zod tests for project/topic Conversation, `resource-node/v1` Draft, PlanView, `nodeVersion`, `componentKey`, optional contract fields, and fixed `REJECTED` run mapping.
- [ ] Add `nodeVersion` and `componentKey` to `AppendTurnRequest`; send them only when defined so existing callers keep their wire shape.
- [ ] Make `nodeContract` fields that PMS does not declare optional; do not synthesize `allowedActions`, `allowedTransitions`, `missingInputRules`, or `requiredFields`.
- [ ] Add the provenance golden vector to both fixture paths byte-for-byte; the Connector copy is the canonical authoring location and the backend copy is a checked-in test-resource duplicate, not an npm package asset.
- [ ] Add `scripts/verify-provenance-fixture-sync.mjs` to compare the two files with SHA-256/byte equality and fail with both absolute paths when they diverge.
- [ ] Run `pnpm vitest run tests/contract/orchestrator-client.test.ts tests/contract/orchestrator-session.test.ts tests/contract/project-topic-orchestrator-contract.test.ts` and expect the new tests to pass after implementation.
- [ ] Run `pnpm run typecheck` and `PMS_BACKEND_ROOT=/Users/fs/Desktop/Project/pms-backend node scripts/verify-provenance-fixture-sync.mjs`.
- [ ] Review the wire shape against the backend DTO task before committing.
- [ ] Commit: `feat(contract): add project topic orchestrator schemas`.

### Task 1: Extend backend persistence and request/response models without changing state semantics

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/api/AiOrchestratorRequest.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/api/AiOrchestratorResponse.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/domain/AiOrchestratorIntent.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/persistence/AiPlanDO.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/persistence/AiPlanMapper.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/resources/db/migration/V73__ai_orchestrator_project_topic_binding.sql`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/contract/ResourceNodeContract.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorStateTest.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorPersistenceTest.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorResourceContractTest.java`

**Interfaces:** Add `Long nodeVersion` and `String componentKey` to `AppendTurnRequest`/`AppendTurnCommand`; add the same fields to PlanView and persist them as nullable `pms_ai_plan.node_version` and `pms_ai_plan.component_key`. Add `RESOURCE_NODE_FIELD_UPDATE` and `RESOURCE_NODE_COMPLETE` to `AiOrchestratorIntent`. Keep `AiOrchestratorState` exactly as `RECEIVED`, `CONTEXT_READY`, `DRAFT_VALIDATED`, `NEEDS_INPUT`, `PLAN_READY`, `PREVIEWED`, `WAITING_CONFIRMATION`, `EXECUTING`, `VERIFYING`, `WRITE_RESULT_UNKNOWN`, `SUCCEEDED`, `FAILED`, `CONFLICT`, `CANCELLED`.

- [ ] Write failing DTO tests proving project/topic requests deserialize with `nodeVersion` and `componentKey`, while requirement/story requests still deserialize unchanged.
- [ ] Add the Flyway columns with nullable defaults and indexes only if the existing query path needs them; do not add a new Conversation/Plan/Event table.
- [ ] Implement `ResourceNodeContract` with required common fields (`nodeId`, `key`, `label`, `version`, `writableFields`, `protectedFields`, `writeCapable`) and optional declared fields.
- [ ] Verify state tests reject any attempt to add `ACTIVE` or `REJECTED` and preserve the existing `NEEDS_INPUT` transition table.
- [ ] Run `mvn -Dtest=AiOrchestratorStateTest,AiOrchestratorPersistenceTest,AiOrchestratorResourceContractTest test`.
- [ ] Review migration compatibility with the existing MySQL schema before committing.
- [ ] Commit: `feat(orchestrator): persist project topic node bindings`.

### Task 2: Introduce the resource adapter boundary and focused preflight

**Files:**
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/adapter/ResourceOrchestratorAdapter.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/adapter/ResourceOrchestratorAdapterRegistry.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/adapter/ResourceNodeBinding.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/adapter/ProjectOrchestratorAdapter.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/adapter/TopicOrchestratorAdapter.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/contract/AiAgentDraftValidator.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiAgentDraftValidatorTest.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/ResourceOrchestratorAdapterTest.java`

**Interfaces:** `ResourceOrchestratorAdapter` must expose resource identity, focused context loading, `ResourceNodeBinding resolveBinding(context, nodeId, componentKey, nodeVersion)`, draft validation, command mapping, and resource readback. `ResourceNodeBinding` carries `nodeId`, `nodeVersion`, `componentKey`, `saveContract`, and the five-axis version snapshot. The registry selects project/topic by `resourceType`; existing requirement/story paths remain inline in `AiOrchestratorService` until a separate refactor is explicitly approved.

- [ ] Write failing tests for one writable saveContract, multiple writable saveContracts without `componentKey`, explicit non-writable component, zero writable contracts, wrong current node, and project `project-basic-info` resource-level boundary.
- [ ] Implement binding resolution from focused context; project node version must come from `saveContract.nodeVersion`, never `context.version`.
- [ ] Implement the exact component selection rules and return `CAPABILITY_UNAVAILABLE` in-band for ambiguous or non-writable writes while keeping read-only context available.
- [ ] Validate `nodeId === currentNode.id` only for node commands; leave `project.update`/`project.create` outside this guard.
- [ ] Run the focused backend adapter tests and existing context tests.
- [ ] Review that no adapter reads business Mapper classes or selects the first component implicitly.
- [ ] Commit: `feat(orchestrator): add project topic resource adapters`.

### Task 3: Implement draft provenance and version binding

**Files:**
- Create: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/provenance/DraftProvenanceDigestService.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/DraftProvenanceDigestServiceTest.java`
- Read: `/Users/fs/Desktop/Project/pms-backend/src/test/resources/fixtures/provenance/draft-provenance-v1.json` (the byte-identical copy created in Task 0)
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorService.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/command/CommandPreviewRequest.java` only if the existing provenance field cannot carry the adapter output
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/connector/AiProvenanceValidator.java` only for shared validation gaps
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/connector/AiProvenanceValidatorTest.java`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-contracts/src/provenance.ts` only if the golden vector exposes a contract mismatch
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/contract/agent-provenance-contract.test.ts`

**Interfaces:** `DraftProvenanceDigestService.compute(DigestInput input): String` must implement the frozen canonical JSON and SHA-256 algorithm. `DigestInput` includes `contractVersion`, resource identity, `nodeId`, `componentKey`, intent, `requestedCompletion`, the five-axis `versionSnapshot`, facts, inferences, assumptions, unresolved decisions, patch, and fieldSources. The service returns `provenance = {contractVersion, draftDigest, fieldSources}` for `CommandPreviewRequest.provenance`.

- [ ] Write failing Java tests from `/Users/fs/Desktop/Project/pms-backend/src/test/resources/fixtures/provenance/draft-provenance-v1.json`, including sorted object keys, sorted `sourceRefs`, preserved array order, explicit `null` axes, and the `sha256:` prefix; the Task 0 sync script must have already proved byte equality with the Connector copy.
- [ ] Implement the canonicalizer and size/reference limits without storing full conversation text.
- [ ] Build `versionSnapshot` from `ResourceNodeBinding`: project `saveContract.nodeVersion`, project entity/context version as separate axes, workflow instance version, component version, and null for unknown values.
- [ ] Pass the generated provenance into the existing `CommandPreviewRequest`; do not accept an externally supplied digest without recomputing it.
- [ ] After preview, require PMS `expectedVersions`, `provenanceRef=operation:<previewOperationId>`, and matching `draftDigest` before exposing `PREVIEWED`/`WAITING_CONFIRMATION`.
- [ ] Run backend provenance tests plus `pnpm vitest run tests/contract/agent-provenance-contract.test.ts` and `pnpm run typecheck`.
- [ ] Review the Java and TypeScript golden-vector output byte-for-byte.
- [ ] Commit: `feat(orchestrator): bind project topic plans to provenance`.

### Task 4: Route project/topic turns through the existing Orchestrator flow

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorService.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/contract/AgentDraft.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/contract/AiAgentDraftValidator.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorServiceTest.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/ProjectTopicOrchestratorTurnTest.java`

**Interfaces:** Project/topic drafts use `resource-node/v1` while reusing the existing `AnalysisDraft` item shape. `AiOrchestratorService.appendTurn` delegates project/topic to the registry, persists a Plan with `nodeVersion`/`componentKey`, and keeps requirement/story behavior unchanged. The adapter returns `NEEDS_INPUT`, `CAPABILITY_UNAVAILABLE`, or `CONFLICT` in-band; it does not add those values to `AiOrchestratorState`.

- [ ] Write failing tests for project/topic conversation creation, valid field update, valid completion, missing fields, missing sources, unsupported component, and current-node conflict.
- [ ] Extend resource type validation in conversation creation and preserve user scope/resource existence checks.
- [ ] Add optional `requestedCompletion` and `fieldSources` to the resource-node draft mapping without changing requirement/story validation rules.
- [ ] Implement project/topic turn handling through `ResourceOrchestratorAdapterRegistry` and the existing event sequence (`CONTEXT_READ`, `DRAFT_VALIDATED`, `INPUT_REQUIRED`, `PLAN_CREATED`).
- [ ] Implement `NEEDS_INPUT` continuation by creating a new turn/Plan and merging only valid prior patch entries; assert the old Plan JSON and status remain unchanged.
- [ ] Keep `REJECTED` out of backend Plan/state; expose it only in the CLI progression-run projection task.
- [ ] Run `mvn -Dtest=AiOrchestratorServiceTest,ProjectTopicOrchestratorTurnTest,AiAgentDraftValidatorTest test`.
- [ ] Review the diff for accidental changes to requirement/story intent or state transitions.
- [ ] Commit: `feat(orchestrator): route project topic turns through adapters`.

### Task 5: Add generic preview, confirmation, focused readback, and recovery

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorService.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorVerificationService.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/api/AiOrchestratorResponse.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorVerificationServiceTest.java`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorPersistenceTest.java`
- Create: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/ProjectTopicOrchestratorRecoveryTest.java`

**Interfaces:** Adapter readback returns resource detail, focused context, selected component field values, and fields from `saveContract.fieldContracts` where that contract is declared. When project does not declare `fieldContracts`, verification must use preview preconditions and the returned focused values; it must not fabricate a project field contract. Verification must compare the normalized patch against focused readback and confirm protected fields and current node identity.

- [ ] Write failing tests for `PLAN_READY → PREVIEWED → WAITING_CONFIRMATION → EXECUTING → VERIFYING → SUCCEEDED` using a project fixture.
- [ ] Map project to `node.field.update`/`node.complete-with-data` and topic to `development-item.node.field.update`/`development-item.node.complete-with-data`; preserve project `project-basic-info` as resource-level `project.update`.
- [ ] Confirm uses the stored preview operation, original provenance, original expected versions, and idempotency key; it never submits a new provenance object.
- [ ] Implement focused readback verification and map mismatched fields, protected-field changes, and current-node changes to failed/unknown semantics instead of treating operation success as proof.
- [ ] Cover same-key replay, different-preview rejection, version conflict, `WRITE_RESULT_UNKNOWN`, event sequence continuity, and session reload in tests.
- [ ] Run the focused backend recovery/verification tests and the full backend orchestrator test package.
- [ ] Review failure paths for transaction boundaries and no duplicate business writes.
- [ ] Commit: `feat(orchestrator): add project topic recovery and verification`.

### Task 6: Expand Connector client and CLI orchestration commands

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-client/src/OrchestratorClientTypes.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-client/src/PmsClient.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-client/src/orchestrator.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-contracts/src/orchestrator.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/cli/runCli.ts`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/commands/scenarios/resourceOrchestrator.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/commands/scenarios/requirementAnalysis.ts` only for shared result projection
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/commands/scenarios/storyOrchestrator.ts` only for shared result projection
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/unit/orchestrator-cli.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/unit/orchestrator-client.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/contract/orchestrator-session.test.ts`

**Interfaces:** `PmsClient.appendTurn` accepts `{ conversationId, message, contractVersion, draft, nodeId?, nodeVersion?, componentKey?, contextVersion?, requestId? }`; existing methods keep their routes. Add the CLI command `pms scenario resource-orchestrator create|turn|preview|confirm|events|session <project|topic> <id> [options]`, implemented by `resourceOrchestrator.ts` and dispatched from `runCli.ts`. Parsing accepts project/topic PlanView and preserves preview `expectedVersions`, `provenanceRef`, `draftDigest`, and operation warnings.

- [ ] Write failing client tests for project/topic Conversation creation and turn requests with `nodeVersion`/`componentKey`.
- [ ] Implement schema/client changes without adding another HTTP client or embedding model configuration.
- [ ] Implement `pms scenario resource-orchestrator create|turn|preview|confirm|events|session <project|topic> <id> [options]` and add help/argument validation; `REJECTED` is emitted only at progression-run boundary and the Orchestrator turn remains PlanView-shaped.
- [ ] Add human-facing output assertions that use resource/node/component labels while retaining IDs only in machine-readable fields.
- [ ] Run `pnpm vitest run tests/unit/orchestrator-cli.test.ts tests/unit/orchestrator-client.test.ts tests/contract/orchestrator-session.test.ts` and `pnpm run typecheck`.
- [ ] Review backward compatibility with existing requirement/story CLI commands.
- [ ] Commit: `feat(cli): support project topic orchestrator sessions`.

### Task 7: Add isolated real project and topic Orchestrator E2E

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/support/projectFixture.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/support/topicFixture.ts`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-project-node.e2e.test.ts`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-topic-node.e2e.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/scripts/verify-real-pms-agent-suite.sh`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/package.json`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/e2e-report.md`

**Interfaces:** Fixtures must create or discover resources through capabilities/context/saveContract, never fixed node IDs or component array positions. Each E2E uses isolated MySQL, dedicated test data, and the existing OAuth/session harness.

- [ ] Write project E2E for `create conversation → read focused context → append draft → preview → confirm → focused readback → session reload`.
- [ ] Write topic E2E for the same path, including a topic component with a development-item command.
- [ ] Add negative cases for multiple writable components, missing `requestedCompletion`, stale `nodeVersion`, and provenance mismatch.
- [ ] Add recovery assertions for same-key replay and `WRITE_RESULT_UNKNOWN` without introducing an operation GET endpoint.
- [ ] Add both tests to the unified suite behind explicit environment gates; default runs remain safe and skip without isolated PMS variables.
- [ ] Run `pnpm run verify:real-pms:agent-suite` against an isolated backend/MySQL and record test counts and cleanup evidence.
- [ ] Review that the suite destroys the isolated database and does not use shared pre-existing IDs.
- [ ] Commit: `test(e2e): verify project topic orchestrator sessions`.

### Task 8: Release gate and documentation synchronization

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/superpowers/plans/2026-10-19-four-resource-agent-orchestrator-roadmap.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/e2e-agent-cli-runbook.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/release-checklist.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/orchestrator-session-contract.md`
- Modify: `/Users/fs/Desktop/Project/pms-backend/docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/skills/pms-project-management/SKILL.md`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/docs/orchestrator-project-topic-acceptance-report.md`

**Interfaces:** Documentation must describe the same resource/intent table, state/event distinction, version axes, component rules, provenance binding, run-boundary `REJECTED`, and E2E commands as the implementation.

- [ ] Update roadmap Task 5.1/5.2 checklist only after their focused tests and reviews pass; do not mark the milestone complete from documentation alone.
- [ ] Add release gates for backend unit/integration tests, Connector unit/contract/typecheck/build, isolated project/topic E2E, and Markdown/static checks.
- [ ] Document that “disabled until the isolated suite passes” is a merge/release gate, not a runtime feature flag: Tasks 4–6 remain on the feature branch, Task 7 must pass in isolation, and only after Task 8 records the gate may the project/topic allow-list merge to the release branch or deploy.
- [ ] Run `PMS_BACKEND_ROOT=/Users/fs/Desktop/Project/pms-backend node scripts/verify-provenance-fixture-sync.mjs` as a release gate and attach its output to the acceptance record.
- [ ] Run the full Connector suite (`pnpm test`), `pnpm run typecheck`, `pnpm run build:cli`, and the targeted backend Maven test suite.
- [ ] Run `git diff --check` in both repositories and verify no credentials or untracked generated files are staged.
- [ ] Perform final review against every item in this plan and the design spec.
- [ ] Commit: `docs(orchestrator): record project topic acceptance gates`.

## Dependency Order

1. Task 0 freezes the wire contract and digest vectors.
2. Task 1 adds backend storage and DTO compatibility.
3. Task 2 provides binding/preflight used by Tasks 3–5.
4. Task 3 provides provenance and version binding used by preview.
5. Task 4 routes turns and multi-turn input through adapters.
6. Task 5 completes preview/confirm/readback/recovery.
7. Task 6 updates Connector/CLI clients against the backend contract.
8. Task 7 runs real isolated project/topic acceptance.
9. Task 8 updates release gates and marks roadmap progress.

Each task must finish its focused tests, code review, regression check, and commit before the next task starts. Do not open the project/topic capability gate before Task 7 passes.

This plan is the executable breakdown of roadmap Milestone 5: Task 0–6 deliver the four-resource adapter and session contract required by roadmap Task 5.1; Task 5, Task 7, and the recovery checks deliver roadmap Task 5.2's minimum resumable confirmation loop. The roadmap checklist is updated only in Task 8 after those gates pass.
