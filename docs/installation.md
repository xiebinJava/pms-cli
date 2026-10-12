# PMS CLI 安装

## 安装

发布包安装后会把 `pms` 放入 PATH：

```bash
npm install -g @xiebinjava/pms-cli
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
pms capabilities --format json
```

`pms auth login` 会打开 PMS 浏览器登录页，CLI 使用 PKCE 回调交换短时 access token；长期 refresh token 只保存到操作系统凭据管理器。

需求分析保存示例：

```bash
pms requirement analysis save 23 \
  --node-id 301 \
  --version 7 \
  --arguments-json '{"background":"补充用户场景"}' \
  --idempotency-key analysis-save-23-7 \
  --format json
```

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

没有 `PMS_E2E_WRITE=true`、`PMS_E2E_ISOLATED=true` 或完整配置时，两个真实写入测试只跳过，不产生认证、写入或清理请求。分析保存不会自动完成节点、修改所属系统或清理用户需求的历史正文。

## 设计边界

CLI-Anything 用于生成和核验 CLI harness 的命令/Skill 形态；运行时只依赖 PMS API。PMS 后端仍是权限、流程、动态字段、幂等和审计的唯一真源。
