# PMS CLI 四类资源自然语言闭环与发布收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test and review gate.

**Goal:** 将当前 project/topic Orchestrator 代码收口为可发布基线，完成四类资源真实验收，并让 Claude/Codex/DeepSeek 通过 `pms-project-management` skill 使用统一自然语言推进链路和轻量会话恢复。

**Architecture:** 外部 Agent 负责自然语言理解、资源识别、草稿生成和子 Agent 调度；`pms-cli` 只负责 PMS capabilities/context、progression、preview、execute、回读和会话投影；PMS backend 继续负责权限、字段、流程、版本、事务、幂等和审计；已有 `ai-orchestrator-v1` 只承载需要恢复的 Conversation/Plan/Event。

**Tech Stack:** Java 17/Spring Boot/MyBatis-Plus/Flyway；TypeScript/Zod/Vitest；现有 `PmsClient`、`resource-scenario`、`progression run`；MySQL 隔离 E2E；Markdown skill/runbook。

**Spec:** `docs/superpowers/specs/2026-10-21-pms-cli-natural-language-closure-design.md`

**Repositories:** Connector 变更提交到 `/Users/fs/Desktop/Project/pms-ai-connector`；Backend 变更提交到 `/Users/fs/Desktop/Project/pms-backend`。两个仓库必须独立 staging、独立 commit；不把 sibling repository 文件加入另一仓库。

## Implementation status (2026-10-21)

- Task 0 已完成：backend `e515ee9`、connector `17f4caf`，定向测试、Connector 全套测试、类型检查和差异检查通过。
- Task 1 已完成：隔离 run `codex20261021matrix4` 通过需求、故事、项目、专题和资源场景矩阵，且已清理数据库卷和网络。
- Task 2 已完成：connector `327e265`，skill/runbook 和外部 Agent 边界契约已落地。
- Task 3 已完成：connector `f341061`、`b82f383`，项目隔离 run `codex20261021resume2` 验证 `resume` 的只读恢复动作。
- Task 4 的代码、文档和发布门禁已完成：backend `d16b411`、`198a7dd`，connector `6f7e731`、`79c3351`、`4bc1588`、`0a542db`、`6c1bb89`。provenance fixture 同步门禁通过；完整 Maven 测试已在 Colima Docker 环境通过。
- 当前发布基线已闭环：roadmap Task 3.2 的 story 专属测试、四资源隔离 E2E、只读 resume 恢复、Connector 回归和 backend 全量回归均已完成。未执行推送或合并，等待发布操作决策。

## Global Constraints

- PMS backend 是权限、字段、流程、版本、幂等和审计的唯一业务真源。
- `pms-cli` 不配置模型 URL、API Key、模型名称，不保存完整聊天记录，不把 PMS Token 交给模型。
- 四类资源节点写入统一经过 `context → draft → preview/auto/confirm → execute → focused readback`。
- `contextVersion` 不替代 project/topic 的 `nodeVersion`；并发保护以 PMS preview 返回的 `expectedVersions` 为准。
- `NEEDS_INPUT` 通过新 turn/Plan 续轮，原 Plan 不可变；不得修改 Orchestrator 状态转换表来制造回环。
- 外部 Agent 不得猜测 nodeId、componentKey、字段 key 或版本；所有写入字段必须有 `fieldSources`。
- 用户可见自然语言结果默认显示资源名称、节点名称、状态、字段和阻塞，不显示内部 ID。
- 高风险操作继续使用 preview/confirm；低/中风险只有在当前对话明确提出写入时才可使用 auto。

## Review Focus

- 当前未提交改动是否只包含本阶段已验证的后端回读、专题组件映射和 E2E 修正；测试覆盖 Task 0。
- 四类资源是否都验证成功、缺失输入、版本冲突、幂等重放、能力不可用和恢复；测试覆盖 Task 1。
- skill 是否把模型放在外部 Agent，并明确只读、写入授权、来源和名称优先；测试覆盖 Task 2。
- `resume` 是否只读取会话或复用原 Plan/preview/idempotency，不创建第二次写入；测试覆盖 Task 3。
- release gate 是否能阻止文档已完成但真实 E2E 未通过的发布；测试覆盖 Task 4。

## File Map

