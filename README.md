# PMS CLI

PMS CLI 是面向 Codex、Claude Code、WorkBuddy 等本地工作台的 PMS 命令行入口。安装后提供一个位于 PATH 中的 `pms` 命令，通过自然语言工作台调用 CLI，再由 PMS 后端负责权限、流程模板、动态字段、业务校验、幂等和审计。

代码仓库：[github.com/xiebinJava/pms-cli](https://github.com/xiebinJava/pms-cli)

## 安装和登录

```bash
npm install -g @brad.xie/pms-cli
pms doctor --format json
pms auth login
pms capabilities --format json
```

本地源码构建：

```bash
pnpm install --frozen-lockfile
pnpm build:cli
node dist/pms-cli.js --help
```

默认 PMS 地址为 `http://localhost:5173/api`，可通过 `PMS_BASE_URL` 覆盖（请填写纯 URL，不要粘贴 Markdown 链接）。认证会打开 PMS 浏览器登录页并使用 PKCE 回调；access token 只在进程内存中使用，refresh token 只保存到操作系统凭据管理器。`pms auth login` 只输出账号摘要，不输出任何 Token。

## 常用命令

```bash
pms capabilities --format json
pms search project --keyword 订单 --format json
pms get project 7 --format json
pms context project 7 --format json
pms context requirement 23 --view focused --node-id 299 --format json
pms context project 7 --view focused --node-id 299 --component solution-design --format json
pms operation preview project.create --arguments-json '{"name":"订单中心"}' --format json
pms operation execute --preview-operation-id <preview-operation-id> --idempotency-key idem-1 --format json
# 用户已明确要求的低/中风险写入可省略重复确认；高风险操作仍必须走上面的 preview/execute
pms operation auto development-item.node.complete-with-data --arguments-json '{"itemType":"STORY","itemId":34,"nodeId":383,"version":4,"ownerId":2,"startDate":"2026-10-10","endDate":"2026-10-20","fieldValues":{"businessResult":"已完成"}}' --context-id story:34 --context-version 4 --idempotency-key story-34-node-383-complete-4 --format json
pms scenario project-create plan --arguments-json '{"name":"AI Native PMS","description":"让 AI 参与项目管理全生命周期"}' --format json
pms scenario project-create execute --arguments-json '{"name":"AI Native PMS","description":"让 AI 参与项目管理全生命周期"}' --preview-operation-id <preview-operation-id> --idempotency-key project-ai-native-pms-1 --format json
pms scenario requirement-analysis plan 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --format json
pms scenario requirement-analysis execute 23 --node-id 301 --version 7 --arguments-json '{"interpretation":"补充用户场景"}' --preview-operation-id <preview-operation-id> --idempotency-key requirement-analysis-23-7 --format json
pms requirement analysis save 23 --node-id 301 --version 7 --context-id requirement:23 --context-version 7 --arguments-json '{"interpretation":"补充用户场景"}' --preview-operation-id <preview-operation-id> --idempotency-key analysis-save-23-7 --format json
pms workflow action topic 82 development-item.node.complete --preview-operation-id <preview-operation-id> --idempotency-key workflow-action-82-1 --format json
pms dashboard summary --format json
```

CLI-Anything 用于生成和核验 CLI harness 的命令、Skill 和测试形态；运行时不依赖 CLI-Anything，不使用浏览器点击自动化，也不复制 PMS 业务规则。

## 工作台 Skill

把 `skills/pms-project-management/SKILL.md` 安装到 Codex 的用户 Skill 目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-skill.ps1
```

```bash
sh scripts/install-skill.sh
```

Claude Code、WorkBuddy 可将同一份 `SKILL.md` 复制到各自的用户级 Skill 目录。Skill 只调用 `pms`，不依赖源码目录。ChatGPT 网页版无法直接调用用户电脑上的本地 CLI；需要在本地工作台中使用。

## 开发和验证

```bash
pnpm test
pnpm typecheck
pnpm build:cli
pnpm verify:real-pms:readonly
```

真实只读 E2E 默认跳过，需要设置 `PMS_E2E_READONLY=true`、`PMS_E2E_BASE_URL` 和短期 `PMS_E2E_TOKEN`。真实写入只允许在隔离环境手动执行，并要求 `PMS_E2E_ALLOWED_BASE_URL` 与写入目标精确匹配；清理必须调用 PMS 业务命令，不能使用 SQL。

需求分析保存只允许写入当前流程能力目录声明的需求澄清组件字段。先读取 `capabilities` 和需求 `context`，区分事实、推断和假设；没有明确节点目标时只能输出草稿，不能默认选择第一个候选节点。保存命令必须由调用方提供节点 ID、上下文版本和幂等键，连接器不会自动批准、完成节点或修改所属系统。

## 两个可演示场景

场景命令是面向自然语言工作台的编排入口：AI 负责理解用户话术，CLI 负责读取 PMS 真源、校验能力、执行写入并回读结果。`plan` 只读；`execute` 才写入。

- `project-create`：读取可用项目类型和流程模板，生成创建预览，执行后回读项目详情和实际绑定的流程上下文。
- `requirement-analysis`：读取需求详情、当前节点和流程版本，保留事实/推断/假设边界，保存指定分析补丁后回读需求和上下文。

场景结果中的 `trace.operationId` 是 PMS 持久化 AI 操作记录的审计引用；如果后端返回独立 `auditId`，会一并透传。重复业务请求必须复用同一幂等键，连接器不会自动重试写操作。

详见 [安装说明](docs/installation.md)、[Feishu CLI 对齐说明](docs/feishu-cli-alignment.md)、[兼容矩阵](docs/compatibility-matrix.md) 和 [E2E 验收报告](docs/e2e-report.md)。
