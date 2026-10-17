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

需求和故事节点使用同一条 Agent progression 链：

```text
pms context --view focused
  → Agent draft（fieldSources + requestedCompletion）
  → scenario progression plan
  → development-item.node.complete-with-data preview
  → scenario progression execute
  → get/context 回读与 verification
```

真实写入只允许在隔离数据库中执行。需求场景需要指定一个已经处于可完成测试节点的需求和节点；故事场景可以使用已有故事，也可以在隔离库中创建夹具并推进到验收节点：

```bash
export PMS_E2E_REQUIREMENT_ID=24
export PMS_E2E_NODE_ID=387
export PMS_E2E_CREATE_REQUIREMENT_FIXTURE=false # 隔离库为空时改为 true，自动创建并推进需求夹具
export PMS_E2E_STORY_ID=34                 # 不创建故事夹具时使用
export PMS_E2E_CREATE_STORY_FIXTURE=false  # 创建夹具时改为 true

pnpm run verify:real-pms:node-autofill
```

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

新增的 `tests/e2e/agent-progression-run.e2e.test.ts` 验证需求节点的统一运行入口：外部 Agent 草稿 → fresh preview → 低/中风险 auto 执行 → PMS 回读与 verification → 同一幂等键 replay → 只读审计查询。测试不调用模型，默认跳过。

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
