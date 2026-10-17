# Agent Progression Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test and review gate.

**Goal:** Add a single `pms scenario progression run` entry point that lets an external Claude/Codex Agent submit a validated draft, obtain a PMS preview, execute only under the requested risk mode, and receive readback/verification in one stable JSON envelope.

**Architecture:** Keep Claude/Codex outside the CLI. The CLI composes the existing `planAgentProgression` and `executeAgentProgression` functions; it does not add model calls, PMS business rules, or an alternate write path. A new `agent-progression-run/v1` schema carries the plan, execution result, operation/audit identifiers, and verification fields.

**Tech Stack:** TypeScript, Zod, Vitest, existing `PmsClient` and PMS scenario adapters, Markdown skill/runbook documentation.

**Spec:** `docs/superpowers/specs/2026-10-17-agent-progression-run-design.md`

## Global Constraints

- `pms-cli` must not contain a model SDK, model URL, API key, model name, prompt orchestration, or model network call.
- The run command must reuse the existing progression adapters and PMS preview/execute/readback flow.
- `READ_CONTEXT` is read-only and must never call preview or execute.
- An executing run (`auto` or `confirm`) requires an explicit idempotency key; `plan` and `READ_CONTEXT` do not. The CLI must never invent one.
- `auto` may execute only automatic low/medium-risk capabilities; high-risk auto requests return `WAITING_CONFIRMATION` without writing.
- `confirm` is an explicit authorization from the external Agent after the user authorized the write; PMS permission, version, idempotency, audit, and readback checks remain authoritative.
- Existing `draft`, `plan`, and `execute` commands remain backwards compatible.
- The new run entry point supports requirement, topic, and story; project node writes remain outside this phase.

## Review Focus

- A read request accidentally creating a preview or write: Task 2 test asserts both client methods are untouched.
- A high-risk operation executing under `auto`: Task 2 test asserts `WAITING_CONFIRMATION` and zero execute calls.
- A write proceeding without an idempotency key: Task 3 dispatch test asserts a CLI usage error before runtime creation.
- A draft becoming stale or unsafe between validation and preview: Task 2/5 tests assert context conflict and protected/unknown fields stop before execution.
- Operation/audit/readback identifiers being dropped from the combined result: Task 1 contract test and Task 2 result test assert all identifiers survive parsing.

### Task 1: Add the versioned run result contract

**Files:**
- Create: `packages/pms-contracts/src/agentProgressionRun.ts`
- Modify: `packages/pms-contracts/src/index.ts`
- Create: `tests/contract/agent-progression-run-contract.test.ts`

**Interfaces:**
- Produces `agentProgressionRunContractVersion = "agent-progression-run/v1"` and restricts the run resource type to requirement, topic, or story.
- Produces `agentProgressionRunResultSchema` and `AgentProgressionRunResult`.
- The result includes `phase: "run"`, resource/intent, `status`, `writeDecision`, nullable `plan`, nullable `result`, nullable `previewOperationId`, `operationId`, `auditId`, `readback`, `verification`, and `warnings`.
- Status values are `CONTEXT_READY`, `PLAN_READY`, `NEEDS_INPUT`, `WAITING_CONFIRMATION`, `CAPABILITY_UNAVAILABLE`, `SUCCEEDED`, `REJECTED`, `CONFLICT`, and `WRITE_RESULT_UNKNOWN`.

- [ ] **Step 1: Write the failing contract test**

  Add cases for a read result, a preview-only `NEEDS_INPUT` result, and an executed result carrying `previewOperationId`, `operationId`, `auditId`, `readback`, and `verification`. Assert that unknown top-level keys fail parsing.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `pnpm vitest run tests/contract/agent-progression-run-contract.test.ts`

  Expected: FAIL because the new schema/export does not exist.

- [ ] **Step 3: Implement the schema**

  Define the schema in `agentProgressionRun.ts` by composing the existing `agentProgressionPlanSchema`, `agentProgressionResultSchema`, `agentProgressionWriteDecisionSchema`, `agentProgressionResourceTypeSchema`, and `agentProgressionIntentSchema`. Keep optional operation identifiers nullable and default warnings to an empty array. Export the file from `packages/pms-contracts/src/index.ts`.

- [ ] **Step 4: Run the focused contract test**

  Run: `pnpm vitest run tests/contract/agent-progression-run-contract.test.ts`

  Expected: PASS.

- [ ] **Step 5: Review and commit**

  Inspect the schema for duplication and backwards-compatibility impact, then commit:

  ```bash
  git add packages/pms-contracts/src/agentProgressionRun.ts packages/pms-contracts/src/index.ts tests/contract/agent-progression-run-contract.test.ts
  git commit -m "feat(cli): add progression run result contract"
  ```

