# PMS CLI E2E 验收

真实验收默认关闭，避免误写业务数据。只读验收需要一个短期用户 Token：

```powershell
$env:PMS_E2E_READONLY="true"
$env:PMS_E2E_BASE_URL="http://localhost:5173/api"
$env:PMS_E2E_TOKEN="<short-lived-user-token>"
$env:PMS_E2E_PROJECT_ID="1" # 可选；不设置时使用列表第一条项目
pnpm vitest run tests/e2e/pms-cli.e2e.test.ts
```

验收覆盖能力目录、项目查询、企业项目看板摘要和项目流程上下文；字段、节点、允许动作均从接口回读，不在测试中硬编码流程节点。

写入验收必须使用隔离账号、隔离项目和业务命令清理。不得直接执行 SQL，不得使用管理员 token，也不得在未设置 cleanup 的情况下打开 `PMS_E2E_WRITE=true`。重复幂等键、无权限用户和过期 Token 的结果应保持由 PMS 后端返回，CLI 不做绕过或本地伪造。

## 项目创建真实验收

自动化闭环由 `tests/e2e/project-create.e2e.test.ts` 提供，默认 skipped。执行前必须同时设置 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`、`PMS_E2E_BASE_URL`、与其精确匹配的 `PMS_E2E_ALLOWED_BASE_URL`、`PMS_E2E_AUTH_ORIGIN`、`PMS_E2E_ACCOUNT_ID` 和安全的 `PMS_E2E_RUN_ID`，再运行：

```bash
pnpm run verify:real-pms:project-create
```

测试会通过 BrowserAuth 请求浏览器授权，核对 `capabilities.viewer.id`，创建唯一的 `AI-E2E-<runId>` 项目，使用同一完整请求和幂等键重放，并通过精确 `get/context` 回读。清理仅使用本次成功创建并记录的项目 ID；无法删除时报告残留 ID，不申请管理员权限。

## 需求分析保存真实验收

`tests/e2e/requirement-analysis.e2e.test.ts` 同样默认 skipped。除隔离认证配置外，还必须指定 `PMS_E2E_REQUIREMENT_ID` 和 `PMS_E2E_NODE_ID`；测试不会从列表任意挑选需求或节点，不会自动创建前置流程，也不会删除历史分析字段。它只验证明确节点、当前版本、结构化分析字段回读、来源文本回读、受保护字段不变以及相同幂等键回放。

来源内容只按系统回读结果记录，不据此宣称外部资料真实或已被 PMS 验证；静态 Skill 测试只能验证约束文字，不能替代后端授权、字段白名单、版本、幂等和审计。

## 故事节点编排真实验收

`tests/e2e/orchestrator-story-node.e2e.test.ts` 覆盖上下文读取、`NEEDS_INPUT`、多轮草稿合并、预览、确认、执行、回读、幂等重放、版本冲突、跨 CLI 进程恢复和操作审计。它只允许写入一次性隔离数据库，并要求显式设置 `PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true`。

测试结束时会通过 `PMS_E2E_MYSQL_CLIENT` 查询 `pms_ai_operation`。没有宿主机 MySQL 客户端时，使用 `scripts/e2e-mysql-client.sh`，让查询在隔离 MySQL 容器内执行：

```bash
export PMS_E2E_MYSQL_CLIENT="$PWD/scripts/e2e-mysql-client.sh"
export PMS_E2E_MYSQL_CONTAINER="pms-ai-e2e-${PMS_E2E_RUN_ID}-mysql-1"
export PMS_E2E_DB_URL="mysql://pms_e2e:local-only-password@127.0.0.1:13306/${PMS_E2E_DATABASE_NAME}"
pnpm run verify:real-pms:story-orchestrator
```

这段数据库访问只用于验收审计，不是 CLI 的运行时依赖。

截至本地开发阶段，未在没有隔离配置的环境执行上述真实写入验收；“测试跳过”不计为真实场景通过。

## 资源场景闭环验收（2026-10-16）

`tests/e2e/resource-scenario-real-pms.test.ts` 使用显式的 `PMS_E2E_RESOURCE_SCENARIO=true` gate，要求专用账号、一次性 `pms_ai_e2e_` 数据库、项目/专题/需求 ID 和 `PMS_E2E_DB_URL`。它会对三类资源分别执行 `plan → execute → readback`，重放同一幂等键，并查询 `pms_ai_operation` 审计记录。plan 后通过资源详情确认业务数据未改变，execute 后验证版本、operationId、auditId、verification 和回读结果。

本次隔离运行 `resource-20261016e` 已通过真实 PMS：需求、专题、项目均完成
`plan（含 preview）→ execute → resource/context readback`，并验证了 `operationId`、`auditId`、
verification、业务字段回读和相同幂等键重放。运行使用一次性数据库和专用账号，未修改开发环境中的业务库。
MySQL 查询使用 `scripts/e2e-mysql-client.sh` 在指定容器内执行；未配置隔离 gate、账号或数据库时，显式运行该 E2E 会失败并说明缺失项。

## 四类资源统一验收

`scripts/verify-real-pms-agent-suite.sh` 是需求、专题、项目、故事的统一真实验收入口：资源场景测试覆盖需求/专题/项目，需求 Orchestrator 测试覆盖需求会话，故事 Orchestrator 测试覆盖故事会话。脚本在同一个一次性数据库中自动创建四类夹具，串行执行三个 E2E 文件，不需要人工预置资源 ID。

它要求 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`、`PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true`，并要求目标 URL、数据库白名单、账号、run ID、`PMS_E2E_DB_URL` 等隔离配置齐全。推荐通过 package script 执行：

