# 四类资源统一 Agent 推进协议与现有 Orchestrator 扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test and review gate.

**Goal:** 在不重复建设现有 Orchestrator 的前提下，收口项目、需求、专题、故事的 Agent 推进协议，补齐安全语义、focused readback、来源审计和真实 E2E。

**Architecture:** 外部 Agent 负责自然语言理解和子 Agent；`pms-cli` 负责无状态 context/capabilities/progression run；PMS 后端负责业务规则、版本、事务、幂等和审计；已有 `ai-orchestrator-v1` 负责持久化会话和恢复，并在后续扩展到四类资源。

**Tech Stack:** TypeScript、Zod、Vitest、Java/Spring PMS backend、现有 `PmsClient`、resource-scenario adapters、MySQL 隔离 E2E、Markdown skill/runbook。

**Spec:** `docs/superpowers/specs/2026-10-19-four-resource-agent-orchestrator-roadmap-design.md`

## 实施状态（2026-10-20）

- Milestone 0–4 的已实施代码、契约和文档任务已按提交记录同步；Task 5 的代码、单元/契约验证和项目/专题 E2E 测试已落地，但真实隔离 E2E 尚未运行，不能据此宣称发布通过。
- Task 3.1 的 `expectedVersions` 已由 PMS preview 生成并回传，CLI 会在带 provenance 的写入计划阶段校验版本冲突；旧的 `expected_versions_json` 仍保留变更列表格式，供既有命令执行守卫兼容读取。
- Task 3.2 的 `userFacing.targetNode` 和 `userFacing.fieldChanges` 已落地，字段摘要会名称化并遮蔽内部 ID。
- Milestone 4 的真实隔离 PMS E2E 尚未在本轮运行；代码和门禁已准备好，不能据此宣称真实链路已通过。
- Milestone 5（扩展现有 Orchestrator 到四类资源）已完成代码和静态验证；真实隔离验收仍是发布门禁，未通过前不能合并到默认发布分支。

## Global Constraints

- CLI 不保存模型 URL、API Key、模型名，也不调用模型 API。
- `progression run` 是 Agent 节点写入的标准入口；旧入口保持兼容，但不由 skill 推荐。
- `READ_CONTEXT` 和 `plan` 永远不写；`run` 默认 `plan`；`auto` 必须显式指定并带幂等键。
- 未决决策、低置信高风险推断、缺少来源和缺少必填字段返回 `NEEDS_INPUT`，不能由泛化 `confirm` 放行。
- 节点写入必须由共享 resolver 选择可写 saveContract：恰好 1 个可写 saveContract 时可省略 `componentKey`；多个必须显式选择，否则返回 `CAPABILITY_UNAVAILABLE`；0 个可写 saveContract 只阻止写入意图，`READ_CONTEXT` 仍可读并标注 `writeCapable=false`（项目 `workbench` 只作为兼容别名）；并统一校验当前节点、能力契约、preview 版本、幂等键和实际字段回读。
- `COMPLETE_NODE` 必须显式 `requestedCompletion=true`；缺失或 false 不得生成完成预览。
- 业务状态使用统一 run envelope；认证、网络和协议解析才使用 `ok:false` 系统错误，这个收敛在 Milestone 0/1 完成。
- `agent-progression/v2` 与 `agent-progression-run/v2` 是本阶段的破坏性协议版本；不兼容旧 `agent-progression/v1`、`agent-progression-run/v1` 或 progression 命令的旧 `--version` 参数。CLI progression 命令使用 `--node-version` 与 `--context-version` 两个明确参数；其他 CLI 命令的既有 `--version` 参数不在本次删除范围内。
- `contextVersion` 是关联字段；并发保护以 preview 捕获的 node/entity/workflow/field versions 为准。
- `REJECTED` 不是新的 `writeDecision`；固定为 `writeDecision=NEEDS_INPUT`、`plan.preview=null`、`rejectionReason=COMPLETION_NOT_REQUESTED`。
- `auditId` 当前等于 `operationId`，按 opaque 审计关联标识处理；不假设独立审计实体。unknown write 第一阶段只允许同幂等键重放。
- 每个任务执行“实现 → 聚焦测试 → review → 回归测试 → 提交”；review 未通过不得进入下一任务。

## Review Focus

- 不把已有 Orchestrator 当成空白重新实现；
- 不把 project 的完整 projection 误判为稀疏；重点验证 topic/story 合并；
- 不让旧入口绕过节点 preflight、来源和授权规则；
- 不让 `patchApplied` 只依赖 operation 成功；
- 不把合法 completion metadata 当成保护字段变更；
- 不混淆 contextVersion 与真正的并发版本；
- 不让 E2E 使用错误的安全变量或污染共享数据库；
- 不把 provenance 的调研和实现混在同一个任务；
- 不让 project/topic 节点 E2E 依赖人工预置数据。

## Milestone 0：事实基线与决策冻结

### Task 0.1：建立四资源真实能力矩阵

**Files:**
- Create: `docs/agent-progression-resource-matrix.md`
- Modify: `docs/e2e-agent-cli-runbook.md`
- Verify (no source change): `tests/e2e/resource-scenario-real-pms.test.ts`
- Verify (no source change): `tests/e2e/story-acceptance-real-pms.test.ts`
- Verify (no source change): `tests/contract/agent-scenario-cli.test.ts`

