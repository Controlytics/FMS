# QA — Defect Register

Severity (consequence): **P0** data corruption / security breach / outage · **P1** major workflow
failure · **P2** significant defect or degraded performance · **P3** minor / usability.
Remediation priority is separate and, for regulated flows, the operator's decision.

Evidence column: `probe` = executed black-box probe (result file in `QA/results/probes/`);
`code` = confirmed by reading the source (file:line), not yet reproduced at runtime;
`seed` = recorded earlier and not yet re-verified in this campaign.

Status: OPEN · FIXED (with regression test) · DOCUMENTED DECISION · NOT A DEFECT · NEEDS OPERATOR.

## 1. New defects found by this campaign

| ID | Sev | Title | Evidence | Steps / proof | Root cause | Status |
|---|---|---|---|---|---|---|
| QA-D001 | P2 | Concurrent PM-task starts create several IN_PROGRESS executions for one visit | **probe** `R6a-pm-execution-race.run1..5.json` | 20 simultaneous `POST /api/pm-executions` (OPERATOR, same APPROVED entry): 5, 5, 5, 4, 2 executions created per run, each with its own `PM_STARTED` audit row; expected 1 + 19 × 409 | `pm-schedules/pm-executions.ts`: `findFirst({status:'IN_PROGRESS'})` then `create`, no transaction, no unique index | **FIXED** — one transaction with `SELECT … FOR UPDATE` on the entry row; audit row joins the tx. Test `pm-schedules/__tests__/pm-execution-start-race.test.ts` (old code: 12 of 20 succeeded; new: 1) |
| QA-D002 | P1 | Web stage screen (`/filters/stage/:key`) hangs when the server asks the missed-PM question or an AHU set/completion gate fires | **code** | stage-screen return wired the submit handlers that await `askPmSkipReasons` / `runAhuGate`, but `PmPendingTasksDialog`, `AhuSetChooserDialog`, `RemainingFiltersDialog` were mounted only in the landing return | dialogs mounted in one of two return branches | **FIXED** — one `gateDialogs` element rendered in both returns (`filter-operations.tsx`). Guard test `filter-management/__tests__/stage-screen-gate-dialogs.test.ts` (old: 3/3 fail). Browser check pending (dist rebuild) |
| QA-D003 | P2 | 12 config definitions were stored without any server-side validation | **code** + route test | `config/dynamic-routes.ts`: no body schema, 0 of 38 defs define `zodSchema`/`validate` | missing validation | **FIXED** — new `lib/config-settings-validate.ts` checks each def's declared type/min/max/lengths/static options; pre-flight: every stored value on 4 databases passes (`QA/tests/probes/config-stored-values-check.mts`). Tests `lib/__tests__/config-settings-validate.test.ts` (9) + `e2e/dynamic-config-validation.test.ts` (old: 2/3 fail) |
| QA-D004 | P3 | Concurrent block-change requests created duplicate PENDING requests | **code** + test | `block-change.service.ts`: `findFirst(PENDING)` then `create`, no transaction | same as D001 | **FIXED** — transaction + row lock on the filter. Test `block-change-requests/__tests__/create-race.test.ts` (old code: 12 of 20 created) |
| QA-D005 | P2 | Block-change approver / requester notifications never delivered | **test** (found while testing D004) | `prisma.notification.create` failed `Invalid value for argument type. Expected NotificationType`; swallowed by the non-fatal try/catch | `BLOCK_CHANGE_REQUESTED/_APPROVED/_REJECTED` sent since 2026-05-25 but never added to the enum (schema and all 3 DBs) | **FIXED** — enum + additive migration `20261019090000_block_change_notification_types` (applied to `digilog_test_db` and `digilog_qa_perf`; **NOT applied to `digilog_db`** — runs on next `npm run db:migrate` / installer upgrade); web type lists updated. Assertion added to the D004 test. Sweep of every notification type sent vs the enum: no other gap |
| QA-D006 | P2 | Pagination / export-limit / backup-format saved unsigned through `PUT /api/config/:key` | **code** + test | defs declare `requiresReauth: true, reauthAction: 'UPDATE_CONFIG_PAGE'`; the static route only enforced 4 hard-mapped keys | map did not fall back to the def | **FIXED** — server falls back to the def's re-auth row (`config/routes.ts`); Pagination page now prompts (`pagination.tsx`). Test `e2e/config-page-reauth-static-route.test.ts` (old: 200 unsigned) |
| QA-D007 | P2 | Replacement Schedule upload had no password path | **code** | raw `fetch` with no `reauth.execute` while the server enforces `UPLOAD_REPLACEMENT_SCHEDULE` | — | **FIXED** — `replacement-schedule.tsx` submit goes through `reauth.execute`, password in `x-reauth-password` (same as PM upload); cancel returns to the preview |
| QA-D008 | P2 | Typed filter create accepted a deactivated AHU (BR-070) | **code** + test | `filter.service.ts` checked the AHU existed, not `isActive` | — | **FIXED** — same refusal as the generic path. Test `assets/services/__tests__/filter-create-inactive-ahu.test.ts` (old code created the filter) |
| QA-D009 | P2 | Password reuse allowed for passwords older than 12 months even inside the configured count (CS-100) | **code** + test | hidden 12-month cut-off, no recorded rationale (arrived in `77b3a58`, 2026-04-06) | — | **FIXED** — the configured count is the whole rule (`auth.service.ts`); test added to `auth.service.test.ts` |
| QA-D010 | P2 | Filter approval: submitter could approve their own filter (OQ-18 / BR-061) | **code** + test | no user-level check; PM and replacement have one | — | **FIXED** (operator decision 2026-10-19) — `assertNotOwnFilter` on review/approve/reject (`filter-approval.service.ts`). Test `assets/__tests__/filter-approval-sod.test.ts` (old: 3/4 fail) |
| QA-D011 | P2 | Static config PUT let ADMIN save SUPER_ADMIN-only settings (C-01) | code + test | `configEndpoint` ignored the def's `requiredRole` | — | **FIXED** — request-time gate; `e2e/config-page-reauth-static-route.test.ts` (old: ADMIN 200) |
| QA-D012 | P2 | FDM generic edits: invalid date → 500 + SYSTEM_ERROR, month 13 stored, PM overlap allowed, raw error text to client (M50) | **test** | no value checks; separation rule skipped | — | **FIXED** — `invalidValue` via the shared check, `assertSeparation`, AppError-only messages; `e2e/super-admin-data-validation.test.ts` (old: 500 / 200 / 200) |
| QA-D013 | P3 | P2025 answered 400 DATA_CONSTRAINT; PrismaClientValidationError answered 500 + SYSTEM_ERROR (M29 residual, M15/M50 class) | test | unmapped in `app.ts` | — | **FIXED** — 404 / 400; `e2e/prisma-not-found-404.test.ts` |
| QA-D014 | P2 | Cleaning-profile PUT accepted blank name; unknown nodeType → 500 (M15) | test | schema gaps | — | **FIXED** — DB enum + name length; `e2e/cleaning-profile-schema.test.ts` (PUT cases fail on old code; the POST case also passed on old code for another reason — it guards only) |
| QA-D015 | P2 | Notification visibility: three disagreeing rules; a user could act on an admin notice about them (M30); unit tests passed by `undefined===undefined` (M32) | test | copied predicates | — | **FIXED** — `notifications/visibility.ts`; tests corrected and extended |
| QA-D016 | P3 | Notification retry delay mis-indexed; RETRYING rows stranded by a restart (C-11) | test | in-process timers | — | **FIXED** — indexing + boot `failStrandedRetries`; `notification-delivery/__tests__/retry-recovery.test.ts` |
| QA-D017 | P2 | Server idle logout used the old `session` row, not the configured Password Policy idle (OQ-12) | test | settings moved, sweep not | — | **FIXED** — `session-sweep.ts`; `auth/__tests__/session-sweep-idle-source.test.ts` (old: 2/3 fail) |
| QA-D018 | P3 | Disk health via WMIC on C:, 0 % on failure (M51) | test | — | — | **FIXED** — statfs + "unavailable"; `system-health/__tests__/disk-usage.test.ts` |
| QA-D019 | P3 | Orphan profile photos never deleted (M55) | test | no GC | — | **FIXED** — nightly `photo_orphan_sweep`; `lib/__tests__/photo-orphan-sweep.test.ts` (new code; nothing to fail against) |
| QA-D020 | P3 | System role with users refused as "has users" (C-08) | test | check order | — | **FIXED** — `role.service.ts`; e2e `roles.test.ts` assertion updated to SYSTEM_ROLE |
| QA-D021 | P3 | 34 signature prompts showed a fixed/generic action label (F-14) | test | static `actionLabel` | — | **FIXED** — `pendingActionLabel` fallback; guard in `config/__tests__/signed-writes-guard.test.ts` |
| QA-D022 | P3 | FDM: 3 writes bypassed re-auth (R-03); lifecycle-step delete hit the cycles endpoint (F-02); backup picker hid `.dump`; Delete shown for system roles | test | — | — | **FIXED** — guard test above |
| QA-D023 | P3 | System Health shown in every role's sidebar but route ADMIN/SA only; Notifications route ignored NOTIFICATION_DELETE (OQ-17, operator: visibility only) | code | sidebar and route rules diverged | — | **FIXED** — `sidebar.tsx`, `main.tsx` (no test — small; covered by tsc) |
| QA-D024 | P2 | Web + tablet items done by the helper agents, verified by me: M63 M66 M74 M79 M82 M87 OQ-08 OQ-09 OQ-10 OQ-11/M80 OQ-14 OQ-15 OQ-16 OQ-19 C-02 C-05 C-07(web) · tablet OQ-02 OQ-03a OQ-05 OQ-06 OQ-07 OQ-13 C-04 C-07(server+tablet) OQ-04 M53 | **test** — 17 new web test files; against the committed pages 16 fail (78 tests); the 17th (`tablet-rules.test.ts`) unit-tests the new helper modules directly | per item, `QA/_discovery/reverify-open-items.md` | — | **FIXED** (APK rebuild needed for the tablet items). Offline diff reviewed: cache read/evict only, queue/replay untouched, filters with unsynced work are never evicted, batch list is not per-user |