- Backend Orchestrator 和验证逻辑：`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/`。
- Backend 定向测试：`/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/`。
- Connector CLI 路由和场景：`apps/pms-cli/src/cli/runCli.ts`、`apps/pms-cli/src/commands/scenarios/`。
- Connector 客户端和契约：`packages/pms-client/src/`、`packages/pms-contracts/src/`。
- Connector E2E：`tests/e2e/orchestrator-*.e2e.test.ts`、`tests/e2e/support/`。
- Agent skill 与发布文档：`skills/pms-project-management/SKILL.md`、`docs/e2e-agent-cli-runbook.md`、`docs/release-checklist.md`。

---

### Task 0: Review and commit the current project/topic baseline

**Files:**
- Modify only the already changed files in `/Users/fs/Desktop/Project/pms-backend`.
- Modify only the already changed files in `/Users/fs/Desktop/Project/pms-ai-connector`.
- Test: existing backend Orchestrator tests and Connector tests listed below.

**Interfaces:** Preserve the current project/topic adapter, component envelope, provenance binding and readback verifier. No new feature is introduced in this task.

- [ ] **Step 1: Review the backend diff.** Confirm `AiOrchestratorService` wraps topic patches under `__components.<componentKey>`, `AiOrchestratorVerificationService` accepts structured readback metadata without weakening protected-field checks, and `CompleteNodeWithDataCommand` exposes requirement-scope preconditions before execute.
- [ ] **Step 2: Review the Connector diff.** Confirm the topic E2E stale-version assertion uses the pre-write node version, fixture values come from PMS contracts, and no temporary diagnostic output remains.
- [ ] **Step 3: Run backend focused tests.**

  Run: `mvn -q -Dtest=com.brad.pms.ai.orchestrator.AiOrchestratorVerificationServiceTest,com.brad.pms.ai.command.node.CompleteNodeWithDataCommandTest,com.brad.pms.ai.orchestrator.ProjectTopicOrchestratorRecoveryTest test`

  Expected: exit code 0.
- [ ] **Step 4: Run Connector regression checks.**

  Run: `pnpm typecheck` and `pnpm test`.

  Expected: typecheck passes; all non-skipped tests pass.
- [ ] **Step 5: Check repository hygiene.** Run `git diff --check` in both repositories and verify no token, password, database dump, generated build output or temporary debug log is staged.
- [ ] **Step 6: Commit separately.** Backend commit message: `fix(orchestrator): close project topic readback gaps`. Connector commit message: `test(e2e): stabilize project topic orchestrator verification`.
- [ ] **Step 7: Review gate.** Re-run `git status --short` in both repositories and record the two commit hashes before starting Task 1.

### Task 1: Build the four-resource acceptance matrix

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-requirement-analysis.e2e.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-story-node.e2e.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-project-node.e2e.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-topic-node.e2e.test.ts`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/orchestrator-four-resource-matrix.test.ts` only if shared assertions cannot be kept in existing tests.
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/e2e/support/isolatedSession.ts` and fixture helpers only when a missing isolation assertion is identified.
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/AiOrchestratorIsolatedAcceptanceTest.java` only for backend-side contract assertions.

**Interfaces:** Reuse existing `PmsClient`, `resourceNodeDraft`, `runHappyResourceNodeSession`, `agent-progression/v2`, `resource-node/v1`, and the existing isolated PMS stack. Do not add fixed resource IDs or a second E2E harness.

- [ ] **Step 1: Write the matrix cases.** For each resource type assert: focused read, valid plan, preview, execute, focused readback, protected-field preservation, idempotent replay, stale version conflict, missing-input response, and capability-unavailable response where the fixture supports it.
- [ ] **Step 2: Add requirement/story coverage for missing-input and replay.** Keep their existing contracts and ensure the new assertions do not change `REQUIREMENT_ANALYSIS_SAVE` or story workbench intent semantics.
- [ ] **Step 3: Keep project/topic fixture creation isolated.** Create resources at runtime, resolve the current writable node and component from PMS context, and destroy the database/network/volume after the run.
- [ ] **Step 4: Add name-first assertions.** In the natural-language-facing projection, assert resource title and node label are present; IDs remain only in machine-readable fields.
- [ ] **Step 5: Run the real matrix.** Start the isolated backend with the documented E2E environment, then run:

  ```bash
  pnpm run verify:real-pms:orchestrator
  pnpm run verify:real-pms:story-orchestrator
  pnpm run verify:real-pms:project-orchestrator
  pnpm run verify:real-pms:topic-orchestrator
  ```

  Expected: each command passes with a fresh `PMS_E2E_RUN_ID`; no command uses a pre-existing project/topic ID as its write fixture.
