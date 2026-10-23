# 四类资源 Agent 推进与 Orchestrator 路线图评审

日期：2026-10-19

评审对象：

- `docs/superpowers/specs/2026-10-19-four-resource-agent-orchestrator-roadmap-design.md`
- `docs/superpowers/plans/2026-10-19-four-resource-agent-orchestrator-roadmap.md`

评审范围：

- `pms-ai-connector`：`pms-cli` 的 progression、resource-scenario、readback、contracts、测试与文档；
- `pms-backend`：capability catalog、focused context、project/development node 命令、operation/audit、orchestrator。

---

## 结论摘要

方向正确：CLI 无状态、模型在外部 Agent、PMS 后端是权限/字段/流程/版本/审计的最终权威，preview → idempotent execute → readback 的主链路成立。

但当前 spec/plan 仍有三类问题，建议在进入实施前先冻结：

1. **事实基线有误**：Orchestrator 已经存在；project 的 resource 投影并不稀疏；`contextVersion` 在后端不是写入守卫。
2. **核心安全语义未闭环**：draft 来源没有进入 PMS 审计；其他写入入口可以绕过统一协议；未决决策/低置信推断在 `confirm` 后仍可写入；`run` 默认 `auto`。
3. **回读验证名不副实**：project/requirement/topic 的 `patchApplied` 只看 operation 成功，没有验证字段；after 读的是非 focused context；共享 verifier 的文件清单缺少 executor。

建议先把本文的 **“六、实施前必须确认的决策清单”** 全部关闭，再开始 Milestone 1。

---

## 一、P0：会导致架构返工或安全语义不成立

### P0-1. “Orchestrator 尚未建设”是错的，第四阶段会做重

spec 第 41 行声称会话、计划、操作事件和持续推进会话层“尚未建设”。实际后端已有：

- `pms-backend/docs/agent-contracts/orchestrator/ai-orchestrator-v1.md`；
- 持久化表 `pms_ai_conversation`、`pms_ai_conversation_turn`、`pms_ai_plan`、`pms_ai_operation_event`；
- `/integration/ai/v1/orchestrator/*` 的 conversation / plan / preview / confirm / events / session 接口；
- `pms-ai-connector` 的 `PmsClient.createConversation/appendTurn/previewPlan/confirmPlan/listConversationEvents/getOrchestratorSession`；
- `docs/orchestrator-session-contract.md`；
- requirement analysis 和 story node 两条已落地的 orchestration 路径。

**建议：**

- 第四阶段改为“扩展现有 `ai-orchestrator-v1` / `orchestrator-session/v1` 到四资源三意图”；
- 明确 `agent-progression-run/v1` 是 orchestrator 和外部 Agent 共用的**无状态执行边界**；
- 复用现有 `AiOrchestratorResponse.PlanView` 中的 `nodeContract`、`missingFields`、`questions`、`verification`，不要新造一套并行输出；
- 在 spec 中增加“复用现有实现”一节。

---

### P0-2. “任何写入都必须带可追溯的 draft 来源”目前没有实现

代码事实：

- `PmsClient.preview()` 只发送 `command/arguments/context/contract/clientId/requestId`（`packages/pms-client/src/PmsClient.ts:398-410`）；
- `PmsClient.execute()` 同样没有 draft（`PmsClient.ts:233-248`）；
- `executePreview()` 只发送 `operationId` 和 `idempotencyKey`（`PmsClient.ts:261-274`）。

因此 `facts`、`fieldSources`、`sourceRefs` 只在 CLI 本地校验，**从未到达 PMS 后端，也不会进入后端审计**。后端只能看到 arguments，无法回答“这个值来自哪段对话/哪份上下文”。

**建议（需在 Milestone 0 决策）：**

- 方案 A（推荐）：preview 请求增加 `draftRef` / `draftDigest` / `sourceRefs`，后端持久化到 operation/plan/audit；
- 方案 B：CLI 侧持久化 provenance，并在 run 结果返回可追踪的 `draftRef`；
- 方案 C：明确降级为“CLI 本地校验，不进入 PMS 审计”，同时修改 spec 的安全原则与完成定义。

无论选哪种，都需要契约版本策略和跨仓库任务。

---

### P0-3. 统一入口可以被绕过

