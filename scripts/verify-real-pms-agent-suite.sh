#!/usr/bin/env bash
set -euo pipefail

# Runs the four-resource acceptance suite against one explicitly isolated PMS.
# The five E2E files keep their own domain assertions; this script only fixes
# the safety gate, fixture mode and serial execution order in one entry point.

required_env=(
  PMS_E2E_BASE_URL
  PMS_E2E_ALLOWED_BASE_URL
  PMS_E2E_AUTH_ORIGIN
  PMS_E2E_DATABASE_NAME
  PMS_E2E_ALLOWED_DATABASE_NAME
  PMS_E2E_ACCOUNT_ID
  PMS_E2E_RUN_ID
  PMS_E2E_DB_URL
)

for name in "${required_env[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "统一真实验收缺少配置: $name" >&2
    exit 2
  fi
done

if [[ "${PMS_E2E_WRITE:-}" != "true" || "${PMS_E2E_ISOLATED:-}" != "true" ]]; then
  echo "统一真实验收必须设置 PMS_E2E_WRITE=true 和 PMS_E2E_ISOLATED=true" >&2
  exit 2
fi
if [[ "${PMS_E2E_DATABASE_CLEANUP_CONFIRMED:-}" != "true" ]]; then
  echo "统一真实验收创建夹具前必须设置 PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true" >&2
  exit 2
fi
export PMS_E2E_RESOURCE_SCENARIO=true
export PMS_E2E_CREATE_RESOURCE_FIXTURES=true
export PMS_E2E_CREATE_FIXTURE=true
export PMS_E2E_STORY_ORCHESTRATOR=true
export PMS_E2E_CREATE_STORY_FIXTURE=true
export PMS_E2E_PROJECT_ORCHESTRATOR=true
export PMS_E2E_CREATE_PROJECT_ORCHESTRATOR_FIXTURE=true
export PMS_E2E_TOPIC_ORCHESTRATOR=true
export PMS_E2E_CREATE_TOPIC_ORCHESTRATOR_FIXTURE=true

exec pnpm exec vitest run \
  tests/e2e/resource-scenario-real-pms.test.ts \
  tests/e2e/orchestrator-requirement-analysis.e2e.test.ts \
  tests/e2e/orchestrator-story-node.e2e.test.ts \
  tests/e2e/orchestrator-project-node.e2e.test.ts \
  tests/e2e/orchestrator-topic-node.e2e.test.ts \
  --maxWorkers=1 --minWorkers=1
