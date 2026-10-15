# Safe Agent Write Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every Agent-facing PMS write follow `plan/preview → explicit confirmation → execute preview → readback verification`, then validate the flow against a real PMS backend and extend it to project, topic, and story workflows before introducing a durable Orchestrator session layer.

**Architecture:** Keep PMS as the system of record and keep `pms-ai-connector` as the deterministic policy and protocol boundary. Existing low-level PMS APIs may remain for compatibility, but default CLI write commands must require a persisted preview identity and confirmation provenance. Scenario commands will expose one consistent contract and return operation, verification, and refresh metadata.

**Tech Stack:** TypeScript, Node 22, Vitest, esbuild, PMS HTTP API, Spring Boot PMS backend, CLI JSON contracts.

**Spec:** The user-requested four-stage safe write lifecycle: (1) tighten legacy writes with contract tests, (2) real PMS Claude/Codex-to-CLI E2E, (3) project/topic/story scenarios, (4) Orchestrator conversation/session layer.

## Global Constraints

- Agent-facing writes must not call the automatic write endpoint without a preview operation identity.
- Execution must require an idempotency key and confirmation provenance.
- A successful write must be followed by resource/context readback; failed readback is `WRITE_RESULT_UNKNOWN`.
- Existing user changes in the working tree must not be staged or overwritten.
- Every task is test-first, independently verified, and reviewed before the next task starts.

## Review Focus

- Missing or expired preview IDs must fail before any write call: Task 1 contract tests.
- Replaying the same idempotency key must be safe while a new key against a stale context must conflict: Task 1 and Task 2 tests.
- Project creation has no existing entity context but still needs a global preview context: Task 1 project tests.
- Workflow actions and shortcut commands must preserve action permissions and refresh scopes: Task 1 workflow tests and Task 3 scenario tests.
- Agent sessions must survive a separate CLI process and expose progress/verification state: Task 4 orchestrator tests.

### Task 1: Unify and lock down CLI write entry points

**Files:**
- Modify: `apps/pms-cli/src/cli/runCli.ts`
- Modify: `apps/pms-cli/src/commands/core/operation.ts`
- Modify: `apps/pms-cli/src/commands/shortcuts/project.ts`
- Modify: `apps/pms-cli/src/commands/shortcuts/requirement.ts`
- Modify: `apps/pms-cli/src/commands/core/workflow.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/projectCreate.ts`
- Modify: `packages/pms-contracts/src/operation.ts`
- Test: `tests/unit/cli-runner.test.ts`, `tests/contract/project-create-readback.test.ts`, `tests/contract/analysis-save-flow.test.ts`, `tests/contract/command-contract.test.ts`, and new write-lifecycle contract tests.

**Interfaces:**
- Consume: existing `operationPreview`, `operationExecutePreview`, `PmsClient.executePreview`, and operation result schemas.
- Produce: explicit `previewOperationId` options for project creation, requirement save, workflow action, and generic operation execution; stable validation errors before runtime creation; readback-aware result contracts.

- [ ] Write failing tests for every write entry point: plan/preview does not execute, execute without preview ID fails before runtime/write, and execute with a persisted preview calls only `executePreview`.
- [ ] Run the focused tests and confirm they fail for the missing preview contract.
- [ ] Implement the smallest CLI/parser/shortcut changes to enforce preview binding and preserve compatibility only behind an explicit legacy escape hatch, if one is required by existing tests.
- [ ] Run focused tests, typecheck, CLI bundle, and the full Vitest suite.
- [ ] Review the diff and commit Task 1.

### Task 2: Validate against a real PMS backend and external-agent path

**Files:**
- Modify: `tests/e2e/support/*` only when required to make the real session deterministic.
- Create or modify: `tests/e2e/safe-write-lifecycle.e2e.test.ts` and `docs/e2e-safe-write-report.md`.
- Modify: backend launch/configuration only if the existing documented startup path is insufficient; do not change business behavior without a failing test.

**Interfaces:**
- Consume: Task 1 CLI contracts and the existing isolated-session/auth callback helpers.
- Produce: a repeatable command/test that starts the real PMS backend, authenticates the CLI, runs read → plan → confirm → execute → readback, and records operation/audit IDs.

- [ ] Add a real-server E2E test with a unique idempotency key and isolated fixture.
- [ ] Start the backend and dependencies using the repository's existing scripts, then run the test through the built CLI.
- [ ] Verify the Claude/Codex-facing invocation is JSON-only and that no direct database mutation is used.
- [ ] Record the exact command, environment requirements, result, and cleanup steps.
- [ ] Review and commit Task 2.

### Task 3: Extend the safe lifecycle to project, topic, and story scenarios

**Files:**
- Modify: `apps/pms-cli/src/commands/scenarios/projectCreate.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyWorkbench.ts`
- Modify: topic/requirement scenario modules discovered during Task 1.
- Modify: `apps/pms-cli/src/cli/runCli.ts` and `packages/pms-contracts/src/*` as needed.
- Test: scenario contract, unit, and real/isolated E2E tests for project, topic, and story writes.

**Interfaces:**
- Consume: the unified preview-bound operation contract and readback verification from Tasks 1–2.
- Produce: consistent plan/execute result envelopes with `operation`, `previewOperationId`, `verification`, `warnings`, `refreshScopes`, and conflict/unknown-result statuses.

- [ ] Add failing tests for project creation, topic actions, and story node updates using the same preview ID.
- [ ] Implement scenario adapters and help text without adding a second execution protocol.
- [ ] Run targeted tests, full tests, typecheck, and bundle.
- [ ] Review and commit Task 3.

### Task 4: Build the durable Orchestrator conversation/session layer

**Files:**
- Modify/create: `apps/pms-cli/src/commands/scenarios/agentWorkSession.ts` and orchestrator command modules.
- Modify/create: `packages/pms-contracts/src/orchestrator.ts`, `packages/pms-client/src/*`.
- Test: `tests/unit/orchestrator-*`, `tests/contract/orchestrator-*`, and `tests/e2e/orchestrator-*.test.ts`.
- Create: `docs/orchestrator-session-contract.md`.

**Interfaces:**
- Consume: scenario plans, preview IDs, operation events, readback verification, and child-agent draft contracts from Tasks 1–3.
- Produce: durable `Conversation`, `Turn`, `ContextSnapshot`, `Plan`, `Confirmation`, `OperationEvent`, and `Verification` contracts with CLI commands for create/turn/preview/confirm/events.

- [ ] Write failing tests for conversation creation, turn append, plan preview, explicit confirmation, event polling, retry/idempotency, and stale-context conflicts.
- [ ] Implement the session store through the PMS orchestrator API; keep the CLI stateless between commands except for auth.
- [ ] Add progress/event output suitable for Claude/Codex and preserve machine-readable JSON.
- [ ] Run the full verification matrix and review the final architecture/diff.
- [ ] Commit Task 4 and document the supported natural-language interaction examples.