skill 明确允许低/中风险使用 `pms operation auto`；`operation auto` 与 `resource-write` 都不要求 draft、不要求字段来源、不做节点 preflight。

如果“四类资源写入统一走 `progression run`”是目标，必须说明：

- `progression run` 是否为新协议的唯一入口；
- `operation auto` 是否只保留给非节点类操作，或标记为 legacy；
- `resource-write` 是否补 draft 校验。

否则外部 Agent 可以绕过统一协议，P0-2 的 provenance 原则也无法成立。

---

### P0-4. `run` 默认 `execute-mode=auto`

`agentProgressionInputSchema` 的默认值是 `plan`（`packages/pms-contracts/src/agentProgression.ts:86`），但 CLI 在 `apps/pms-cli/src/cli/runCli.ts:900` 和 `:831` 把默认值覆盖为 `auto`。

对面向外部 LLM Agent 的协议，默认值应为 `plan`；`auto` 必须显式声明，并继续要求幂等键。

---

### P0-5. 状态/错误语义不统一

- operation 返回的 `CONFLICT` 是 in-band status；
- adapter `validate()` 抛出的 `CONTEXT_CONFLICT` / `CAPABILITY_UNAVAILABLE`（`projectScenarioAdapter.ts:103-128`、`requirementScenarioAdapter.ts:130-151`）会一路抛到 `runCli.ts:178-200`，输出 `ok:false` + `error.code`，不是 `agent-progression-run/v1`；
- story 路径大量抛普通 `Error`（`storyProgressionAdapter.ts:175-189`、`storyWorkbench.ts:142-151`），最终变成 `CLI_ERROR`。

**建议：** 定义唯一规则：

- 预期业务状态（NEEDS_INPUT / WAITING_CONFIRMATION / CAPABILITY_UNAVAILABLE / CONFLICT / WRITE_RESULT_UNKNOWN）必须 in-band；
- 认证、网络、协议解析等系统错误才走错误信封；
- 在 `runAgentProgression` 边界统一收敛，story 也要使用 `ResourceScenarioError` 或等价类型。

---

### P0-6. `patchApplied` 对 project/requirement/topic 没有验证字段

- project：`patchApplied = resourceReadback && contextReadback && workflowStable && operation.status === "SUCCEEDED"`（`projectScenarioAdapter.ts:153-155`）；
- requirement：只看 `operation.status === "SUCCEEDED"`（`requirementScenarioAdapter.ts:183`）；
- topic：同样（`topicScenarioAdapter.ts:169-170`）；
- 只有 story 真正比较了 content（`storyWorkbench.ts:298-299`）。

也就是说，“回读验证”对三类资源只是身份校验 + 后端说成功。后端已有更完整的 `AiOrchestratorVerificationService.patchInReadback()`，可以直接复用其思路。

**建议：** 共享 verifier 必须定义四类资源分别从哪里读取 patch 值：

- project：focused context 中选中节点的 component content / workbench snapshot；
- requirement/topic/story：focused context 中选中节点对应 component 的 content；
- 比较时明确“值相等”的语义（类型归一化、日期格式、空值），避免 story 式严格 JSON 比较产生误报。

---

### P0-7. 回读使用非 focused context，且 executor 丢弃了 normalizedArguments

`resourceScenarioExecutor.ts`：

- before 读 `client.context({ type, id })`（`:126-134`）；
- after 读非 focused context（`:103-108`）；
- `adapter.verifyReadback(before, after, {}, operation)`，第三个参数是空对象（`:106`）。

而 plan 的 Task 1.2 / 2.1 要求“资源详情与 focused context 合并比较”，文件清单却没有 `resourceScenarioExecutor.ts`。不改 executor，既拿不到 focused context，也拿不到 nodeId / 写入参数。

**建议：** executor 需要：

- 按资源类型读取 focused context（project/story 带 nodeId，story 带 component）；
- 把 plan 阶段选出的 saveContract / normalizedArguments / nodeId 传给 verifier；
- before 快照尽量复用 plan 阶段已经读到的 context，减少 TOCTOU。

---

### P0-8. 受保护字段没有统一定义，且会把“合法变更”判成异常

当前至少三套语义：

