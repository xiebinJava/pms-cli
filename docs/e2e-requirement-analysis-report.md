# Requirement Analysis Orchestration E2E Report

日期：2026-10-15（Asia/Shanghai）

## Scope

本次验证“外部 AI 生成结构化 `AnalysisDraft` → Connector 校验 → PMS context → preview → 用户确认 → execute → get/context 回读”。模型调用不在 Connector 内执行，真实写入只连接一次性隔离 PMS 环境。

代表性自然语言影子用例位于 [`tests/fixtures/requirement-analysis-shadow-cases.json`](../tests/fixtures/requirement-analysis-shadow-cases.json)。

## Draft provider and read-only shadow command

`AnalysisDraftProvider` 现在只保留生成结构化草稿的本地测试接口。`FixedAnalysisDraftProvider` 用于确定性测试和链路冒烟；真实模型由 Claude、Codex 或 DeepSeek 等外部 Agent 持有，pms-cli 不负责调用模型，也不持有模型 API Key。所有外部 Agent 草稿进入 PMS 场景前仍必须通过 `analysisDraftSchema` 和服务端契约校验。

本地可用固定 Mock 运行只读影子评估：

```bash
pnpm build:cli
node dist/pms-cli.js scenario requirement-analysis shadow 33 \
  --cases-file tests/fixtures/requirement-analysis-shadow-cases.json \
  --provider mock
```

影子命令只支持 `--provider mock`，用于验证本地链路。需要评估真实模型时，由 Claude、Codex 或 DeepSeek 在自身会话中读取 `pms context`，生成 `AnalysisDraft` 后再调用 CLI 的 draft/plan/execute 能力；pms-cli 不接收模型地址、API Key 或模型名称，也不会主动把 PMS 上下文发送到模型服务。

生产 Agent 不需要任何模型配置。它可以先读取上下文并自行生成 `AnalysisDraft`，再通过 Agent Draft Contract 交给 CLI：

```bash
node dist/pms-cli.js scenario requirement-analysis draft 33 \
  --node-id 701 --version 4 --draft-json '<完整 AnalysisDraft JSON>'

node dist/pms-cli.js scenario requirement-analysis plan 33 \
  --node-id 701 --version 4 --draft-json '<同一份 AnalysisDraft JSON>'
```

`draft` 只校验草稿，不产生 preview 或写入；`plan` 校验通过后才生成 preview；用户确认后再使用同一份草稿和幂等键执行 `execute`。旧的 `--arguments-json` 仍保留给兼容调用，但新的 Agent 集成应使用 `--draft-json`。

## Automated evidence

- `tests/unit/e2e-safety.test.ts`: 8 passed。
- `tests/unit/requirement-fixture.test.ts`: 4 passed。
- `tests/unit/auth.test.ts`: 5 passed。
- `tests/unit/analysis-draft-provider.test.ts`: 4 passed。
- `tests/unit/analysis-shadow.test.ts`: 2 passed。
- `tests/unit/cli-runner.test.ts`: 10 passed，包含只读 shadow 命令路由。
- Final Connector suite excluding the environment-sensitive `tests/e2e/install.test.ts`: 123 passed，4 skipped。该安装测试依赖本机 OS keyring 子进程；本次单独重跑受本机凭据环境阻塞，未发现与本次 Provider 改动相关的断言失败。
- `tests/e2e/requirement-analysis.e2e.test.ts`: 1 real test passed。
- `tests/e2e/requirement-analysis-conflict.e2e.test.ts`: 1 real test passed。
- Real tests ran serially with `--maxWorkers=1 --minWorkers=1` in a fresh disposable MySQL/API target. The stack was stopped and its volume removed after the run.

The save test verified a run-scoped requirement created through registered operations, a real preview and execute, unchanged protected fields, readback of the source marker, and same-idempotency-key replay with the same operation. The conflict test verified that a new key using the old node version is rejected with client-side `PmsClientError(kind="conflict", status=409)`, that the first analysis remains readable, and that the stale marker is absent.

## Contract notes

The backend automatic execute endpoint currently represents stale business versions as HTTP 409. It does not return a successful envelope whose `status` is `CONFLICT`; scenario callers must normalize this to a non-write conflict and must not blindly retry with a fresh version.

The fixture advances the newly created requirement through the real owner, schedule, field-binding and node-complete commands before selecting the requirement receiving node. This avoids using a shared record or a hard-coded node ID.

## Shadow-case status

The 12 prompts in `tests/fixtures/requirement-analysis-shadow-cases.json` are an evaluation matrix only. The provider abstraction is now implemented, but no external model credentials or human timing/quality baseline was configured in this run, so no natural-language quality or efficiency gain is claimed. The next experiment must record facts/inferences/assumptions/unresolved decisions, source coverage, clarification count, active effort, total time, revisions and reviewer score without writing to PMS.

## Acceptance decision

The deterministic context and save contract is ready for a controlled shadow experiment. A full chat workbench remains gated on that experiment: proceed only if active user effort improves without reducing review quality and without unauthorized/protected-field writes. Until then, build at most a preview-first “draft → preview → confirm” surface that reuses the tested scenario API.
