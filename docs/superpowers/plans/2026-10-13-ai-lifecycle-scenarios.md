# AI 生命周期场景闭环实施计划

## 1. 契约与类型

- 扩展连接器场景输出类型，统一描述能力摘要、预览、执行结果、回读和 trace。
- 保留 `operationId`、`requestId`、`idempotencyKey`，可选透传 `auditId`。
- 不收紧现有 `OperationResult.data` 的开放结构，确保项目 workflow 快照继续可回读。

## 2. 需求分析场景编排

- 新增只读准备函数：读取 capabilities、requirement get/context，并解析允许的分析字段和当前节点。
- 新增保存后回读函数：保存前重新读取 context，执行 `requirement.analysis.save`，成功后回读 get/context。
- 输出事实、推断、假设分组；不自动选择节点，不自动完成节点。
- 保存失败、版本冲突、权限不足时保留后端错误，不自动重试写入。

## 3. 项目创建场景编排

- 新增项目创建 plan 函数：读取 capabilities，整理可用项目类型 ID、流程模板版本和必填字段，调用 preview。
- 新增 project-create execute 函数：使用显式幂等键执行，读取项目详情和流程上下文。
- 明确区分项目实体版本和实际绑定的流程模板版本，并在回读中断言实际模板版本。
- 回读失败时保留成功操作结果并返回 warning。

## 4. CLI 路由与演示文档

- 增加 `scenario project-create plan|execute` 路由。
- 增加 `scenario requirement-analysis plan|execute` 路由。
- 更新 `--help`、CLI command contract、README 和 E2E report。
- 增加自然语言演示脚本/示例，说明 AI 如何从用户话术转换为只读准备、预览、执行和回读步骤。

## 5. 测试先行

- 先补场景编排单元测试，再实现代码。
- 补 CLI 精确路由、参数校验和输出 envelope 测试。
- 扩展项目创建 E2E：能力/模板、审计引用、工作流快照、幂等重放和清理。
- 扩展需求分析 E2E：保存前复核、结果回读、保护字段、幂等重放和审计引用。

## 6. 验证

- 运行 `pnpm test`。
- 运行 `pnpm typecheck`。
- 运行 `pnpm build:cli`。
- 若具备隔离 PMS 配置，分别运行两个真实写入验收；否则明确记录 skipped，不宣称真实闭环通过。
- 检查 git diff，确保不触碰数据库、不修改默认流程模板和用户已有改动。
