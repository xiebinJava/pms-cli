# Agent Draft 与来源审计合约

`agent-progression/v2` 的写入请求由外部 Agent 生成 draft，`pms-cli` 只负责读取 PMS 上下文、校验草稿、生成 preview 和执行已绑定的 preview。CLI 不保存模型地址、API Key 或完整聊天记录。

## Draft

写入节点时，Agent 必须把字段变更放在 `draft.patch`，并为每个可写字段提供 `draft.fieldSources`：

```json
{
  "patch": { "testResult": "PASS" },
  "fieldSources": {
    "testResult": {
      "sourceType": "pms_context",
      "sourceRefs": ["requirement-node:101#component:requirement-node-workbench"],
      "confidence": "high"
    }
  },
  "requestedCompletion": true
}
```

`sourceRefs` 必须来自本次 `pms context --view focused` 返回的可读取引用，格式为：

- `<resourceType>:<id>`
- `<resourceType>-node:<nodeId>`
- `<resourceType>-node:<nodeId>#component:<componentKey>`

`conversation:<id>`、`pms:<...>` 和任意外部模型内部引用不能直接授权 PMS 写入。对话中的信息必须先经过 Orchestrator 映射到可读取的 PMS context；映射失败时返回 `NEEDS_INPUT`。

## Provenance

当 PMS capabilities 声明 `provenanceVersions` 包含 `draft-provenance/v1` 时，`progression run` 的写入必须携带：

```json
{
  "contractVersion": "draft-provenance/v1",
  "draftDigest": "sha256:<64 位小写十六进制>",
  "fieldSources": {
    "testResult": {
      "sourceType": "pms_context",
      "sourceRefs": ["requirement-node:101#component:requirement-node-workbench"],
      "confidence": "high"
    }
  }
}
```

`draftDigest` 的输入包含资源、节点、组件、意图、完成标记、facts/inferences/assumptions/unresolvedDecisions、patch、fieldSources 和以下版本快照：

```json
{
  "nodeVersion": 4,
  "entityVersion": 3,
  "workflowInstanceVersion": 8,
  "componentVersion": 2,
  "contextVersion": "requirement:24:entity:3"
}
```

未知版本必须写 `null`。对象 key 递归按字典序排序；只有 `sourceRefs` 数组排序，其他数组保留顺序；用无空白 UTF-8 JSON 做 SHA-256，并加 `sha256:` 前缀。版本变化、patch 变化或字段来源变化都会使 digest 变化。

## 失败和执行边界

- provenance 非法或超过大小限制：`REJECTED`，并返回 `PROVENANCE_INVALID` 或 `PROVENANCE_TOO_LARGE`。
- PMS 明确不支持 provenance：`CAPABILITY_UNAVAILABLE`，warnings 包含 `PROVENANCE_NOT_SUPPORTED`，不生成 preview。
- PMS 支持 provenance 但请求缺失：`NEEDS_INPUT`，warnings 包含 `PROVENANCE_NOT_PROVIDED`，不生成 preview。
- PMS preview 必须回显 `provenanceRef = operation:<previewOperationId>` 和相同的 `draftDigest`；回显不匹配时 CLI 停止执行。
- execute 只接收原 preview 的 operationId 和幂等键，不接收新的 provenance。

旧 `operation auto` 与资源级兼容入口可以继续工作，但缺少 provenance 时结果必须带 `PROVENANCE_NOT_AUDITED`，不能被当作完成了来源审计的 progression 写入。
