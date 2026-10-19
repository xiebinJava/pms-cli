# 四类资源 Agent progression 真实能力矩阵

日期：2026-10-19
范围：`pms-ai-connector` 当前代码、现有契约测试、真实 PMS E2E 门禁。
用途：冻结 Milestone 0 的代码事实；本文件不把尚未实现的 v2、provenance 或 Orchestrator 扩展写成当前能力。

## 协议基线

| 能力 | 当前代码基线 | v2 目标 |
| --- | --- | --- |
| Agent context | `agent-contract/v1`，先检查 capabilities 的 `agentContractVersion` 和 feature flag | 继续沿用 Agent context 合约，和 progression v2 独立演进 |
| Resource scenario | `resource-scenario/v1` | 暂不升级，作为底层兼容适配边界 |
| Agent progression input/plan/result | `agent-progression/v1` | 升级为 `agent-progression/v2` |
| Agent progression run envelope | `agent-progression-run/v1` | 升级为 `agent-progression-run/v2` |
| Draft provenance | 当前只在 CLI 本地校验 | `draft-provenance/v1`，由后端 preview 持久化和回显 |
| 版本参数 | progression 当前仍可解析旧 `--version` | progression v2 使用 `--node-version` 和 `--context-version`；其他 CLI 命令的 `--version` 不受影响 |

## 共同执行事实

1. `pms context` 支持 `legacy` 和 `focused` 两种视图；`--component` 只能和 `focused` 一起使用。`getAgentContext()` 会先检查 `agentContractVersion`、`readonlyWorkflowContext` 或 `focusedWorkflowContext` feature，再读取 PMS context。
2. `pms capabilities` 是操作、风险、scope、输入字段和 refresh scope 的服务端目录。CLI 的 `CapabilityResolver` 不猜测未声明的操作。
3. `planResourceScenario()` 的共同路径是：adapter 读取 context → normalize arguments → capabilities 校验 → adapter 校验 → PMS preview。
4. `executeResourceScenario()` 要求 `previewOperationId` 和 `idempotencyKey`，执行后读取 resource/context 并生成 verification。当前 executor 仍需要 Milestone 2 才会把本次 expected patch 传给 verifier，当前 `patchApplied` 不能视为完整字段级证明。
5. `progression run` 是四类资源的统一 Agent 入口，但当前代码仍是 v1；它复用 resource adapter，story 另外复用 story workbench adapter。

## 资源矩阵