- [ ] **Step 6: Review gate.** Record operation status, verification status, database cleanup and any skipped case. A skipped case is a release failure unless the reason is an explicitly documented non-applicable capability.
- [ ] **Step 7: Commit.** `test(e2e): add four resource orchestrator acceptance matrix`.

### Task 2: Make the external-agent natural-language path explicit

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/skills/pms-project-management/SKILL.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/e2e-agent-cli-runbook.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/contract/skill-analysis-contract.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/contract/agent-progression-run-contract.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/cli/runCli.ts` only if examples expose a missing option or produce an ambiguous error.
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts` only if a contract test finds a missing source or field error.

**Interfaces:** The external Agent calls `pms resolve`, `pms capabilities`, `pms context`, and `pms scenario progression run`. The CLI accepts exact names, `--node-version`, `--context-version`, `--component`, `--draft-json`, and `--execute-mode`. No model endpoint or model credential is added.

- [ ] **Step 1: Write failing skill-contract assertions.** Pin the sequence `resolve → capabilities/context → draft → progression run → readback`, external-model ownership, `fieldSources`, one idempotency key, auto vs confirm risk rules, name-first output, and `WRITE_RESULT_UNKNOWN` handling.
- [ ] **Step 2: Update the skill.** Add a canonical natural-language recipe for each resource type and state that Claude/Codex/DeepSeek generate the draft while CLI only operates PMS. Explicitly forbid guessing node/field/component/version and forbid exposing IDs as the main result.
- [ ] **Step 3: Update the runbook.** Include one read-only example, one low/medium-risk auto write example, one high-risk confirmation example, one `NEEDS_INPUT` continuation, and one stale-version recovery example. Use placeholders for names and never include credentials.
- [ ] **Step 4: Make errors actionable.** Ensure unknown resource names, ambiguous names, missing sourceRefs, unsupported completion, and stale versions return a structured next action instead of a generic shell error.
- [ ] **Step 5: Run contract checks.**

  Run: `pnpm vitest run tests/contract/skill-analysis-contract.test.ts tests/contract/agent-progression-run-contract.test.ts tests/unit/agent-progression-run-cli.test.ts tests/unit/agent-progression-run.test.ts`.

  Expected: all tests pass and no model configuration is referenced by the CLI contract.
- [ ] **Step 6: Commit.** `docs(skill): define four resource natural language workflow`.