| 资源 | 回读硬编码字段 | saveContract.protectedFields |
| --- | --- | --- |
| project | `id/status/deleted`（`projectScenarioAdapter.ts:290-295`） | `projectId/nodeId/workbench` |
| requirement | `systemId/targetType/targetId/ownerId/status/startDate/endDate`（`requirementScenarioAdapter.ts:397-400`） | 同左 |
| topic | `id/status/deleted`（`topicScenarioAdapter.ts:359-361`） | `status` |
| story | `title/status/ownerId/startDate/dueDate`（`storyWorkbench.ts:415-418`） | 由 variant 决定 |

需要先定义“受保护字段”到底指：

1. **资源级身份/状态字段**（不允许任何节点写入改动）；还是
2. **saveContract 声明的节点内容保护字段**（不允许通过 patch 写入）。

共享 verifier 不能只接收 `protectedFields`，还必须接收**本次写入显式允许变更的字段集**（例如 completion metadata `ownerId/startDate/endDate`），否则 `COMPLETE_NODE` 的合法变更仍可能被判成 `WRITE_RESULT_UNKNOWN`。

---

### P0-9. 未决决策 / 低置信推断在 `confirm` 后仍可写入

`planAgentProgressionDraft` 的判定顺序：

```text
unknown/protected -> CAPABILITY_UNAVAILABLE
missing / missingSources -> NEEDS_INPUT
unresolvedDecisions 或 executionMode=confirmation -> WAITING_CONFIRMATION
```

因此 `unresolvedDecisions` 和低置信度的 `testResult` / `acceptanceConclusion` 只触发 `WAITING_CONFIRMATION`，`confirm` 后就会写入（`AgentDraftContract.ts:157-163`）。

而 runbook 又说“未决问题会阻止写入，返回 NEEDS_INPUT 或 CAPABILITY_UNAVAILABLE”（`docs/agent-progression-runbook.md:90`）。

**建议：** 明确未决决策是阻塞（`NEEDS_INPUT`）还是确认即可放行。从 spec 的 Review Focus 看应为阻塞；低置信高风险推断也不应在一次泛化的 `confirm` 后写入。

---

### P0-10. `requestedCompletion=false` 不会阻止完成节点

`requestedCompletion` 唯一的用途是跳过 completionRequiredMetadata 检查（`AgentDraftContract.ts:147`）。`resourceOperation()` 仍把 `COMPLETE_NODE` 映射成 `complete-with-data`（`agentProgression.ts:317-320`），`toResourceDraft()` 也没有把它传给下层（`agentProgression.ts:339-348`）。

之前 backend 的 `2026-10-17-node-detail-autofill.md` Task 4 review gate 明确要求“节点状态只在 `requestedCompletion=true` 时推进”，但代码没有实现，测试也没有覆盖 false。

**建议：** 要么实现“false 时降级为字段更新 / 拒绝完成”，要么删掉该字段。

---

### P0-11. project / story 没有校验 `nodeId === currentNode.id`

- requirement/topic adapter 明确检查 `rawContext.currentNode?.id !== nodeId`（`requirementScenarioAdapter.ts:146-151`、`topicScenarioAdapter.ts:139-141`）；
- project adapter 没有（`projectScenarioAdapter.ts:117-129`），后端 `NodeFieldUpdateCommand` 也没有强制当前节点；
- story 的 `readStoryBinding()` 同样没有（`storyProgressionAdapter.ts:167-201`），后端 `UpdateDevelopmentItemNodeFieldCommand` 也没有。

后端 focused context 同时返回 `currentNode`（真实进行中节点）和 `meta.selectedNodeId`（请求节点），CLI 能判断。

**建议：** 统一要求“progression 只能推进当前节点”，四类资源都在 adapter preflight 中校验；如果确实需要历史节点补录，应作为独立意图，而不是 `UPDATE_NODE_FIELDS`。

---

### P0-12. Agent 读到的 `contextVersion` 无法直接回传给 `--version`

`pms context --format agent` 的 `contextSnapshot.contextVersion` 来自：

```ts
meta.contextVersion ?? `${type}:${id}:entity:${entityVersion ?? version ?? "unknown"}`
```

（`apps/pms-cli/src/commands/core/agentContext.ts:217-222`）

实际值：

