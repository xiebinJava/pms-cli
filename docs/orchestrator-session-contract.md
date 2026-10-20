# Orchestrator Session Contract

## Purpose

The CLI remains stateless between commands. PMS is the source of truth for the
conversation, turns, plans, previews, confirmations, operations, and progress
events. A session read reconstructs the current state from those durable PMS
records instead of relying on a local process or an in-memory agent context.

The current contract is `orchestrator-session/v1` at the product level. It
reuses the existing PMS Orchestrator conversation, plan, preview, operation,
verification, and event records. The CLI command for the existing requirement
path is:

```text
pms scenario requirement-analysis orchestrate session <conversation-id> [--after-sequence <n>]
```

`--after-sequence` is an incremental, conversation-scoped event cursor. PMS
allocates one monotonic sequence across every plan in a conversation. The
returned `events` array contains only events after that cursor. `nextSequence`
is the next cursor the caller should use. A caller may start a fresh process,
load the session again, and continue from the returned cursor without carrying
local state. The session endpoint reads the conversation, latest plan, and
events in one read-only transaction.

## Conversation lifecycle

Natural-language agents should keep the lifecycle explicit:

```text
user message
  -> create conversation
  -> append turn with a validated draft
  -> PMS creates a durable plan
  -> preview plan
  -> user confirms with an idempotency key
  -> PMS executes the approved operation
  -> read session/events and verify the resource
```

Example CLI calls:

```bash
pms scenario requirement-analysis orchestrate create 33
pms scenario requirement-analysis orchestrate turn 10 \
  --message "补齐需求分析" \
  --draft-json '{"facts":[],"inferences":[],"assumptions":[],"unresolvedDecisions":[],"patch":{}}'
pms scenario requirement-analysis orchestrate session 10 --after-sequence 0
pms scenario requirement-analysis orchestrate preview 30
pms scenario requirement-analysis orchestrate confirm 30 \
  --idempotency-key req-33-analysis-1
pms scenario requirement-analysis orchestrate session 10 --after-sequence 5

# 故事节点使用同一套跨进程会话协议
pms scenario story-orchestrator session 20 --after-sequence 0

# 项目/专题节点使用同一套会话协议和 resource-node/v1 草稿
pms scenario resource-orchestrator create project 42
pms scenario resource-orchestrator turn 61 \
  --message "补充当前节点说明" \
  --draft-json '{"contractVersion":"resource-node/v1","resourceType":"project","intent":"UPDATE_NODE_FIELDS","nodeId":"node-123","nodeVersion":7,"fieldChanges":[{"fieldKey":"description","value":"...","sourceRefs":["project:42"]}],"requestedCompletion":false}'
pms scenario resource-orchestrator preview 88
pms scenario resource-orchestrator confirm 88 --idempotency-key project-42-node-123-1
pms scenario resource-orchestrator events 61 --after-sequence 0
pms scenario resource-orchestrator session 61

# 专题使用同一入口，只替换资源类型和当前上下文中的节点/组件
pms scenario resource-orchestrator create topic 18
```

The model or parent agent owns the natural-language interpretation and draft
construction. PMS owns context validation, plan persistence, preview
preconditions, confirmation, execution, and readback events. The CLI only
transports typed requests and renders typed responses.

## Session response

The response has this shape:

```json
{
  "sessionId": 10,
  "conversation": {
    "conversationId": 10,
    "resourceType": "requirement",
    "resourceId": 33,
    "status": "ACTIVE",
    "latestPlan": null
  },
  "latestPlan": null,
  "events": [
    {
      "sequenceNo": 5,
      "eventType": "WAITING_CONFIRMATION",
      "operationId": null,
      "detail": {"planId": 30},
      "createdAt": "2026-10-15T09:00:00Z"
    }
  ],
  "afterSequence": 4,
  "nextSequence": 6
}
```

The durable records support the following progress events:

```text
CONTEXT_READ
DRAFT_VALIDATED
INPUT_REQUIRED
PLAN_CREATED
PREVIEW_CREATED
WAITING_CONFIRMATION
EXECUTION_STARTED
EXECUTION_FINISHED
VERIFICATION_FINISHED
READBACK_UNKNOWN
FAILED
CONFLICT
CANCELLED
```

The exact event set may grow, but event sequence numbers are monotonic within
one conversation. Consumers should ignore unknown event types while preserving
the cursor.

`AiOrchestratorState` 是 Plan 的持久状态，事件名是进度记录，两者不混用。
Plan 状态使用 `RECEIVED → CONTEXT_READY → DRAFT_VALIDATED → PLAN_READY /
NEEDS_INPUT → PREVIEWED → WAITING_CONFIRMATION → EXECUTING → VERIFYING →
SUCCEEDED|WRITE_RESULT_UNKNOWN`，并保留 `FAILED`、`CONFLICT`、`CANCELLED`。
`NEEDS_INPUT` 是当前 Plan 的终态；补充信息通过服务层合并 patch 后生成新 Plan，
不是状态机回环。progression run 的拒绝信封在边界展开为
`status=REJECTED`、`writeDecision=NEEDS_INPUT`、`plan.preview=null` 和
`rejectionReason=COMPLETION_NOT_REQUESTED`，不新增 Orchestrator 状态。

## Project/topic resource-node 约束

project/topic 的会话使用 `resource-node/v1`。turn 请求可以携带
`nodeId`、`nodeVersion`、`componentKey` 和 `contextVersion`；其中
`contextVersion` 沿用 requirement/story 的关联字段及快照标签语义，在
project/topic 上不能代替节点并发版本。真实并发保护来自 preview 返回的
`expectedVersions`，并且 provenance 的 `versionSnapshot` 与其 digest 绑定。
project 的 `nodeVersion` 必须取当前 focused context 的 `nodeContract.version`；
不能把 project 实体 `context.version` 当作节点版本。topic/story 的实体版本可能
为空时也不能补成 0。

可写 `saveContract` 的组件选择规则与 progression run 相同：恰好一个可写组件
可省略 `componentKey`，多个必须显式指定，零个只允许只读上下文并返回
`writeCapable=false`。`project-basic-info` 是项目实体资料路径，使用
`project.update`，不伪装为资源节点字段写入。project/topic 没有声明的
`fieldContracts` 不由会话层伪造；缺失信息来自后端 preview preconditions 或
当前组件合同。

provenance 由外部 Agent 按 `draft-provenance/v1` 规范提供，Orchestrator 不调用
模型、不生成不可验证的来源。preview 必须回显 `provenanceRef`、`draftDigest`
和 `expectedVersions`，confirm 只能执行原 preview 绑定的草稿和版本快照。

## Safety rules

- A plan must be previewed before it is confirmed.
- Confirmation always carries an idempotency key. Replaying the same key is
  safe; a new key against stale context must surface a conflict.
- A session read is read-only and never mutates PMS.
- The CLI must not infer a successful write from a transport response alone;
  the agent should inspect the operation result and the subsequent resource or
  context readback.
- If a process crashes after confirmation, a new process resumes by calling
  `session` with the last known cursor, then checks the latest plan and events.
