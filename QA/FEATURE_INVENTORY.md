# QA — Feature Inventory and Traceability Matrix

DigiLog / FMS, branch `RFID` (working tree of 2026-10-19, includes the uncommitted 2026-10-17 load-test
fixes). Phase 1 of the QA campaign. Everything here was derived read-only from the source by four
discovery sweeps; nothing was executed. Every count is backed by a command quoted in the source document
named in the "Detail" column.

| Detail document | What it holds | IDs |
|---|---|---|
| `_discovery/frontend-inventory.md` (+ `_discovery/parts/01..07`, being restored after an accidental delete) | 75 routed paths, 155 pages/views, 157 dialogs, 154 forms, 795 actions, 109 tables, 248 suspicious rows | `FE-R-nnn`, `FE-P/D/F/A-xnn` |
| `_discovery/backend-workflows.md` | 33 modules, 40 workflows, 128 business rules, 159 distinct error codes, 4 cron jobs, 38 config defs, DB constraints | `BE-M-nn`, `WF-nnn`, `BR-nnn` |
| `docs/production-readiness/03_API_ENDPOINT_INVENTORY.md` | 429 API operations with gate, audit flag, source line | path + method |
| `_discovery/existing-tests-map.md` | 164 API + 75 web + 19 shared test files; 250 of 429 operations have no HTTP-level test | — |
| `_discovery/code-smells.md` | 146 findings in 9 categories; top-10 likely defects | `CS-nnn` |

## 1. Totals

| Surface | Count | Source |
|---|---|---|
| Web routes (`<Route path=`) | 75 (63 behind `RequireRole`) | frontend-inventory §2 |
| Pages / views incl. tab panels and tablet views | 155 | frontend-inventory §2 |
| Dialogs (incl. 22 native confirm/alert/prompt sites) | 157 | frontend-inventory §2 |
| Forms / buttons / inputs | 154 forms (12 `<form>`), 836 buttons, 507 inputs | frontend-inventory §2 |
| API operations | 429 (GET 205, POST 104, PUT 87, PATCH 3, DELETE 30); 206 reach `auditLog()` | 03 inventory |
| API modules / workflows / business rules | 33 / 40 / 128 | backend-workflows §0 |
| Error-code vocabulary | 159 distinct (123 API + 24 pipeline-only + 12 offline) | backend-workflows §5 |
| Permissions / re-auth actions / audit actions / sidebar items | 106 / 127 / 98 / 27 | backend-workflows §0 |
| Config definitions | 38 (31 SUPER_ADMIN-only) | backend-workflows §9 |
| Prisma models / enums / triggers / partial unique indexes | 61 / 24 / 5 / 2 | backend-workflows §8 |
| Scheduled jobs | 4 in-process node-cron + 1 Windows task (pg_dump 01:30) | backend-workflows §6 |
| Existing automated tests | API 164 files (41 e2e), web 75, shared 19, integration 1 | existing-tests-map §1-3 |
| API operations with NO HTTP-level test | **250 of 429 (58 %)** | existing-tests-map App. A |
| Modules with zero tests of any kind | 4: debug-traces, filter-profiles, guest, notification-rules | existing-tests-map §2 |
| Web pages with zero tests | 76 page entry files (incl. all config pages); no page is rendered by any test | existing-tests-map §3 |

## 2. Traceability matrix (feature groups)

One row per testable feature group. `Workflow` and `Pages` link to the detail IDs. `Existing tests`
says what is covered today (U = unit/service, E = in-process e2e, — = none). `Status` is the campaign
status and starts at NOT TESTED for everything; it changes only when a test in `QA/tests/` or a
documented manual run has been executed. Phase columns name the campaign phases (2 UI, 3 workflow,
4 roles, 5 API abuse, 6 load, 7 volume, 8 fault, 9 E2E, 10 security) that must produce evidence.