- project：`project:42:entity:3`
- requirement：`requirement:33:entity:7`
- topic/story：`topic:34:entity:unknown`（后端 `entityVersion` 为 null）

但 `progression run --version` 用 `nonNegativeInteger` 解析（`runCli.ts:923`；plan/execute/draft 同理 `845/864/883`），只接受数字。

另外，`buildAgentContext` 只在 `!context.meta?.contextVersion` 时加 `MISSING_CONTEXT_VERSION` 警告（`agentContext.ts:29-35`）；topic/story 的 `meta.contextVersion` 存在但是 `...:unknown`，Agent 不会收到警告。

**建议：**

- spec 明确 progression 的 `contextVersion` 取 `context.version`（节点版本），并在 `--format agent` 中单独暴露 `nodeVersion` / `entityVersion` / `workflowInstanceVersion`；
- 或让 `--version` 接受 `meta.contextVersion` 字符串，并在 CLI 内部按资源类型解析；
- 后端为 topic/story 补齐 `entityVersion`，不要让 `meta.contextVersion` 长期是 `:unknown`。

---

## 二、P1：需要修正的事实与根因

### P1-1. 稀疏投影不是 project，而是 topic/story

- **project**：`/resources/project/{id}` 返回完整 details（id/code/name/status/owner/manager/org/dates/currentNode...），context 的 `resourceDetails` 也完整（`AiConnectorQueryService.java:250-274`、`AiProjectContextReader.java:242-258`）。
- **topic/story**：`/resources/{type}/{id}` 的 details 才是真正稀疏的，`entityVersion` 被硬编码为 `null`，缺少 `description/status/storyPoints/startDate/dueDate/blocker/latestBuildVersion/testStatus/sourceRequirements`（`AiConnectorQueryService.java:299-323`）。
- focused 视图下，非选中节点的 `content/saveContract/fieldValues` 是占位或空（`contentState="NOT_REQUESTED"`、`saveContract=null`）。

**建议：** 把 spec 第 38 行的根因改为“topic/story 的 resource 投影需要与 focused context 合并；project 的 resource 投影本身完整”。Task 1.2 的测试前提也要相应调整。

---

### P1-2. `contextVersion` 不是后端的写入守卫

- preview 要求 `contextVersion` 非空，但只用于审计/幂等，不与当前上下文比较（`CommandPreviewRequest.java:31-32`、`AiOperationService.java:50-51,169-170,237-247`）。
- 真正的并发保护来自 preview 捕获的 `projectVersion / nodeVersion / workbenchVersion / fieldVersions`，执行时由 `PmsCommandVersionGuard` 比较。
- 只有 requirement/story 的 orchestrator 路径真正检查 `contextVersion`（`AiOrchestratorService.java:589-593,604-606`）。

**建议：** spec 明确：

- “并发保护由 preview 内的版本快照负责”；
- `contextVersion` 只用于关联、审计和 orchestrator 恢复；
- 如果要让 connector 写入也检查 `contextVersion`，需要后端新增校验，不能只靠字段存在。

---

### P1-3. `contextVersion` 存在多个版本轴

- project：顶级 `version` 和 `entityVersion` 都等于 project entity version；
- requirement：顶级 `version` = 选中节点版本，`entityVersion` = requirement 版本；
- topic/story：顶级 `version` = 选中节点版本，`entityVersion = null`；
- `meta.contextVersion` 是 `"{type}:{id}:entity:{entityVersion}"`，development item 可能是 `unknown`；
- `meta.workflowInstanceVersion` 是另一条轴。

**建议：** 在 spec 中增加“版本与并发守卫”一节，列表定义：

| 名称 | 来源 | 用途 |
| --- | --- | --- |
| node version | `context.version` / node.version | 节点写入的乐观锁 |
| entity version | `context.entityVersion` | 资源实体版本、审计 |
| workflow instance version | `meta.workflowInstanceVersion` | 流程级并发 |
| contextVersion | `meta.contextVersion` | 审计/会话关联，不直接当写入守卫 |

并明确 `agent-progression/v1` 的 `contextVersion` 字段对应哪一个。

---

### P1-4. 没有 GET operation-by-id，`auditId == operationId`

- 只有 `POST /operations/preview` 和 `POST /operations/execute`，没有 `GET /operations/{id}`；
- `AiOperationResultDTO` 的 `auditId` 等于 `operationId`，不是独立审计记录 ID。

