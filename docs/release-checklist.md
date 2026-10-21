# 四资源 Agent 推进发布门禁

这份清单用于发布 `pms-cli`、PMS backend 和配套 skill。它把“代码测试通过”和“可以安全让 Agent 写入”分开检查。

## 1. 版本组合

- backend 先发布并确认 capabilities 已声明当前协议版本：`agent-progression/v2`、`agent-progression-run/v2`；如果写入要提交来源，必须同时声明 `draft-provenance/v1`。
- connector 再发布。不能用新 connector 连接旧 backend，也不能把 v1 progression 示例当成 v2 写入请求。
- progression 命令使用 `--node-version` 和 `--context-version`；旧 `--version`、`agent-progression/v1` 和 `agent-progression-run/v1` 应返回迁移错误。
- 发布前确认 `skills/pms-project-management/SKILL.md` 与 `docs/agent-progression-runbook.md` 推荐的是 `scenario progression run`，兼容入口明确标记为 legacy。

## 2. 本地静态门禁

在 connector 仓库执行：

```bash
pnpm run typecheck
pnpm run build:cli
pnpm exec vitest run tests/contract tests/unit --cache=false --maxWorkers=1 --minWorkers=1
```

认证单元测试如果受本机钥匙串或浏览器监听权限影响，应在隔离环境中复跑；不能把跳过认证测试写成全量通过。真实 E2E 默认关闭，未打开 gate 时的 `skipped` 不是业务验收通过。

## 3. 隔离真实 E2E 门禁

所有会写 PMS 的测试都必须同时设置 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`，并指向一次性 `pms_ai_e2e_` 数据库。资源场景还必须设置 `PMS_E2E_RESOURCE_SCENARIO=true`；使用自动创建项目/专题夹具时设置 `PMS_E2E_CREATE_RESOURCE_FIXTURES=true`。

至少运行以下代表性链路：

```bash
pnpm run verify:real-pms:resource-scenario
pnpm run verify:real-pms:node-autofill
pnpm run verify:real-pms:story-orchestrator
pnpm run verify:real-pms:project-orchestrator
pnpm run verify:real-pms:topic-orchestrator
```

发布前优先运行统一门禁，它会串行执行上述五条代表性链路：

```bash
pnpm run verify:real-pms:agent-suite
```

该脚本要求 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`、
`PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true` 以及数据库白名单变量，并在一次性
隔离库中开启资源夹具。项目夹具会用已注册命令从创建态推进到第一个可写节点，
不依赖人工预置的项目/专题 ID。资源夹具必须重新读取当前节点、focused context、
可写 `saveContract` 和字段版本。项目/专题节点字段写入必须完成 preview、execute、
回读和相同幂等键 replay；没有可写节点时测试必须失败，不得静默跳过。

未设置真实 E2E gate 时，测试输出的 `skipped` 只能表示“未运行”，不能计入发布通过。
“project/topic Orchestrator disabled until isolated suite passes”是合并和发布门禁，
不是运行时 feature flag：隔离套件通过前，相关代码只能留在功能分支，不能合并或部署到默认发布分支。

## 4. Unknown write 核验

当 execute 返回成功但回读不完整时，状态必须是 `WRITE_RESULT_UNKNOWN`。处理顺序固定为：

1. 保留 `previewOperationId`、`operationId`、`auditId`、幂等键和 `draftDigest`；完成节点导致的状态、负责人或排期变化必须使用 preview/operation 中由 PMS 声明的 `allowedMutations` 回读核验，execute 请求本身不得携带这份白名单。
2. 只在同一 conversation、同一 preview、同一 `draftDigest` 范围内用相同幂等键重放。
3. 重放前重新读取资源和 focused context；如果版本冲突，返回 `CONFLICT` 并重新 plan。
4. 不根据一次 HTTP 成功猜测字段已经落库，也不依赖尚未提供的 operation GET 或 provenance 查询来自动收敛。

当前 `auditId` 与 `operationId` 相同，只作为 opaque 审计关联标识使用；不要把它当成独立审计实体或自行拼接第二套 ID。

## 5. 来源审计和旧入口

- progression 写入若 backend 未声明 `draft-provenance/v1`，返回 `CAPABILITY_UNAVAILABLE` 和 `PROVENANCE_NOT_SUPPORTED`，不生成 preview、不写入。
- execute 只能引用原 preview 的来源绑定，不能提交另一份 provenance。
- 旧 `operation auto`、`operation execute` 和 `resource-write` 保留兼容，但执行结果必须带 `PROVENANCE_NOT_AUDITED`；它们不能被 skill 当作节点 Agent 写入的默认入口。
- 审计不得保存 Token、API Key、完整聊天记录或未映射的 `conversation:`/`pms:` 引用。

## 6. 发布后抽查

- 用 Claude/Codex 发起一次只读 `READ_CONTEXT`，确认结果中的项目、需求、专题、故事名称化输出正确，内部 ID 只存在机器字段。
- 用一条低/中风险节点草稿完成 `plan → auto → 回读`，确认字段变化、保护字段和 operation/audit 关联可定位。
- 用一条高风险完成请求确认会返回 `WAITING_CONFIRMATION`，缺少 `requestedCompletion=true` 会返回 `REJECTED`/`NEEDS_INPUT`，且没有 preview 或写入。
- 保存本次发布的测试日志、requestId、previewOperationId 和隔离数据库 run-id；停止隔离环境并销毁数据库卷。

## 7. 文档与跨仓库一致性

- connector 与 backend 都必须包含同一份 `draft-provenance/v1` golden vector；运行
  `node scripts/verify-provenance-fixture-sync.mjs`，输出必须确认两侧字节一致。
- `docs/orchestrator-session-contract.md`、backend 的
  `docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`、本清单和
  `skills/pms-project-management/SKILL.md` 的资源矩阵、状态/事件边界、版本轴、组件
  选择和 E2E 命令必须同步。
- Markdown 静态检查、`git diff --check`、connector typecheck/build、Connector
  unit/contract tests、backend Orchestrator 回归测试均是发布前门禁；任何一项失败都不
  得以“代码已提交”替代。

## 8. 本轮闭环证据

- 四资源真实矩阵运行：隔离 run `codex20261021matrix4`。通过
  `resource-scenario-real-pms.test.ts`、需求分析、故事节点、项目节点和专题节点
  五个套件；首次因宿主机没有 `mysql` 命令失败，随后使用
  `scripts/e2e-mysql-client.sh` 在 MySQL 容器内查询并通过。
- Orchestrator 恢复运行：隔离 run `codex20261021resume2`。项目会话验证了
  `PLAN_READY → PREVIEW → WAITING_CONFIRMATION → CONFIRM → SUCCEEDED → NO_ACTION`
  的只读 `resume` 投影，并通过回读、幂等重放、版本冲突、非法来源和多组件守卫。
- 两个隔离 run 均在测试结束后通过 `scripts/stop-ai-e2e.sh` 销毁数据库卷和网络；
  不得把这些一次性 run 当作共享环境配置。
- `resume` 的用户可见命令是：
  `pms scenario resource-orchestrator resume <conversation-id> [--after-sequence <n>]`。
  它只读会话和事件，不生成 turn、preview、execute 或新的幂等键。