**Interfaces:** 矩阵按资源、意图、执行模式记录代码事实，不预设所有组合都可写。本任务只记录并运行现有测试，不为了“看起来有改动”而修改测试源码。

- [x] 盘点 project/requirement/topic/story 的 context、focused context、saveContract、capability、preview、execute、readback 和已有 E2E。
- [x] 标注 project `project_node` capability、`project-basic-info`、`solution-decision`、`custom-fields` 的可用性。
- [x] 沿用现有 `PMS_E2E_RESOURCE_SCENARIO`、`PMS_E2E_STORY_ACCEPTANCE`、`PMS_E2E_WRITE`、`PMS_E2E_ISOLATED` 和数据库白名单，不引入不存在的 `PMS_E2E_ENABLED`。
- [x] 记录 operationId/auditId 当前契约关系和 unknown write 核验路径。
- [x] 明确远程委派 token 的 preview/orchestrator allow-list 暂不属于第一阶段；若纳入后续，必须增加 backend scope/route 测试。
- [x] 运行既有 resource/story E2E 的默认跳过检查和 CLI contract tests。
- [x] Review：确认矩阵只描述代码事实，并引用已有 Orchestrator，而不是把它写成未来能力。
- [x] 提交：`git commit -m "docs(cli): freeze resource progression facts"`。

### Task 0.2：冻结协议决策并补契约测试

**Files:**
- Modify: `packages/pms-contracts/src/agentProgression.ts`
- Modify: `packages/pms-contracts/src/agentProgressionRun.ts`
- Modify: `packages/pms-contracts/src/agent.ts`
- Modify: `packages/pms-contracts/src/resourceScenario.ts`
- Modify: `apps/pms-cli/src/cli/runCli.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgression.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgressionRun.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/resourceScenarioRegistry.ts`
- Modify: `apps/pms-cli/src/commands/core/agentContext.ts`
- Modify: `tests/contract/agent-progression-run-contract.test.ts`
- Modify: `tests/contract/resource-scenario-contract.test.ts`
- Modify: `tests/unit/agent-progression-run.test.ts`
- Modify: `tests/unit/agent-progression-run-cli.test.ts`
- Verify (covered by): `tests/unit/agent-progression-run.test.ts`（边界映射已合并覆盖，未重复创建同断言测试文件）
- Create: `docs/agent-progression-decisions.md`
- Create: `docs/agent-progression-v2-migration.md`

**Interfaces:** 升级到破坏性的 `agent-progression/v2` 与 `agent-progression-run/v2`，不再兼容 `agent-progression/v1`、`agent-progression-run/v1` 或 progression 命令的旧 `--version` 参数；使用 `--node-version` 表示 nodeVersion，使用 `--context-version` 表示 opaque contextVersion；增加 `componentKey`、`nodeVersion` 和可选 `rejectionReason`。旧协议和旧参数必须返回迁移错误，不能静默转换。`REJECTED` 固定映射为 `writeDecision=NEEDS_INPUT`、`plan.preview=null`、`rejectionReason=COMPLETION_NOT_REQUESTED`（仅当 `requestedCompletion` 缺失或为 false）。

- [x] 将 CLI `progression run` 默认执行模式改为 `plan`，并测试未指定模式时零写入。
- [x] 在契约中增加可选 `componentKey` 字段并定义 `workbench` 归一化；组件解析、多 saveContract 选择和 story resolver 接入在 Task 1.1 实现，本任务不重复实现。
- [x] 增加 `nodeVersion`/`entityVersion`/`workflowInstanceVersion` 的只读输出，并测试 Agent 只读取 `nodeContract.version` 就能正确回传节点版本。
- [x] 仅删除 progression 命令的旧 `--version` 参数入口，新增 `--node-version` 与 `--context-version`；旧 `agent-progression/v1`、`agent-progression-run/v1`、旧参数和旧示例统一返回明确迁移错误，其他 CLI 命令的既有 `--version` 保持不变；connector、backend、skill、fixture 在同一发布批次切换到 v2。
- [x] `COMPLETE_NODE` 要求 `requestedCompletion === true`；缺失或 false 在计划阶段不生成完成预览，run 结果固定为 `status=REJECTED`、`writeDecision=NEEDS_INPUT`、`plan.preview=null`、`rejectionReason=COMPLETION_NOT_REQUESTED`。为保持 writeDecision 兼容，不把 `REJECTED` 加入 `writeDecision` enum。
- [x] 固定未决决策、低置信高风险推断和缺少来源为 `NEEDS_INPUT`；Task 3.2 只验证 story 路径遵守该规则，不再重复修改判定。
- [x] 在本任务完成通用业务错误映射：`ResourceScenarioError`/`CONTEXT_CONFLICT` 在 run 边界输出 in-band 状态（冲突映射为 `CONFLICT`），认证、网络、协议解析等系统错误才走错误信封；story 专属的剩余归一化留在 Task 3.2。
- [x] 在 `runAgentProgression()` 内部捕获 `ResourceScenarioError`（以及 story 路径的等价业务异常），映射为 in-band `CONFLICT`/`NEEDS_INPUT`/`CAPABILITY_UNAVAILABLE`；不得依赖 `runCli.ts` 的通用 catch 转成 `ok:false`。认证、网络、协议解析等系统错误继续抛出。
- [x] 冻结 `auditId` 语义：当前等于 `operationId`，按 opaque 审计关联标识处理，不假设独立审计实体；unknown write 第一阶段只允许同一 conversation、同一 preview、同一 draftDigest 下的幂等键重放。
- [x] 增加 run envelope 契约测试：`REJECTED` 时 `writeDecision`、`plan.preview` 和 `rejectionReason` 固定；`auditId` 按 operationId 别名断言。
- [x] 边界映射已由现有 `tests/unit/agent-progression-run.test.ts` 覆盖；`tests/contract/resource-scenario-error-matrix.test.ts` 继续覆盖既有契约矩阵，不重复实现同一断言。
- [x] 在 `docs/agent-progression-decisions.md` 记录本任务冻结的默认模式、版本轴、组件规则、状态映射、auditId 和来源持久化边界。
- [x] 文档化按资源区分的 nodeVersion/entityVersion/workflowInstanceVersion/contextVersion 来源和用途，并写明 progression 命令的 `--version` 已删除、`--node-version`/`--context-version` 的迁移关系；创建 v1→v2 迁移说明。
- [x] Review：检查新契约与既有 CLI、PmsClient、Orchestrator PlanView 没有字段冲突。
- [x] 提交：`git commit -m "fix(cli): freeze progression safety semantics"`。

