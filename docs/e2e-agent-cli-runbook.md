# 真实 PMS CLI Agent E2E

这份流程验证真实的 `pms-cli` 构建产物，而不是直接调用 TypeScript 函数。测试会通过浏览器完成 CLI OAuth 授权，然后用 CLI 完成：

```text
capabilities
→ scenario project-create plan
→ scenario project-create execute（绑定 preview）
→ get project
→ context project（读取回读）
→ operation preview project.delete
→ operation execute（绑定 preview）
```

测试只写入一次性隔离数据库，成功和失败都会尝试清理创建的项目。

## 启动隔离 PMS

在 `pms-backend` 仓库准备好构建产物后运行：

```bash
cd /Users/fs/Desktop/Project/pms-backend

PMS_E2E_RUN_ID=codex20261015d \
PMS_E2E_MYSQL_USER=pms_e2e \
PMS_E2E_MYSQL_PASSWORD='local-only-password' \
PMS_E2E_MYSQL_ROOT_PASSWORD='local-only-root-password' \
PMS_E2E_JWT_SECRET='local-only-jwt-secret-at-least-32-characters' \
PMS_E2E_ADMIN_EMAIL=codex-e2e@example.test \
PMS_E2E_ADMIN_PASSWORD='codex-e2e-password-2026' \
PMS_E2E_API_PORT=18080 \
PMS_E2E_MYSQL_PORT=13306 \
PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173 \
PMS_E2E_FOREGROUND=true \
./scripts/start-ai-e2e.sh
```

`PMS_E2E_RUN_ID` 每次应使用新的安全值，避免复用旧的数据库卷。密码示例只用于本地隔离环境，不要提交到仓库或用于共享环境。

## 启动授权页面

CLI OAuth 的授权页面属于前端路由，因此需要把前端代理到隔离 PMS：

```bash
cd /Users/fs/Desktop/Project/pms-front
VITE_PORT=15173 \
VITE_PROXY_TARGET=http://127.0.0.1:18080 \
npm run dev -- --host 127.0.0.1
```

测试输出 `PMS_E2E_AUTH_URL=...` 后，在浏览器打开该 URL，登录隔离管理员并点击“同意并继续”。回调地址是 CLI 临时启动的本地端口，授权页跳转后页面显示连接失败是预期现象；CLI 本地回调已经收到授权码并会继续执行测试。

## 运行测试

在 `pms-ai-connector` 仓库执行：

```bash
npm run build:cli

PMS_E2E_BASE_URL=http://127.0.0.1:18080/api \
PMS_E2E_ALLOWED_BASE_URL=http://127.0.0.1:18080/api \
PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173 \
PMS_E2E_DATABASE_NAME=pms_ai_e2e_codex20261015d \
PMS_E2E_ALLOWED_DATABASE_NAME=pms_ai_e2e_codex20261015d \
PMS_E2E_ACCOUNT_ID=1 \
PMS_E2E_RUN_ID=codex20261015d \
npm run verify:real-pms:cli
```

测试会让构建后的 CLI 自己执行 `pms auth login`，并把授权 URL 输出到测试日志；CLI 在测试环境可以通过 `PMS_CLI_KEYRING_SERVICE` 指定独立的系统 keyring service，避免污染本机默认的 `pms-cli` 登录状态。普通用户无需设置这些变量。

## 节点详情自动补全 E2E

需求和故事节点使用同一条 Agent progression 链。当前仓库已切换到 `agent-progression/v2` / `agent-progression-run/v2`；progression 命令使用 `--node-version` 传递节点版本，使用 `--context-version` 传递会话/审计关联信息，旧的 `--version` 参数会返回迁移错误。真实 E2E 示例必须和对应构建产物同批次升级，不能用 v1 CLI 调 v2 后端。

```text
pms context --view focused
  → Agent draft（v2；fieldSources + requestedCompletion）
  → scenario progression plan
  → development-item.node.complete-with-data preview
  → scenario progression execute
  → get/context 回读与 verification
```

真实写入只允许在隔离数据库中执行。需求场景需要指定一个已经处于可完成测试节点的需求和节点；故事场景可以使用已有故事，也可以在隔离库中创建夹具并推进到验收节点。旧 v1 示例在协议升级前不得用于真实写入：

```bash
export PMS_E2E_REQUIREMENT_ID=24
export PMS_E2E_NODE_ID=387
export PMS_E2E_CREATE_REQUIREMENT_FIXTURE=false # 隔离库为空时改为 true，自动创建并推进需求夹具
export PMS_E2E_STORY_ID=34                 # 不创建故事夹具时使用
export PMS_E2E_CREATE_STORY_FIXTURE=false  # 创建夹具时改为 true

pnpm run verify:real-pms:node-autofill
```

