# Project/topic Orchestrator 验收记录

日期：2026-10-20（Asia/Shanghai）  
范围：在现有 `ai-orchestrator-v1` 上接入 project/topic 的资源节点会话，不新建第二套 Conversation/Plan 模型。

## 当前结论

代码、契约、静态门禁和本地回归已经完成；真实隔离 PMS 的 project/topic OAuth + MySQL 写入 E2E 尚未运行，因此当前状态是 **待真实验收**，不能作为发布通过。

“project/topic Orchestrator disabled until isolated suite passes”采用合并/发布门禁实现，不增加运行时 feature flag：隔离套件通过前，相关提交只能留在功能分支，不能合并或部署到默认发布分支。

## 已完成证据

- Backend Orchestrator 回归：`mvn -Dtest='com.brad.pms.ai.orchestrator.*Test' test`，95 个通过、0 失败、1 个隔离环境测试跳过。
- Connector 全量回归：`pnpm test`，79 个测试文件通过、15 个环境门禁测试跳过；395 个测试通过、0 失败、15 个跳过。
- Connector 类型检查：`pnpm run typecheck` 通过。
- CLI 构建：`pnpm run build:cli` 通过，生成 `dist/pms-cli.js`。
- provenance golden vector：`node scripts/verify-provenance-fixture-sync.mjs` 通过；connector/backend 两侧 fixture 的 SHA-256 均为 `9bb35388f55cc98138b9dd9ca917731b21373d5ab8e681d8bca0ea9472c0facb`。
- `git diff --check` 通过。

对应实现提交：

- Backend：`c17160d feat(orchestrator): add project topic recovery and verification`
- Connector：`95c42b1 feat(cli): support project topic orchestrator sessions`
- Connector E2E/fixture：`29ac1b8 test(e2e): verify project topic orchestrator sessions`

## 真实验收范围

两条新链路均要求：

1. 通过 focused context 读取当前节点、`nodeContract`、可写 `saveContract` 和版本轴。
2. 使用 `resource-node/v1` 草稿完成 turn → preview → confirm → execute → focused readback。
3. 校验 `expectedVersions`、`provenanceRef`、`draftDigest` 与回读 verification。
4. 使用相同 conversation、preview、draftDigest 和幂等键 replay，不产生第二次业务效果。
5. 校验旧 `nodeVersion` 的冲突、非法 provenance、缺失 `requestedCompletion` 和多可写组件未选择时的拒绝语义。
6. 项目夹具通过已注册命令从 `project-basic-info` 创建态推进到第一个可写节点，不使用人工预置节点 ID；专题夹具遵循相同规则。

单独运行：

```bash
pnpm run verify:real-pms:project-orchestrator
pnpm run verify:real-pms:topic-orchestrator
```

统一运行：

```bash
pnpm run verify:real-pms:agent-suite
```

统一脚本运行前必须准备真实隔离 PMS、OAuth 前端代理和一次性数据库，并设置：

```bash
export PMS_E2E_WRITE=true
export PMS_E2E_ISOLATED=true
export PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true
export PMS_E2E_BASE_URL=http://127.0.0.1:18080/api
export PMS_E2E_ALLOWED_BASE_URL="$PMS_E2E_BASE_URL"
export PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173
export PMS_E2E_DATABASE_NAME=pms_ai_e2e_<run-id>
export PMS_E2E_ALLOWED_DATABASE_NAME="$PMS_E2E_DATABASE_NAME"
export PMS_E2E_DB_URL="mysql://<isolated-user>:<local-password>@127.0.0.1:13306/${PMS_E2E_DATABASE_NAME}"
export PMS_E2E_ACCOUNT_ID=1
export PMS_E2E_RUN_ID=<run-id>
```

密码只允许通过本地隔离环境变量注入，不能写入文档、提交或共享环境。测试输出的 `skipped` 只能表示 gate 未开启或环境缺失，不计入验收通过。

## 当前限制

- `WRITE_RESULT_UNKNOWN` 的真实故障注入尚未纳入 PMS E2E；其状态、同幂等键重放和恢复语义已由 Backend/Connector 单元与契约测试覆盖。没有 operation GET 或故障注入能力前，不把它伪装成真实链路通过。
- 真实隔离 E2E 通过后，才可以勾选路线图中“隔离 E2E 扩展通过”并进入默认发布分支。