### Task 2: Compose context, preview, execution, and readback

**Files:**
- Create: `apps/pms-cli/src/commands/scenarios/agentProgressionRun.ts`
- Create: `tests/unit/agent-progression-run.test.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgression.ts` only if a small exported helper is needed; do not duplicate adapters.

**Interfaces:**
- Produces `runAgentProgression(client: PmsClient, input: unknown): Promise<AgentProgressionRunResult>`.
- The function parses `agentProgressionInputSchema`, calls `planAgentProgression` for writes, and calls `executeAgentProgression` only when the mode and plan permit execution.
- `READ_CONTEXT` returns `CONTEXT_READY` without preview/execute.
- `plan` returns `PLAN_READY` with the plan and no execution result.
- `NEEDS_INPUT`, `WAITING_CONFIRMATION`, and `CAPABILITY_UNAVAILABLE` return without execution.
- `auto`/`confirm` require `idempotencyKey` before execution and pass the fresh preview operation ID from the newly created plan to `executeAgentProgression`.
- The helper maps operation/audit/readback/verification fields into the new run result without exposing credentials.

- [ ] **Step 1: Write failing behavior tests**

  Use a mocked `PmsClient` and assert:
  - `READ_CONTEXT` performs reads only;
  - a complete low/medium-risk draft in `auto` calls preview then execute and preserves IDs/readback;
  - a high-risk capability in `auto` returns `WAITING_CONFIRMATION` and does not execute;
  - `confirm` executes after preview with the supplied idempotency key;
  - missing fields and protected/unknown fields return before execute.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `pnpm vitest run tests/unit/agent-progression-run.test.ts`

  Expected: FAIL because `runAgentProgression` does not exist.

- [ ] **Step 3: Implement `runAgentProgression`**

  Keep the function as a thin coordinator. Do not re-resolve resource types, field contracts, or operation names. Use `planAgentProgression` as the sole preview path and `executeAgentProgression` as the sole write path. Convert plan decisions to protocol statuses and propagate the preview/result metadata.

- [ ] **Step 4: Run focused tests and existing progression tests**

  Run: `pnpm vitest run tests/unit/agent-progression-run.test.ts tests/unit/agent-progression-plan.test.ts tests/contract/automatic-write-policy.test.ts`

  Expected: PASS.

- [ ] **Step 5: Review and commit**

  Confirm no new PMS client methods, model configuration, retries, or direct adapter calls were introduced, then commit:

  ```bash
  git add apps/pms-cli/src/commands/scenarios/agentProgressionRun.ts tests/unit/agent-progression-run.test.ts
  git commit -m "feat(cli): compose external agent progression run"
  ```

### Task 3: Expose the CLI command and machine-readable errors

**Files:**
- Modify: `apps/pms-cli/src/cli/runCli.ts:HELP and dispatchAgentProgression`
- Modify: `tests/unit/agent-progression-dispatch.test.ts`
- Modify: `tests/contract/agent-scenario-cli.test.ts` when the command-level contract needs a stable fixture.

**Interfaces:**
- Adds `run` to the progression help line.
- Dispatches `scenario progression run <resourceType> <id>` to `runAgentProgression` with the same input parsing used by existing progression commands.
- Requires `--draft-json` for write intents and `--idempotency-key` only for `auto`/`confirm` execution; usage errors occur before `createRuntime`.
- Accepts no `--preview-operation-id`; existing `scenario progression execute` remains the resume path.

- [ ] **Step 1: Write failing dispatch tests**

  Add tests for a read run, a plan run without an idempotency key, an auto write run with JSON draft and idempotency key, missing idempotency key for execution, project rejection, and invalid resource type. Assert the exact contract version/result phase and that usage failures do not authenticate.

- [ ] **Step 2: Run the focused dispatch tests and verify they fail**

  Run: `pnpm vitest run tests/unit/agent-progression-dispatch.test.ts tests/contract/agent-scenario-cli.test.ts`

  Expected: FAIL because `run` is not recognized.

- [ ] **Step 3: Implement dispatch**

  Import `runAgentProgression`, add the help text, parse `run`, validate the write inputs, build an `agent-progression/v1` payload, and return the helper result through the existing JSON envelope/error mapping.

- [ ] **Step 4: Run focused CLI tests**

  Run: `pnpm vitest run tests/unit/agent-progression-dispatch.test.ts tests/contract/agent-scenario-cli.test.ts tests/unit/cli-runner.test.ts`

  Expected: PASS.