## Milestone 1：统一 preflight 与节点安全边界

### Task 1.1：统一 component/workbench 选择

**Files:**
- Create: `apps/pms-cli/src/commands/core/componentResolver.ts`
- Modify: `packages/pms-contracts/src/agentProgression.ts`
- Modify: `packages/pms-contracts/src/resourceScenario.ts`
- Modify: `apps/pms-cli/src/commands/core/agentContext.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgression.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyWorkbench.ts`
- Modify: `tests/contract/workflow-context.test.ts`
- Modify: `tests/unit/agent-progression-run.test.ts`
- Create: `tests/unit/component-resolver.test.ts`

**Interfaces:** 使用统一 `componentKey`；项目 `workbench` 只作为输入兼容别名。resolver 以“可写 saveContract 数量”判定：恰好 1 个可省略；多个未指定时返回 `CAPABILITY_UNAVAILABLE`；指定组件无可写 saveContract 时，写入意图返回 `CAPABILITY_UNAVAILABLE`，只读 context 仍可读并标注 `writeCapable=false`；0 个可写 saveContract 只阻止写入意图。context reader、draft validator 和四类 adapter 必须引用同一个 resolver 实现（`commands/core/componentResolver.ts`），不允许各自选择第一个 component。story 的候选集合必须来自后端声明的合法组件。

- [x] `pms context --format agent --view focused --component <componentKey>` 返回选定 component 的 nodeContract、version、saveContract 和 fieldContracts；`--component` 不允许脱离 `--view focused` 使用。
- [x] 接入 Task 0.2 已冻结的 `componentKey` 字段；project 的 `workbench` 兼容输入在 resolver 入口归一化。
- [x] 多个可写 saveContract 且未指定组件时返回 `CAPABILITY_UNAVAILABLE`，禁止按数组顺序选第一个。
- [x] requirement/topic 不再无条件选第一个 component；按组件选择器和后端声明的 saveContract 选择。
- [x] story progression 改为通过 resolver 选择后端声明的组件，同时保留旧 story workbench CLI 的兼容入口。
- [x] AgentDraftContract 使用同一 resolver 语义，避免 validator 与执行器按不同组件工作。
- [x] resolver 返回的 component/saveContract 已接入 context 展示、draft 校验和 normalizeArguments；readback 字段提取仍由各 adapter 的既有回读逻辑负责，下一任务继续统一。
- [x] 添加单组件、多可写组件、0 个可写组件的只读/写入、unsupported component 和别名冲突测试。
- [x] Review：确认所有资源的 component 选择语义一致，且没有把 workbench 名称泄露成另一套协议字段。
- [x] 提交：`git commit -m "feat(cli): select progression component explicitly"`。

### Task 1.2：统一当前节点校验

**Files:**
- Modify: `apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.ts`
- Modify: `tests/contract/project-resource-scenario.test.ts`
- Modify: `tests/unit/story-workbench-scenario.test.ts`

**Interfaces:** 四类资源的 progression 写入都要求 `nodeId === currentNode.id`；project 的 currentNode 必须取 focused context 的 `currentNode`，不能取 `selectedNodeId`；story 必须先解析 binding 再比较。历史节点补录不属于本阶段。

- [x] 先写 project/story 的错误测试，确保错误节点在 preview 前返回 in-band `CONFLICT`。
- [x] 保留 requirement/topic 的现有校验并统一错误类型。
- [x] project 使用 focused context 的 `currentNode`；测试 `selectedNodeId` 与 `currentNode` 不同时仍返回 `CONFLICT`。
- [x] story 在 `readStoryBinding` 之后比较 `binding.nodeId` 与 `context.currentNode?.id`，不能只信任请求参数。
- [x] draft validator 与 adapter 复用同一个 component resolver 语义，不能分别读取第一个 component。
- [x] `project.create`、`project.update`（包括 `project-basic-info`）继续走资源级路径；当前节点校验只适用于真正的节点写入。
- [x] 运行四类 adapter 的 focused context contract tests。
- [x] Review：确认没有禁止合法的资源级更新，也没有把 selectedNodeId 当成 currentNode。
- [x] 提交：`git commit -m "fix(cli): restrict progression to current nodes"`。

