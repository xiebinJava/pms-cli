# PMS CLI 兼容矩阵

| 项目 | 版本/范围 | 状态 |
| --- | --- | --- |
| Node.js | 22+ | 支持 |
| Windows | PowerShell 安装脚本、PATH CLI | 支持 |
| macOS/Linux | shell 安装脚本、PATH CLI | 支持 |
| Codex | 用户级 Skill + `Bash(pms:*)` | 支持 |
| Claude Code | 用户级 Skill + PATH CLI | 支持 |
| WorkBuddy | 用户级 Skill + PATH CLI | 支持 |
| ChatGPT 网页版 | 直接调用本地 PATH CLI | 不支持；网页沙箱无法访问用户电脑进程 |
| PMS | `/api/integration/ai/v1`，`clientId=pms-cli` | 必须 |

能力、流程节点、组件、字段和允许动作都以 PMS 当前用户返回的能力目录/上下文为准。连接器不承诺固定节点名称或字段名称。

| 只读精确读取 | `GET /integration/ai/v1/resources/{type}/{id}` | 需要服务端声明 `features.resourceGet=true`；缺失时明确不支持 |
| 丰富流程上下文 | `resourceDetails/entityVersion/relations`、节点版本和组件 `saveContract` | 新字段可缺省，缺省不会被客户端伪造 |
| CLI 参数 | `--name value` 与 `--name=value` | 两种形式等价；未知参数、重复 filter key、非法 JSON 在认证前拒绝 |
| 写操作 | `POST .../operations/{preview,execute}` | execute 必须显式 `--idempotency-key`；客户端不自动重试 |
| 需求分析保存 | `pms requirement analysis save` | 需要后端声明 `requirement.analysis.save`、明确节点/版本和分析字段补丁；缺能力时只出草稿 |
| 真实写入验收 | `verify:real-pms:project-create`、`verify:real-pms:analysis-save` | 默认 skipped；必须使用隔离配置、精确目标 allowlist 和浏览器授权，不连接用户数据库 |
