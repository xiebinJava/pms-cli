# Agent progression v2 冻结决策

日期：2026-10-19

本文件记录 `agent-progression/v2` 和 `agent-progression-run/v2` 的不可隐式改变的边界。PMS 后端仍是权限、节点、字段、版本和审计的唯一真源；CLI 只负责读取、校验、预览、执行和回读。

## 默认模式

- `pms scenario progression run` 未指定 `--execute-mode` 时默认为 `plan`，只生成 preview，不写入 PMS。
- `auto` 和 `confirm` 写入必须携带调用方生成的 `--idempotency-key`。
- 低/中风险的 `auto` 只有在当前对话已经表达明确写入意图时才可使用；高风险 `auto` 返回 `WAITING_CONFIRMATION`，只有 `confirm` 才能继续。

## 版本轴

- `agent-progression/v2` 是输入、plan、execute result 和 draft result 的协议版本。
- `agent-progression-run/v2` 是统一运行信封版本。
- `nodeVersion` 表示当前节点合同版本；优先来自 `nodeContract.version` 或 PMS focused context 的节点版本。
- `entityVersion` 表示资源实体版本。
- `workflowInstanceVersion` 表示流程实例版本，可能为空。
- `contextVersion` 是会话/审计关联字段。并发保护以 PMS preview 捕获的节点、实体、流程和字段版本为准，不把外部关联值当成并发版本。

## 参数迁移

- progression 命令删除旧的 `--version` 语义。
- progression 使用 `--node-version` 表示节点版本，使用 `--context-version` 表示会话/审计关联信息。
- `pms requirement analysis`、资源场景等其他命令已有的 `--version` 语义不在本次删除范围内。
- 旧 v1 合约和 progression 旧参数返回 `MIGRATION_REQUIRED`，不静默转换。

## 组件和完成规则

- v2 输入可携带 `componentKey`；组件选择、`workbench` 兼容别名和多 saveContract 选择由后续共享 resolver 冻结。
- `COMPLETE_NODE` 必须显式提供 `requestedCompletion=true`。缺失或为 `false` 时不生成 preview、不执行写入，run 信封返回 `status=REJECTED`、`writeDecision=NEEDS_INPUT`、`rejectionReason=COMPLETION_NOT_REQUESTED`。
- `REJECTED` 是业务状态，不扩展 `writeDecision` 枚举；`writeDecision` 继续使用 `READY`、`NEEDS_INPUT`、`WAITING_CONFIRMATION` 和 `CAPABILITY_UNAVAILABLE`。

## 错误和审计

- `ResourceScenarioError` 在 run 边界映射为 in-band 业务状态：上下文冲突为 `CONFLICT`，能力、权限或资源不可用为 `CAPABILITY_UNAVAILABLE`，结果不确定为 `WRITE_RESULT_UNKNOWN`。
- 认证、网络、协议解析等系统错误继续使用 CLI 错误信封。
- 当前 `auditId` 与 `operationId` 视为同一条 PMS 审计关联标识，不假设存在独立审计实体。
- unknown write 的第一阶段只允许在同一 conversation、同一 preview、同一 `draftDigest` 范围内用相同幂等键重放；不依赖 operation GET 或审计查询收敛。

## 来源边界

- `fieldSources` 的来源持久化、实体校验和大小限制由后续 provenance 任务完成。
- provenance 非法或超限在 run 边界返回 `REJECTED`，分别使用 `PROVENANCE_INVALID` 或 `PROVENANCE_TOO_LARGE`；不能伪装成缺少业务字段。
