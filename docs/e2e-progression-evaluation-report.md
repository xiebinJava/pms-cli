# Agent Progression 影子评估报告

本报告模板用于记录四类资源的自然语言草稿质量。影子运行只读取 PMS 上下文并生成草稿，不调用 `preview`、`execute` 或任何写命令。

外部 Agent 生成草稿后，先通过只读 draft 入口绑定新鲜上下文：

```bash
pms scenario progression draft story 34 \
  --intent UPDATE_NODE_FIELDS \
  --draft-json '<AgentProgressionDraft JSON>'
```

该命令只校验结构并返回上下文版本；随后由 `plan` 依据服务端 `saveContract` 做字段白名单和 preview 校验，再根据能力策略进入 `execute`。pms-cli 不调用模型。

每条用例同时记录三类结果：

- **程序通过**：草稿符合 `AgentProgressionShadowDraft` schema，引用和候选结构可被机器解析。
- **模型输出通过**：由业务人员依据事实准确性、来源覆盖、假设标记、缺失信息识别和字段完整性评分。
- **人工验收通过**：业务人员确认结果可以进入后续 Agent Progression plan；这项结果不能由 schema 校验代替。

## 固定运行信息

| 字段 | 值 |
| --- | --- |
| 用例文件 | `tests/fixtures/progression-shadow-cases.json` |
| Draft source | `mock`（CLI 链路验证）/ 外部 Agent（Claude、Codex、DeepSeek） |
| PMS 版本 | 待填写 |
| pms-cli commit | 待填写 |
| PMS context contract | 待填写 |
| 模型与版本 | 由外部 Agent 运行时在其会话中填写 |
| Prompt 版本 | 待填写 |
| 运行时间 | 待填写 |

## 人工对照字段

每条用例填写主动投入时间、总耗时、澄清次数、遗漏数、返工次数和质量评分，并保留事实、推断、假设、未决问题的逐项备注。CLI 不调用模型；模型输出和人工验收必须由外部 Agent 运行者记录，不能把 Mock 的程序通过写成模型收益。