## Claude/Codex/DeepSeek 自然语言调用约定

自然语言由外部 Agent（Claude、Codex 或 DeepSeek）理解，模型在对话侧生成
`agent-progression/v2` 或 `resource-node/v1` 草稿；`pms-cli` 只读取 PMS 能力和上下文，
调用预览/执行，并回读验证。模型 endpoint、API Key 和 PMS Token 都不配置在 CLI 中。

四类资源都使用同一个顺序：

```text
名称精确解析 → capabilities/context → 外部模型草稿 → 字段来源校验
→ progression plan/auto/confirm → focused readback → 名称优先汇报
```

外部 Agent 可以把下面的用户话术映射到对应的 CLI 入口：

| 用户话术 | Agent 行为 | 写入边界 |
| --- | --- | --- |
| “分析需求《<名称>》当前状态和阻塞，只读” | `resolve` 后执行 `context --format agent` 和 `get` | 只读，不生成幂等键 |
| “补齐专题《<名称>》当前节点并推进” | focused context → 草稿 → `progression run` | 仅使用当前 `saveContract` 字段；缺少不可推断信息返回 `NEEDS_INPUT` |
| “故事《<名称>》测试通过，推进验收中” | 读取测试字段、来源和完成前置条件后生成 `requestedCompletion` 草稿 | 测试结果、构建版本、报告地址和遗留问题必须有 `fieldSources` |
| “更新项目《<名称>》当前节点详情” | focused context → 取 `nodeContract.version` → 节点字段更新 | `context.version` 只作快照标签；`project-basic-info` 走 `project.update` |

低/中风险且用户已经明确表达写入意图时，Agent 可使用 `--execute-mode auto`；业务评审、
验收、删除、归档、批量或成员权限变更使用 `plan` 后等待确认，再以同一草稿和幂等键
执行 `confirm`。一次自然语言请求只生成一个幂等键，版本冲突或回读异常时复用该键，
不要自动创建第二个写入意图。

### 对话恢复和错误下一步

- `NEEDS_INPUT`：只返回后端声明的 `missingFields` 和最小问题；用户补充后由 Agent
  发起新一轮，不猜测字段或默认值。
- `WRITE_RESULT_UNKNOWN`：停止写入，先读取原操作、会话事件和 focused context，确认是否
  已生效后再决定下一步；不要盲目重试。
- 版本冲突：重新读取 `capabilities/context`，使用新的节点/实体版本重新生成草稿；原幂等键
  只用于确认同一业务请求，不能把旧版本强行写回。
- `CAPABILITY_UNAVAILABLE` 或多个可写组件未指定组件：报告缺少的能力/组件选择，不猜测
  `nodeId`、`componentKey` 或字段 key。

自然语言回复优先展示资源名称、节点名称、状态、实际变更和阻塞；内部 ID 只保留在机器
可读 JSON，除非用户明确要求技术排查信息。

资源场景的 project/topic 更新 E2E 支持同样的隔离夹具模式：设置
`PMS_E2E_RESOURCE_SCENARIO=true`、`PMS_E2E_CREATE_RESOURCE_FIXTURES=true`，
测试会用 `project.create` 和 `topic.create` 在本轮数据库内创建资源；此模式下不需要
`PMS_E2E_PROJECT_ID` 或 `PMS_E2E_TOPIC_ID`，但仍需准备一个可读的
`PMS_E2E_REQUIREMENT_ID`。夹具不调用未声明的 delete 命令，需通过隔离数据库销毁清理。

创建夹具后，测试会再次读取资源的当前节点和 focused context，并要求后端声明唯一可写
`saveContract` 以及至少一个非保护字段。随后用该组件和字段执行一次节点字段更新、回读和
幂等重放；如果创建态没有当前节点或可写字段，测试会显式失败并说明缺失条件，不会把它
当成“没有节点场景”而跳过。项目使用实体版本作为并发版本，专题使用流程版本，均由
focused context 实时读取，不从模板或测试代码猜测。

## Project/topic Orchestrator 会话 E2E

project/topic 会话复用现有 PMS Orchestrator 的 Conversation、Plan、Preview、
Operation、Verification 和 Event 记录，不创建第二套会话模型。CLI 入口是：

```bash
pms scenario resource-orchestrator create project <project-id>
pms scenario resource-orchestrator turn <conversation-id> \
  --message "补充当前节点说明" \
  --draft-json '<resource-node/v1 draft>' \
  --node-id <node-id> [--node-version <version>] [--component <component-key>] \
  [--context-version <snapshot-label>]
pms scenario resource-orchestrator preview <plan-id>
pms scenario resource-orchestrator confirm <plan-id> --idempotency-key <key>
pms scenario resource-orchestrator events <conversation-id> --after-sequence 0
pms scenario resource-orchestrator session <conversation-id>
pms scenario resource-orchestrator resume <conversation-id> --after-sequence 0
```