| Feature ID | Feature | Workflow / rules | Pages (FE) | API module | Existing tests | Phases | Status |
|---|---|---|---|---|---|---|---|
| F-01 | Login, logout, refresh, session expiry / conflict, tablet login gate | WF-020, BR-075..082 | FE-R-005, FE-R-001 | auth | E (auth, tablet-login-access), U | 3 4 5 10 | NOT TESTED |
| F-02 | Password policy, change, expiry, history, forced change, lockout | WF-021, BR-083 | FE-R-007, FE-R-020 | auth, config | E (auth), U | 3 5 8 10 | NOT TESTED |
| F-03 | Forgot password, admin requests (public create → approve/reject), contact admin, user lookup | WF-016 | FE-R-006/008, FE-R-073 | admin-requests, auth | E (3 files) | 3 4 5 10 | NOT TESTED |
| F-04 | Re-authentication (electronic signature): gates, `_currentPassword` stripping, REAUTH_* audit rows, legacy-shape health | WF-022, BR-084..088 | FE-R-032 + 74 ReauthDialog mounts | lib/reauth-check, config | E (config-reauth-gates, m1-m2-reauth, access-matrix-reauth) | 3 4 5 10 | NOT TESTED |
| F-05 | Users: create / edit / disable / unlock / reset / role change / bulk delete / hierarchy guard | WF-019 | FE-R-014..017 | users | E (users, error-leak-prisma), U | 2 3 4 5 | NOT TESTED |
| F-06 | Roles & Access: roles CRUD, permission tree, sidebar items, role config, escalation guard | WF-033, BR-124 | FE-R-026, FE-R-019 | roles, config | E (roles), U | 3 4 5 10 | NOT TESTED |
| F-07 | Access matrix, tablet access, action re-auth config pages | WF-025 | FE-R-029, FE-R-050, FE-R-032 | config static routes | E (access-matrix-reauth) | 2 4 5 | NOT TESTED |
| F-08 | Dynamic config (38 defs): GET/PUT, `/current` public reads, secret redaction, partial merge | WF-025, BR-100.. | FE-R-037, FE-R-018 | config | E (config, 2 current e2e), U; **45 dynamic/static ops unhit** | 2 4 5 8 10 | NOT TESTED |
| F-09 | Hierarchy: Block / Area / AHU / Filter create-edit-delete, active-name uniqueness, parent must be active | WF-030, BR-068..070 | FE-R-042 (Structure tab), FE-R-075 | assets, hierarchy | U (15), E (7 skipped!) | 2 3 5 7 8 | NOT TESTED |
| F-10 | Filter creation approval: submit → review → approve / reject → resubmit; bulk upload + validate | WF-011, BR-058..061 | FE-R-042 dialogs | assets | **none over HTTP** | 3 4 5 | NOT TESTED |
| F-11 | RFID identifiers: assign / unassign / re-tag = replace flow, normaliser, tag release on retired filter | WF-031, BR-071..073 | FE-R-042 RFID panel, FE-R-004 RFID-assign view, FE-R-046 | assets/identifiers | E (phase3-rfid-offline, retire-replace-identifier-invariant) | 2 3 5 9 | NOT TESTED |
| F-12 | Cleaning cycle engine: start / advance / checklist / dryer two-step / bypass / terminate / complete; decision tape; tape version | WF-001, BR-001..020 | FE-R-051/052, FE-R-004 stage view | filter-operations | U (20), E (phase2, phase5, c2 …) | 2 3 5 6 8 9 | NOT TESTED |
| F-13 | Stage interlock approvals (WASH_OUT / DRY_OUT), queue, approve / reject / bulk-decide, different-approver rule | WF-002 | FE-R-072 (web = tablet) | stage-approvals | U (4); **none over HTTP** | 3 4 5 9 | NOT TESTED |
| F-14 | AHU completion gate / readiness, set chooser, remaining filters | WF-003 | FE-R-069, FE-R-051 dialogs | filter-operations | U (ahu-completion-gate, e2e variant) | 3 9 | NOT TESTED |
| F-15 | Bulk operate (50–100 tags): partial success, per-item tx + audit, reauth once | WF-004 | FE-R-004 batch submit | filter-operations | U, E (bulk-operate) | 3 5 6 9 | NOT TESTED |
| F-16 | Offline queue + sync engine + offline replay (grant, token, time window, exempt gates, missed-PM write-offs) | WF-005, WF-026, BR-089..094 | FE-R-004 (ribbon, failed-ops panel, hard cutoff) | plugins/auth, sync | U (sync-engine 30+ tests), E (phase3, phase5) | 3 5 8 9 10 | NOT TESTED |
| F-17 | Block change requests: request → approve / reject; single-use approval at cycle start; NONE/CONFIRM/APPROVAL modes | WF-015 | FE-R-043 | block-change-requests | U (consume); **none over HTTP** | 3 4 5 | NOT TESTED |
| F-18 | PM schedules: upload (append-only), separation rule, approve / reject / edit / resubmit, QNN | WF-006, WF-007, BR-035..045 | FE-R-065/066 | pm-schedules | U (6); **none over HTTP (28 ops)** | 2 3 4 5 7 | NOT TESTED |
| F-19 | PM execution, My Tasks, due tasks, missed-PM gate + write-offs, overdue deviations (cron), deviations page | WF-008..010, BR-010..012 | FE-R-067, FE-R-068, FE-R-004 My Tasks | pm-schedules | U (pm-deviations, pm-pending via filter-ops e2e) | 3 4 5 8 | NOT TESTED |
| F-20 | Replacement schedule: xlsx upload, approve / reject / resubmit, due / tasks / blocked, execute replacement | WF-012, WF-013 | FE-R-044, FE-R-048 | replacement-schedule | U (3); 11 ops unhit | 2 3 4 5 | NOT TESTED |
| F-21 | Retire / replace / unretire (incl. SUPER_ADMIN unretire that hard-deletes replacement history) | WF-014, BR-062..067 | FE-R-042, FE-R-045, FE-R-049 | filter-operations, super-admin | E (super-admin-unretire, retire-replace-identifier-invariant) | 3 4 5 8 | NOT TESTED |
| F-22 | Cleaning profiles (lineage versioning), checklist profiles (disable rule, versions), filter profiles, equipment groups (3 instruments, ranges, readings fetch) | WF-027..029, WF-036 | FE-R-053..056, FE-R-062/063 | 4 modules | U (6); **filter-profiles zero tests**; EG and CP unhit over HTTP | 2 3 5 | NOT TESTED |
| F-23 | Cleaning record, cycles list, cycle timeline, filter traceability, lifecycle report, RFID track record, QNN page | reads of WF-001 | FE-R-058..061, FE-R-046/047 | filter-operations/events-routes, pm-schedules/qnn | — (cleaning-record, cycles/:id unhit) | 2 5 7 | NOT TESTED |
| F-24 | Exports (PDF / Excel) + report-export-log gate + export limit | WF-032 | 12 pages' export menus | audit, pm-export, replacement export | E (audit-export-log) | 2 4 5 6 | NOT TESTED |
| F-25 | Report reviews (e-signature flow) — note: "Send for Review" button is dead on all 10 pages (C-01) | WF-017 | FE-R-071 | report-reviews | U (2); **none over HTTP** | 3 4 5 | NOT TESTED |
| F-26 | Audit trail: list / detail / visibility rules / redact / edit / hard delete / verify-chain / hash chain | WF-023, BR-095..099 | FE-R-070 | audit | E (audit, audit-chain …); redact unhit; **no Verify Chain UI (C-09)** | 2 3 4 5 7 10 | NOT TESTED |
| F-27 | Notifications (in-app), rules, email / SMS delivery, templates, logs, user groups | WF-018, WF-040 | FE-R-041, FE-R-033..036 | 4 modules | E (notifications, delivery masking); **notification-rules zero tests** | 2 3 5 8 | NOT TESTED |
| F-28 | Backup: export (dump/json/bak/sql/csv), validate, restore with chain check + audit-row preservation | WF-024 | FE-R-023 (picker excludes `.dump`, F-06) | backup | U (5), E (phase5) | 3 8 10 | NOT TESTED |
| F-29 | Filter Data Management console (SUPER_ADMIN manual CRUD with `_changeReason`) | BE-M-28, BR-102.. | FE-R-049 | super-admin | E (2); **38 of 41 ops unhit** | 2 3 4 5 | NOT TESTED |
| F-30 | Dashboard, dashboard cards, stats, home / module guide | WF-038 | FE-R-011/012 | dashboards, filter-operations stats | U (1); **13 ops unhit** | 2 5 | NOT TESTED |
| F-31 | System health, deployment check, debug traces, version history, help articles | — | FE-R-038/039/074, FE-R-040 | 4 modules | E (system-health, help); debug-traces zero | 2 4 5 | NOT TESTED |
| F-32 | LDAP config / test / login path | WF-037 | FE-R-021 | ldap | U (3); unhit over HTTP | 5 10 | NOT TESTED |
| F-33 | Guest cleaning request (public, unlimited, writes an audit row) | WF-035, BR-116 | FE-R-009 | guest | **zero tests** | 5 10 | NOT TESTED |
| F-34 | SUPER_ADMIN API lock (kill switch, fail-open on DB error) | WF-034, BR-122 | app-layout lockdown screen | super-admin | — | 4 5 8 | NOT TESTED |
| F-35 | Profile, photo upload (MIME + magic bytes), display settings, themes, branding | — | FE-R-013, FE-R-024/027 | uploads, config | U (gate only) | 2 5 10 | NOT TESTED |
| F-36 | Tablet shell: server discovery, server config, login, online/offline detection, tablet access by role, Android back | — | FE-R-001..004 | auth, config | U (single-implementation guard) | 2 9 | NOT TESTED (real device needed) |
| F-37 | Scheduled jobs: session sweep, password expiry, log retention, PM overdue; Windows backup task | §6 | — | app.ts | U (log-retention, password-expiry-sweep) | 3 8 | NOT TESTED |
| F-38 | Operational logging (8 channels, refusal log, redaction) | — | — | lib/logger | U (logger-redaction, log-retention) | 8 10 | NOT TESTED |
| F-39 | Installer / services / upgrade (WinSW, provision-db, apply-addresses, LAN cert) | — | — | scripts/ | — | NOT APPLICABLE on this PC (needs clean WS2022; see production-readiness 12 H1) | BLOCKED |
| F-40 | Load, soak, volume (already measured 2026-10-17/19) | — | — | — | perf framework | 6 7 | see `docs/production-readiness/` (PARTIAL at 100 users) |