### Task 1.3：project focused preflight 与契约对齐

**Files:**
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgression.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Modify: `tests/unit/agent-progression-run.test.ts`
- Modify: `tests/contract/project-resource-scenario.test.ts`

**Interfaces:** project 节点更新/完成与其他资源一样，先读取 focused context、校验项目/节点/版本/saveContract，再进入 preview。

- [x] 移除 project 节点写入的 `preflightContext = null` 特例。
- [x] 使用 Task 1.1 的 component resolver，不在 project adapter 和 draft validator 中各自选择组件。
- [x] project 节点继续只接受 focused context 中声明的 workbench；不支持的 workbench 返回 `CAPABILITY_UNAVAILABLE`；`project-basic-info` 仍走资源级 `project.update`。
- [x] 如果后端暂时没有 project `fieldContracts/requiredFields`，只由 preview preconditions 提供缺失信息，不伪造统一字段契约。
- [x] 将运行时 `saveContract` 与 YAML agent contract 分开处理，不给节点命令自动附加不兼容的 `contractId/contractVersion`。
- [x] 添加 project `READ_CONTEXT` 零 preview/execute 测试。
- [x] Review：确认 adapter 没有复制 PMS 业务规则。
- [x] 提交：`git commit -m "fix(cli): align project progression preflight"`。

## Milestone 2：真实字段回读验证

### Task 2.1：改造 executor 的 focused readback

**Files:**
- Modify: `packages/pms-contracts/src/resourceScenario.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgression.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgressionRun.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts`
- Modify: `apps/pms-cli/src/cli/parseArguments.ts`
- Modify: `apps/pms-cli/src/cli/runCli.ts`
- Modify: `tests/unit/resource-scenario-dispatch.test.ts`
- Modify: `tests/contract/requirement-resource-scenario.test.ts`
- Modify: `tests/contract/topic-resource-scenario.test.ts`
- Modify: `tests/contract/resource-scenario-contract.test.ts`

**Interfaces:** execute 阶段复用或重建 focused before/after context，并把原始目标 `nodeId`、`componentKey`、normalizedArguments、selected saveContract 和 expectedPatch 传给 verifier。

- [x] execute 输入增加可选 `nodeId`、`componentKey`、`expectedPatch`；run 路径从内存中的 plan/draft 传入。
- [x] before/after 使用原始目标 nodeId，即使完成后 currentNode 已经前移；story 带 component 选择。
- [x] execute 重新读取 before/after context，并在版本变化时写入 warning，避免静默吞掉 TOCTOU 信号。
- [x] 不再调用 `adapter.verifyReadback(before, after, {}, operation)`，改为传递真实执行参数和 expectedPatch。
- [x] 单步旧 execute 若没有 expectedPatch，保持兼容但明确降级为身份/保护字段验证，不能宣称 `patchApplied=true`；progression execute 带 draft patch 作为验证参数。
- [x] dispatchResourceScenario 的 execute 分支解析并传递 `--node-id`、`--component`、`--expected-patch-json`。
- [x] 添加 focused readback、CLI 参数透传和 legacy execute 降级测试；节点字段级 projection 比较留给 Task 2.2 共享 verifier。
- [x] Review：确认没有增加隐式重试，readback 失败不会标成成功。
- [x] 提交：`git commit -m "fix(cli): pass focused context into readback"`。

### Task 2.2：抽取共享 verifier 与允许变更集

**Files:**
- Create: `apps/pms-cli/src/commands/scenarios/readbackVerification.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyWorkbench.ts`
- Create: `tests/unit/readback-verification.test.ts`

**Interfaces:**
- `mergeSnapshotDetails(snapshot)`：把资源级 projection、focused component/node projection 和字段契约合并成 verifier 可比较的快照；
- `extractComponentContent(snapshot, resourceType, componentKey)`：使用 Task 1.1 的 resolver 选中的 component/saveContract 提取实际业务字段，不得重新按数组顺序选择，也不能依赖固定的 `details` 路径；
- `comparePatchedFields(before, after, expectedPatch, fieldContracts)`：按 `fieldContracts[].type` 做日期、空值、枚举和数值归一化后比较；
- `compareProtectedFields(before, after, protectedFields, allowedMutations)`：`allowedMutations` 来自 preview/operation 的规范化变更集，不直接从 draft 猜测；
- `buildVerificationResult(...)`：区分 `patchApplied`、`protectedFieldsUnchanged`、`readbackComplete` 和 `WRITE_RESULT_UNKNOWN`。

- [x] 已测试稀疏 topic/story projection、完整 project projection、日期/数值归一化，以及 component 内容提取失败时的 unknown。
- [x] 明确资源级保护字段与本次 completion 合法变更字段分离；保护字段只从可观察快照比较。
- [x] 四类资源 adapter/故事工作台逐个接入共享 verifier，不改变特殊 completion 命令映射。
- [x] 复用后端 verifier 的“预期后状态 + 允许变更集”思路，不复制 Java 业务规则到 CLI。
- [x] 验证器只信任 operation 回传的 `allowedMutations`；缺少字段契约或无法完整读取时不得把“不知道”当成“未变化”。
- [x] Review：确认“不知道”不会被当成“未变化”，真实字段未回读时会降级为 `WRITE_RESULT_UNKNOWN`。
- [x] 提交：`git commit -m "refactor(cli): verify actual progression patches"`。