### Task 3: Add lightweight Orchestrator session recovery

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/cli/runCli.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/apps/pms-cli/src/commands/scenarios/resourceOrchestrator.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-client/src/PmsClient.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/packages/pms-client/src/OrchestratorClientTypes.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/unit/orchestrator-cli.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/unit/orchestrator-session.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/tests/contract/orchestrator-client.test.ts`
- Modify: `/Users/fs/Desktop/Project/pms-backend/src/test/java/com/brad/pms/ai/orchestrator/ProjectTopicOrchestratorRecoveryTest.java` only if the backend session response lacks a required recovery assertion.

**Interfaces:** Add a read-only command `pms scenario resource-orchestrator resume <conversation-id> [--after-sequence <n>]`. It returns the existing `OrchestratorSession` plus a derived `nextAction` of `READ_CONTEXT`, `PROVIDE_INPUT`, `PREVIEW`, `CONFIRM`, `RETRY_SAME_IDEMPOTENCY`, `READ_RESULT`, or `NO_ACTION`. It must not execute a write.

- [ ] **Step 1: Write failing client and CLI tests.** Assert that `resume` reads the session, exposes the latest Plan/event sequence, maps `NEEDS_INPUT` to `PROVIDE_INPUT`, maps `WAITING_CONFIRMATION` to `CONFIRM`, maps `WRITE_RESULT_UNKNOWN` to `RETRY_SAME_IDEMPOTENCY`, and maps terminal success to `NO_ACTION`.
- [ ] **Step 2: Implement session projection.** Reuse `getOrchestratorSession` and `listConversationEvents`; do not add a new HTTP route or table. Preserve `planId`, operation metadata and idempotency metadata in machine-readable output.
- [ ] **Step 3: Enforce no-write behavior.** `resume` must not call preview, confirm, execute, operation auto, or generate a new idempotency key. Continuing a missing-input conversation remains an explicit subsequent `turn` call using the same conversation.
- [ ] **Step 4: Add natural-language recovery examples.** Document “继续刚才的项目”“补上缺失字段”“重新确认上次预览”“核对未知写入结果” and map each to the derived `nextAction`.
- [ ] **Step 5: Run tests.**

  Run: `pnpm vitest run tests/unit/orchestrator-cli.test.ts tests/unit/orchestrator-session.test.ts tests/contract/orchestrator-client.test.ts tests/contract/orchestrator-session.test.ts`.

  Expected: all tests pass; `resume` has no write side effect.
- [ ] **Step 6: Run one real recovery check.** Use an isolated topic or project conversation to reach `NEEDS_INPUT` and `WAITING_CONFIRMATION`, call `resume`, then continue with the existing turn/confirm command and verify the original Plan remains immutable.
- [ ] **Step 7: Commit.** `feat(cli): add read-only orchestrator session resume`.

### Task 4: Final release gate and documentation synchronization

**Files:**
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/release-checklist.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/e2e-agent-cli-runbook.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/orchestrator-session-contract.md`
- Modify: `/Users/fs/Desktop/Project/pms-ai-connector/docs/superpowers/plans/2026-10-19-four-resource-agent-orchestrator-roadmap.md`
- Create: `/Users/fs/Desktop/Project/pms-ai-connector/docs/orchestrator-four-resource-acceptance-report.md`
- Modify: `/Users/fs/Desktop/Project/pms-backend/docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`

**Interfaces:** Documentation must match the implementation from Tasks 0–3: four resource types, `resource-node/v1`, `agent-progression/v2`, `nodeVersion/contextVersion` separation, provenance, state/event distinction, auto/confirm rules, `resume` and E2E commands.

- [x] **Step 1: Update the release checklist.** Add the exact backend, Connector, contract, build, E2E, fixture-sync and `git diff --check` commands. State that project/topic capability is a merge/release gate, not a runtime flag.
- [x] **Step 2: Update the runbook and skill references.** Remove stale commands and examples; ensure all write examples use current v2 flags and name-first reporting.
- [x] **Step 3: Record the acceptance report.** Include commit hashes, test counts, E2E run IDs, resource types covered, cleanup evidence, known limitations and any intentionally skipped capability.
- [x] **Step 4: Run the final gate.**

  ```bash
  mvn -q -DskipTests package
  DOCKER_HOST=unix:///Users/fs/.colima/fsclaw/docker.sock TESTCONTAINERS_RYUK_DISABLED=true mvn -q test
  pnpm test
  pnpm typecheck
  pnpm run build:cli
  pnpm run verify:real-pms:agent-suite
  git diff --check
  ```

  Expected: all commands exit 0; the isolated suite creates and removes its own database; no credentials appear in output or staged files. On the current Colima profile, the Docker socket and `TESTCONTAINERS_RYUK_DISABLED=true` variables above are required.
- [x] **Step 5: Final review.** Compare the acceptance report to every Review Focus item and mark the roadmap only after the real suite passes.
- [x] **Step 6: Commit docs independently.** Backend: `docs(orchestrator): sync four resource release contract`; Connector: `docs(release): record four resource acceptance`.
- [x] **Step 7: Stop and hand off.** Do not push or merge automatically. Provide the two commit hashes and ask whether to push the reviewed commits.

## Dependency Order

1. Task 0 creates a reviewable, tested baseline.
2. Task 1 proves all four resource types behave consistently in real PMS.
3. Task 2 makes the external Claude/Codex/DeepSeek invocation contract explicit.
4. Task 3 adds read-only session recovery on top of the proven Orchestrator flow.
5. Task 4 synchronizes release gates and closes the milestone.

Each task ends with its focused tests, diff review and an independent commit. No task may silently broaden the PMS business model, add a model endpoint to CLI, or bypass preview/execute/audit.
