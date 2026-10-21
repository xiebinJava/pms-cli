# 四资源 Orchestrator 验收报告

日期：2026-10-21（Asia/Shanghai）

## 验收结论

四类资源已经复用现有 `ai-orchestrator-v1` 的 Conversation、Plan、Preview、
Operation、Verification 和事件序列。需求、故事、项目、专题的真实隔离链路均已
通过；项目会话额外验证了 CLI 的只读 `resume` 投影。故事专属的缺来源、未决决策、
低置信高风险推断、完成请求拒绝和预览冲突测试也已补齐。完整 Connector 和 backend
回归门禁均已通过，当前达到发布候选基线。

## 代码与文档范围

本轮依赖的主要提交如下：

| 仓库 | 提交 | 内容 |
| --- | --- | --- |
| backend | `e515ee9` | 收口 project/topic 节点回读、版本和保护字段验证 |
| connector | `17f4caf` | 稳定 project/topic 隔离 E2E 与审计查询 |
| connector | `327e265` | 四资源自然语言模板、外部模型与 CLI 边界 |
| connector | `f341061` | 增加只读 `resource-orchestrator resume` 和 cursor 会话契约 |
| connector | `b82f383` | 在真实 project E2E 中覆盖恢复投影，避免额外写入 |
| connector | `6c1bb89` | 补齐 story 专属安全归一化、名称化输出和契约测试 |
| backend | `198a7dd` | 对齐 HealthController 测试夹具与最新 V73 迁移 |

模型仍由 Claude、Codex、DeepSeek 等外部 Agent 持有；CLI 只传输结构化 Draft、
调用 PMS 契约并呈现结果。CLI 和 backend 均不保存模型 URL、API Key 或完整聊天
记录。

## 真实 E2E 证据

### 四资源矩阵

- 隔离 run：`codex20261021matrix4`
- 目标：一次性 MySQL 数据库和 PMS backend；所有写入都经过 `PMS_E2E_WRITE=true`
  与 `PMS_E2E_ISOLATED=true` 安全门禁。
- 通过套件：
  - `resource-scenario-real-pms.test.ts`（28.0s）
  - `orchestrator-requirement-analysis.e2e.test.ts`（20.2s）
  - `orchestrator-story-node.e2e.test.ts`（17.2s）
  - `orchestrator-project-node.e2e.test.ts`（19.9s）
  - `orchestrator-topic-node.e2e.test.ts`（17.6s）
- 首次执行只因宿主机没有 `mysql` 客户端失败；改用
  `scripts/e2e-mysql-client.sh` 在隔离 MySQL 容器内执行审计查询后全部通过。

### 项目恢复闭环

- 隔离 run：`codex20261021resume2`
- 通过真实浏览器 OAuth 登录和 CLI 授权后，创建项目夹具并读取 focused context。
- 在同一会话中验证：
  `PLAN_READY → PREVIEW → WAITING_CONFIRMATION → CONFIRM → SUCCEEDED → NO_ACTION`。
- `resume` 调用只读会话和事件；测试断言它没有创建 turn、preview、execute 或新的
  幂等键。
- 同一运行还通过字段回读、相同幂等键重放、过期节点版本冲突、非法 provenance
  来源和多可写组件未显式选择等守卫。
- 运行结束后已用 `scripts/stop-ai-e2e.sh` 删除数据库卷和网络。

## 恢复命令语义

```text
pms scenario resource-orchestrator resume <conversation-id> [--after-sequence <n>]
```

这是 CLI 侧的只读投影：`NEEDS_INPUT` 返回 `PROVIDE_INPUT`，待确认返回
`CONFIRM`，未知写入返回 `RETRY_SAME_IDEMPOTENCY`，执行中返回 `READ_RESULT`，
成功或取消返回 `NO_ACTION`。动作建议不替代 PMS 状态机、preview 前置条件或权限
校验，也不单独授权写入。

## 发布门禁结果

1. backend `mvn -q -DskipTests package` 通过；三个 Orchestrator 定向测试通过。
2. backend 在 Colima Docker 环境执行
   `DOCKER_HOST=unix:///Users/fs/.colima/fsclaw/docker.sock TESTCONTAINERS_RYUK_DISABLED=true mvn -q test`，
   共 1,309 个测试，0 失败、0 错误、5 个跳过。
3. connector `pnpm test` 通过（79 个文件，406 个通过、15 个跳过），并通过
   `pnpm typecheck`、`pnpm run build:cli` 和 `git diff --check`。
4. 跨仓库 provenance golden vector 字节同步检查通过，SHA 为
   `9bb35388f55cc98138b9dd9ca917731b21373d5ab8e681d8bca0ea9472c0facb`。

第一次 Maven 全量尝试暴露了 Colima socket/Ryuk 环境差异；按仓库文档关闭 Ryuk
后重新执行通过。健康检查测试中的旧迁移版本 71 夹具已更新为当前 V73，并由 backend
提交 `198a7dd` 固化。上述命令是当前本机 Colima 的复现基线；CI 应替换为自身 Docker
socket，并保留与其运行器相匹配的 Testcontainers/Ryuk 配置。