## Milestone 3：来源审计与统一 Agent 交接

### Task 3.0：冻结 provenance 存储与 digest 契约

**Files:**
- Create: `docs/agent-provenance-contract.md`
- Modify: `docs/agent-progression-decisions.md`
- Create: `packages/pms-contracts/src/provenance.ts`
- Modify: `packages/pms-contracts/src/index.ts`
- Modify: `packages/pms-contracts/src/agentProgression.ts`
- Modify: `packages/pms-contracts/src/agentProgressionRun.ts`
- Modify: `packages/pms-contracts/src/resourceScenario.ts`
- Modify: `docs/agent-progression-runbook.md`
- Create: `tests/contract/agent-provenance-contract.test.ts`
- Create: `tests/fixtures/provenance/*.json`

**Interfaces:** 冻结 spec“来源持久化契约”小节中的 wire shape、`draftDigest` 规范化、存储位置、大小/脱敏限制、`provenanceRef`、capabilities 的 `provenanceVersions` 和发布顺序。本任务只改契约、文档和 fixture，不写后端持久化代码。

- [x] 把 spec 中的 provenance wire shape 落成 TypeScript schema 和 JSON fixture，覆盖合法、超限、非法 sourceRef、digest 稳定性和 digest 不一致。
- [x] `draftDigest` 输入必须包含 `versionSnapshot`（node/entity/workflow/component/context versions）；未知值写 `null`，并测试任一版本变化都会改变 digest。
- [x] sourceRef 契约沿用现有 `<type>:<id>`、`<type>-node:<id>`、`<type>-node:<id>#component:<key>`；不新增 `pms:`/`conversation:` 命名空间；用 fixture 证明 CLI 和后端 validator 使用同一组格式。
- [x] 明确 `pms_ai_operation.provenance_json` 为下一次 migration 的唯一新增列；`pms_ai_plan` 复用 `draft_json`；不新增重复会话/审计表。
- [x] 明确 `provenanceRef = "operation:<previewOperationId>"`，execute 不接受新 provenance。
- [x] 在 `docs/agent-provenance-contract.md` 记录规范化算法、限制、脱敏规则和 rollout 顺序（backend first）。
- [x] Review：确认契约没有保存完整对话、Token 或自由文本。
- [x] 提交：`git commit -m "docs(contract): freeze draft provenance v1"`。

### Task 3.1：跨仓库增加 draft provenance

**Files:**
- Connector: `packages/pms-client/src/PmsClient.ts`、`packages/pms-contracts/src/agentProgressionRun.ts`、`packages/pms-contracts/src/operation.ts`、`packages/pms-contracts/src/resourceScenario.ts`、`apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.ts`、`apps/pms-cli/src/commands/core/agentContext.ts`、`apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Backend: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/integration/ai/api/AiOperationPreviewRequest.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/integration/ai/api/AiCapabilityDTO.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/integration/ai/api/AiOperationResultDTO.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/connector/AutomaticOperationRequest.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/command/CommandPreviewRequest.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/contract/AiAgentDraftValidator.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/entity/AiOperationDO.java`、现有 operation/plan/audit service、repository 和下一次 migration（新增 `pms_ai_operation.provenance_json LONGTEXT NULL`）
- Tests: connector contract、backend controller/service tests、isolated E2E
- Docs: `docs/agent-provenance-contract.md`（Modify）、`docs/agent-draft-contract.md`（Create）

**Interfaces:** 按 Task 3.0 冻结的可选 `provenance` 对象扩展 preview 请求；PMS 持久化字段级来源、`draftDigest` 和 `provenanceRef`，不保存完整对话内容。

