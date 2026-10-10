# PMS CLI command contract

The installed command is `pms`. The CLI is an API-backed client: it reads the
current capability catalog and workflow context from PMS and sends writes only
through `/api/integration/ai/v1`.

## Stable output

Every JSON success writes one object to stdout:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "req-...",
    "clientId": "pms-cli",
    "auditId": "audit-...",
    "refreshScopes": ["project-list"]
  }
}
```

Every failure writes an error envelope to stderr and exits non-zero:

```json
{
  "ok": false,
  "error": { "code": "FORBIDDEN", "message": "...", "details": {} },
  "meta": { "requestId": "req-...", "clientId": "pms-cli" }
}
```

## Core commands

| Command | PMS endpoint | Safe default |
| --- | --- | --- |
| `pms get <resource-type> <id>` | `GET /integration/ai/v1/resources/{type}/{id}` | read |
| `pms capabilities --format json` | `GET /integration/ai/v1/capabilities` | read |
| `pms context <resource-type> <id> --format json` | `GET /integration/ai/v1/context/{type}/{id}` | read |
| `pms operation preview <operation> --arguments-json <json>` | `POST /integration/ai/v1/operations/preview` | dry-run |
| `pms operation execute <operation> --arguments-json <json> --idempotency-key <key>` | `POST /integration/ai/v1/operations/execute` | explicit write |

Write requests carry `clientId=pms-cli`, `requestId`, `idempotencyKey`, and
the capability-provided context/contract versions when required. The CLI
does not access the PMS database or duplicate workflow rules.

## Request parsing and read compatibility

Options accept either `--name value` or `--name=value`. Search filters use
`--filter key=value`; the same filter key cannot be supplied twice and values
may contain additional `=` characters. Unknown flags, unsafe integer IDs,
malformed JSON, incomplete context/contract pairs, and missing write
idempotency keys fail before authentication or a PMS request.

`get` is an exact resource read for requirements, projects, topics, stories,
tasks, subtasks, and iteration plans. It never falls back to a list query.
`context` preserves the resource details, entity version, pinned workflow
template version, node/component metadata, allowed actions, and readable
relations returned by the server.

Older PMS servers may omit `features`, `resourceDetails`, `entityVersion`, or
`relations`. The connector keeps those responses readable, but an absent
`features.resourceGet` or `features.richWorkflowContext` is treated as
unsupported; it is never silently emulated with a list query or fabricated
workflow metadata.