```bash
pnpm run verify:real-pms:agent-suite
```

脚本只负责安全门禁、夹具模式和串行调度；具体的上下文、preview、execute、回读、幂等、冲突、恢复和审计断言仍由各领域 E2E 自己负责。测试结束后应使用对应的 `pms-backend/scripts/stop-ai-e2e.sh` 销毁一次性数据库和服务。

## 场景级闭环验收

场景级 CLI 将两个自然语言工作台场景固定为可演示步骤：

```bash
pms scenario project-create plan --arguments-json '{"name":"AI Native PMS"}' --format json
pms scenario project-create execute --arguments-json '{"name":"AI Native PMS"}' --idempotency-key project-demo-1 --format json

pms scenario requirement-analysis plan 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --format json
pms scenario requirement-analysis execute 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --idempotency-key analysis-demo-23-7 --format json
```

`plan` 阶段只读取能力/上下文并生成预览；`execute` 阶段才提交写入并返回结构化回读。写入结果的 `trace.operationId` 是 PMS 持久化 AI 操作记录的审计引用，重复请求必须使用同一幂等键。真实执行仍必须遵守本文前面的隔离环境和清理要求。

## AI 只读流程上下文的真实验收状态（2026-10-14）

- 单元/合同测试已经覆盖请求/回执核验、referencesScope、contentState、focused 字节预算（详见
  tests/contract/workflow-context.test.ts）。
- `tests/e2e/support/readonlyContextSession.ts` 只从环境读取四类型/节点的显式 ID；缺失→该项“未运行”，
  匹配到首条搜索结果、自动创建或清理资源的行为被 helper 拒绝。安全 gate 单元测试位于
  tests/unit/e2e-safety.test.ts（不借用写 E2E helper）。
- 本次会话（开发阶段）未执行真实只读 API 验收（`pnpm run verify:real-pms:readonly` 需要
  PMS_E2E_READONLY=true、PMS_E2E_TOKEN、四类显式 ID），也未做外部模型工作台的只读解释核验；
  缺失环境→未运行≠通过。
- 旧版后端（无 meta 回执）下 CLI 真实验证已证明 legacy 兼容与显式参数核验失败（见
  2026-10-14-ai-readonly-workflow-context-implementation-review.md 的 Task 7 记录）。
- 两个 feature（readonlyWorkflowContext/focusedWorkflowContext）保持 false，须待所有验收完成后再启用。
