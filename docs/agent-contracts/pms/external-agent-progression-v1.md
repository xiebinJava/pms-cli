# External Agent Progression v1

`pms-cli` 是 PMS 工具层，不是模型客户端。Claude、Codex 或 DeepSeek 保留自然语言会话、模型配置和子 Agent；CLI 只负责把结构化草稿绑定到 PMS 的上下文、能力和写入契约。

## 调用顺序

```text
外部 Agent 对话
  → pms context / progression draft
  → Agent 结合聊天信息生成 AgentProgressionDraft
  → progression plan
  → automatic 能力直接 execute，high-risk 能力先向用户确认
  → progression execute
  → 读取结果和回读验证
```

## 只读读取

```bash
pms context story 34 --view focused --format json
```

模型使用自己的聊天上下文和这个 PMS 快照进行分析。CLI 不读取模型 API Key，也不会把聊天记录转发给任何模型服务。

## 草稿绑定

```bash
pms scenario progression draft story 34 \
  --intent UPDATE_NODE_FIELDS \
  --draft-json '<AgentProgressionDraft JSON>'
```

`draft` 阶段只做 JSON 合约校验并读取最新 PMS context，返回 `contextVersion`。它不会创建 preview，也不会写入数据。`plan` 阶段才依据服务端返回的 `saveContract` 做字段白名单、版本和能力校验。

## 计划与执行

```bash
pms scenario progression plan story 34 \
  --intent COMPLETE_NODE \
  --execute-mode auto \
  --draft-json '<同一份 AgentProgressionDraft JSON>'

pms scenario progression execute story 34 \
  --intent COMPLETE_NODE \
  --execute-mode auto \
  --preview-operation-id '<plan 返回的 operationId>' \
  --idempotency-key '<稳定的幂等键>' \
  --draft-json '<同一份 AgentProgressionDraft JSON>'
```

`executeMode=auto` 只对 capability 标记为 `automatic` 且风险为 low/medium 的操作生效。高风险操作返回 `WAITING_CONFIRMATION`，由外部 Agent 向用户确认后用 `executeMode=confirm` 重试。

## 结果处理

- `SUCCEEDED`：读取 `readback` 和 `verification`，向用户报告真实节点与字段结果。
- `CONFLICT`：重新读取 context，重新生成草稿和 plan；不得复用旧 preview。
- `WRITE_RESULT_UNKNOWN`：保留 `operationId`，先查询操作和回读，不得盲目重试。
- `CAPABILITY_UNAVAILABLE`：向用户说明当前资源或节点没有该能力，不得猜测命令名。

模型供应商配置应放在 Claude/Codex/DeepSeek 的运行环境中，不能放入 `pms-cli` 或 PMS 后端。