| 资源 | 当前支持的 adapter 操作 | context 读取事实 | saveContract / 节点边界 | preview / execute / readback | 当前测试与门禁 | 当前限制 |
| --- | --- | --- | --- | --- | --- | --- |
| project | `project.create`、`project.update`、`node.field.update`、`node.complete-with-data` | `project.create` 不读资源 context；资源级 update 读 project context；节点操作使用 focused context | 节点组件中的 project saveContract 是字段来源；`project-basic-info` 资源级路径不要求 current-node；节点写入必须校验当前节点和 workbench | 复用 resource-scenario preview/execute；回读 project detail + context，并检查资源/上下文身份、工作流稳定性和保护字段 | `tests/contract/project-resource-scenario.test.ts`、`tests/e2e/project-create.e2e.test.ts`、`tests/e2e/resource-scenario-real-pms.test.ts` | `project_node`、`project-basic-info`、`solution-decision`、`custom-fields` 的真实能力仍需以隔离 PMS capabilities/context 矩阵确认；字段级 patch 验证留到 Milestone 2 |
| requirement | `requirement.update`、`requirement.analysis.save`、`requirement.execution-target.link/change/unlink`、`development-item.node.field.update`、`development-item.node.complete-with-data` | 资源级操作读普通 context；analysis save 和节点 update/complete 读 focused context | 节点 saveContract 提供 itemType、itemId、nodeId、version、fieldValuesPath、writable/protected fields；节点写入要求请求 nodeId 等于 currentNode.id | resource-scenario executor 回读 requirement detail + context；analysis 和节点 adapter 都做资源/节点/字段保护校验 | `tests/contract/requirement-resource-scenario.test.ts`、`tests/e2e/resource-scenario-real-pms.test.ts`、`tests/e2e/requirement-node-autofill.e2e.test.ts`、`tests/e2e/agent-progression-run.e2e.test.ts` | 当前 progression/progression-run 仍是 v1；真实节点能否写入取决于 PMS 当前节点 saveContract 和 capability |
| topic | `topic.create`、`topic.update`、`topic.project.link`、`development-item.node.field.update`、`development-item.node.complete-with-data` | create 不读 context；资源级操作读 topic context，并按关联项目再读 project context；节点操作读 focused topic context | topic projection 与 target project context 合并；节点 saveContract 提供组件、字段路径、版本和关联项目节点约束；无 saveContract 只能读 | 回读 topic detail + topic context，额外检查 relation consistency 和 workflow stability | `tests/contract/topic-resource-scenario.test.ts`、`tests/e2e/resource-scenario-real-pms.test.ts` | topic 节点可写组件、关联项目节点和完成能力需要真实 capabilities/context 确认；不能从默认模板猜字段 |
| story | progression 通过 story workbench adapter；底层命令是 `development-item.node.field.update`，完成时使用 saveContract 的 completion command | story progression 总是读取 focused context，并绑定后端声明的 `story-node-workbench` 组件；story workbench 独立路径也读取 focused component | story 当前组件 key、variant、fieldValuesPath、writableFields 和 completion metadata 均由 saveContract 提供；外部 componentKey 不能绕过后端 policy | story workbench 自己执行 preview/execute，并回读 story detail、focused context 和组件内容；统一 progression 结果再投影为 Agent envelope | `tests/contract/story-workbench-contract.test.ts`、`tests/contract/story-workbench-cli.test.ts`、`tests/e2e/story-acceptance-real-pms.test.ts`、`tests/e2e/orchestrator-story-node.e2e.test.ts` | 当前 story adapter 仍有固定组件实现，Task 1.1 才统一 resolver；story 专属异常仍需并入统一 in-band 映射 |

## 真实 PMS 能力矩阵采集规则

Task 0.1 运行时必须记录以下代码事实，不把“适配器支持”误写成“后端已开放”：

- 每类资源的 capabilities action 名称、risk、mode、scope、inputSchema 和 refreshScopes；
- 普通 context 与 focused context 是否可读，两个 feature flag 是否开启；
- 当前节点 ID、节点版本、workflowInstanceVersion、组件 key、saveContract、writable/protected fields；
- preview 是否返回阻塞 preconditions，execute 是否返回 operationId/auditId，回读是否能完成身份、关系、工作流和保护字段校验；
- `project_node` 分组以及 project 的 `project-basic-info`、`solution-decision`、`custom-fields` 是否真实存在；
- topic/story 的 sparse projection 是否需要额外读取关联资源或 workbench component；
- 所有 E2E 是否使用隔离 gate 和允许的数据库白名单。

## E2E 门禁事实

现有真实写入测试使用 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`、`PMS_E2E_ALLOWED_BASE_URL`、`PMS_E2E_ALLOWED_DATABASE_NAME`、`PMS_E2E_ACCOUNT_ID` 和 `PMS_E2E_RUN_ID`。资源场景由 `PMS_E2E_RESOURCE_SCENARIO` 控制，故事验收由 `PMS_E2E_STORY_ACCEPTANCE` 控制，统一 progression 由 `PMS_E2E_AGENT_PROGRESSION` 控制。

未显式打开 gate 时，真实 E2E 必须跳过；显式打开但缺少隔离配置、数据库白名单、OAuth 身份或 MySQL 审计客户端时，测试必须失败，不能把缺配置当作通过。

## Milestone 0 结论

- 当前四类资源均已有 adapter 或 workbench 路径，但只有 requirement/topic/story 的部分场景已有稳定节点写入事实；project 节点能力需要用真实 catalog 再确认。
- 统一 progression v2、sourceRef 实体校验、provenance 持久化和 expectedVersions 绑定都是后续任务，不能从本矩阵推断为当前已实现。
- Orchestrator 现有会话与 PlanView 只作为后续复用目标，本矩阵不把四资源会话映射写成现状。