- [ ] **Step 5: Review and commit**

  Check that the old `draft`, `plan`, `execute`, and `shadow` branches are unchanged, then commit:

  ```bash
  git add apps/pms-cli/src/cli/runCli.ts tests/unit/agent-progression-dispatch.test.ts tests/contract/agent-scenario-cli.test.ts
  git commit -m "feat(cli): expose progression run command"
  ```

### Task 4: Document the Claude/Codex natural-language handoff

**Files:**
- Modify: `skills/pms-project-management/SKILL.md`
- Modify: `README.md`
- Modify: `docs/resource-scenario-runbook.md`
- Modify: `docs/installation.md`
- Create: `docs/agent-progression-runbook.md`

**Interfaces:**
- Documents the external Agent handoff: read focused context, generate `agent-progression/v1` draft with source references, call `progression run`, interpret `NEEDS_INPUT`/`WAITING_CONFIRMATION`/`SUCCEEDED`/conflict statuses.
- Explicitly states that model credentials remain in Claude/Codex/DeepSeek and are never passed to `pms-cli`.
- Includes one requirement/story example with placeholder IDs and a JSON draft shape; it must not tell the Agent to guess node IDs or fields.

- [ ] **Step 1: Add documentation tests/checks**

  Extend the existing documentation/static checks (or add a focused unit check if no suitable test exists) to assert the run command, model-boundary statement, idempotency requirement, and no-guessing rule are present.

- [ ] **Step 2: Update the skill and runbooks**

  Add the natural-language example and result handling without changing the existing safety rules for context, capabilities, preview, execute, versions, or audit.

- [ ] **Step 3: Run documentation/static checks and CLI typecheck**

  Run: `pnpm vitest run tests/unit/e2e-safety.test.ts tests/unit/cli-runner.test.ts && pnpm typecheck`

  Expected: PASS.

- [ ] **Step 4: Review and commit**

  Check that examples never include tokens, API keys, guessed node IDs, SQL, or direct database operations, then commit:

  ```bash
  git add skills/pms-project-management/SKILL.md README.md docs/resource-scenario-runbook.md docs/installation.md docs/agent-progression-runbook.md
  git commit -m "docs(cli): document external agent progression run"
  ```

### Task 5: Prove the golden path against a disposable PMS

**Files:**
- Create or modify: `tests/e2e/agent-progression-run.e2e.test.ts`
- Modify: `docs/e2e-agent-cli-runbook.md` with the exact command and required environment gates.

**Interfaces:**
- Uses the existing isolated PMS/MySQL harness and cleanup safeguards.
- Creates or discovers a run-scoped requirement/story fixture, reads its focused node context, submits a deterministic external-Agent draft through `progression run`, and verifies PMS readback, operation ID, audit ID, and idempotent behavior.
- Includes a high-risk auto case that proves no write occurs and returns `WAITING_CONFIRMATION` if the fixture exposes such a capability; otherwise records the capability-dependent skip explicitly.

- [ ] **Step 1: Add the isolated E2E test behind an explicit gate**

  Reuse `PMS_E2E_*` validation and cleanup helpers. The test must fail when the gate is enabled and required configuration is missing; it must remain skipped by default.

- [ ] **Step 2: Run the E2E test in the disposable stack**

  Run the documented `pnpm vitest run tests/e2e/agent-progression-run.e2e.test.ts --maxWorkers=1 --minWorkers=1` command with an isolated database and authenticated PMS endpoint.

  Expected: PASS with actual preview, execution, readback, operation/audit evidence, or an explicit `WAITING_CONFIRMATION` assertion for high risk.

- [ ] **Step 3: Run the final connector suite**

  Run: `pnpm test && pnpm typecheck && pnpm build:cli`

  Expected: PASS; environment-sensitive keyring tests may remain skipped only under the existing documented condition.

- [ ] **Step 4: Review and commit**

  Review the diff for direct model calls, hidden writes, unscoped retries, and leaked secrets, then commit:

  ```bash
  git add tests/e2e/agent-progression-run.e2e.test.ts docs/e2e-agent-cli-runbook.md
  git commit -m "test(cli): verify external agent progression golden path"
  ```

## Completion Criteria

- `pms scenario progression run` is available for requirement/topic/story node updates and completions without changing the existing command contracts.
- Claude/Codex can use the documented natural-language handoff without supplying model credentials to PMS CLI.
- Read-only, automatic, confirmation-required, missing-input, conflict, and unknown-result paths are machine-readable and tested.
- At least one disposable real-PMS E2E run proves preview, execution policy, readback, audit, and idempotency behavior.