**建议：**

- spec 不要把 `operationId` 和 `auditId` 描述成两个独立引用；
- `WRITE_RESULT_UNKNOWN` 的“只读核验”路径写成：同幂等键重放 `executePreview`，或 `GET /admin/audit?...`（需要 `AUDIT_READ`）；
- plan Task 4.2 的 runbook 相应修改。

---

### P1-5. project workbench 存在“上下文不可发现”缺口

`AiProjectComponentReader` 只暴露 9 个 workbench；`solution-decision` 和 `custom-fields` 虽然 `NodeWorkbenchRegistry` 支持、`node.field.update` 也接受，但 context 中会变成 `contentState="UNSUPPORTED"`、`saveContract=null`。`project-basic-info` 走 `project.update`。

**建议：** 在四资源矩阵中标注：

- `solution-decision` / `custom-fields` → `CAPABILITY_UNAVAILABLE`（或先补后端 context 投影）；
- `project-basic-info` → `project.update`；
- 其余 8 个 workbench 才走 `node.field.update` / `node.complete-with-data`。

---

### P1-6. capability catalog 的 `mode` 恒为 `automatic`

后端把每个命令都标成 `"automatic"`，没有 read action，也没有 confirmation mode（`AiConnectorCapabilityService.java:75-78`）。确认只能由 `risk == "high"` 推导。

**建议：** spec 改为：

> `auto` 只执行 `risk` 为 low/medium 的操作；`risk=high` 必须 `confirm`。

不要写“capability 标记为 automatic 且风险 low/medium”，因为前者对所有可写命令都成立。

---

### P1-7. 远程委派 token 目前不能 preview

`AiDelegationRoutePolicy.java:37-55` 的 allow-list 只允许 capabilities/query/context/resources/execute，不包含 `/operations/preview`，也不包含 orchestrator 路由。

因此 spec 的“远程 Agent 独立最小权限委托会话”当前只能 execute，做不了 preview/confirm。

**建议：** 列为跨仓库任务：补 delegation allow-list 和 scope 策略，或明确远程委派在 Phase 1 不在范围内。

---

### P1-8. 不要给节点命令传 contractId/contractVersion

后端 contract 绑定是可选的；但 project YAML 契约只列了 `node.field.update` / `node.complete`，没有 `node.complete-with-data` 和 `development-item.node.*`。调用方传 contract 会返回 409。

**建议：** spec 区分“context 里的 saveContract”和“agent YAML contract”；不要建议给这些命令加 contract 绑定。

---

### P1-9. project saveContract 缺少 `fieldContracts` / `requiredFields`

`AiProjectComponentReader.saveContract()` 只输出 `writableFields`、`protectedFields`、`dynamicFields`、`completionRequiredMetadata`，没有 development item 那样的 `fieldContracts` / `requiredFields`。

而 `planAgentProgressionDraft` 的 `missingFields` 依赖 `contract.requiredFields` 和 `fieldContracts`（`AgentDraftContract.ts:295-313,331-342`）。

**建议：**

- 后端补齐 project 的 fieldContracts；或
- spec 明确 project 的 `NEEDS_INPUT` 由 preview preconditions 驱动，不承诺统一的 `missingFields`。

---

### P1-10. project capability 分组是 `project_node`，不是 `project`

`PmsCommandMetadata.resourceTypes()` 把 node 命令映射到 `"project_node"`，capability catalog 按此分组。CLI 的 `CapabilityResolver.action()` 全局按名字查找，所以 progression 能跑；但外部 Agent 读 `capabilities.resources[type=project].actions` 时看不到这些命令。

**建议：** 明确是改后端把 project node 动作挂到 `project` 下，还是在 CLI/文档中提供 `project_node` 的映射说明。

---

## 三、方案与计划文本问题