## 3. Highest-risk areas (consolidated from the four sweeps; each is a claim to verify, not a verdict)

Ranked by (likelihood it is real) × (consequence for a regulated client). "Source" names the sweep row.

| # | Risk | Why it matters | Source | First probe |
|---|---|---|---|---|
| R1 | Web stage screen (`/filters/stage/:key`) never mounts the missed-PM, AHU-set-chooser and remaining-filters dialogs; a 409 `PM_PREVIOUS_TASK_PENDING` or AHU gate leaves the submit spinning | Operators cannot complete a PM-reason cleaning from the web when a PM is pending; silent hang | FE F-01 (confirmed structurally) | Playwright: operator on the stage screen scans a filter whose AHU owes a PM |
| R2 | Dynamic config PUT validates nothing (0 of 38 defs define a schema/validate hook); static PUTs for access-matrix / action-reauth / tablet-access / LDAP accept any object | Any CONFIG_UPDATE holder can store malformed policy; session / password / interlock / re-auth behaviour then runs on garbage | CS-070..074, CS-086 | PUT a wrong-typed body, read `/current`, observe login + re-auth behaviour |
| R3 | Offline replay bypasses interlock, terminal interlock, AHU-overdue, block-change and missed-PM gates; grant proves a password, not offline-ness | A tablet holding a grant can push writes the live gates would refuse; visible only via `replayExemptGates` | BR-026/028/090, BR-088 | Replay a WASH_OUT advance with a grant while an approval is PENDING; check event + audit row |
| R4 | SUPER_ADMIN unretire hard-deletes the replacement filter's cycles, events and identifiers | Only code path that destroys cleaning history; recorded only in `afterValue._sideEffects` | BR-066 | Retire → replace → unretire on the test DB; count rows before/after; read the audit row |
| R5 | Audit edit / hard delete break the chain permanently; no DB-level UPDATE trigger; Verify Chain has no UI | Chain breakage is detectable only by an API nobody can click | BR-095/123, FE C-09 | Verify-chain before/after an edit; confirm the UI offers no way to run it |
| R6 | Two read-then-create races: PM execution start and block-change request (no unique key, no transaction) | Duplicate IN_PROGRESS executions / duplicate PENDING requests under concurrent taps | CS-140, CS-141 | 10 parallel POSTs; count rows |
| R7 | Replacement Schedule upload/validate/template are raw `fetch` with no re-auth path while the server enforces `UPLOAD_REPLACEMENT_SCHEDULE`; pagination Save and three FDM mutations likewise | Enabling the re-auth row makes the feature fail with a bare 401 | FE R-01..R-04 | Enable the row for a role, attempt the upload |
| R8 | Legacy `action-reauth` config shape silently disables every policy-driven e-signature gate | Whole §11 signature layer off with one bad config write | BR-086 | Write the legacy shape on the test DB; call a gated route without a password |
| R9 | Filter approval workflow has no separation of duties (submitter can approve); `/api/hierarchy/filters` typed create does not check the AHU is active | Inconsistent with every other approval flow; filter attached to a deactivated AHU | BR-061, BR-070 | Submit and approve as the same QA user; create under a deactivated AHU |
| R10 | FDM lifecycle-step Delete routes an event id to the cycles endpoint | 404 today; wrong-row deletion if ids ever collide | FE F-02 (confirmed) | Click Delete on a lifecycle step; capture the request |
| R11 | Required `SIGNATURE` checklist question can never be answered (tablet and web have no widget) | A checklist profile with such a question blocks every batch | FE F-04 | Create the question on the test DB; run a cycle |
| R12 | Tablet-access gating is skipped offline; required-reauth cancel shows as a red error on 8 tablet actions; debug keystroke overlay always rendered | Field confusion; a QA/Admin role can operate offline on a tablet it may not use online | FE C-12, F-05, F-10 | Tablet offline with an Admin account |
| R13 | Guest cleaning request is public, unlimited, writes an audit row per call | Audit-trail flooding from the LAN | BR-116 | 1,000 POSTs; count audit rows (test DB only) |
| R14 | 250 of 429 API operations have no HTTP-level test; PM schedules (28), Filter Data Management (38), dashboards (13), stage approvals (6), report reviews (6) have none | Regressions in those modules are invisible to the suite | existing-tests-map | Phase 5 generated endpoint tests |
| R15 | Password-reuse check capped at 12 months regardless of `preventReuseCount`; notification retries are in-process timers lost on restart; system-health disk check uses `wmic` on `C:` | Policy not enforced as configured; stranded log rows; false health | CS-100, CS-002, CS-102 | Unit probes |

Dead or placeholder controls found (not defects to fix, but must not be "tested as passing"): Send for
Review (10 mounts, constant `false`), AHU Dashboard "Swap Sets", Role Assignments `PER_USER`/`ROLE_GATED`
options, web `DryerDurationDialog`, `/filters/:id/operate` ignoring `:id`, FDM generic-tab branch,
debug `handleToggleEntityTracing`, users `bulkDeleting` flag, 11 `customPagePath` values pointing at
routes that do not exist (frontend-inventory §5.1).

## 4. What this inventory does not cover

- Kotlin RFID scanner app (`rfid_scan_app/`) and the Capacitor native layer (`ServerScanPlugin.java`,
  `RfidPlugin.java`): no device here; listed as BLOCKED in F-36.
- Installer and Windows services (F-39): needs a clean machine.
- Runtime behaviour of anything marked UNVERIFIED in the detail documents.
