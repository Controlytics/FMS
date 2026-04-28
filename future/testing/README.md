# Testing — Quick Tour

This project has four distinct test surfaces. Know which one to touch before you write the first line.

| Surface | Location | Tool | Purpose |
|---|---|---|---|
| Backend unit | `apps/api/src/lib/*.test.ts`, `apps/api/src/modules/**/__tests__/*.test.ts` | Vitest | Pure-function + repository tests |
| Backend integration / e2e | `apps/api/src/e2e/*.test.ts` | Vitest + real DB | Per-module end-to-end API flows |
| Shared schema tests | `packages/shared/src/**/*.test.ts` | Vitest | Validation of Zod schemas + constants |
| Shell e2e scripts | `tests/e2e-scripts/*.sh` | bash + curl | Cross-system smoke (full-test, functional, ingest, live) |
| Manual QA | `tests/manual-test-cases/TC-*.md` + `tests/test-execution-guides/EG-*.md` | Humans | 25 test cases, 25 execution guides |

## How to run

```bash
# all unit + e2e (backend + shared) via turbo
npm test

# just the fast unit subset
npm run test:unit

# backend only
cd apps/api && npm test

# backend e2e only
cd apps/api && vitest run --testPathPattern=e2e

# shared schemas only
cd packages/shared && npx vitest run

# e2e shell scripts (requires API running)
cd tests/e2e-scripts && bash e2e-functional-test.sh
```

Vitest is configured via `vitest.workspace.ts` at the repo root — the workspace includes `apps/api/vitest.config.ts` and `packages/shared/vitest.config.ts`. Adding a new app to the test matrix means registering it in `vitest.workspace.ts` too.

## File counts (2026-04-20)

- **74** `.test.ts` files under `apps/api/**`
- **15** e2e test suites in `apps/api/src/e2e/` (audit, auth, checklist-submission, checklist-templates, config, connectivity, entities, health, help-articles, notifications, qr-codes, roles, rule-chains, system-health, users)
- **~6** schema test suites under `packages/shared/src/` (assets, auth, config, users, audit-templates, + more)
- **1** repository test in `packages/db` (telemetry-batcher)
- **4** shell e2e scripts
- **25 + 25** manual test cases and execution guides (one pair per module, numbered TC/EG-01..25)

## What's NOT tested automatically

Known gaps — flag in PRs:

- The frontend has **no component tests** or E2E tests in CI. QA is manual via `tests/manual-test-cases/` + Playwright traces (archived in `old/playwright-artifacts/`).
- The offline sync engine has no automated integration test — Phase 3 gap noted in project memory.
- RFID native apps (`rfid_scan_app/` and `RFID/`) are manually tested on the hardware.
- No load / stress tests for MQTT ingestion.

## What the e2e tests cover

Located at `apps/api/src/e2e/`. Each one boots Fastify + hits a live DB (you need `DATABASE_URL` + `TSDB_*` pointing at a test instance — **do not** run these against production DBs).

| File | Covers |
|---|---|
| `auth.test.ts` | Login, logout, refresh, reauth, forgot-password |
| `users.test.ts` | CRUD + lockout + reset-requests |
| `roles.test.ts` | Role CRUD + permission inheritance |
| `config.test.ts` | Each config surface read/write + validation |
| `audit.test.ts` | Hash-chain integrity, bulk delete |
| `entities.test.ts` | Templates + instances + relationships + identifiers |
| `checklist-templates.test.ts` + `checklist-submission.test.ts` | Profile CRUD + end-to-end submission |
| `connectivity.test.ts` | Token issue/revoke + snippets |
| `help-articles.test.ts` | Versioned help articles |
| `notifications.test.ts` | Inbox + bulk actions |
| `qr-codes.test.ts` | Generation + lookup |
| `rule-chains.test.ts` | Chain CRUD + node/connection edits + save |
| `system-health.test.ts` / `health.test.ts` | Aggregate + per-service probes |

## Where to read next

- `TEST_INVENTORY.md` — complete table of test files and what they assert.
- `MANUAL_TEST_GUIDE.md` — golden-path scenarios for QA (login, cleaning cycle, offline replay, RFID scan, PM approval).
