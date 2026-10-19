# Agent progression v1 → v2 迁移说明

日期：2026-10-19

这次升级是破坏性协议升级。Connector、PMS backend、`pms-project-management` skill、fixture 和外部调用示例必须在同一发布批次升级；不能让 v1 CLI 静默调用 v2 后端。

## 版本变化

| 旧协议 | 新协议 | 迁移要求 |
| --- | --- | --- |
| `agent-progression/v1` | `agent-progression/v2` | 请求和所有 plan/result/draft result 同批替换 `contractVersion` |
| `agent-progression-run/v1` | `agent-progression-run/v2` | run envelope 同批替换，嵌套 plan/result 也必须使用 v2 |

旧版本不会被兼容解析。直接提交旧版本会收到 `MIGRATION_REQUIRED`，不能把旧字段猜测转换为新字段。

## CLI 参数变化

旧 progression 调用：

```bash
pms scenario progression run requirement 33 \
  --intent UPDATE_NODE_FIELDS \
  --version 7 \
  --draft-json '<agent-progression/v1 draft>'
```

新 progression 调用：

```bash
pms scenario progression run requirement 33 \
  --intent UPDATE_NODE_FIELDS \
  --node-version 7 \
  --context-version conversation:latest \
  --draft-json '<agent-progression/v2 draft>'
```

旧的 `--version` 只在 progression 命令中删除。需求分析保存、资源场景等其他入口的既有 `--version` 参数不受这次迁移影响。

## 新增字段

- `componentKey`：外部 Agent 可传递后端上下文中声明的组件键。是否可写、多个 saveContract 如何选择，由共享 resolver 和后端能力目录决定。
- `nodeVersion`：节点合同版本，只用于只读交接和显示；真正的并发保护由 preview 捕获的 PMS 版本快照完成。
- `entityVersion`、`workflowInstanceVersion`：只读回读字段，缺失时保留 `null`，不能补成 0。
- `rejectionReason`：业务状态为 `REJECTED` 时返回原因，目前包括 `COMPLETION_NOT_REQUESTED`、`PROVENANCE_INVALID` 和 `PROVENANCE_TOO_LARGE`。

## 行为变化

1. `progression run` 默认是 `plan`，未指定模式不会写入。
2. `COMPLETE_NODE` 必须在 Agent draft 中显式写入 `requestedCompletion: true`；缺失或 `false` 直接返回 `REJECTED`，不会生成 preview。
3. 业务异常在 run 信封中返回 `CONFLICT`、`CAPABILITY_UNAVAILABLE` 或 `WRITE_RESULT_UNKNOWN`；只有系统错误才走 `ok:false`。
4. unknown write 第一阶段只保证同一 conversation、preview 和 draft digest 下的幂等重放，不要求先实现 operation GET。

## 发布检查

- [ ] Connector 契约常量、CLI 构造和嵌套结果均为 v2。
- [ ] skill、runbook、fixture 和外部示例均不再生成 v1 progression 草稿。
- [ ] progression 旧 `--version` 有明确迁移错误；其他命令的 `--version` 仍可用。
- [ ] 默认运行 mode 的契约测试确认没有隐式写入。
- [ ] `COMPLETE_NODE` 缺少显式请求的测试确认没有 preview/execute。
- [ ] 真实 PMS E2E 使用同一批次的 v2 CLI 和 backend，并保持隔离写入门禁。
