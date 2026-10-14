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
| 流程上下文聚焦读取 | `--view focused --node-id <id> [--component <key>]` | 需要服务端 meta.formatVersion=2；显式参数被旧服务端忽略时客户端核验失败，不降级 |
| 引用权限投影 | `meta.referencesScope=readable-only` | 引用列表是权限投影：不可读/已删除引用整项省略，空列表不代表业务未关联 |
| 组件正文状态 | `contentState=LOADED/EMPTY/NOT_REQUESTED/UNSUPPORTED` | EMPTY≠未读；UNSUPPORTED 保留 config、不输出原始内容 |
| focused 字节预算 | 524288 UTF-8 data JSON 字节 | 服务端整体拒绝（HTTP 422 CONTEXT_TOO_LARGE:），不截断；不影响 legacy 视图 |
| 真实写入验收 | `verify:real-pms:project-create`、`verify:real-pms:analysis-save` | 默认 skipped；必须使用隔离配置、精确目标 allowlist 和浏览器授权，不连接用户数据库 |
