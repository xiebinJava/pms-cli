# Orchestrator Session Contract

## Purpose

The CLI remains stateless between commands. PMS is the source of truth for the
conversation, turns, plans, previews, confirmations, operations, and progress
events. A session read reconstructs the current state from those durable PMS
records instead of relying on a local process or an in-memory agent context.

The current contract is `orchestrator-session/v1` at the product level. The
CLI command is:

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
PLAN_CREATED
PREVIEW_CREATED
WAITING_CONFIRMATION
EXECUTION_STARTED
EXECUTION_FINISHED
VERIFICATION_FINISHED
FAILED
CONFLICT
CANCELLED
```

The exact event set may grow, but event sequence numbers are monotonic within
one conversation. Consumers should ignore unknown event types while preserving
the cursor.

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
