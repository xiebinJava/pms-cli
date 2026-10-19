# Agent Progression Run 手册

`pms scenario progression run` 是 Claude、Codex 或 DeepSeek 操作 PMS 需求、专题、故事和项目节点字段、完成项目节点的统一交接入口。外部模型负责理解自然语言和生成草稿；PMS 后端仍是权限、流程模板、字段合同、版本、幂等和审计的唯一真源。

## 一次自然语言请求如何落地

```text
用户：把需求 33 的测试节点补齐，并推进到下一节点
  ↓
外部 Agent：读取能力和 focused context，识别当前节点与 saveContract
  ↓
外部 Agent：生成 agent-progression/v2 draft，附 fieldSources.sourceRefs
  ↓
pms-cli：progression run ... --execute-mode plan
  ↓
PMS：校验能力、权限、版本、字段和业务前置条件，返回 preview
  ↓
外部 Agent：根据风险和当前对话决定 auto 或请求明确确认
  ↓
pms-cli：progression run ... --execute-mode auto|confirm --idempotency-key ...
  ↓
PMS：执行、审计、回读；CLI 返回 operationId/auditId/verification
```

模型凭据留在 Claude/Codex/DeepSeek。`pms-cli` 不包含模型 SDK，不保存模型 API Key，也不把 PMS Token 或 auth store 传给模型。

## 推荐对话流程

外部 Agent 先执行：

```bash
pms capabilities --format json
pms context requirement 33 --view focused --format agent
```

读取结果后，必须使用实际返回的 `currentNode.id`、上下文版本、组件 key、`saveContract.writableFields` 和 `allowedActions`。不能猜测 nodeId、字段 key、版本，也不能使用默认流程模板替代事项实际绑定的模板版本。

只读分析：

```bash
pms scenario progression run requirement 33 \
  --intent READ_CONTEXT --format json
```

只生成计划：

```bash
pms scenario progression run requirement 33 \
  --intent UPDATE_NODE_FIELDS \
  --execute-mode plan \
  --node-id <context.currentNode.id> \
  --draft-json '<agent-progression/v2 draft>' \
  --format json
```

低/中风险且用户已经明确要求写入：

```bash
pms scenario progression run requirement 33 \
  --intent UPDATE_NODE_FIELDS \
  --execute-mode auto \
  --node-id <context.currentNode.id> \
  --draft-json '<same draft>' \
  --idempotency-key requirement-33-node-<node>-<turn> \
  --format json
```

高风险写入必须在当前对话取得明确授权后使用 `confirm`。`auto/confirm` 都必须提供幂等键；`READ_CONTEXT` 和 `plan` 不需要幂等键。`run` 自己生成 fresh preview，不接受 `--preview-operation-id`。

## 草稿形状

```json
{
  "facts": [{"text": "测试节点当前为空", "sourceRefs": ["requirement-node:<node>"]}],
  "inferences": [],
  "assumptions": [],
  "unresolvedDecisions": [],
  "patch": {"testResult": "PASS"},
  "fieldSources": {
    "testResult": {
      "sourceType": "pms_context",
      "sourceRefs": ["requirement-node:<node>#component:requirement-node-workbench"],
      "confidence": "high"
    }
  },
  "requestedCompletion": false
}
```

字段必须来自当前 `saveContract.writableFields`。`protectedFields`、未知字段、缺少来源、低置信度高风险推断和未决问题都会阻止写入，并返回 `NEEDS_INPUT` 或 `CAPABILITY_UNAVAILABLE`。

## 结果处理

`agent-progression-run/v2` 返回一个稳定 JSON。progression 命令使用 `--node-version` 传递节点版本，使用 `--context-version` 传递会话/审计关联信息；旧的 `--version` 参数会返回迁移错误：

- `CONTEXT_READY`：只读上下文完成。
- `PLAN_READY`：已生成计划和 preview，没有写入。
- `NEEDS_INPUT`：字段、来源、负责人、排期或其他合同信息不足。
- `WAITING_CONFIRMATION`：高风险或当前能力需要明确授权。
- `CAPABILITY_UNAVAILABLE`：当前 PMS 没有声明该能力或字段不可写。
- `SUCCEEDED`：执行、回读和验证均完成。
- `CONFLICT`：上下文或版本发生变化，需要重新读取后再 plan。
- `WRITE_RESULT_UNKNOWN`：PMS 已处理但回读不能证明结果，禁止盲目重试。

写入结果应向用户说明 `operationId`、`auditId`、实际变更和 `verification`。不要输出 Token、密码、SQL 或完整堆栈。

## 当前边界

统一 `run` 入口支持 `requirement`、`topic`、`story` 和 `project`。项目支持只读上下文、基于当前 `saveContract` 的节点字段更新，以及在 PMS 能力目录声明 `node.complete-with-data` 且当前 `saveContract.completionCommand` 匹配时原子保存并完成节点；未声明时会返回 `CAPABILITY_UNAVAILABLE`，不会自动拆分成多次写入。

项目节点字段更新示例：

```bash
pms scenario progression run project --name "PMS 项目管理系统" \
  --intent UPDATE_NODE_FIELDS \
  --execute-mode plan \
  --node-id <context.currentNode.id> \
  --draft-json '<agent-progression/v2 draft>' \
  --format json
```
