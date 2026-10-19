# Resource Scenario CLI 验收手册

这套接口把自然语言代理的写入动作固定成：

```text
Claude/Codex 理解请求
→ pms scenario resource plan
→ 展示 preview 和 warnings
→ 用户确认
→ pms scenario resource execute
→ PMS 回读 resource/context，并返回 operationId/auditId
→ 根据 verification 汇报结果
```

## 自然语言到 CLI

| 自然语言意图 | 资源场景 | 关键参数 |
| --- | --- | --- |
| 分析需求 33 的当前信息并更新标题 | `requirement.update` | `resourceType=requirement`、`resourceId=33` |
| 更新专题 12 的标题 | `topic.update` | `resourceType=topic`、`resourceId=12` |
| 更新项目 42 的名称 | `project.update` | `resourceType=project`、`resourceId=42` |
| 修改项目某节点工作台字段 | `node.field.update` | `projectId`、`nodeId`、`workbench`、`fields`，以 context 的 `saveContract` 为准 |

代理必须先读取上下文并把实体版本带入 plan。不要从默认流程模板推断节点、字段或版本。

需求、专题、故事和项目节点字段也可以使用统一的 `progression run`：

```bash
pms scenario progression run requirement 33 --intent READ_CONTEXT --format json
pms scenario progression run requirement 33 --intent UPDATE_NODE_FIELDS \
  --execute-mode plan --node-id <node-id> \
  --draft-json '<agent-progression/v2 draft>' --format json
pms scenario progression run project --name "PMS 项目管理系统" --intent READ_CONTEXT --format json
pms scenario progression run project --name "PMS 项目管理系统" --intent UPDATE_NODE_FIELDS \
  --execute-mode plan --node-id <node-id> \
  --draft-json '<agent-progression/v2 draft>' --format json
```

这里由 Claude/Codex/DeepSeek 负责把自然语言整理成草稿，CLI 只读取 PMS、生成 preview、执行并回读。模型凭据留在外部工作台，不传入 CLI；写入字段必须引用本次 context 返回的 `saveContract`，不能猜测 nodeId 或字段 key。低/中风险且用户已明确要求时可使用 `--execute-mode auto`；高风险必须使用 `confirm`，并始终携带幂等键。
项目节点支持读取、字段更新，以及在 PMS 能力目录和当前节点 `saveContract` 都声明时使用 `node.complete-with-data` 原子保存并完成。若任一侧未声明完成能力，`COMPLETE_NODE` 会返回 `CAPABILITY_UNAVAILABLE`，不会绕过能力合同或拆成多次写入。

## plan → 确认 → execute

```bash
pms scenario resource plan project project.update 42 \
  --arguments-json '{"name":"AI 协作项目"}' \
  --version 9
```

plan 只返回 `resource-scenario/v1` 预览，包括 `normalizedArguments`、`capability`、`preview`、`warnings` 和 `requiresConfirmation=true`。它不会返回执行结果，也不会调用 execute。

用户确认后，代理只能复用原来的 `preview.operationId` 和新生成的幂等键：

```bash
pms scenario resource execute project project.update 42 \
  --preview-operation-id preview-123 \
  --idempotency-key project-update-42-20261016
```

execute 返回 `operation`、`previewOperationId`、`readback`、`verification`、`warnings` 和 `refreshScopes`。不能把新的 arguments 夹带进 execute；参数变了就重新 plan。

专题、需求的调用形式相同：

```bash
pms scenario resource plan topic topic.update 12 --arguments-json '{"title":"新的专题标题"}'
pms scenario resource plan requirement requirement.update 33 --arguments-json '{"title":"新的需求标题"}'
```

## 节点工作台字段

先取 focused context：

```bash
pms context project 42 --view focused --node-id 301 --component solution-design
```

只允许提交对应组件 `saveContract.writableFields` 中的字段；`protectedFields`、项目 ID、节点 ID 和版本不能由模型覆盖：

```bash
pms scenario resource plan project node.field.update 42 \
  --node-id 301 \
  --arguments-json '{"fields":{"productSolution":"新的方案"}}'
```

## 冲突、权限和不确定结果

- `RESOURCE_NOT_FOUND`：资源或上下文不存在，重新读取资源 ID。
- `FORBIDDEN`：当前 CLI 身份没有权限，不能换成管理员 Token 绕过。
- `CAPABILITY_UNAVAILABLE`：能力目录不支持该 operation 或字段，重新读取 capabilities。
- `CONTEXT_CONFLICT`：版本、节点、挂载关系或目标状态已变化，重新 context 后重新 plan。
- `PREVIEW_REQUIRED` / `IDEMPOTENCY_REQUIRED`：execute 缺少安全写入所需参数。
- `WRITE_RESULT_UNKNOWN`：PMS 已返回成功但回读无法证明结果；不要自动重试，保留 `previewOperationId`、`operationId` 和幂等键，先查询资源和操作审计。

## 真实隔离验收

真实写入必须显式打开 gate，并使用一次性数据库和专用账号。需要配置：

```bash
export PMS_E2E_RESOURCE_SCENARIO=true
export PMS_E2E_WRITE=true
export PMS_E2E_ISOLATED=true
export PMS_E2E_BASE_URL=http://127.0.0.1:18080/api
export PMS_E2E_ALLOWED_BASE_URL="$PMS_E2E_BASE_URL"
export PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:18080
export PMS_E2E_DATABASE_NAME=pms_ai_e2e_resource
export PMS_E2E_ALLOWED_DATABASE_NAME="$PMS_E2E_DATABASE_NAME"
export PMS_E2E_DB_URL='mysql://pms_e2e:local-only-password@127.0.0.1:13306/pms_ai_e2e_resource'
export PMS_E2E_ACCOUNT_ID=1
export PMS_E2E_RUN_ID=resource-20261016
export PMS_E2E_PROJECT_ID=42
export PMS_E2E_TOPIC_ID=12
export PMS_E2E_REQUIREMENT_ID=33
export PMS_E2E_MYSQL_CLIENT="$PWD/scripts/e2e-mysql-client.sh"
export PMS_E2E_MYSQL_CONTAINER="pms-ai-e2e-${PMS_E2E_RUN_ID}-mysql-1"
```

配置必须指向可丢弃的 `pms_ai_e2e_` 数据库和专用资源。执行：

```bash
pnpm vitest run tests/e2e/resource-scenario-real-pms.test.ts --maxWorkers=1 --minWorkers=1
```

未配置 `PMS_E2E_RESOURCE_SCENARIO=true` 时套件保持关闭；显式打开后，任何缺失配置、认证错误、MySQL 客户端缺失或隔离校验失败都会使测试失败。缺失环境不计为通过。
