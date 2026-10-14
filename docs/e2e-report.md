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

截至本地开发阶段，未在没有隔离配置的环境执行上述真实写入验收；“测试跳过”不计为真实场景通过。

## 场景级闭环验收

场景级 CLI 将两个自然语言工作台场景固定为可演示步骤：

```bash
pms scenario project-create plan --arguments-json '{"name":"AI Native PMS"}' --format json
pms scenario project-create execute --arguments-json '{"name":"AI Native PMS"}' --idempotency-key project-demo-1 --format json

pms scenario requirement-analysis plan 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --format json
pms scenario requirement-analysis execute 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --idempotency-key analysis-demo-23-7 --format json
```

`plan` 阶段只读取能力/上下文并生成预览；`execute` 阶段才提交写入并返回结构化回读。写入结果的 `trace.operationId` 是 PMS 持久化 AI 操作记录的审计引用，重复请求必须使用同一幂等键。真实执行仍必须遵守本文前面的隔离环境和清理要求。