`resume` 是只读恢复投影，不会创建 turn、preview、execute 或新的幂等键。它返回
`nextAction`：`PROVIDE_INPUT` 表示“补上缺失字段”后重新发起 turn，`CONFIRM` 表示
“重新确认上次预览”时复用原 Plan，`RETRY_SAME_IDEMPOTENCY` 表示“核对未知写入结果”时
先读操作/事件和 focused context，并复用原幂等键；成功终态返回 `NO_ACTION`。

测试草稿必须使用当前 focused context 返回的 `nodeContract`、可写
`saveContract`、字段来源和版本；不能猜节点 ID、组件键或把 project 实体
`context.version` 当作节点版本。preview 返回的 `expectedVersions`、
`provenanceRef` 和 `draftDigest` 是后续 confirm 的绑定事实。恰好一个可写组件时
可以省略 `--component`；多个组件必须显式指定，零个组件只能做只读读取并返回
`writeCapable=false`。项目 `project-basic-info` 仍走 `project.update`，不伪装为
节点字段写入。

项目夹具模式（统一套件默认开启）会通过已注册的 `project.create` 和公开节点命令
从创建态推进到第一个可写节点，再实时读取 focused context；不依赖固定的项目 ID。
如果无法找到可写节点，测试必须失败并报告命令或模板缺口，不能静默跳过。专题夹具
遵循相同规则。

单独运行两条会话 E2E：

```bash
pnpm run verify:real-pms:project-orchestrator
pnpm run verify:real-pms:topic-orchestrator
```

或运行统一五资源门禁：

```bash
pnpm run verify:real-pms:agent-suite
```

这些命令只有在真实隔离 PMS、OAuth 前端代理和一次性数据库均已准备时才会执行写入。
默认环境下的 `skipped` 只是未运行，不是验收通过；合并/发布前必须设置
`PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true`、`PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true`
并保存测试日志。统一套件通过前，project/topic Orchestrator 代码保持在功能分支，
不进入默认发布分支。

该命令还要求前面的隔离目标变量完整（`PMS_E2E_BASE_URL`、`PMS_E2E_ALLOWED_BASE_URL`、`PMS_E2E_DATABASE_NAME`、`PMS_E2E_ALLOWED_DATABASE_NAME`、`PMS_E2E_ACCOUNT_ID`、`PMS_E2E_RUN_ID`），并且必须设置 `PMS_E2E_WRITE=true` 和 `PMS_E2E_ISOLATED=true`。需求夹具不能自动清理已推进的流程节点，因此只应使用可销毁的隔离数据库；故事夹具同样随隔离数据库一起销毁。

要只验证模型输出和缺失项，不写入 PMS，可以直接运行：

```bash
pnpm exec vitest run --cache=false tests/unit/agent-progression-plan.test.ts tests/contract/agent-scenario-cli.test.ts
```

其中 `NEEDS_INPUT` 会返回 `missingFields` 并保持 `preview=null`；`UPDATE_NODE_FIELDS` 只调用 `development-item.node.field.update`，不会推进节点。

### 操作审计查询的 MySQL 客户端

故事节点编排验收会在业务链路完成后只读查询 `pms_ai_operation`，确认执行状态和审计记录已经持久化。查询由 `tests/e2e/support/operationAudit.ts` 通过 `PMS_E2E_MYSQL_CLIENT` 启动：

- 本机已安装 MySQL 客户端时，可以省略该变量；
- 本机没有 `mysql` 命令时，使用仓库脚本调用一次性 MySQL 容器内置的客户端，不需要在宿主机安装 MySQL：

```bash
cd /Users/fs/Desktop/Project/pms-ai-connector
export PMS_E2E_MYSQL_CLIENT="$PWD/scripts/e2e-mysql-client.sh"
export PMS_E2E_MYSQL_CONTAINER="pms-ai-e2e-${PMS_E2E_RUN_ID}-mysql-1"
```

脚本只移除宿主机映射用的 `--host/--port` 参数，查询仍使用 `PMS_E2E_DB_URL` 中的账号和数据库名；容器外的业务 API 和 OAuth 流程不变。`PMS_E2E_MYSQL_CONTAINER` 省略时，脚本会根据 `PMS_E2E_RUN_ID` 推导默认容器名。

故事节点编排验收还需要只读审计连接：

