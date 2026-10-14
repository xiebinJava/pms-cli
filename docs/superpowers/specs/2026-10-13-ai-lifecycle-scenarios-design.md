# AI 生命周期场景闭环设计

## 背景

PMS 已经提供能力目录、项目类型与流程模板、操作预览、幂等执行、资源详情和流程上下文接口。当前 `project.create` 与 `requirement.analysis.save` 分散在基础 CLI 命令中，能够调用后端，但还没有被组织成可演示、可验收、可回读的业务场景。

本次目标是完成两个闭环：

1. 自然语言创建项目。
2. 需求分析并保存成果。

## 目标

- AI 可以先读取 PMS 当前能力和流程配置，再决定可用参数。
- 所有写入仍由 PMS 后端执行，连接器不访问数据库、不复制业务规则。
- 场景结果包含可审计的操作引用、幂等结果和保存后的真实回读。
- 真实 E2E 能够验证授权、模板/节点选择、版本、重复请求和清理边界。
- 分析与保存保持两个阶段，不能把模型推断伪装成 PMS 已确认事实。

## 非目标

- 不新增 PMS 业务表、AI 会话表或独立成果库。
- 不修改默认流程模板、历史绑定模板或现有业务命令语义。
- 不让连接器自动选择需求节点、自动完成节点或自动修改需求所属系统。
- 不在连接器中实现第二套权限、版本或成员规则。
- 不把 `operationId` 改名伪装为后端不存在的独立 `auditId`。

## 方案

在 `pms-cli` 增加场景编排层，复用现有 `PmsClient`、`CapabilityResolver`、`operationPreview`、`operationExecute`、`get` 和 `context`。

### 项目创建场景

`createProjectScenario` 按以下顺序工作：

1. 读取 `capabilities`，取得当前用户可用且允许创建项目的项目类型 ID、必填字段和已发布流程模板版本。
2. 校验用户提供的项目参数；不猜测缺失的必填值。
3. 调用 `project.create` 预览。
4. 只有调用方明确进入执行阶段时，才使用同一份参数和幂等键执行创建。
5. 从执行结果读取项目 ID，随后精确读取项目详情和流程上下文。
6. 返回结构化的 `capabilitiesSummary`、`preview`、`result`、实际绑定的流程模板版本、项目详情、流程上下文和 `trace`。

`trace` 至少包含请求 ID、操作 ID、幂等键和可选的后端 `auditId`。由于当前 PMS 没有单独返回 `auditId`，`operationId` 是持久化 AI 操作记录的审计引用，不新增虚构的审计 ID。

### 需求分析保存场景

`saveRequirementAnalysisScenario` 按以下顺序工作：

1. 读取 `capabilities`，确认存在 `requirement.analysis.save` 及其字段白名单。
2. 读取需求的 `get` 和 `context`，确认实际绑定的流程版本、当前节点、节点版本、组件和允许动作。
3. 将模型或用户提供的内容保持为分析补丁；输出中区分事实、推断和待确认假设。
4. 保存前重新读取 `context`，防止使用过期节点或版本。
5. 使用明确的需求 ID、节点 ID、版本、上下文版本和幂等键执行窄写操作。
6. 保存成功后精确回读需求详情和流程上下文，并验证原有正文及受保护字段仍然存在。
7. 返回分析补丁、执行结果、回读结果和审计引用。

连接器不替调用方选择节点，也不替调用方补充不存在的来源、日期或结论。

## CLI 与演示入口

新增场景级命令，基础命令继续保留：

```text
pms scenario project-create plan --arguments-json <json>
pms scenario project-create execute --arguments-json <json> --idempotency-key <key>
pms scenario requirement-analysis plan <id> --node-id <id> --version <version> --arguments-json <json>
pms scenario requirement-analysis execute <id> --node-id <id> --version <version> --arguments-json <json> --idempotency-key <key>
```

`plan` 只读并输出事实、能力、预览和待确认信息；`execute` 是明确的写入口。需求分析的 execute 在保存前重新读取上下文，不依赖 plan 阶段缓存的版本。

自然语言工具（Codex、Claude Code、WorkBuddy 等）负责理解用户表达、补齐业务参数和生成分析内容；场景命令负责把这些内容安全地绑定到 PMS 的能力、版本、幂等和回读流程。

## 验收策略

### 单元验收

- 项目场景：能力读取、模板选择校验、预览先于执行、执行后详情/上下文回读、回读失败保留成功结果。
- 需求分析场景：字段白名单、保存前上下文复核、执行后详情/上下文回读、保护字段不变。
- CLI：精确路由、错误在认证前失败、JSON 输出包含 trace，重复幂等键不生成第二次写入。

### 真实 E2E 验收

- 项目创建使用隔离账号、唯一名称和业务命令清理，只清理本次记录的项目 ID。
- 需求分析使用显式配置的需求和节点，不自动挑选，不删除历史正文。
- 两个场景都验证 viewer 身份、能力目录、上下文版本、成功结果、精确回读和重复请求。
- 未配置隔离环境时，测试保持 skipped，不能把 skipped 宣称为通过。

## 风险与处理

- 流程模板由后端动态返回，测试只断言实际响应，不硬编码默认模板或节点列表。
- 真实写入失败时不自动更换节点、参数或幂等键；先保留后端错误。
- 回读失败时返回成功操作结果与 warning，避免把“写入成功但读取失败”误报为写入失败。
- `operationId` 是当前可用的持久化审计引用；如果未来 PMS 提供独立审计 ID，连接器可无破坏地透传到 `trace.auditId`。
