# Changelog

## Unreleased

- Added the gated `pms requirement analysis save` entry point with explicit node/version arguments, idempotency replay, capability checks and safe Skill guidance.
- Added default-off isolated E2E scaffolding for project creation and requirement analysis save; real runs require browser authorization and explicit isolation configuration.

## 0.1.0

- Added the agent-native `pms` CLI with browser PKCE login and OS keyring refresh-token storage.
- Added dynamic capability/context discovery, preview-before-write operations, resource shortcuts and JSONL output.
- Added Codex/Claude Code/WorkBuddy Skill installation guidance and standalone CLI smoke tests.
- Removed the legacy adapter runtimes in favor of one first-party PMS CLI entry point.
