# Existing automated-test coverage map

Read-only discovery, 2026-10-19, branch `RFID`. Nothing was executed: every count below comes from `ls`/`find`/`grep` (commands in the footnote). Numbers that can only be learned by running the suite (pass/fail, skipped-at-runtime, coverage %) are marked **unverified**.

## 1. Runners, configs, scripts

| Item | Finding |
|---|---|
| Root workspace | `vitest.workspace.ts` lists 4 projects: `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, `packages/shared/vitest.config.ts`, `tests/integration/vitest.config.ts`. `vitest` is NOT a root devDependency (root has only `madge` + `turbo`); it is hoisted from the workspaces. |
| Root scripts | `test` = `turbo run test` (runs each workspace's own `test`); `test:unit` = `turbo run test --filter=@digilog/shared --filter=@digilog/api`; `lint` = `turbo run lint` (each workspace's `lint` is `tsc --noEmit`, i.e. a typecheck, not ESLint); `check:cycles` = `madge --circular … packages/queue/src` — **stale**: `packages/queue` no longer exists (only `packages/shared` is under `packages/`). No root `coverage` or `typecheck` script. |
| API (`apps/api/package.json`) | `test` = `vitest run --pool=forks --poolOptions.forks.singleFork=true`; `test:coverage` = same + `--coverage`; `test:e2e` = same + `--testPathPattern=e2e` — **`--testPathPattern` is a Jest flag, not a Vitest one; this script is probably broken (unverified; not run)**. `lint` = `tsc --noEmit`; `lint:js` = eslint with `--max-warnings 10000`. |
| Web (`apps/web/package.json`) | `test` = `vitest run`; `test:watch` = `vitest`; `test:coverage` = `vitest run --coverage`; `lint` = `tsc --noEmit`; `lint:js` = eslint. |
| Shared (`packages/shared/package.json`) | `test` = `vitest run`; `lint` = `tsc --noEmit`. No coverage script. |
| API vitest config | `environment: node`, `globals: true`, `include: src/**/*.test.ts`, `fileParallelism: false`, `testTimeout: 30000`, `setupFiles: ./vitest.setup.ts`, `globalSetup: ./vitest.global-setup.ts`. |
| Web vitest config | `environment: jsdom`, `@vitejs/plugin-react`, `@` alias → `src`, `@digilog/shared` aliased to the shared **TS source**, `include: src/**/*.test.{ts,tsx}`, `setupFiles: ./src/test-setup.ts` (registers `@testing-library/jest-dom/vitest`). Separate from `vite.config.ts` on purpose (that one reads mkcert certs at load). |
| Shared vitest config | `environment: node`, `include: src/**/*.test.ts`. No coverage block. |
| Integration vitest config | `include: *.test.ts` in `tests/integration`, reuses `apps/api/vitest.setup.ts`, own `vitest.global-setup.ts` that is a **no-op unless `INTEGRATION_TEST=1`**; `testTimeout` 120 s, `fileParallelism: false`. |
| **Which DB the API tests use** | `apps/api/vitest.env.ts` (imported by both `vitest.setup.ts` per-worker and `vitest.global-setup.ts` once) loads `apps/api/.env` and rewrites `DATABASE_URL` from `digilog_db` → **`digilog_test_db`** before any PrismaClient is built. It also defaults `JWT_SECRET` / `VERIFICATION_TOKEN_SECRET`. `vitest.global-setup.ts` then upserts the fixtures: role `VIEWER`, user `admin`/`Admin@123` (SUPER_ADMIN), user `RB0001`/`Test@1234` (OPERATOR); it throws if the `SUPER_ADMIN` role is missing ("run `npx tsx prisma/seed.ts`"). |
| **Coverage** | `@vitest/coverage-v8` is a devDependency of api and web. Both `vitest.config.ts` files carry a `coverage` block: `provider: 'v8'`, `reporter: ['text', 'text-summary']`, `include: src/**/*.{ts,tsx}`, `exclude: tests, __tests__, *.d.ts, src/e2e/test-helper.ts`. **No thresholds anywhere. No html/lcov reporter configured.** Shared and integration have no coverage config. |

### How to run each suite (exact scripts found)

```bash
# API — the only stable invocation (single fork; shared `admin` session race otherwise)
cd apps/api && npm test
cd apps/api && npm run test:coverage          # text + text-summary to stdout
cd apps/api && npx vitest run --pool=forks --poolOptions.forks.singleFork=true src/e2e   # e2e only (positional filter; the test:e2e script's flag is Jest syntax)

# Web
cd apps/web && npm test
cd apps/web && npm run test:coverage
cd apps/web && npx vitest run src/routes/version-history/__tests__/diff.test.ts   # single file

# Shared
cd packages/shared && npm test

# Integration (gated; without the env var it registers 1 skipped suite and exits 0)
INTEGRATION_TEST=1 npx vitest run --project tests/integration   # from repo root via the workspace — "--project" usage unverified
#   or from the folder:  cd tests/integration && INTEGRATION_TEST=1 npx vitest run