1. **统一输入示例无法通过 Zod。** spec 第 96-103 行的 `facts: [{key, value, sourceRef}]` 与实际 `resourceScenarioDraftItemSchema`（`{text, sourceRefs[], confidence?}`）不一致，且缺少 `fieldSources`，会被 `NEEDS_INPUT`。建议直接复用 `docs/agent-progression-runbook.md:72-88`。
2. **`audit` 和顶层 `missingFields` 不存在。** run 契约只有 `auditId`；`missingFields` 只在 `plan` 里。要么补契约，要么改文档。
3. **`userFacing` 缺 `targetNode` 和字段名称。** `userFacingDisplaySchema` 目前只有 `resourceName/resourceStatus/currentNode/operationStatus/actualChange/blockers`。Task 3.2 需要同时修改 contracts，当前文件清单没有。
4. **`project.create/update` 与统一 run 的关系没写清。** 统一 schema 要求 `resourceId` 且意图只有三个，create/update 无法表达。建议明确它们继续走 `pms scenario resource`，不在本阶段统一 run 范围内。
5. **Task 0.1 的“project 被误标为不支持”在当前代码/文档中找不到依据。** Milestone 0 应先做真实 inventory，不要先假定缺陷。
6. **`PMS_E2E_ENABLED` 不存在。** 现有 E2E 使用 `PMS_E2E_WRITE` + `PMS_E2E_ISOLATED` + 具体场景 flag。方案应沿用现有 gate。
7. **文件清单遗漏：**
   - Task 1.2 / 2.1 缺 `resourceScenarioExecutor.ts`；
   - Task 2.2 缺 `storyProgressionAdapter.ts` / `storyWorkbench.ts` 和 `packages/pms-contracts/src/userFacing.ts`；
   - Task 4.1 缺 topic/project fixture 创建。
8. **现有 E2E 覆盖被低估。** `tests/e2e/resource-scenario-real-pms.test.ts:29` 已覆盖 requirement/topic/project 的 plan→execute→readback + 幂等重放 + audit；`tests/e2e/story-acceptance-real-pms.test.ts:25` 覆盖 story acceptance。Task 4.1 应写“扩展现有 E2E”，而不是从零建立。
9. **“四资源 × 三意图 × 三执行模式”矩阵过宽。** 建议收敛为每个资源一条 READ、一条 UPDATE、一条 COMPLETE，加幂等重放、版本冲突、unknown、capability unavailable 等关键路径。
10. **Milestone 5 应改为扩展已有 orchestrator。** 新建两份 spec/plan 前先引用 `ai-orchestrator-v1.md` 和 `orchestrator-session-contract.md`，明确复用现有表和接口。
11. **跨仓库任务没有列。** 至少包括：draft provenance、capability 分组、project fieldContracts、delegation allow-list、verification 复用。当前 plan 的文件全部在 connector 仓库。

---

## 四、建议的计划修订

### Milestone 0：事实与契约冻结

- 建立四资源 × 意图 × 执行模式矩阵，但只记录**代码事实**；
- 盘点已有 capability、context、saveContract、命令、E2E；
- 明确复用现有 orchestrator，不新建会话层；
- 产出“版本与并发守卫”一节。

### Milestone 1：统一语义

- `contextVersion` 定义与来源；
- in-band status vs 错误信封；
- draft provenance 决策；
- protected-field taxonomy + 允许变更集；
- `requestedCompletion` 语义；
- CLI 默认 `execute-mode=plan`；
- 未决决策/低置信推断的阻塞规则。

### Milestone 2：project/story preflight

- `nodeId === currentNode.id`；
- project draft 校验接入；
- draft validator 与 adapter-selected saveContract 对齐（多 workbench）；
- project requiredFields（如果要做）；
- topic/story 的版本字段规范化。

### Milestone 3：readback verifier

- executor 改 focused context + 传 normalizedArguments/nodeId；
- 四资源 `patchApplied` 真正比较字段；
- 受保护字段排除合法 completion metadata；
- 复用 `/resources` + focused context 的合并；
- WRITE_RESULT_UNKNOWN 的核验路径写入 runbook。

### Milestone 4：统一 run 结果与 userFacing

- story 路径补齐 status/userFacing/错误类型；
- 修改 `userFacingDisplaySchema`（targetNode、字段名称）或降低目标；
- `audit` / `missingFields` 契约对齐；
- 名称化输出快照测试。

### Milestone 5：E2E

- 复用 `resource-scenario-real-pms` / `story-acceptance-real-pms`；
- 新增 topic/project fixture；
- 按风险区分 project completion（high，必须 confirm）和 development completion（medium，可 auto）；
- 覆盖幂等、冲突、unknown、capability unavailable、audit 定位。

