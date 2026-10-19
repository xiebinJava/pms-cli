# Agent Draft Provenance v1

日期：2026-10-19

本文冻结 Connector 与 PMS 之间的字段来源审计契约。它描述可传输和可持久化的最小来源信息，不保存完整对话、访问令牌、密码或自由文本聊天记录。

## Wire shape

preview 请求的 `provenance` 是可选字段，以便旧客户端继续读取和规划；当写入能力声明支持 `draft-provenance/v1` 时，写入请求必须携带它：

```json
{
  "contractVersion": "draft-provenance/v1",
  "draftDigest": "sha256:<64 位小写十六进制>",
  "fieldSources": {
    "testResult": {
      "sourceType": "pms_context",
      "sourceRefs": ["requirement-node:12#component:requirement-node-workbench"],
      "confidence": "high"
    }
  }
}
```

`fieldSources` 是字段到来源的映射，最多 200 个字段；每个字段最多 20 个 `sourceRefs`。序列化后的 UTF-8 JSON 不得超过 64 KiB。超限返回 `PROVENANCE_TOO_LARGE`，而不是把它当成业务字段缺失。

## Source references

持久化来源必须是当前调用方可读取的 PMS context 引用：

- 资源：`<resourceType>:<resourceId>`，例如 `project:42`、`requirement:33`；
- 节点：`<resourceType>-node:<nodeId>`，例如 `project-node:3`；
- 组件：`<resourceType>-node:<nodeId>#component:<componentKey>`；
- `story-node:<nodeId>` 与 `story-node:<nodeId>#component:story-node-workbench` 也属于上述节点/组件形式。

这里的 `resourceType` 可以是 `project`、`requirement`、`topic`、`story`、`task`、`subtask`、`iteration_plan`、`workflow_template` 或 `user`；节点和组件引用只允许四类可推进资源：project、requirement、topic、story。

持久化层不接受 `pms:` 或 `conversation:` 命名空间。Claude、Codex 等外部 Agent 的对话消息只能作为本地草稿输入；Orchestrator 必须先把对话映射为可读的 PMS context/sourceRef，映射失败时返回 `NEEDS_INPUT`，不能单独授权写入。`sourceType` 仍可记录 `pms_context`、`conversation` 或 `inference`，但所有持久化 `sourceRefs` 都必须符合上面的 PMS 引用格式。

## Draft digest

`draftDigest` 绑定一次草稿和它读取时的版本快照。规范化输入固定为：

```text
{contractVersion, resourceType, resourceId, nodeId, componentKey,
 intent, requestedCompletion, versionSnapshot, facts, inferences,
 assumptions, unresolvedDecisions, patch, fieldSources}
```

`versionSnapshot` 必须包含以下五个 key，未知值写 `null`，不得省略：

```json
{
  "nodeVersion": null,
  "entityVersion": null,
  "workflowInstanceVersion": null,
  "componentVersion": null,
  "contextVersion": null
}
```

规范化规则：递归按 object key 的字典序排序；只有名为 `sourceRefs` 的数组按字典序排序；其他数组保持声明顺序；使用无空白 JSON、UTF-8 编码和 SHA-256，结果带 `sha256:` 前缀。`requestId`、`operationId`、时间戳、凭据和完整对话不参与 digest。任一版本轴变化都必须生成不同 digest。

Connector 的实现位于 `packages/pms-contracts/src/provenance.ts`，后端校验器必须使用同一算法和同一 sourceRef 集合。`execute` 不重新接受 provenance，只引用原 preview 的 digest 和版本快照。

## Storage and response binding

- 下一次 migration 只给 `pms_ai_operation` 增加可空的 `provenance_json LONGTEXT`；
- `pms_ai_plan` 复用现有 `draft_json`，不新增重复列；
- `pms_ai_operation_event.detail_json` 只记录 `provenanceRef` 和 digest，不复制完整来源；
- preview 的 `provenanceRef` 固定为 `operation:<previewOperationId>`，并回显 digest；
- operation/plan/audit 查询可以用 `provenanceRef` 定位字段来源，但不是第一阶段 unknown write 收敛的前置条件。

## Validation and rollout

校验失败统一映射为业务层的 `REJECTED`：非法引用返回 `rejectionReason=PROVENANCE_INVALID`，超限返回 `rejectionReason=PROVENANCE_TOO_LARGE`。未读取到完整上下文或来源不可映射则返回 `NEEDS_INPUT`，不能伪装成来源审计成功。

发布顺序固定为 backend first、connector second。Connector 在写入前检查 capabilities 的 `provenanceVersions` 是否包含 `draft-provenance/v1`；后端不支持时必须返回 `CAPABILITY_UNAVAILABLE` 与 `PROVENANCE_NOT_SUPPORTED`，不生成 preview、不写入。旧的 `resource-write`/`operation auto` 入口可以继续执行，但结果必须标记 `PROVENANCE_NOT_AUDITED`，不得宣称完成来源审计。