# Everything via turbo
npm test            # repo root
```

To get an HTML or lcov coverage report you would have to add `html` / `lcov` to the `reporter` array in each `vitest.config.ts` (or pass Vitest's `--coverage.reporter` CLI option — not verified here). Neither exists today, so there is no coverage artifact to read; producing one requires a run.

Prerequisites for the API suite: PostgreSQL with `digilog_test_db` migrated and seeded (`DATABASE_URL=…/digilog_test_db INITIAL_ADMIN_PASSWORD=Admin@123 npx tsx prisma/seed.ts`), `apps/api/.env` present. Last documented baseline (apps/api/CLAUDE.md, 2026-09-04): API 1468 passing / 0 failed / 16 skipped over 141 files; web 816/816 over 63 files. File counts have since grown to 164 (api) and 75 (web) — **the pass counts are stale and unverified**.

## 2. API tests

### File counts

| Area | Files |
|---|---|
| `apps/api/src/e2e/*.test.ts` | 41 (the brief said 42; `ls` says 41 + `test-helper.ts`) |
| `apps/api/src/lib/` (`__tests__/` 14 + `*.test.ts` 16) | 30 |
| `apps/api/src/plugins/__tests__/` | 2 |
| `apps/api/src/__tests__/` | 2 |
| `apps/api/src/modules/**` | 89 |
| **Total `apps/api/src`** | **164** |
| `tests/integration` | 1 |

### e2e harness

`apps/api/src/e2e/test-helper.ts` builds Fastify in-process (`buildApp()`, `app.inject`, no listening socket) and exports `loginAs`, `obtainOfflineGrant`, `authGet/Post/Put/Delete`, `ADMIN_PASSWORD`. **It mounts only 11 route modules**: auth, users, config, audit, roles, assets, notifications, notification-settings (notification-delivery), user-groups, backup, system-health. Every e2e that needs filters / hierarchy / super-admin / help / admin-requests / sync builds its own Fastify instance inside the file (same pattern, see `e2e/bulk-operate.test.ts`, `modules/filter-operations/__tests__/ahu-completion-gate.e2e.test.ts`). Consequence: pm-schedules, stage-approvals, equipment-groups, dashboards, debug-traces, ldap, notification-rules, report-reviews, replacement-schedule (except `blocked-filters`), block-change-requests, guest, uploads, deployment-check, filter-profiles, cleaning-profiles and checklist-profiles **are never mounted by any HTTP-level test**.

### e2e files → endpoints driven

| File | First describe | URLs driven (from literal `/api/...` strings; `x` = interpolated id) |
|---|---|---|
| access-matrix-reauth | PUT /api/config/access-matrix requires a signature | config/access-matrix |
| admin-request-role-only | Contact Admin — Modify User is role-only | admin-requests, admin-requests/user-lookup |
| admin-request-temp-password-length | temp password length = policy minLength | **no HTTP** — calls `adminRequestService` directly |
| audit-chain | Audit hash chain — C3 | audit/verify-chain |
| audit-export-log | POST /api/audit/report-export-log | audit/report-export-log |
| audit-trail-gaps | Audit-trail gap closures | notification-settings/logs/:id, user-groups (CRUD + members) |
| audit | Audit Trail endpoints | audit (list, :id, bulk-delete) |
| auth-profile-reauth | H1 — PUT /api/auth/profile reauth gate | auth/login, me, offline-grant, profile |
| auth | Auth endpoints | auth/login, logout, beacon-logout, verify, me, profile, change-password, forgot-password |
| bulk-operate | POST /api/filters/bulk-operate | filters/bulk-operate |
| bulk-upload-scope-route | bulk-upload-filters — scope + hierarchy permission | assets/instances/bulk-upload-filters, auth/login |
| c2-retire-replace-bulk-upload-reauth | C2 — Retire / Replace / Bulk-Upload reauth gates | filters/:id/retire, filters/:id/replace, assets/instances/bulk-upload-filters |
| checklist-submission | Checklist Submission E2E | **no HTTP** — pure-data answer-shape assertions (19 HTTP tests were deleted 2026-07-02 per its header) |
| cleaning-profile-assignment-current | GET …/cleaning-profile-assignment/current | config/cleaning-profile-assignment, …/current |
| config-reauth-gates | config writes that require a signature | config/audit-templates, field-ids, field-ids/:id, report-signatories, tablet-access |
| config | Config endpoints | config/action-reauth (+check, my-actions), audit-templates (+current), branding, datetime (+current), field-ids, login-security, my-config, pagination (+current), password-policy, roles, roles/:name, session, user-id (+next, validate), users/:id; auth/me |
| entities | Entity Management endpoints | assets/templates, assets/instances, instances/tree, assets/identifiers (7 instance-CRUD cases `it.skip`) |
| error-leak-prisma | VAPT-5 — Prisma errors do not leak | users |
| field-ids-current | GET /api/config/field-ids/current | config/field-ids, …/current |
| filter-partial-update | attributes merged, not replaced | hierarchy/filters/:id |
| filter-replace-duplicate-name | duplicate-name guard | filters/:id/replace |
| health | Health endpoint | health |
| help-articles | Help Articles E2E | help (list, :id, :id/versions) |
| list-view-permissions | Retirement / Replacement list View permissions | filters/retirements, filters/replacements |
| m1-m2-reauth-action-rename | audit-correct reauth action keys | admin-requests/:id/process, assets/instances/:id/lifecycle-state |
| notification-config-audit-masking | audit secret masking | notification-settings/email, …/sms |
| notifications | Notifications endpoints | notifications (list, :id, read/unread, bulk-read/unread/delete, mark-all-read, unread-count) |
| password-expiry-sweep | password-expiry sweep (real DB) | **no HTTP** — calls `sweepPasswordExpiryNotifications` |
| pending-filter-not-operable | pending-review filter is not operable | filters/:id/retire, :id/replace, assets/identifiers |
| phase2-filter-operations | Filter Operations route-level e2e | filters/:id/start-cycle, advance, bypass, submit-checklist, terminate-cycle, current-state |
| phase3-rfid-offline | RFID & Offline | assets/identifiers, identifiers/lookup/:code, identifiers/:id (1 `it.skip`) |
| phase4-perms-themes-reports | Permissions / Themes / Reports | config/branding, registry/manifest, report-page-titles (+current); filters/:id/start-cycle; users; health |
| phase5-decision-tape-backup | Decision Tape + Backup + Sync | backup/export, restore, validate; filters/cycles, events, :id/advance, :id/current-state; sync/since |
| replacement-audit-enrichment | replacement-schedule audit read-side | audit |
| retire-replace-identifier-invariant | RFID identifier ownership invariant | filters/:id/retire, :id/replace |
| roles | Roles endpoints | roles (list, :name, active, permissions/all, :name/creatable) |
| super-admin-data-delete | DELETE super-admin/data/notifications/:id | super-admin/data/notifications/:id |
| super-admin-unretire | POST …/retirements/:id/unretire | super-admin/filter-data/retirements/:id/unretire |
| system-health | System Health endpoints | system-health |
| tablet-login-access | tablet login refused before session check | auth/login, auth/me |
| users | Users endpoints | users (list, :id, stats, reset-requests, reset-requests/pending, :id/disable, enable, unlock, reset-password) |

### Module → unit tests → e2e → gaps

"Unit" = files under the module dir. "URL-hit" = inventory operations whose path is matched by a literal `/api/...` string in ANY test file (e2e or module). "Untested ops" therefore means **no HTTP-level test at all**; service-level unit tests may still exist (noted).

| Module | Ops (inventory) | Unit test files in module | e2e files touching it | Ops with no URL hit | Notes on remaining gap |
|---|---|---|---|---|---|
| admin-requests | 5 | 1 (`request-subject`: describeRequestSubject) | admin-request-role-only, m1-m2-reauth, admin-request-temp-password-length (service) | 1 | `GET /pending-count` |
| assets | 25 | 15 (helpers: attribute-validator, cycle-detection, descendant-collector; repos: identifier/instance/relationship/template; services: filter, filter-fields, filter-upload-template, identifier, instance, template, bulk-upload-filter-scope.e2e, filter.service update-audit) | entities (7 skipped), phase3-rfid-offline, bulk-upload-scope-route, c2-…, pending-filter-not-operable, filter-replace-duplicate-name, m1-m2 | 12 | **Filter approval workflow entirely unhit over HTTP**: `pending-approval`, `approval-counts`, `review`, `approve`, `reject`, `:id/resubmit`; also `track-record`, `bulk-upload-filters/validate`, `filter-upload-template.xlsx`, `:id/children`, `PATCH :id/status`, `GET templates/:id` |
| audit | 9 | 0 | audit, audit-chain, audit-export-log, replacement-audit-enrichment | 2 | `POST /:id/redact`, `POST /bulk-redact` (the chain-preserving path has no test; hard-delete does) |
| auth | 10 | 3 (auth.repository, auth.service, password-expiry-sweep) | auth, auth-profile-reauth, tablet-login-access | 1 | `POST /refresh` |
| backup | 3 | 5 (backup-chain, helpers, repository, service, pg-tools) | phase5-decision-tape-backup | 0 | — |
| block-change-requests | 5 | 1 (`approval-consume`: consumeApprovalTx) | — | 5 | whole module unhit over HTTP (list, create, pending-count, approve, reject) |
| checklist-profiles | 11 | 1 (`checklist-profile.service`: versioning) | — | 6 | question CRUD, reorder, versions, versions/:n |
| cleaning-profiles | 8 | 1 (`pipeline-connections`) | — | 6 | get/put/delete `:id`, toggle-status, versions, versions/:n |
| config | 101 | 6 (config.repository, config.service, backup-format-current.e2e, block-change-approval-current.e2e, dynamic-config-strips-transport-fields, config-redact-secrets) | config, config-reauth-gates, access-matrix-reauth, field-ids-current, cleaning-profile-assignment-current, phase4 | 45 | all `dynamic/*` GET+PUT for backup-format, export-limit, filter-approval, filter-cleaning-reasons, filter-field-options, guest-cleaning-requests, pm-schedule-approval, pm-schedule-settings, qnn-notifications, replacement-schedule-approval, stage-interlock; static export-limit, export-options, offline-cache, pm-schedule-filters, replacement-schedule-filters (+ `/current`), dashboard-cards, report-labels, report-signatories/resolved, access-matrix/my-modules, tablet-access/my-features, password-policy/current |
| dashboards | 13 | 1 (`mass-assignment`: body-schema `additionalProperties`) | — | 13 | whole module unhit |
| debug-traces | 6 | 0 | — | 6 | **zero tests of any kind** |
| deployment-check | 1 | 1 (`environment-port`) | — | 1 | route unhit |
| equipment-groups | 10 | 3 (create-always-active, instrument-fetch SSRF, set-active-in-use-guard) | — | 10 | whole module unhit over HTTP (incl. `test-url`, `fetch-readings`) |
| filter-operations | 26 | 20 (advance-with-checklist-atomic, ahu-completion-gate(.e2e), ahu-interlock-advance-gate, batch-states-fanout, concurrent-operator, deep-review-d5-d7, disabled-checklist-skipped, dry-in-first-stage-duration, get-current-state, helpers, start-cycle-replacement-gate, tape-version-check, terminal-checklist-advance-persistence, wash-in-readings-mid-cycle, without-final-checklist, cycle-write/bulk-operate, cycle-write/start-equipment-pin, tape/tape-generator, tape/tape-parity) | phase2, phase5, bulk-operate, c2, list-view-permissions, pending-filter-not-operable, retire-replace-identifier-invariant, filter-replace-duplicate-name | 9 | `GET batch-states` (unit-tested, no HTTP), `cleaning-record`, `cycles/:id`, `dashboard-stats`, `field-options`, `manual-status-changes`, `reasons`, `:id/stage-options`, `POST ahu-set-availability` |
| filter-profiles | 8 | 0 | — | 8 | **zero tests of any kind** |
| guest | 1 | 0 | — | 1 | **zero tests of any kind** (`POST /guest/cleaning-request`, public) |
| help | 6 | 0 | help-articles | 0 | — |
| hierarchy | 12 | 2 (hierarchy.routes: tree/blocks + limit cap; create-filter.routes) | filter-partial-update | 5 | `GET ahus`, `ahus/:id`, `areas`, `areas/:id`, `blocks/:id` |
| ldap | 4 | 3 (escape, group-match, provision-audit) | — | 4 | config GET/PUT, status, test-connection unhit |
| notification-delivery | 18 | 1 (`sms-http-gateway`) | notification-config-audit-masking, audit-trail-gaps | 13 | oauth2 (4), email/test, sms/test, send, logs, logs/stats, templates CRUD |
| notification-rules | 8 | 0 | — | 8 | **zero tests of any kind** |
| notifications | 9 | 2 (repository, service) | notifications | 0 | — |
| pm-schedules | 28 | 6 (overwrite-qnn, pm-deviations, pm-import-guards, pm-schedule-crud, pm-separation, upload-role) | — | 28 | **no HTTP test for any PM endpoint**; logic covered at service level (separation, import guards, crud validation, deviations, QNN overwrite, upload role) |
| replacement-schedule | 14 | 3 (blocked-filters, blocked-filters-route, bulk-workflow) | replacement-audit-enrichment (reads audit) | 11 | review/approve/reject/resubmit/review-edit/execute, upload-side validate, template.xlsx, export.xlsx, due, tasks |
| report-reviews | 6 | 2 (concurrent-decision, service canViewReportReview) | — | 6 | whole module unhit over HTTP |
| roles | 9 | 2 (repository, service) | roles | 1 | `GET /access-matrix` |
| stage-approvals | 6 | 4 (bulk-decide, list-window, queue-supersede, stage-details) | — | 6 | whole module unhit over HTTP; service covered |
| super-admin | 41 | 1 (`rfid-event-edit`: planRfidEventEdit) | super-admin-data-delete, super-admin-unretire | 38 | Filter Data Management console: every `data/*` list/create/edit/delete except `DELETE data/notifications/:id`; every `filter-data/*` write except unretire; `api-lock`, `stats` |
| sync | 1 | 2 (sync.routes registration, sync.service since()) | phase5 | 0 | — |
| system-health | 1 | 0 | system-health | 0 | — |
| uploads | 1 | 1 (`photo-route-gate`: registration-time permission gate) | — | 1 | no real multipart POST test |
| user-groups | 7 | 0 | audit-trail-gaps | 0 | — |
| users | 15 | 2 (repository, service) | users, error-leak-prisma | 3 | `bulk-delete`, `password-expiry-sweep` (service tested), `reset-requests/:id/process` |
| Health | 1 | — | health | 0 | — |

**Totals: 429 inventory operations; 250 have no URL reference in any test file (58%); 179 do.** Per-module untested counts are in the table; the full 250-item list is in Appendix A.

Modules with **no test file inside the module directory**: audit, debug-traces, filter-profiles, guest, help, notification-rules, system-health, user-groups (8). Of those, audit, help, system-health and user-groups are exercised by e2e; **debug-traces, filter-profiles, guest, notification-rules have zero tests of any kind (4 modules).**

### lib / plugins unit tests (30 + 2)

audit (C3 chain), audit-diff, audit-verify-legacy-key-order, audit-visibility, build-context, date-range-guard, error-schemas, errors, hash-chain (V1/V2/V3), jwt, log-format, log-retention, logger-redaction, mask-secrets, offline-replay-token, offline-time-window (+ `.replay`), password, password-expiry, rate-limit-key, rate-limit-policy (source-text guard on `app.ts`), reauth-audit, reauth-check, refusal-log, sanitize (stripHtml), server-id, ssrf, swagger (fail-closed /docs), tablet-access, user-id-validator; plugins: auth.plugin (`matchesPublicPath`), rbac.plugin. `src/__tests__`: install-baseline (fresh-install JSON), role-effective-permissions (tree-derived map = legacy map per role).

## 3. Web tests (75 files)

| Area | Files | What they cover |
|---|---|---|
| `src/__tests__` | 1 | `route-guard-coverage` — reads `main.tsx` text and asserts every `<Route>` is wrapped in a guard (source-text guard) |
| `components/` | 5 | `sidebar-visibility` (tree vs legacy map), `date-range-filter` (`checkRangeEdge`), `message-dialog` (render), `searchable-select` (`matchOptions` + render) |
| `hooks/` | 4 | `strip-year`, `use-can`, `use-reauth` (`executeWithResult`), `use-rfid-scan-field` |
| `lib/__tests__` | 31 | ahu-block-map, api-base, api-client-reauth-shape, cleaning-cycle-columns (source guard), cleaning-cycle-stage-cell, cleaning-cycle-stage-progress, datetime-input, dev-ports (ini parsing), document-branding, download-name, excel-export-injection (VAPT-1), filter-ancestry, filter-status-scope, local-context (+day2), offline-cache, offline-store (IDB v4), password-policy-source (source guard), password-utils, pdf-winansi (source guard), report-range, report-review, resolve-bulk-targets, rfid-scan, server-discovery, stage-approval-details, sync-engine, sync-since, sync-store-shape (IDB v5), transition-endpoints, url-utils (source guard) |
| `lib/filter-ops/__tests__` | 9 | ahu-completion-check, bulk-operate client, dialog-state (+ property test over 200 random pipelines), next-pending-checklist, resolve-pending-checklist, use-core, use-dryer-autofetch, validate-offline-gate |
| `routes/**` | 25 | see mapping below |

### Route tests → page / helper covered

| Route folder | Test files | Covers |
|---|---|---|
| admin-requests | keyboard-access.test.tsx | keyboard a11y of the page (render) |
| audit | admin-request-summary, audit-helpers, components/audit-detail-modal.tsx, components/audit-table.tsx | `audit-helpers.ts` + two components (render) |
| cleaning-cycles | cycle-detail-terminated, lifecycle-timeline | `cycle-detail-pdf.ts`, `filter-lifecycle.tsx` helpers (`mergeTimeline`, `replacementChain`) |
| config | datetime-super-admin (source guard), can-access-module, roles-components/permissions-tab-coverage | `datetime.tsx` gate text, `can-access-module.ts`, `permission-tree-grouping.ts` |
| filter-management | components/checklist-dialog.tsx, components/drying-filters-panel.tsx, filter-list/dialogs/retire-replace-panel.tsx, filter-list/lib/{lastCleaningDateState, pending-workflow-steps, validate-template-attributes, workflow-row-actions} | 3 dialogs/components (render), 4 pure libs |
| home | FlowChart.tsx, module-flows, viewer-access | module guide catalog + render |
| mobile | cycle-start-refusal (source guard on `mobile-operations.tsx`), server-config.tsx (render), stage-approvals-single-implementation (source guard: `/m` renders the web page) | |
| users | components/user-delete-dialogs.tsx | delete-dialog copy |
| version-history | diff | `diffSnapshots()` |

Only **12 `.test.tsx`** files render React at all; **8 tests are source-text guards** (regex over a source file, no execution): route-guard-coverage, cleaning-cycle-columns, password-policy-source, pdf-winansi, url-utils, datetime-super-admin, cycle-start-refusal, stage-approvals-single-implementation. **No full page is rendered by any test.**

### Route folders / pages with ZERO tests

Route folders (23 incl. `dashboard.tsx`): 9 have at least one test (above); **14 have none**: approvals, auth, checklist-admin, dashboard, debug, deviations, hierarchy-preview, my-tasks, notifications, pm-schedules, profile, report-reviews, stage-approvals, system-health.

Page-level source files (the component a `<Route>` renders) with no test referencing them — **76 of the ~80 page entry files**:

- approvals/index
- auth: login, change-password, contact-admin, forgot-password, guest-request (5)
- checklist-admin: list, detail (2)
- cleaning-cycles: history, timeline, cycle-detail-view (3)
- config (35): access-matrix, action-reauth, ahu-filter-set-config, appearance, audit-templates, backup, branding, cleaning-profile-assignment, dashboard-cards, display-settings, dynamic-config, equipment-groups, export-options, field-ids, filter-cleaning-reasons, filter-data-management, filter-field-options, filter-setup, help, ldap, notification-rules/index, notification-settings/{email-settings, sms-settings, notification-logs}, offline-cache, pagination, password-policy, replacement-schedule-filters, report-config, report-labels, report-page-titles, report-signatories, role-assignments, role-access, tablet-access, user-id
- dashboard.tsx
- debug/index
- deviations/index
- filter-management (11): ahu-dashboard, cleaning-profile-editor, cleaning-profile-list, filter-list (page; its `lib/` is tested), filter-operations (page; `lib/filter-ops` is tested), filter-traceability, quality-notifications, replacement-list, replacement-schedule, retirement-list, rfid-track-record
- hierarchy-preview/index
- mobile: mobile-login, mobile-forgot-password, mobile-wrapper (3)
- my-tasks/index
- notifications/index
- pm-schedules: index, detail (2)
- profile/index
- report-reviews/index
- stage-approvals/index
- system-health/index
- users: list, create, edit, reset-requests (4)

The tested exceptions: `admin-requests/index` (keyboard a11y render), `home/index` (via FlowChart/viewer-access), `mobile/server-config`, `config/datetime` (text guard), `mobile/mobile-operations` (text guard), `version-history/index` (diff engine).

## 4. `tests/integration` and `tests/performance`

### tests/integration (1 test file)

- `windows-server-stack.test.ts` — `describe.skipIf(!INTEGRATION_TEST)`; the ONE remaining test boots the API in-process via the e2e helper and asserts `GET /api/health` → 200 `{status:'ok'}`. The MQTT/TimescaleDB, graphile-worker and puppeteer PDF halves were deleted (2026-07-15, 2026-08-26, 2026-07-04). `vitest.global-setup.ts` delegates to the API global setup only when gated.

### tests/performance (load-test framework, 2026-10-17; commands in `tests/performance/README.md`)

| File | One line |
|---|---|
| `api/run-load.mjs` | Dependency-free load runner; `--scenario web-users|tablet-operators|bulk-operate --profile smoke|baseline|normal|high|peak|stress|spike|soak30|soak2h`; refuses non-localhost and port 3000; `PERF_CONFIRM=yes` above smoke; writes `results/runs/<id>.json/.csv` |
| `api/single-shot.mjs` | Times each URL once, serially — an endpoint's own cost |
| `api/scenarios/web-users.mjs` | Read path: replays each page's first-load waterfall + its poll timers per virtual user; tablets at `/m` |
| `api/scenarios/tablet-operators.mjs` | Write path: operators drive cleaning cycles to completion following the server tape; shift officers approve from the queue; `PERF_CLEANING_REASON=PM` hits the missed-PM gate |
| `api/scenarios/bulk-operate.mjs` | One `POST /api/filters/bulk-operate` with `PERF_BULK_SIZE` start-and-advance items per operator |
| `lib/auth.mjs` | Logs perf users in once and caches tokens (login is rate-limited 100/min) |
| `lib/http.mjs` | Keep-alive https client + metrics; trusts the mkcert root |
| `data-generation/seed-perf-db.ts` | Synthetic one-year plant/history into `digilog_perf` only (refuses non-`_perf` DB); `--scale`, `--users`, `--verify` |
| `data-generation/verify-perf-chain.ts` | Windowed audit-chain verification using the app's own verifier |
| `data-generation/check-perf-db.ts` | Post-seed row counts / invariants report |
| `data-generation/perf-env.ts` | Safety bootstrap: pins `DATABASE_URL` to a `_perf` DB before loading `.env` |
| `endurance/sample-resources.ps1` | CSV of API CPU/memory/handles + Postgres connections/locks every N s |
| `equivalence/capture.mjs` | Saves GET bodies to diff old vs new build |
| `equivalence/pm-due-compare.mts` | Diffs original vs current `getDueTasks` output |
| `profile/profile-endpoints.mts` | In-process inject + every Prisma query with duration |
| `profile/cpu-profile-batch-states.mts` | V8 CPU profile of one `getBatchStates()` |
| `profile/slow-queries.mjs` | Groups a `-Profile` instance's slow-query log by statement |
| `recovery/restart-under-load.ps1` | Kills the perf API mid-run, restarts, measures time-to-healthy |
| `recovery/backup-restore-timing.ps1` | Times pg_dump/pg_restore and plain-SQL dump/psql replay into a fresh `_perf` DB |
| `security/bcrypt-throughput.mjs` | bcrypt compares/s vs libuv threadpool size |
| `start-perf-api.ps1` / `stop-perf-api.ps1` | Second production-build API on :3100 (`-Profile` :3101, `-Database digilog_day1_perf -Port 3102`), `LOG_DIR=tests/performance/results/logs` |
| `results/` | 36 run json/csv pairs (2026-10-17), 19 resource CSVs (one from 2026-10-19 — the run in progress), `openapi.json`, `perf-users.json`, backups, logs |

None of this is a vitest project; nothing here is a correctness test.

## 5. Manual test assets

**No `Oq` folder exists in the repo.** The OQ scripts live outside the repo under `C:\Users\hello\Downloads` (names only, not read):

`Downloads\OQ\OQ\` (2026-10-09) — 7 docx: Test Case 1 Shift Officer, 2 Admin, 3 Supervisor Features-2, 4 QA, 5 Engineering Manager, 6 Operator Tab by Features, 6 Operator.
`Downloads\OQ\OQ\Oq\` (2026-10-09) and `Downloads\Oq (1)\Oq\` (2026-10-12) — the same 11 docx: TestCase1 Admin-web, 2 Supervisor-web, 3 Supervisor-tab, 4 Engineering-Manager, 5 QA-web, 6 shiftOfficer-web (+ `01-10-26` variant), 7 shift_officer-Tab, 8 Operator-web (+ `01-10-26` variant), 9 operator-Tab.
`Downloads\Oq (1)\Oq\Updated by Claude\` (2026-10-13):
- `Separate web and tab 12-10-26\` — 9 docx (one per role × web/tab, suffix `-12-10-26`)
- `OQ Updated Documents\` — 6 docx (Admin, Supervisor web+tab, Eng Manager, QA, Shift Officer web+tab, Operator web+tab)
- `Compact 18-20 pages 13-10-26\` — 6 docx (one per role, `-13-10-26`) — the memory file calls these the final set ("One document per role 13-10-26" is not a folder name on disk; the compact folder is the closest match).

Repo `tasks/*.md` that are manual test scripts / verification checklists: `PHASE1-DEPLOYMENT-TEST-2026-04-29.md`, `PHASE2-DEPLOYMENT-TEST-2026-04-29.md`, `PLAN-2026-05-02-step8.8-apk-field-qa.md` (2026-05-12), `STEP-5-CHECKLIST-INVESTIGATION.md` (2026-05-12), `OFFLINE-CYCLE-TEST-2026-05-17.md`, `RBAC-RUNTIME-VERIFICATION-CHECKLIST.md` (2026-06-30), `ATOMIC-ADVANCE-CHECKLIST-PLAN.md` (2026-07-16), `FDM-CONSOLE-VERIFICATION-2026-09-04.md`, `STAGE-APPROVAL-TABLET-VERIFICATION-2026-09-04.md`.

## 6. Skipped / conditional tests

| Kind | Count | Where |
|---|---|---|
| `it.skip` (API) | 12 | `e2e/entities.test.ts` ×7 (instance CRUD — needs a template that only seed can create), `e2e/phase3-rfid-offline.test.ts` ×1 (offlinePerformedAt preserved on advance), `filter-operations/__tests__/concurrent-operator.test.ts` ×4 (n/a collision codes) |
| `describe.skipIf` | 1 | `tests/integration/windows-server-stack.test.ts` gated on `INTEGRATION_TEST=1` (1 test inside) |
| `.todo` / `.only` / `test.skip` / `describe.skip` | 0 | — |
| Web / shared skips | 0 | — |
| Env gates in tests | `INTEGRATION_TEST` (integration only). Other `process.env.*` reads in tests are the subject under test (`PORT`, `API_PORT`, `API_DOCS`, `LOG_RETENTION_DAYS`, `NODE_ENV`, `TZ`), not gates. No `RUN_INTEGRATION`, no `CI` gate. |

The 2026-09-04 baseline reported 16 skipped; static count is 13 (12 + 1 gated). The difference can only be resolved by running (unverified).

## 7. Browser automation

- `@playwright/test` is **not** in any package.json. Playwright is available only as the Claude Code **Playwright MCP plugin** (`mcp__plugin_playwright_playwright__*`), plus the `claude-in-chrome` and `mobile-mcp` MCPs.
- `.playwright-mcp/` (repo root, 250 files, gitignored artifacts) holds 7 ad-hoc scripts:
  - `dry-in-start-tablet.js`, `dry-in-start-web.js` (2026-10-06) — standalone `node` scripts (require `playwright-core` from the npx cache): log in, drive Dry In start on `/m` and `/filters`, intercept every POST under `/api/filters` with fakes, capture bodies. Zero live writes.
  - `status-scan-rfid.js` — tablet Status → Scan RFID popup with a lower-cased doubled tag; read-only.
  - `login-401-path.js`, `login-lands-on-dashboard.js` (2026-10-03) — `async (page) => {}` snippets for `browser_run_code_unsafe`: session-death/401 redirect and login-always-lands-on-`/` scenarios.
  - `shots.js`, `shots-all.js` (2026-10-01) — screenshot sweeps for the UI redesign (`shots-all` walks ~55 routes at 1440×900).
  - Plus 91 `page-*.yml` accessibility snapshots, 27 console logs, 8 screenshot folders (after-all 55, after 10, before 10, shots-dry-in 13, sheets 10, tablet 6, auth 5, final 4).
- `old/playwright-artifacts/` — 136 historic console logs (Apr 2026), no scripts.

## Appendix A — the 250 inventory operations with no test URL reference

Method: literal `/api/...` strings in all 165 test files (api + integration), `${…}` → wildcard, matched against the 429 inventory paths with `{param}` wildcards. It does NOT credit service-level unit tests (see §2 table "Notes").

**admin-requests** (1/5): `GET /api/admin-requests/pending-count`

**assets** (12/25): `GET /api/assets/identifiers/track-record`, `GET /api/assets/instances/approval-counts`, `POST /api/assets/instances/approve`, `POST /api/assets/instances/bulk-upload-filters/validate`, `GET /api/assets/instances/filter-upload-template.xlsx`, `GET /api/assets/instances/pending-approval`, `POST /api/assets/instances/reject`, `POST /api/assets/instances/review`, `GET /api/assets/instances/{id}/children`, `POST /api/assets/instances/{id}/resubmit`, `PATCH /api/assets/instances/{id}/status`, `GET /api/assets/templates/{id}`

**audit** (2/9): `POST /api/audit/bulk-redact`, `POST /api/audit/{id}/redact`

**auth** (1/10): `POST /api/auth/refresh`

**block-change-requests** (5/5): `GET /`, `POST /`, `GET /pending-count`, `POST /{id}/approve`, `POST /{id}/reject` (all under `/api/block-change-requests`)

**checklist-profiles** (6/11): `POST /{id}/questions`, `PUT /{id}/questions/{questionId}`, `DELETE /{id}/questions/{questionId}`, `PUT /{id}/reorder`, `GET /{id}/versions`, `GET /{id}/versions/{versionNumber}` (under `/api/checklist-profiles`)

**cleaning-profiles** (6/8): `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `PATCH /{id}/toggle-status`, `GET /{id}/versions`, `GET /{id}/versions/{versionNumber}` (under `/api/filter-cleaning-profiles`)

**config** (45/101): `GET access-matrix/my-modules`; `PUT dashboard-cards`, `GET dashboard-cards/current`; `GET+PUT dynamic/{backup-format, export-limit, filter-approval, filter-cleaning-reasons, filter-field-options, guest-cleaning-requests, pm-schedule-approval, pm-schedule-settings, qnn-notifications, replacement-schedule-approval, stage-interlock}` (22); `GET+PUT export-limit`, `GET export-limit/current`; `GET+PUT export-options`, `GET export-options/current`; `GET+PUT offline-cache`, `GET offline-cache/current`; `GET password-policy/current`; `GET+PUT pm-schedule-filters`, `GET pm-schedule-filters/current`; `GET+PUT replacement-schedule-filters`, `GET replacement-schedule-filters/current`; `PUT report-labels`, `GET report-labels/current`; `GET report-signatories/resolved`; `GET tablet-access/my-features` (all under `/api/config`)

**dashboards** (13/13): `GET /`, `POST /`, `GET /widget-types`, `DELETE /{dashboardId}/assign/{assignmentId}`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/assign`, `GET /{id}/data/{widgetId}`, `PUT /{id}/layout`, `POST /{id}/widgets`, `PUT /{id}/widgets/{widgetId}`, `DELETE /{id}/widgets/{widgetId}`

**debug-traces** (6/6): `GET /`, `PUT /entity/{id}/toggle`, `GET /operation-trace`, `PUT /operation-trace`, `GET /stats`, `GET /{id}` (under `/api/debug/traces`)

**deployment-check** (1/1): `GET /api/deployment-check/`

**equipment-groups** (10/10): `GET /`, `POST /`, `GET /by-block/{blockId}`, `POST /fetch-readings`, `POST /test-url`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `GET /{id}/versions`, `GET /{id}/versions/{versionNumber}`

**filter-operations** (9/26): `POST /ahu-set-availability`, `GET /batch-states`, `GET /cleaning-record`, `GET /cycles/{id}`, `GET /dashboard-stats`, `GET /field-options`, `GET /manual-status-changes`, `GET /reasons`, `GET /{id}/stage-options` (under `/api/filters`)

**filter-profiles** (8/8): `GET /`, `POST /`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/assign`, `GET /{id}/versions`, `GET /{id}/versions/{versionNumber}`

**guest** (1/1): `POST /api/guest/cleaning-request`

**hierarchy** (5/12): `GET /ahus`, `GET /ahus/{id}`, `GET /areas`, `GET /areas/{id}`, `GET /blocks/{id}`

**ldap** (4/4): `GET /config`, `PUT /config`, `GET /status`, `POST /test-connection`

**notification-delivery** (13/18): `GET email/oauth2/{authorize, code, redirect-uri, status}`, `POST email/test`, `GET logs`, `GET logs/stats`, `POST send`, `POST sms/test`, `GET templates`, `POST templates`, `PUT templates/{id}`, `DELETE templates/{id}` (under `/api/notification-settings`)

**notification-rules** (8/8): `GET /`, `POST /`, `GET /event-types`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}`, `POST /{id}/test`, `PUT /{id}/toggle`

**pm-schedules** (28/28): `POST /api/pm-executions/`; under `/api/pm-schedules`: `POST /`, `GET ahu-configs`, `PUT ahu-configs/{ahuId}`, `GET deviations`, `POST deviations/sweep`, `POST deviations/{id}/acknowledge`, `GET due`, `GET entries`, `POST entries/approve`, `GET entries/export.xlsx`, `GET entries/pending-counts`, `POST entries/reject`, `POST entries/review`, `PUT entries/{id}/edit`, `POST entries/{id}/resubmit`, `PUT entries/{id}/review-edit`, `GET pending-tasks-map`, `GET qnn`, `GET qnn/visible`, `GET settings`, `GET template.csv`, `POST upload`, `GET workflow-config`, `GET {entityId}`, `GET {entityId}/history`, `PUT {id}`, `DELETE {id}`

**replacement-schedule** (11/14): `GET due`, `POST entries/approve`, `POST entries/reject`, `POST entries/review`, `POST entries/{id}/execute`, `POST entries/{id}/resubmit`, `PUT entries/{id}/review-edit`, `GET export.xlsx`, `GET tasks`, `GET template.xlsx`, `POST validate` (under `/api/replacement-schedules`)

**report-reviews** (6/6): `GET /`, `POST /`, `GET /queue`, `GET /{id}`, `POST /{id}/approve`, `POST /{id}/review`

**roles** (1/9): `GET /api/roles/access-matrix`

**stage-approvals** (6/6): `GET /`, `POST /bulk-decide`, `GET /queue`, `GET /{id}`, `POST /{id}/approve`, `POST /{id}/reject`

**super-admin** (38/41): `GET+PUT api-lock`; `data/admin-requests` GET/POST/PUT/DELETE; `GET data/audit-trail`; `data/block-change-requests` GET/POST/PUT/DELETE; `data/cleaning-cycles` GET/POST/PUT/DELETE; `PUT data/deviations/{id}`; `data/filter-events` GET/POST/PUT/DELETE; `data/notifications` GET/POST; `data/pm-entries` GET/POST/PUT/DELETE; `GET data/pm-schedules`; `PUT data/quality-notifications/{id}`; `PUT filter-data/filters/{id}`; `filter-data/replacements` POST/PUT/DELETE; `filter-data/retirements` POST/PUT/DELETE; `PUT filter-data/rfid-events/{id}`; `PUT filter-data/stage-approvals/{id}`; `GET stats`

**uploads** (1/1): `POST /api/uploads/photo`

**users** (3/15): `POST /bulk-delete`, `POST /password-expiry-sweep`, `POST /reset-requests/{id}/process`

## Footnote — commands used (all read-only, run from the repo root in Git Bash)

```
cat vitest.workspace.ts apps/api/vitest.config.ts apps/web/vitest.config.ts packages/shared/vitest.config.ts tests/integration/vitest.config.ts
cat apps/api/vitest.env.ts apps/api/vitest.global-setup.ts apps/api/vitest.setup.ts apps/web/src/test-setup.ts tests/integration/vitest.global-setup.ts
grep -A60 '"scripts"' package.json apps/api/package.json apps/web/package.json packages/shared/package.json
grep -n coverage package.json apps/*/package.json packages/shared/package.json
find apps/api/src -name "*.test.ts" | wc -l                      # 164
ls apps/api/src/e2e/*.test.ts | wc -l                             # 41
find apps/web/src -name "*.test.ts" -o -name "*.test.tsx" | wc -l # 75
find packages/shared/src -name "*.test.ts" | wc -l                # 19
ls apps/api/src/modules/                                          # 33
find apps/web/src/routes -type f \( -name "*.tsx" -o -name "*.ts" \) -not -path "*/__tests__/*" -not -name "*.test.*" | wc -l   # 158
grep -cE "<Route" apps/web/src/main.tsx                           # 77
grep -rnE "describe\.skipIf|it\.skipIf|\bit\.skip\b|\bdescribe\.skip\b|\btest\.skip\b|\.todo\(|\.only\(" apps/api/src apps/web/src packages/shared/src tests/integration --include="*.test.ts*"
grep -rnoE "process\.env\.[A-Z_]+" apps/api/src tests/integration --include="*.test.ts" | awk -F: '{print $NF}' | sort | uniq -c
grep -rlE "readFileSync" apps/web/src --include="*.test.ts*"      # 8 source-text guards
for f in <each test file>; do grep -m1 -oE "describe\(\s*['\"\`][^'\"\`]+" "$f"; done
sed -n 188,858p docs/production-readiness/03_API_ENDPOINT_INVENTORY.md  → parsed 429 rows (python -I, scratchpad xref.py)
grep -oE "(['\"\`])/api/[^'\"\`]*\1" over all api+integration test files → matched against inventory paths with {param} wildcards
find /c/Users/hello -maxdepth 4 -iname "oq" -type d ; find "Downloads/OQ" "Downloads/Oq (1)" -type f -printf "%TY-%Tm-%Td  %p\n"
ls -la --time-style=long-iso tasks/ | grep -iE "test|oq|qa|verif|script|checklist"
ls .playwright-mcp ; find .playwright-mcp -type f | wc -l ; grep -rn playwright package.json apps/*/package.json
cat tests/performance/README.md tests/performance/data-generation/README.md ; head of each tests/performance script
```
