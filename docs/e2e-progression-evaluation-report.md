# Agent Progression 影子评估报告

本报告模板用于记录四类资源的自然语言草稿质量。影子运行只读取 PMS 上下文并生成草稿，不调用 `preview`、`execute` 或任何写命令。

每条用例同时记录三类结果：

- **程序通过**：草稿符合 `AgentProgressionShadowDraft` schema，引用和候选结构可被机器解析。
- **模型输出通过**：由业务人员依据事实准确性、来源覆盖、假设标记、缺失信息识别和字段完整性评分。
- **人工验收通过**：业务人员确认结果可以进入后续 Agent Progression plan；这项结果不能由 schema 校验代替。

## 固定运行信息

| 字段 | 值 |
| --- | --- |
| 用例文件 | `tests/fixtures/progression-shadow-cases.json` |
| Provider | `mock` / `external` |
| PMS 版本 | 待填写 |
| pms-cli commit | 待填写 |
| PMS context contract | 待填写 |
| 模型与版本 | 仅 external 运行填写 |
| Prompt 版本 | 待填写 |
| 运行时间 | 待填写 |

## 人工对照字段

每条用例填写主动投入时间、总耗时、澄清次数、遗漏数、返工次数和质量评分，并保留事实、推断、假设、未决问题的逐项备注。没有实际运行 external provider 时，模型输出和人工验收必须标为 `NOT_EVALUATED`/`PENDING`，不能写成收益。