### Milestone 6：Orchestrator

- 扩展 `ai-orchestrator-v1` 到四资源；
- 复用 `pms_ai_plan` / `pms_ai_operation_event` / `PlanView`；
- `agent-progression-run/v1` 作为执行边界，不复制 adapter。

---

## 五、建议的验收矩阵

| 资源 | READ_CONTEXT | UPDATE_NODE_FIELDS | COMPLETE_NODE | 风险/执行 |
| --- | --- | --- | --- | --- |
| project | focused context + 名称 | `node.field.update` | `node.complete-with-data` | update=medium(auto)；complete=high(confirm) |
| requirement | focused context + 名称 | `development-item.node.field.update` | `development-item.node.complete-with-data` | complete=medium(auto) |
| topic | focused context + 名称 | 同上 | 同上 | `topic-design-review` 需要领域确认 |
| story | focused context + story workbench | story workbench / `development-item.node.field.update` | `development-item.node.complete-with-data` | 按 workbench completionMode |

每个资源至少覆盖：

- 成功路径（plan → execute → readback → audit）；
- 缺失必填字段 → `NEEDS_INPUT`，零 preview；
- 高风险 → `WAITING_CONFIRMATION`，auto 不执行；
- 幂等重放；
- 版本冲突 → `CONFLICT`；
- 回读不一致 → `WRITE_RESULT_UNKNOWN`；
- capability unavailable；
- project 的 `solution-decision` / `custom-fields` / `project-basic-info` 排除路径。

---

## 六、实施前必须确认的决策清单

- [ ] 是否保留 `agent-progression/v1` 并扩展字段，还是升到 `v2`？
- [ ] draft provenance 走后端持久化、CLI 本地持久化，还是明确降级？
- [ ] `operation auto` / `resource-write` 是否允许绕过 progression？如果允许，如何补 draft 校验？
- [ ] `run` 的默认 `execute-mode` 是否改为 `plan`？
- [ ] 未决决策和低置信高风险推断是 `NEEDS_INPUT` 还是 `WAITING_CONFIRMATION`？
- [ ] `requestedCompletion=false` 的语义：拒绝完成、降级为字段更新，还是删除字段？
- [ ] `contextVersion` 唯一语义与来源；CLI `--version` 接受字符串还是数字？
- [ ] 四资源是否统一要求 `nodeId === currentNode.id`？
- [ ] project 的 `fieldContracts/requiredFields` 是否由后端补齐？
- [ ] project capability 是否从 `project_node` 改挂到 `project`？
- [ ] 远程委派是否需要 preview/orchestrator 路由？是否在 Phase 1 范围内？
- [ ] story 路径是否收敛到统一 adapter，还是保留独立实现但统一结果契约？

---

## 七、证据索引

### pms-ai-connector

| 文件 | 关键位置 |
| --- | --- |
| `apps/pms-cli/src/commands/scenarios/agentProgression.ts` | project preflight null（:49-51）、draft plan 跳过（:55-57）、contextVersion 检查（:245）、intent→command（:317-327） |
| `apps/pms-cli/src/commands/scenarios/resourceScenarioExecutor.ts` | before/after 非 focused（:103-108,126-134）、verifyReadback 传 `{}`（:106） |
| `apps/pms-cli/src/commands/scenarios/projectScenarioAdapter.ts` | focused context（:49-53）、缺 currentNode 校验（:117-129）、verifyReadback（:139-157）、protected 比较（:290-295） |
| `apps/pms-cli/src/commands/scenarios/requirementScenarioAdapter.ts` | currentNode 校验（:146-151）、patchApplied（:183）、protected 列表（:397-400） |
| `apps/pms-cli/src/commands/scenarios/topicScenarioAdapter.ts` | currentNode 校验（:139-141）、patchApplied（:169-170）、protected 列表（:359-361） |
| `apps/pms-cli/src/commands/scenarios/storyProgressionAdapter.ts` | 独立路径（:23-124）、generic Error（:175-189）、缺 currentNode 校验（:167-201） |
| `apps/pms-cli/src/commands/scenarios/storyWorkbench.ts` | patchApplied（:298-299）、protected 列表（:415-418） |
| `apps/pms-cli/src/commands/scenarios/AgentDraftContract.ts` | missingSources（:99-102）、状态判定（:144-163）、首个 saveContract 组件（:288-292）、敏感 key 正则（:241-264） |
| `apps/pms-cli/src/cli/runCli.ts` | 默认 auto（:831,:900）、`--version` 仅数字（:845,:864,:883,:923） |
| `apps/pms-cli/src/commands/core/agentContext.ts` | contextVersion 生成（:217-222）、MISSING_CONTEXT_VERSION（:29-35） |
| `packages/pms-contracts/src/agentProgression.ts` | draft schema（:70-90）、result schema（:113-138） |
| `packages/pms-contracts/src/agentProgressionRun.ts` | run schema（:35-55） |
| `packages/pms-contracts/src/userFacing.ts` | 缺 targetNode/字段（:15-23） |
| `packages/pms-client/src/PmsClient.ts` | preview/execute 不含 draft（:233-248,:398-410） |
| `tests/e2e/resource-scenario-real-pms.test.ts` | 已有 requirement/topic/project E2E（:29） |
| `tests/e2e/story-acceptance-real-pms.test.ts` | 已有 story acceptance E2E（:25） |