- [x] 扩展 `AiOperationPreviewRequest`、`CommandPreviewRequest`、PmsClient preview 参数和 `operation.ts`，字段可选，旧客户端不带 provenance 时保持兼容。
- [x] 新增 `pms_ai_operation.provenance_json LONGTEXT NULL` migration；`AiOperationDO`、DTO 和审计查询回读该列；`pms_ai_plan` 复用 `draft_json`，不新增列。
- [x] capabilities 增加 `provenanceVersions: ["draft-provenance/v1"]`；`progression run` 的 UPDATE/COMPLETE 在 backend 不支持时直接返回 `CAPABILITY_UNAVAILABLE`（warnings 含 `PROVENANCE_NOT_SUPPORTED`），不生成 preview、不写入；旧 `resource-write`/`operation auto` 入口可执行但必须标记 `PROVENANCE_NOT_AUDITED` 和 legacy。
- [x] `draftDigest` 按 Task 3.0 的规范化算法计算并包含 `versionSnapshot`；preview 返回 PMS 生成的 `expectedVersions`，CLI 对该版本快照做冲突校验；稳定性、字段顺序、版本变化和 digest 不一致均有测试覆盖。
- [x] sourceRef 沿用现有格式 `<type>:<id>`、`<type>-node:<id>`、`<type>-node:<id>#component:<key>`；同步修改 `agentContext.ts`、`AgentDraftContract.ts` 和 `AiAgentDraftValidator.java`；generic `validate()` 的 `readableReferences` 补齐节点/组件 ref；不引入 `pms:`/`conversation:` 命名空间。
- [x] 校验 `sourceRefs` 必须指向本次可读取的 PMS context，不能由 Agent 任意伪造；Orchestrator 对话引用必须已建立可读会话映射，否则只能作为待补充信息，不能单独授权写入；preview 响应回显 `provenanceRef` 和 digest。
- [x] 让 execute 只引用已 preview 的 provenance，不允许 execute 重新提交另一份 draft；同步修改 operation/plan/audit DTO、`operation.ts` 和 `resourceScenarioExecutor.ts` 的传播链。
- [x] 对旧资源级客户端保持字段可选和版本兼容；缺失 provenance 的 legacy execute 只能走显式兼容降级，不得伪称完成了来源审计。`agent-progression/v2` 写入不得通过旧协议降级。
- [x] 发布顺序固定为 backend first、connector second；不接受新 connector + 旧 backend 的组合。
- [x] 添加 provenance 回读测试，证明字段级来源能通过已存在的 operation/plan 查询定位；该查询用于来源审计，不作为第一阶段 unknown write 的必备收敛路径；覆盖 sourceRefs 无效、超限、digest 不一致和重复 execute。
- [x] Review：确认不把 Token、完整聊天记录或敏感字段写入审计。
- [x] 提交：分别在 backend/connector 使用对应 commit，记录跨仓库依赖；`expectedVersions` 修复提交为 backend `1d5342d`、connector `cec4fe3`。

### Task 3.2：统一 Agent Draft、状态和名称化输出

**Files:**
- Modify: `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/agentProgressionRun.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts`
- Modify: `apps/pms-cli/src/commands/scenarios/storyWorkbench.ts`
- Modify: `packages/pms-contracts/src/userFacing.ts`
- Modify: `apps/pms-cli/src/output/userFacing.ts`
- Modify: `tests/unit/agent-draft-contract.test.ts`
- Modify: `tests/unit/user-facing-projection.test.ts`
- Modify: `tests/contract/agent-progression-run-contract.test.ts`

**Interfaces:** `userFacing` 明确包含 `targetNode` 和 `fieldChanges` 的名称化摘要；内部 ID 仍只在机器字段。`plan` 和 `result` 的结构分别固定为 `context/preview/missingFields` 与 `operation/readback/verification`。

- [x] `userFacing.targetNode` 和 `userFacing.fieldChanges` 已加入契约；字段变更摘要名称化展示，内部 ID 只保留在机器字段并按规则脱敏。

- [ ] 验证 Task 0.2 已冻结的规则在 story 路径生效：unresolved/low-confidence → `NEEDS_INPUT`，`requestedCompletion` 缺失或 false → `REJECTED`；只补 story 专属测试，不重复修改判定逻辑。
- [ ] 完成 story 剩余的异常归一化：story 使用 `ResourceScenarioError` 或等价类型，统一映射到 in-band 状态而不是 `ok:false`；通用 run 边界映射已在 Task 0.2 完成。
- [ ] 文档示例严格复用实际 `resourceScenarioDraftSchema`，不再使用不存在的 `{key,value,sourceRef}` 形状。
- [ ] 明确 facts/inferences/assumptions 的来源规则：facts/inferences 必须有 sourceRefs；assumptions 只能生成补问，不能直接写入；缺来源或低置信高风险一律 `NEEDS_INPUT`。
- [ ] 为 story 路径补充 `storyProgressionAdapter.ts` 和 `storyWorkbench.ts` 的错误归一化、组件解析和字段提取测试。
- [x] Review：确保 Claude/Codex 能直接使用结果，不需要从 ID 猜名称。
- [x] 提交：实现提交为 `8822518 feat(cli): expose user facing node and field changes`。

### Task 3.3：收紧旧写入口边界

**Files:**
- Modify: `skills/pms-project-management/SKILL.md`
- Modify: `apps/pms-cli/src/cli/runCli.ts`
- Modify: `tests/contract/skill-analysis-contract.test.ts`
- Modify: `tests/unit/agent-progression-run-cli.test.ts`
- Modify: `docs/agent-progression-runbook.md`

**Interfaces:** progression run 是 Agent 节点写入标准入口；旧 `operation auto`/`resource-write` 保留兼容并标记 legacy，非节点资源级操作可继续使用。

- [x] 移除文档中对旧入口的默认推荐。
- [x] 旧 `resource-write`/`operation auto` 执行结果 warnings 固定包含 `PROVENANCE_NOT_AUDITED`，文档和 skill 标记 legacy；progression 写入路径在后端不支持 provenance 时则直接阻止写入。
- [x] 不删除现有命令，确保现有用户脚本兼容。
- [x] Review：确认旧入口的兼容边界不会造成第二套隐式安全语义。
- [x] 提交：实现提交为 `b1ca837 docs(cli): make progression the agent write path`。

## Milestone 4：扩展已有真实 E2E 与发布门禁

### Task 4.1：扩展现有资源场景 E2E