| QA-D025 | P3 | Admin Requests: `actionTaken` returned only inside `data`, so "no action was required" never showed; FDM offered RESET_PASSWORD / UNLOCK_USER (codes the server never handles) and omitted 4 real types; 3 more pages showed "Export failed" on a cancelled password prompt (Lifecycle, Audit Trail, Replacement Schedule) | test (from the web helper's final report) | — | — | **FIXED** — `admin-requests/routes.ts`, `filter-data-management.tsx`, three export catches; tests `e2e/admin-request-action-taken.test.ts` (old: undefined), guards in `signed-writes-guard.test.ts` (types = server enum; every export-reauth page handles a cancel) |
| M10 | P2 (latent) | RFID Track Record reads every identifier audit row into memory per request and filters in Node | code (re-check 2026-10-19) | only from/to reach SQL | — | **FIXED** — filters, count and paging in SQL (`identifier.service.ts`); equivalence 23/23 on the QA clone (`QA/tests/equivalence/rfid-track-record-compare.mts`); test `rfid-track-record-paging.test.ts` |
| M11r | P3 | `GET /api/instances?parentId=null` root filter unreachable (schema allows uuid only) | code | sentinel vs schema | — | **FIXED** — shared `assetQuerySchema` accepts the `null` sentinel; test `asset-query-parentid.test.ts` |

### Runtime re-check on the rebuilt API (2026-10-19 14:16, `digilog_qa_perf` :3104)
- PM race probe 5 × 20 concurrent starts: **1 execution and 19 × 409 every run** (before: 2–5 executions).
- Endpoint sweep, 429 operations: no unauthenticated access, no 5xx, no leaked internals; only the 10
  list-style lookups that answer an empty 200 for an unknown id (reviewed, not defects).

### Claims checked and NOT defects

| Claim (source) | Result | Evidence |
|---|---|---|
| CS-070/071 "config PUTs validate nothing" (code-smell sweep) | **Overstated.** The 26 custom-page defs (session, password-policy, login-security, …) go through `PUT /api/config/:key` → `configService.updateConfig` with a Zod schema. Session: out-of-range idle (100000, 0) and wrong-type duration → **400 VALIDATION_ERROR, nothing stored**; unknown key → stripped. Only the dynamic route (QA-D003) is unvalidated | **probe** `R2-config-put-validation-session.json` |
| "Every route has a schema" vs "42 mutating routes have no body schema" (two sweeps) | Both true: every registration has a `schema:` block, 20 write routes have no validated body inside it | backend-workflows §7, code-smells §4 |

## 2. Seeded from earlier records (to re-verify; counted once)

### 2a. OQ bug list, 2026-10-12/13 (operator chose "document only, list bugs")

| ID | Area | Title | Status |
|---|---|---|---|
| OQ-01 | Offline / Part 11 | Offline Wash Out / Dry Out skips the Shift Officer approval | DOCUMENTED DECISION (operator 2026-10-19: keep the offline approval exemption) |
| OQ-02 | Tablet | Approval banner is dead code | FIXED — QA-D024 |
| OQ-03 | Tablet | Stage Approvals tab shown to Operator/Supervisor; Replacement Tasks tile shown to every role | Stage Approvals tab FIXED (QA-D024); Replacement Tasks tile = DOCUMENTED DECISION (2026-06-04) |
| OQ-04 | Tablet | Access check fails open offline (= frontend sweep F-05) | FIXED — QA-D024 |
| OQ-05 | Tablet | Perform always opens Wash In | FIXED — QA-D024 |
| OQ-06 | Tablet | Perform (overdue) skips the password acknowledgement | FIXED — QA-D024 |
| OQ-07 | Tablet | Login silently ends the other session | FIXED — QA-D024 |
| OQ-08 | PM | Text says "QA approval", flow is Manager review | FIXED — QA-D024 |
| OQ-09 | PM | Edit toast is wrong | FIXED — QA-D024 |
| OQ-10 | PM | Rejection remarks only appear in the PDF | FIXED — QA-D024 |
| OQ-11 | PM | Detail page is unlinked | FIXED — QA-D024 |
| OQ-12 | Web | Idle timer uses the password-policy idle setting, not the session idle setting | FIXED — QA-D017 |
| OQ-13 | Web | "Perform" shown on "Not Performed" tasks | FIXED — QA-D024 |
| OQ-14 | Web | Equipment Groups back arrow → Access Denied | FIXED — QA-D024 |
| OQ-15 | Web | "Filter Cleaning Record" menu opens a page titled "Cleaning Cycles" | FIXED — QA-D024 |
| OQ-16 | Web | Retirement/Replacement Excel export ignores "PDF only" | FIXED — QA-D024 |
| OQ-17 | Web | Some pages hidden from the sidebar but open by URL | FIXED (visibility only, operator decision) — QA-D023 |
| OQ-18 | Approvals | Filter review/approve has no different-person check (= backend sweep BR-061) | FIXED (operator: different person) — QA-D010 |
| OQ-19 | Admin requests | ENABLE_ACCOUNT / DISABLE_ACCOUNT render as raw codes; toast "undefined request has been approved" | FIXED — QA-D024 |

### 2b. Enterprise-audit mediums confirmed live 2026-07-15

`tasks/ENTERPRISE-AUDIT-MEDIUMS-VERDICTS-2026-07-15.md` holds 41 CONFIRMED-LIVE verdicts; 10 were fixed in
`bad2ca4` (M69 M72 M65 M44 M45 M59 M85 M05 M83 M39). Open at that date: M06 M07 M10 M11 M15 M23 M27 M29
M30 M32 M37 M43 M47 M50 M51 M53 M55 M58 M62 M63 M66 M70 M73 M74 M76 M79 M80 M82 M87 M88 M89 M90.
Each is re-verified against the current tree before it is counted open in the final report; the
priority note of that date stands (M50 first, then M87, then M53).

### 2c. Operator decisions left open on 2026-07-15

| ID | Title | Status |
|---|---|---|
| OD-01 | SUPER_ADMIN gets neither a permission gate nor re-auth on audit hard-delete | NEEDS OPERATOR |
| OD-02 | Notification rule test-fire succeeds for a rule whose event type is never emitted | NEEDS OPERATOR |

## 3. Documented decisions (tested as such, never "fixed")

| Behaviour | Where it is decided |
|---|---|
| Offline replay skips interlock / AHU / block-change / missed-PM gates, records them in `replayExemptGates`; grant issuance not audited | CLAUDE.md "Strict audit 2026-09-24/25", FDM retrofit 2026-08-27 |
| Unretire hard-deletes the replacement filter's history, recorded in `afterValue._sideEffects` | CLAUDE.md FDM retrofit 2026-08-27 |
| Audit edit / hard delete break the chain and stay loud | CLAUDE.md 2026-07-01, 2026-08-27 |
| Only three rate limits; guest request unlimited | CLAUDE.md 2026-10-10 |
| SUPER_ADMIN bypasses RBAC, lockout and expiry; no MFA | memory 2026-07-25 |
