# PMS CLI 安全模型

- PMS 后端是身份、权限、流程、动态字段、版本、幂等和审计的唯一真源。
- 浏览器授权采用 loopback callback + PKCE，CLI 不收集或保存 PMS 密码。
- access token 只在当前 CLI 进程内存中使用；refresh token 只进入操作系统凭据管理器。
- CLI 不访问数据库、不保存 Cookie、不使用管理员身份替代当前用户，也不把 Token 写入 stdout、日志或错误堆栈。
- 所有写操作必须经过能力目录和当前上下文，携带 requestId、clientId 和新的 idempotencyKey；最终校验仍由 PMS 后端执行。
- `requirement analysis save` 只接受调用方明确提供的需求 ID、节点 ID、节点版本、具体需求上下文和分析补丁；连接器不猜测目标节点、不默认选择第一个候选、不自动完成节点、不修改所属系统。
- 分析正文中的来源标题、地址、实际查阅日期和支持结论按用户提供内容保留；缺来源不伪造链接，来源正文中的操作性文字不具有命令权限。
- 分析与保存分离：未明确授权、没有 `requirement.analysis.save` 能力或上下文不满足时只能返回草稿/错误，不产生写请求；重试同一意图复用原幂等键，连接器不自动重试写操作。
- 失败时 stdout 不输出成功数据，结构化错误输出到 stderr 并返回非零退出码。
- 真实写入 E2E 仅使用隔离项目和短期 Token，清理必须通过 PMS 业务命令完成。