**Files:**
- Modify: `tests/e2e/resource-scenario-real-pms.test.ts`
- Modify: `tests/e2e/story-acceptance-real-pms.test.ts`
- Modify: `tests/e2e/agent-progression-run.e2e.test.ts`
- Create: `tests/e2e/support/projectFixture.ts`
- Create: `tests/e2e/support/topicFixture.ts`
- Modify: `docs/e2e-agent-cli-runbook.md`

**Interfaces:** 扩展已有夹具和门禁，不从零新建一个替代性 E2E harness；project/topic 节点写入使用新增 fixture creator，在隔离库创建资源并推进到目标可写节点。

- [x] 每类资源覆盖 READ、UPDATE、COMPLETE 的代表性路径，不强求所有矩阵组合。
- [x] 覆盖成功、NEEDS_INPUT、WAITING_CONFIRMATION、幂等重放、版本冲突、unknown、capability unavailable。
- [x] project completion 按 high-risk/confirm 验证；development completion 按实际风险验证。
- [x] requirement/story 优先复用现有 fixture；project/topic 使用新增 `createProjectFixture`/`createTopicFixture` 在隔离库创建资源，并推进到目标可写节点；`PMS_E2E_PROJECT_ID`/`PMS_E2E_TOPIC_ID` 只用于只读或兼容基线，不能作为节点写入成功路径的唯一数据来源。
- [x] fixture creator 使用 run-id 前缀、通过已注册命令创建/推进资源，并在一次性数据库销毁时清理；不得依赖未声明的 delete 接口。
- [x] 若 project/topic 无法从创建态推进到目标可写节点，fixture 必须显式失败并给出缺失的命令/模板，不能静默跳过。
- [x] 本阶段只扩展 CLI/resource-scenario/progression E2E；Orchestrator E2E 留到 Milestone 5，避免把两层故障混在同一门禁里。
- [x] 验证 preview/operation/audit/readback/provenance 关联。
- [x] Review：确认失败能通过 requestId/operationId 定位，且清理策略真实可执行。
- [x] 提交：实现提交为 `02eb0bc test(cli): extend resource fixtures to node writes`。
- [ ] 在真实隔离 PMS/MySQL 环境实际运行四资源 E2E；当前仅完成测试代码、fixture 和门禁，未将跳过状态误报为通过。

### Task 4.2：统一发布检查与 unknown 核验手册

**Files:**
- Create: `docs/release-checklist.md`
- Modify: `docs/resource-scenario-runbook.md`
- Modify: `docs/e2e-agent-cli-runbook.md`
- Modify: `tests/contract/resource-scenario-contract.test.ts`

- [x] 明确 unknown write 第一阶段只能使用同一 conversation、同一 preview、同一 draftDigest 下的幂等键重放，不假设存在 operation GET 或把 provenance 查询当作写入收敛路径。
- [x] 确认文档描述与 Task 0.2 冻结一致：`auditId` 当前等于 `operationId`，是 opaque 审计关联标识，不是独立审计实体。
- [x] 发布门禁包含 unit、contract、typecheck、build、隔离 E2E 和文档静态检查。
- [x] Review：对照 Global Constraints 检查模型边界、凭据、旧入口和数据库隔离。
- [x] 提交：实现提交为 `54e9e88 chore(cli): add progression release gates`。

## Milestone 5：扩展已有 ai-orchestrator-v1

### Task 5.1：把四类资源接入现有 Orchestrator 合约

**Files:**
- Backend: `/Users/fs/Desktop/Project/pms-backend/docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/domain/AiOrchestratorIntent.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorService.java`、现有 orchestrator contract/service/verification tests、必要的 migration
- Connector: `docs/orchestrator-session-contract.md`、`packages/pms-client` orchestrator methods/tests
- Tests: existing orchestrator contract tests、`tests/e2e/orchestrator-requirement-analysis.e2e.test.ts`、`tests/e2e/orchestrator-story-node.e2e.test.ts` 和新增/扩展的 project/topic orchestrator isolated E2E

**Interfaces:** 复用 `Conversation`、`Plan`、`OperationEvent`、`PlanView.nodeContract`、`missingFields`、`questions`、`verification`；`agent-progression-run/v2` 作为无状态执行边界，旧 v1 不再作为执行入口。实现前先把下表落成代码中的 adapter mapping，不新建第二套 PlanView。

| 资源 | READ_CONTEXT | UPDATE_NODE_FIELDS | COMPLETE_NODE |
| --- | --- | --- | --- |
| project | focused context + `project_node` capability | `node.field.update`（`project-basic-info` 走 `project.update`，不映射为节点写入） | `node.complete-with-data` |
| requirement | focused context + development-item capability | `development-item.node.field.update` | `development-item.node.complete-with-data` |
| topic | focused context + development-item capability | `development-item.node.field.update` | `development-item.node.complete-with-data` |
| story | focused context + story workbench binding | `development-item.node.field.update`（story workbench variant） | `development-item.node.complete-with-data` / workbench `completionCommand` |