```bash
export PMS_E2E_DB_URL="mysql://pms_e2e:local-only-password@127.0.0.1:13306/${PMS_E2E_DATABASE_NAME}"
pnpm run verify:real-pms:story-orchestrator
```

该查询只用于验证审计，不参与 CLI 正常运行；隔离环境停止后，数据库卷和其中的夹具一并删除。

手动登录时，CLI 使用的是 `PMS_AUTH_ORIGIN`（而不是 `PMS_E2E_AUTH_ORIGIN`）：

```bash
PMS_BASE_URL=http://127.0.0.1:18080/api \
PMS_AUTH_ORIGIN=http://127.0.0.1:15173 \
pms auth login
```

## 停止环境

```bash
cd /Users/fs/Desktop/Project/pms-backend
PMS_E2E_RUN_ID=codex20261015d ./scripts/stop-ai-e2e.sh
```

停止脚本会删除本次隔离服务和数据库卷。不要把共享开发数据库作为写入 E2E 的目标。

## 统一 Agent progression run E2E

新增的 `tests/e2e/agent-progression-run.e2e.test.ts` 验证需求节点的统一运行入口：外部 Agent 草稿 → fresh preview → 低/中风险 auto 执行 → PMS 回读与 verification → 同一 conversation、preview、draftDigest 下的幂等键 replay。测试不调用模型，默认跳过；unknown write 第一阶段不依赖 operation GET 或审计查询收敛。

在上面的隔离 PMS 启动完成后，额外设置：

```bash
export PMS_E2E_AGENT_PROGRESSION=true
export PMS_E2E_WRITE=true
export PMS_E2E_ISOLATED=true
export PMS_E2E_BASE_URL=http://127.0.0.1:18080/api
export PMS_E2E_ALLOWED_BASE_URL="$PMS_E2E_BASE_URL"
export PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173
export PMS_E2E_DATABASE_NAME=pms_ai_e2e_agent_progression
export PMS_E2E_ALLOWED_DATABASE_NAME="$PMS_E2E_DATABASE_NAME"
export PMS_E2E_DB_URL="mysql://pms_e2e:local-only-password@127.0.0.1:13306/${PMS_E2E_DATABASE_NAME}"
export PMS_E2E_MYSQL_CLIENT="$PWD/scripts/e2e-mysql-client.sh"
export PMS_E2E_ACCOUNT_ID=1
export PMS_E2E_RUN_ID=agent-progression-20261017
export PMS_E2E_REQUIREMENT_ID=24
export PMS_E2E_NODE_ID=387
```

运行：

```bash
pnpm vitest run tests/e2e/agent-progression-run.e2e.test.ts --maxWorkers=1 --minWorkers=1
```

也可以设置 `PMS_E2E_CREATE_AGENT_PROGRESSION_FIXTURE=true` 和 `PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true`，让测试在一次性数据库中创建本轮需求夹具。创建夹具会推进真实流程节点，不能用于共享环境。

## CLI 名称推进闭环 E2E

`tests/e2e/cli-name-progression.e2e.test.ts` 使用构建后的 `dist/pms-cli.js`，验证 Claude/Codex 可使用的命令边界：

```text
pms scenario progression run requirement --name ... --intent READ_CONTEXT
→ pms scenario progression run requirement --name ... --intent COMPLETE_NODE --execute-mode auto
→ pms context requirement --name ... 回读
```

故事使用同样的名称解析和推进链路。测试会在一次性数据库中创建需求和故事夹具，并验证 `userFacing` 投影包含名称但不包含 `resourceId`。在隔离 PMS 启动并完成前端代理配置后运行：

```bash
export PMS_E2E_CLI_NAME_PROGRESSION=true
export PMS_E2E_CREATE_REQUIREMENT_FIXTURE=true
export PMS_E2E_CREATE_STORY_FIXTURE=true
export PMS_E2E_WRITE=true
export PMS_E2E_ISOLATED=true
export PMS_E2E_BASE_URL=http://127.0.0.1:18080/api
export PMS_E2E_ALLOWED_BASE_URL="$PMS_E2E_BASE_URL"
export PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173
export PMS_E2E_DATABASE_NAME=pms_ai_e2e_cli_name_progression
export PMS_E2E_ALLOWED_DATABASE_NAME="$PMS_E2E_DATABASE_NAME"
export PMS_E2E_ACCOUNT_ID=1
export PMS_E2E_RUN_ID=cli-name-progression-20261017

pnpm run verify:real-pms:cli-name-progression
```

该测试只允许指向 `pms_ai_e2e_` 一次性数据库；需求和故事流程节点会被真实推进，必须在测试结束后删除隔离环境，不能指向共享开发库。