### pms-backend

| 文件 | 关键位置 |
| --- | --- |
| `src/main/java/com/brad/pms/ai/command/PmsCommandMetadata.java` | node 命令分组 `project_node`（:49-55）、project 命令风险（:165-202） |
| `src/main/java/com/brad/pms/ai/connector/AiConnectorCapabilityService.java` | mode 恒为 automatic（:75-78） |
| `src/main/java/com/brad/pms/ai/connector/AiConnectorQueryService.java` | project 完整投影（:250-274）、topic/story 稀疏投影（:299-323） |
| `src/main/java/com/brad/pms/ai/connector/context/AiProjectComponentReader.java` | project saveContract（:174-204）、未暴露 workbench（:95-121） |
| `src/main/java/com/brad/pms/ai/connector/context/AiDevelopmentComponentReader.java` | development saveContract（:121-262） |
| `src/main/java/com/brad/pms/ai/connector/context/ContextReadOptions.java` | focused/legacy、componentKey 约束（:11-29） |
| `src/main/java/com/brad/pms/ai/connector/context/AiContextNodeSelector.java` | currentNode vs selectedNodeId（:29-56） |
| `src/main/java/com/brad/pms/ai/command/PmsCommandVersionGuard.java` | 版本比较（:8-16） |
| `src/main/java/com/brad/pms/ai/command/node/NodeFieldUpdateCommand.java` | preview 版本快照（:58-87）、execute 校验（:174-198） |
| `src/main/java/com/brad/pms/ai/command/node/CompleteNodeWithDataCommand.java` | 前置条件（:107-118）、execute 校验（:226-246） |
| `src/main/java/com/brad/pms/ai/command/development/CompleteDevelopmentItemNodeWithDataCommand.java` | 开发项完成（:33-146） |
| `src/main/java/com/brad/pms/ai/orchestrator/service/AiOrchestratorVerificationService.java` | 现有 patch 回读验证（:30-72,:187-200） |
| `src/main/java/com/brad/pms/ai/connector/AutomaticCommandExecutionService.java` | high-risk 自动执行拒绝（:31-33）、节点必须具体上下文（:59-73） |
| `src/main/java/com/brad/pms/ai/connector/AiDelegationRoutePolicy.java` | 委派 allow-list（:37-55） |
| `docs/agent-contracts/orchestrator/ai-orchestrator-v1.md` | 现有 orchestrator 对象/接口/表 |
| `docs/agent-contracts/pms/project-kickoff.md` | project 命令与节点契约 |

---

## 八、值得保留的设计

- CLI 不持有模型凭据、不调用模型，边界清晰；
- preview → idempotent execute → readback 主链路正确；
- 名称优先、ID 仅作为机器字段；
- 每个实施任务“实现 → 聚焦测试 → review → 回归”的节奏合理；
- 第一阶段与后续 Orchestrator 分阶段，避免把协议收口和会话层混做；
- 现有 `resource-scenario` adapter、`saveContract`、幂等/审计基础扎实，第一阶段本质上是“收口”而非“重写”。
