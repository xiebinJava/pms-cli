# 真实 PMS CLI Agent E2E

这份流程验证真实的 `pms-cli` 构建产物，而不是直接调用 TypeScript 函数。测试会通过浏览器完成 CLI OAuth 授权，然后用 CLI 完成：

```text
capabilities
→ scenario project-create plan
→ scenario project-create execute（绑定 preview）
→ get project
→ context project（读取回读）
→ operation preview project.delete
→ operation execute（绑定 preview）
```

测试只写入一次性隔离数据库，成功和失败都会尝试清理创建的项目。

## 启动隔离 PMS

在 `pms-backend` 仓库准备好构建产物后运行：

```bash
cd /Users/fs/Desktop/Project/pms-backend

PMS_E2E_RUN_ID=codex20261015d \
PMS_E2E_MYSQL_USER=pms_e2e \
PMS_E2E_MYSQL_PASSWORD='local-only-password' \
PMS_E2E_MYSQL_ROOT_PASSWORD='local-only-root-password' \
PMS_E2E_JWT_SECRET='local-only-jwt-secret-at-least-32-characters' \
PMS_E2E_ADMIN_EMAIL=codex-e2e@example.test \
PMS_E2E_ADMIN_PASSWORD='codex-e2e-password-2026' \
PMS_E2E_API_PORT=18080 \
PMS_E2E_MYSQL_PORT=13306 \
PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173 \
PMS_E2E_FOREGROUND=true \
./scripts/start-ai-e2e.sh
```

`PMS_E2E_RUN_ID` 每次应使用新的安全值，避免复用旧的数据库卷。密码示例只用于本地隔离环境，不要提交到仓库或用于共享环境。

## 启动授权页面

CLI OAuth 的授权页面属于前端路由，因此需要把前端代理到隔离 PMS：

```bash
cd /Users/fs/Desktop/Project/pms-front
VITE_PORT=15173 \
VITE_PROXY_TARGET=http://127.0.0.1:18080 \
npm run dev -- --host 127.0.0.1
```

测试输出 `PMS_E2E_AUTH_URL=...` 后，在浏览器打开该 URL，登录隔离管理员并点击“同意并继续”。回调地址是 CLI 临时启动的本地端口，授权页跳转后页面显示连接失败是预期现象；CLI 本地回调已经收到授权码并会继续执行测试。

## 运行测试

在 `pms-ai-connector` 仓库执行：

```bash
npm run build:cli

PMS_E2E_BASE_URL=http://127.0.0.1:18080/api \
PMS_E2E_ALLOWED_BASE_URL=http://127.0.0.1:18080/api \
PMS_E2E_AUTH_ORIGIN=http://127.0.0.1:15173 \
PMS_E2E_DATABASE_NAME=pms_ai_e2e_codex20261015d \
PMS_E2E_ALLOWED_DATABASE_NAME=pms_ai_e2e_codex20261015d \
PMS_E2E_ACCOUNT_ID=1 \
PMS_E2E_RUN_ID=codex20261015d \
npm run verify:real-pms:cli
```

测试会让构建后的 CLI 自己执行 `pms auth login`，并把授权 URL 输出到测试日志；CLI 在测试环境可以通过 `PMS_CLI_KEYRING_SERVICE` 指定独立的系统 keyring service，避免污染本机默认的 `pms-cli` 登录状态。普通用户无需设置这些变量。

手动登录时，CLI 使用的是 `PMS_AUTH_ORIGIN`（而不是 `PMS_E2E_AUTH_ORIGIN`）：

```bash
PMS_BASE_URL=http://127.0.0.1:18080/api \
PMS_AUTH_ORIGIN=http://127.0.0.1:15173 \
pms auth login
```

## 停止环境

```bash
cd /Users/fs/Desktop/Project/pms-backend
PMS_E2E_RUN_ID=codex20261015d ./scripts/stop-ai-e2e.sh
```

停止脚本会删除本次隔离服务和数据库卷。不要把共享开发数据库作为写入 E2E 的目标。