- [x] 先把现有 requirement analysis/story node 的差异与上表对照，列成 adapter mapping，不新建第二套 PlanView。
- [x] 扩展 `AiOrchestratorIntent` 的 resource × READ/UPDATE/COMPLETE 映射，以及现有 draft 校验、command mapping、PlanView 的 `nodeContract/missingFields/questions/verification` 字段；明确 project/topic 的 component 选择。
- [x] 扩展 project/topic 的 context、draft、preview、confirm、readback 映射，并把现有 connector result envelope 映射为 Orchestrator 的 `operation/readback/verification`。
- [x] 复用现有持久化表和事件序列，不新增重复 Conversation/Plan 表；版本、来源和恢复信息沿用既有 plan/operation/verification 字段。
- [x] 保持外部 Agent 直接调用 CLI 的路径兼容。
- [x] Review：确认 Orchestrator 只编排，不复制 PMS 字段规则和 CLI adapter。
- [x] 提交：backend `c17160d`，connector `95c42b1`。

### Task 5.2：实现最小恢复闭环

**Scope:** 一个资源、一个会话、一个待确认节点；不同时实现多资源事务、自动审批和复杂 UI。

**Files:**
- Backend: `/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorService.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/api/AiOrchestratorResponse.java`、`/Users/fs/Desktop/Project/pms-backend/src/main/java/com/brad/pms/ai/orchestrator/persistence/AiPlanDO.java`、`AiOperationEventDO.java`、`AiPlanMapper.java`、现有 orchestrator contract/service tests（必要时追加最小 migration）
- Connector: `packages/pms-client/src/PmsClient.ts`、orchestrator session methods/tests、`tests/e2e/orchestrator-requirement-analysis.e2e.test.ts`、`tests/e2e/orchestrator-story-node.e2e.test.ts`
- Docs: `/Users/fs/Desktop/Project/pms-backend/docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`、`docs/orchestrator-session-contract.md`

**Interfaces:** 复用 `PlanView`、`AiOrchestratorState`、`AiOperationEventDO.sequenceNo`（数据库列名为 `sequence_no`）、`pms_ai_plan.idempotency_key` 和 `verification`；恢复只读取已有 plan/event，不新造会话模型。

- [x] 明确 WAITING_CONFIRMATION 的恢复状态机：pending plan → confirm → execute → readback → verified/failed/unknown，每一步都可由 `planId`/`operationId` 恢复。
- [x] 支持 confirm 的幂等重放：同一 conversation、同一 preview、同一 draftDigest 下的 `idempotency_key` 返回同一 operation/result；不同 draft、不同 digest 或不同 preview 不得复用。
- [x] 覆盖断线、版本冲突、执行未知和事件序列缺口：未知状态进入 `WRITE_RESULT_UNKNOWN`，第一阶段只通过同一 conversation、同一 preview、同一 draftDigest 下的幂等键重放收敛；真实 fault-injection 仍由后续基础设施补齐。
- [x] 用已有 orchestrator E2E 验证，不新建平行 harness；新增 project/topic 会话测试并接入统一五资源套件。
- [x] Review：确认 Orchestrator 失败不会破坏现有 CLI progression run。

## 发布顺序

1. Milestone 0：先冻结事实、版本、状态、来源和入口决策。
2. Milestone 1：统一当前节点和 project preflight。
3. Milestone 2：解决真实字段回读，否则不能宣称写入已验证。
4. Milestone 3：先用 Task 3.0 冻结 provenance 契约，再实现来源审计、名称化输出和旧入口边界。
5. Milestone 4：扩展已有 E2E 并建立发布门禁。
6. Milestone 5：在现有 Orchestrator 上扩展四资源，不重新建会话层。

## 最终验收清单

- [x] `run` 默认 plan，业务状态和系统错误边界稳定。
- [x] 四类资源的代码路径校验当前节点、能力、preview 版本、幂等和字段回读；真实隔离 E2E 仍待运行。
- [x] 未决决策、低置信高风险推断和缺少来源不会被 confirm 直接写入。
- [x] `REJECTED` 的 `writeDecision`、`plan.preview` 和 `rejectionReason` 映射在契约测试中固定。
- [x] `auditId` 只按 operationId 别名/opaque 关联标识描述，不存在独立审计实体假设。
- [x] draft provenance 可追踪到 operation/plan/audit，且不泄露完整对话或凭据。
- [x] provenance 的 wire shape、digest、存储、限制和 rollout 顺序在 Task 3.0 冻结后才进入实现。
- [x] sourceRef 沿用现有 `<type>:<id>` / `<type>-node:<id>` / `<type>-node:<id>#component:<key>` 格式，CLI 与后端 validator 使用同一组命名空间。
- [x] `draftDigest` 包含 `versionSnapshot`，任一版本变化都会改变 digest。
- [x] provenance 不支持时 progression 写入被阻止；旧入口标记 legacy 和 `PROVENANCE_NOT_AUDITED`。
- [x] 用户默认看到名称和业务术语，机器字段保留内部 ID。
- [x] 旧写入口兼容但不再是 Agent 节点写入标准入口。
- [ ] 现有资源场景、story、orchestrator 隔离 E2E 扩展通过（测试代码已准备，真实隔离环境尚未运行）。
- [x] project/topic 节点 E2E 使用隔离 fixture creator，不依赖人工预置 ID。
- [x] Orchestrator 复用现有表、接口和 PlanView，未产生平行会话模型；四资源扩展代码已完成，真实隔离 E2E 仍是发布门禁。
- [ ] 每个任务都经过聚焦测试、review 和回归测试（Task 3.2 剩余 story 专属项完成后再关闭）。
