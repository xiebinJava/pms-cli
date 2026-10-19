# PMS CLI 安装

## 安装

发布包安装后会把 `pms` 放入 PATH：

```bash
npm install -g @brad.xie/pms-cli
pms doctor --format json
pms setup
```

开发仓库本地构建：

```bash
pnpm install --frozen-lockfile
pnpm build:cli
node dist/pms-cli.js --help
```

## 认证和第一次使用

```bash
set PMS_BASE_URL=http://localhost:5173/api  # Windows PowerShell: $env:PMS_BASE_URL=...
pms auth login
pms auth doctor --format json
pms capabilities --format json
```

`pms auth login` 会打开 PMS 浏览器登录页，CLI 使用 PKCE 回调交换短时 access token；长期 refresh token 只保存到操作系统凭据管理器。

`PMS_BASE_URL` 必须填写纯 URL，例如 `http://localhost:5173/api`，不要粘贴 `[地址](地址)` 形式的 Markdown 链接。登录成功只返回账号摘要，不会把 access token 或 refresh token 打印到终端。

`pms auth doctor --format json` 只读取本地凭据状态，不会访问 PMS 业务接口，也不会输出 Token。它会区分已登录、未登录、钥匙串超时和钥匙串权限失败。遇到 `KEYRING_TIMEOUT` 或 `KEYRING_ACCESS` 时，请在普通终端重新执行 `pms auth login`，并允许终端访问 macOS 登录钥匙串。

需求分析保存示例：

```bash
pms requirement analysis save 23 \
  --node-id 301 \
  --version 7 \
  --context-id requirement:23 \
  --context-version 7 \
  --arguments-json '{"interpretation":"补充用户场景"}' \
  --preview-operation-id <preview-operation-id> \
  --idempotency-key analysis-save-23-7 \
  --format json
```

## Claude/Codex 自然语言推进

安装并授权后，外部工作台中的 Claude、Codex 或 DeepSeek 负责理解对话，`pms-cli` 负责 PMS 真源读取、能力校验、preview、写入和回读。模型凭据留在外部工作台；不要在 CLI 中配置模型 URL、API Key 或模型名称。

先读取上下文，再让外部模型基于返回的节点合同生成草稿：

```bash
pms scenario progression run story 34 --intent READ_CONTEXT --format json
pms scenario progression run story 34 --intent UPDATE_NODE_FIELDS \
  --execute-mode plan --node-id <node-id> \
  --draft-json '<agent-progression/v1 draft>' --format json
```

计划确认后，低/中风险写入可由当前已明确的用户意图直接使用 `auto`；高风险使用 `confirm`。两者都必须由调用方提供幂等键，CLI 不会猜测节点、字段或幂等键：

```bash
pms scenario progression run story 34 --intent UPDATE_NODE_FIELDS \
  --execute-mode auto --node-id <node-id> \
  --draft-json '<same draft>' --idempotency-key story-34-node-<node>-1 --format json
```

返回的 `status`、`operationId`、`auditId`、`readback` 和 `verification` 是机器可读交接结果。当前统一入口支持需求、专题、故事以及项目节点字段更新和原子完成；项目节点完成要同时满足 PMS 能力目录与当前节点 `saveContract` 的声明。

## 场景级自然语言演示

项目创建建议先执行只读计划，再由调用方明确执行：

```bash
pms scenario project-create plan \
  --arguments-json '{"name":"AI Native PMS","description":"让 AI 参与项目管理全生命周期","priority":1}' \
  --format json

pms scenario project-create execute \
  --arguments-json '{"name":"AI Native PMS","description":"让 AI 参与项目管理全生命周期","priority":1}' \
  --idempotency-key project-ai-native-pms-1 \
  --format json
```

需求分析场景会在保存前再次读取上下文，防止使用过期版本：

```bash
pms scenario requirement-analysis plan 23 \
  --node-id 301 --version 7 \
  --arguments-json '{"interpretation":"补充用户场景"}' \
  --format json

pms scenario requirement-analysis execute 23 \
  --node-id 301 --version 7 \
  --arguments-json '{"interpretation":"补充用户场景"}' \
  --idempotency-key requirement-analysis-23-7 \
  --format json
```

两个场景都返回 `trace`、执行结果和精确回读。`trace.operationId` 是当前 PMS 持久化 AI 操作记录的审计引用，不代表连接器自行创建了审计数据。

保存前应先使用 `pms capabilities --format json` 和 `pms context requirement 23 --format json` 确认能力、实际绑定流程和目标节点。没有明确目标节点时只生成分析草稿；CLI 不会替用户挑选第一个候选节点，也不会自动完成节点或修改所属系统。

## 工作台 Skill

Codex：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-skill.ps1
```

```bash
sh scripts/install-skill.sh
```

Claude Code 和 WorkBuddy 也可将 `skills/pms-project-management/SKILL.md` 复制到它们的用户级 Skill 目录；Skill 只调用 `pms`，不依赖源码目录。

真实写入验收默认关闭。只有专门的隔离账号、隔离环境和一次性 run ID 都准备好时，才手动启用项目创建验收：

```bash
export PMS_E2E_BASE_URL="http://localhost:5173/api"
# 必须与 PMS_E2E_BASE_URL 完全匹配；用于防止误把写入验收指向生产环境
export PMS_E2E_ALLOWED_BASE_URL="http://localhost:5173/api"
export PMS_E2E_AUTH_ORIGIN="http://localhost:5173"
export PMS_E2E_ACCOUNT_ID="7"
export PMS_E2E_RUN_ID="run-20261010"
pnpm run verify:real-pms:project-create
```

命令会要求浏览器完成当前账号授权，`PMS_E2E_ACCOUNT_ID` 只用于核对实际授权身份，不是免密登录。测试只清理本次成功记录的项目 ID；任何清理失败都会列出残留 ID，不会扩大清理范围，也不会使用 SQL。

需求分析保存验收还需要明确指定可写隔离需求和节点：

```bash
export PMS_E2E_REQUIREMENT_ID="23"
export PMS_E2E_NODE_ID="301"
pnpm run verify:real-pms:analysis-save
```

没有 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true` 或完整配置时，两个真实写入测试只跳过，不产生认证、写入或清理请求。`PMS_E2E_ALLOWED_BASE_URL` 必须与写入目标精确匹配，否则测试会在浏览器授权前拒绝。分析保存不会自动完成节点、修改所属系统或清理用户需求的历史正文。

## 设计边界

CLI-Anything 用于生成和核验 CLI harness 的命令/Skill 形态；运行时只依赖 PMS API。PMS 后端仍是权限、流程、动态字段、幂等和审计的唯一真源。
