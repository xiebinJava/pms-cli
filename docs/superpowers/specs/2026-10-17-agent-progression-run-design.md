# Agent Progression Run Design

Date: 2026-10-17

## Goal

Provide Claude, Codex, and similar external Agents with one stable CLI entry point for a single project-management request. The Agent remains responsible for natural-language understanding and draft generation. `pms-cli` remains a stateless PMS protocol client: it reads the current PMS context, validates the Agent Draft against the live capability contract, creates a preview, optionally executes according to the declared risk mode, and reads back the result.

The first supported scenarios are requirement, topic, and story node field updates/completions. Project node writes stay outside this change.

## Non-goals

- No model SDK, model URL, API key, model name, prompt orchestration, or network call to a model from `pms-cli`.
- No new PMS backend business rules or alternative write endpoint.
- No removal of the existing `draft`, `plan`, or `execute` commands.
- No automatic selection of a node, field, owner, date, or workflow template.
- No bypass of PMS preview, permissions, version checks, idempotency, audit, or readback verification.

## External Agent flow

```text
User natural language
  -> Claude/Codex interprets request and reads PMS context through pms-cli
  -> Agent emits agent-progression/v1 draft with sourceRefs/fieldSources
  -> pms scenario progression run
       -> fresh focused context + capability read
       -> draft validation and missing-field diagnostics
       -> PMS preview
       -> automatic execution only when requested mode and capability risk allow it
       -> PMS readback and verification
  -> fixed JSON result for the Agent to report
```

The CLI never sends PMS context to a model. The external Agent decides when a user message is an explicit write authorization and chooses `--execute-mode auto` for low/medium automatic capabilities or `--execute-mode confirm` for a high-risk operation that the user explicitly authorized. `--execute-mode plan` is read/preview only.

## CLI contract

Add:

```text
pms scenario progression run <project|requirement|topic|story> <id> \\
  --intent <READ_CONTEXT|UPDATE_NODE_FIELDS|COMPLETE_NODE> \\
  [--node-id <id>] [--version <version>] [--draft-json <json>] \\
  [--execute-mode plan|auto|confirm] \\
  [--preview-operation-id <id>] [--idempotency-key <key>]
```

`run` is a convenience composition over existing scenario functions; it must not duplicate resource adapters or PMS business rules. It creates a fresh preview inside the same invocation. Resuming an already-created preview remains the responsibility of the existing `execute` command.

- `READ_CONTEXT`: reads resource and focused context and returns `CONTEXT_READY`; it does not accept a draft and never previews or writes.
- `UPDATE_NODE_FIELDS` / `COMPLETE_NODE`: require a draft. The command validates the draft against fresh context before previewing.
- `plan`: returns a plan and preview, with `NEEDS_INPUT`, `WAITING_CONFIRMATION`, or `CAPABILITY_UNAVAILABLE` when applicable; it never executes.
- `auto`: executes only when the live capability is automatic and low/medium risk. If the capability requires confirmation, returns `WAITING_CONFIRMATION` and does not write.
- `confirm`: is an explicit execution authorization supplied by the calling Agent after the user authorized the write. It can execute non-read capabilities, including high-risk ones, but still requires the preview operation ID and a fresh idempotency key.
- A write run requires an explicit `--idempotency-key`; the CLI never invents a retry key.
- Execution cannot accept a second draft or changed arguments after preview. A changed draft requires a new run.

The result is a new `agent-progression-run/v1` envelope containing the original `agent-progression/v1` plan and, when execution was attempted, the existing progression result. It includes `status`, `writeDecision`, `previewOperationId`, `operationId`, `auditId`, `readback`, `verification`, and warnings without exposing credentials.

## Safety and error behavior

- Unknown/protected fields, missing evidence references, stale context, missing required completion fields, and blocked preview preconditions stop before execution.
- `WAITING_CONFIRMATION` and `NEEDS_INPUT` are successful protocol outcomes, not retries.
- PMS conflicts and `WRITE_RESULT_UNKNOWN` are returned with their operation/idempotency references. The CLI does not retry writes.
- For `READ_CONTEXT`, no `--idempotency-key`, preview, or write capability is required.
- Existing commands and schemas remain backwards compatible; the new run result has its own versioned schema.

## Testing

1. Unit tests for run dispatch and mode routing.
2. Contract tests for the new run result schema and stable JSON fields.
3. Regression tests proving:
   - read context never calls preview or execute;
   - auto executes a permitted low/medium operation;
   - auto stops at `WAITING_CONFIRMATION` for high risk;
   - confirm executes high risk only with preview and idempotency key;
   - missing fields, stale versions, and protected-field drafts do not write;
   - readback and audit identifiers are preserved.
4. One isolated real-PMS E2E test for a requirement or story node, using a disposable database and the already established runbook gates.
5. Update the Claude/Codex skill and CLI docs with one natural-language example and the JSON result interpretation.
