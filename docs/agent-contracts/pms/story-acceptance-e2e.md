# Story acceptance completion E2E

This check proves the "story-workbench/v1" vertical slice through a disposable PMS:

1. Read the focused acceptance context and its saveContract.
2. Create a development-item.node.complete-with-data preview from the server-declared completion command.
3. Execute the preview with acceptance fields, owner, schedule and one idempotency key.
4. Read the story and focused context back, including the next current node.
5. Replay the same preview and idempotency key without creating a second operation.

Run it only against an isolated, disposable database:

    PMS_E2E_STORY_ACCEPTANCE=true \
    PMS_E2E_WRITE=true \
    PMS_E2E_ISOLATED=true \
    PMS_E2E_CREATE_STORY_FIXTURE=true \
    PMS_E2E_DATABASE_CLEANUP_CONFIRMED=true \
    pnpm exec vitest run tests/e2e/story-acceptance-real-pms.test.ts --maxWorkers=1 --minWorkers=1

The required target, account and browser settings are the same as the other isolated E2E suites (PMS_E2E_BASE_URL, PMS_E2E_ALLOWED_BASE_URL, PMS_E2E_AUTH_ORIGIN, PMS_E2E_DATABASE_NAME, PMS_E2E_ALLOWED_DATABASE_NAME, PMS_E2E_ACCOUNT_ID, and PMS_E2E_RUN_ID). When using an existing story instead, set PMS_E2E_CREATE_STORY_FIXTURE=false and provide PMS_E2E_STORY_ID.

The test must stay skipped when the explicit opt-in flag is absent. It must fail closed when the write, isolation, target or cleanup gates are missing; it must never fall back to a shared PMS database.
