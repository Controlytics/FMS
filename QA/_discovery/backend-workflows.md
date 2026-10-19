# Backend business-rule and workflow inventory

DigiLog / FMS API (`apps/api`, Fastify + Prisma). Read-only derivation from source on branch `RFID`, 2026-10-19. Nothing was run against the API or database. Every count in this document comes from a grep or ls listed in the footnote (§11). Endpoint rows are NOT repeated here; they live in `docs/production-readiness/03_API_ENDPOINT_INVENTORY.md` (429 operations) and are referenced by path + source line.

ID scheme: `BE-M-nn` module, `WF-nnn` workflow / state machine, `BR-nnn` business rule, `ERR` error code. These IDs are meant to merge into `QA/FEATURE_INVENTORY.md` and `QA/BUSINESS_WORKFLOW_TESTS.md`.

## 0. Counts

| Thing | Count | Source |
|---|---|---|
| API modules | 33 | `ls apps/api/src/modules` |
| Workflows / state machines documented (§3) | 40 (16 with an explicit DB status enum) | this doc |
| Business rules catalogued (§4) | 128 | this doc |
| `AppError` / direct-reply refusal sites (non-test, non-e2e) | 424 | §11 cmd 5 |
| Distinct API-thrown error codes | 123 | §11 cmd 5 |
| Distinct shared pipeline-executor guard codes | 30 (24 not thrown anywhere else) | §11 cmd 6 |
| Offline replay codes (token + time window) | 12 | `lib/offline-replay-token.ts`, `lib/offline-time-window.ts` |
| Grand distinct error-code vocabulary | 159 | union of the three |
| node-cron jobs | 4 (+1 Windows scheduled task outside the app) | `apps/api/src/app.ts:849-857` |
| Config definitions | 38 | `ls apps/api/src/modules/config/defs/*.def.ts` |
| Permission constants / re-auth actions / audit actions / sidebar items | 106 / 127 / 98 / 27 | §11 cmd 8 |
| Prisma models / enums / migrations | 61 / 24 / 14 (1 baseline + 13) | §11 cmd 9 |
| DB triggers (functions) | 5 triggers, 6 functions | baseline migration |
| Partial unique indexes expressing business rules | 2 | baseline + `20260925091000` |
| Route registrations with a `schema:` block | 100% (every `app.<verb>(` in every routes file) | §11 cmd 10 |
| Default roles | 6 (SUPER_ADMIN 6 > ADMIN 5 > SUPERVISOR 4 > MAINTENANCE 3 > OPERATOR 2 > VIEWER 1) | `apps/api/prisma/default-roles.ts:10-159` |

## 1. Modules (BE-M-nn)

Service files listed are the non-test `.ts` files that hold rules; `routes.ts` is implied for every module.

| ID | Module (`apps/api/src/modules/…`) | Owns | Rule-bearing files |
|---|---|---|---|
| BE-M-01 | `admin-requests` | Unauthenticated "ask an admin" requests (new user, unlock, reset, modify role); approve/reject by ADMIN. Public `user-lookup` GET. | `admin-request.service.ts` |
| BE-M-02 | `assets` | Asset templates, generic `AssetInstance` CRUD (Block/Area/AHU/Filter), identifiers (RFID), bulk filter upload, filter creation approval workflow (submit → review → approve / reject → resubmit). | `filter-approval.service.ts`, `filter-workflow.ts`, `services/instance.service.ts`, `services/identifier.service.ts`, `services/filter.service.ts`, `services/bulk-upload-filter.service.ts`, `services/filter-fields.service.ts`, `services/template.service.ts`, `helpers/*` |
| BE-M-03 | `audit` | Audit trail read (visibility-scoped), report-export log gate, redact / bulk-redact (chain-preserving), edit, hard delete / bulk delete (chain-breaking, trigger disabled in-tx), verify-chain. | `routes.ts` (logic inline), `lib/audit.ts`, `lib/audit-verify.ts`, `lib/audit-visibility.ts`, `lib/hash-chain.ts` |
| BE-M-04 | `auth` | Login (lockout, status, expiry, tablet gate, session conflict), logout / beacon, refresh, `/me`, profile, change-password (policy + history), `/verify` (re-auth probe), forgot-password, offline-grant. | `auth.service.ts`, `auth.repository.ts` |
| BE-M-05 | `backup` | Export (dump/json/bak/sql/csv), validate, restore (JSON/BAK/.dump) with chain check, signature check, trigger disable, audit-row preservation, safety dump + rollback. | `backup.service.ts`, `backup.repository.ts`, `backup.helpers.ts`, `pg-tools.ts` |
| BE-M-06 | `block-change-requests` | Cross-block cleaning: request → approve/reject; single-use approval consumed at cycle start; mode NONE / CONFIRM / APPROVAL from config. | `block-change.service.ts` |
| BE-M-07 | `checklist-profiles` | Checklist profiles + questions, snapshot-then-bump versioning, disable guard (`CHECKLIST_IN_USE`), delete guards. | `checklist-profile.service.ts` |
| BE-M-08 | `cleaning-profiles` | Cleaning pipelines (STAGE/CHECKLIST nodes + edges), lineage versioning (update = new ACTIVE row in lineage, old row archived), toggle/archive/delete guards, disabled-checklist reference refusal. | `cleaning-profile.service.ts` |
| BE-M-09 | `config` | 38 config defs (dynamic GET/PUT per def), static config routes (branding, roles/user config, field-ids, tablet-access, access-matrix, action-reauth, report-*, offline-cache, dashboard-cards, cleaning-profile-assignment, export-options, pm/replacement schedule filters, user-id), `/current` public reads, secret redaction. | `config.service.ts`, `config.repository.ts`, `dynamic-routes.ts`, `static-routes/*.ts`, `defs/*.def.ts`, `lib/config-registry.ts`, `lib/config-discovery.ts` |
| BE-M-10 | `dashboards` | Dashboards, widgets, layout, assignment; `timeseries_chart` widget returns `[]`. | `routes.ts` |
| BE-M-11 | `debug-traces` | Audit-trail re-read as "traces" (visibility-scoped since 2026-08-27), operation-trace toggle. | `routes.ts` |
| BE-M-12 | `deployment-check` | SUPER_ADMIN health / configuration sanity report incl. `getReauthHealth()`. | `routes.ts` |
| BE-M-13 | `equipment-groups` | Equipment groups (exactly 3 instruments), range validation, snapshot-then-bump versioning, deactivate/delete guards, instrument reading fetch via `hardenedFetch`. | `equipment-groups.service.ts`, `instrument-fetch.ts` |
| BE-M-14 | `filter-operations` | THE cleaning-cycle engine: start / advance / advance-with-checklist / submit-checklist / bypass / terminate / bulk-operate, stage interlock, AHU completion gate, retire / replace, current-state + batch-states, cycles / events / cleaning-record reads, decision tape. | `cycle-write/*.ts` (7 files), `stage-interlock.ts`, `ahu-completion-gate.ts`, `local-context.ts`, `filter-resolver.ts`, `stage-rules.ts`, `manual-cycle.ts`, `filter-operations.service.ts`, `current-state.ts`, `batch-cache.ts`, `batch-preload.ts`, `tape/*`, `helpers.ts`, `events-routes.ts` |
| BE-M-15 | `filter-profiles` | Filter profiles (→ cleaning profile + applicable templates), versioning, assign to filters. | `filter-profile.service.ts` |
| BE-M-16 | `guest` | Unauthenticated guest cleaning request → gated notification + audit row. | `routes.ts` |
| BE-M-17 | `help` | Help articles + versions (SUPER_ADMIN writes). | `routes.ts` |
| BE-M-18 | `hierarchy` | Typed Block/Area/AHU/Filter reads and typed filter create/update/delete (mirrors into `asset_instances` via trigger). | `hierarchy.service.ts`, `assets/services/filter.service.ts` |
| BE-M-19 | `ldap` | LDAP config, test, status; login path auth + auto-provision + attribute/role sync. | `ldap.service.ts` |
| BE-M-20 | `notification-delivery` | Email/SMS config (+OAuth2), templates, logs, test send, dispatcher for rules. | `delivery.service.ts`, `notification-dispatcher.ts`, `config-loader.ts`, `template-engine.ts`, `channels/*` |
| BE-M-21 | `notification-rules` | Event → recipients (ROLE/GROUP/USER) rules, cooldown, toggle, test. | `routes.ts` |
| BE-M-22 | `notifications` | In-app notifications: list (role/user + gated types), read/unread, delete (permission-gated). | `notification.service.ts`, `notification.repository.ts` |
| BE-M-23 | `pm-schedules` | PM schedules per AHU/year, CSV upload (append-only), separation rule, 3-step approval, edit/resubmit, due tasks, missed-PM gate + write-offs, overdue deviation sweep + acknowledge, QNN numbers, executions. | `pm-import.ts`, `pm-separation.ts`, `pm-separation-guard.ts`, `pm-approval.ts`, `pm-schedule-crud.ts`, `pm-due-tasks.ts`, `pm-pending-tasks.ts`, `pm-deviations.ts`, `pm-executions.ts`, `pm-workflow.ts`, `pm-ahu-config.ts`, `pm-shared.ts`, `qnn.ts`, `pm-export.ts`, `execution-routes.ts` |
| BE-M-24 | `replacement-schedule` | Replacement schedule upload (xlsx), 3-step approval, due/tasks/blocked lists, execute replacement (all-AHU-filters task model). | `service.ts`, `workflow.ts`, `template.service.ts`, `export.ts` |
| BE-M-25 | `report-reviews` | Ad-hoc report review → approve e-signature flow (PENDING_REVIEW → PENDING_APPROVAL → APPROVED / REJECTED). | `service.ts` |
| BE-M-26 | `roles` | Roles CRUD with hierarchy + privilege-escalation guard; SUPER_ADMIN hidden from non-SA. | `role.service.ts` |
| BE-M-27 | `stage-approvals` | QA interlock approvals for WASH_OUT / DRY_OUT leave-gate: queue, approve, reject (rewinds filter), bulk-decide, supersede. | `service.ts`, `stage-details.ts` |
| BE-M-28 | `super-admin` | API kill-switch, Filter Data Management console (manual CRUD of cycles, events, PM entries, notifications, QNN, admin/block requests, retirements, replacements, RFID events) with mandatory `_changeReason`. | `routes.ts`, `record-edit-routes.ts`, `rfid-event-edit.ts`, `manual-change.ts` |
| BE-M-29 | `sync` | `/since` delta feed for the tablet cache (version cursors; filters by `updatedAt`). | `sync.service.ts` |
| BE-M-30 | `system-health` | SUPER_ADMIN/ADMIN health snapshot. | `routes.ts` |
| BE-M-31 | `uploads` | Profile photo upload (MIME allowlist + magic bytes + size). | `routes.ts` |
| BE-M-32 | `user-groups` | Notification recipient groups. | `routes.ts` |
| BE-M-33 | `users` | User CRUD, enable/disable/unlock/reset, reset requests, bulk delete, hierarchy guard (`assertCanManageTarget`), SUPER_ADMIN hiding. | `user.service.ts`, `user.repository.ts` |

## 2. Cross-cutting enforcement layers (read these before any workflow)

| Layer | Where | What it decides |
|---|---|---|
| Public paths | `plugins/auth.ts:180-194` | No JWT for `/api/auth/login`, `/forgot-password`, `/beacon-logout`, `/api/health`, `/api/guest/cleaning-request`, OAuth2 callback; GET-only public: `/api/config/branding`, `/api/config/datetime/current`, `/uploads/photos/`, `/uploads/branding/`, `/api/roles/active`, `/api/admin-requests/user-lookup`. Swagger only when `API_DOCS=on` (`auth.ts:211`). |
| JWT + session | `plugins/auth.ts:249-298` | 401 `UNAUTHORIZED` (no token), `TOKEN_EXPIRED`, `SESSION_INVALID` (terminated), `SESSION_EXPIRED` (idle or max-duration), `ACCOUNT_INACTIVE`. Sliding expiry touched at most once per `SESSION_TOUCH_INTERVAL_MS`. User/session cache invalidated on role change, disable, unlock, reset. |
| Forced password change | `plugins/auth.ts:310-370` | When `forcePasswordChange` (or derived expiry, non-SA) every request 403s `FORCE_PASSWORD_CHANGE` / `PASSWORD_EXPIRED` except an exact method+path allowlist of 6 (`change-password`, `logout`, `me`, `password-policy/current`, `tablet-access/my-features`). |
| SUPER_ADMIN API lock | `plugins/auth.ts:380-410`, `lib/super-admin-lock.ts` | When `system_config['super-admin-api-access']` is off, SA is frozen to 7 method+path pairs, 403 `SUPER_ADMIN_API_LOCKED`. **Fail-open** on DB error. Flip = `PUT /api/super-admin/api-lock` with `enforceReauthAlways('TOGGLE_SUPER_ADMIN_API_ACCESS')`. |
| RBAC | `plugins/rbac.ts:19-110` | `requirePermission`, `requireAnyPermission`, `requireRole`, `requireSuperAdmin`. SUPER_ADMIN bypasses ALL of them (incl. `requireRole`). Role perms cached 5 s. `hasEffectivePermission` (`packages/shared/src/types/permissions.ts:257`) also accepts `X_READ` for `X_VIEW` and `X_MANAGE` for `X_{CREATE,UPDATE,DELETE,VIEW,READ,EXPORT}`. |
| Re-auth (e-signature) | `lib/reauth-check.ts` | `enforceReauth(action)` – gated by `system_config['action-reauth']` (role list per action, 10 s cache); `enforceReauthAlways(action)` – cannot be switched off. Both strip `_currentPassword` from the body FIRST (`takeBodyPassword`), accept header `x-reauth-password`, return 401 `REAUTH_REQUIRED` with no password, 401 `REAUTH_FAILED` / 403 `ACCOUNT_LOCKED` on bad password (counts toward the login lockout), write `REAUTH_FAILED` / `REAUTH_SUCCESS` audit rows and publish the success row id to the request store so every later audit row carries `signature_audit_id`. Both return `{ok:true}` immediately when `req.offlineReplayVerified`. Legacy nested config shape ⇒ ALL gates silently off (logged at error; `getReauthHealth()` surfaces it). |
| Offline replay | `plugins/auth.ts:423-477`, `lib/offline-replay-token.ts`, `lib/offline-time-window.ts` | Header `x-offline-replay-token` (HMAC JWT, 24 h, bound to user+session) verified at onRequest; honoured ONLY when route URL starts with `/api/filters/` (`isOfflineReplayRoute`). Bare `x-offline-replay: true` ⇒ 401 `OFFLINE_REPLAY_HEADER_DEPRECATED`. A verified replay must carry `offlinePerformedAt` + `clientOpId` (400 `OFFLINE_REPLAY_FIELDS_REQUIRED`); `offlinePerformedAt` ≤ now+5 min, ≥ now−30 d, after cycle start and after previous event. Every gate skipped is appended to `replayExemptGates` on the event + audit row. |
| Date range guard | `lib/date-range-guard.ts`, registered `app.ts:640` | Global preHandler: `from/to`, `startDate/endDate`, `dateFrom/dateTo` inverted ⇒ 400 `INVALID_DATE_RANGE`; bare end date expands to 23:59:59.999; non-date values ignored. |
| Rate limits | `app.ts:268-270`, `modules/auth/routes.ts:26-29,295,329-332` | `global:false`; only `/login` 100/min, `/verify` 50/min, `/change-password` 50/min, keyed by `rateLimitKeyGenerator` (IPv6 /64). 429 `TOO_MANY_REQUESTS`. |
| Error handler | `app.ts:296-480` | `AppError` → its status/code; 429; 413 `BODY_TOO_LARGE`; 400 `VALIDATION_ERROR` (Fastify schema + Zod); 415 `UNSUPPORTED_MEDIA_TYPE`; 400 `PARSE_ERROR`; Prisma P2002 → 409 `CONFLICT`; P2000 → 400 `VALUE_TOO_LONG`; P2024/P2028 → 503 `SERVICE_BUSY`; other known Prisma → 400 `DATA_CONSTRAINT`; else 500 `INTERNAL_ERROR` + `SYSTEM_ERROR` notification (1/min). Only `AppError` messages reach clients. |
| Refusal log | `lib/refusal-log.ts` (onSend) | Every 4xx/5xx logs `errorCode` + `errorMessage` to http/error/security channels. |
| HTML sanitizer | `lib/sanitize.ts` | `stripHtml` / `sanitizeStrings` (sanitize-html, no tags). **Not global** – applied in 11 call-site files (§7). |
## 3. Workflows and state machines (WF-nnn)

Conventions: "Who" = RBAC preHandler → re-auth action (R = `enforceReauth`, policy-driven; RA = `enforceReauthAlways`, cannot be turned off). "Writes" = tables touched. "Audit" = `audit_trail.action`. "Refuses" = error codes (see §5 for status). Offline = behaviour under a verified offline-replay grant.

### WF-001 Cleaning cycle (core engine) — `modules/filter-operations/cycle-write/*`

**Entities:** `cleaning_cycles.status` ∈ {IN_PROGRESS, COMPLETED, TERMINATED} (`CleaningCycleStatus`); the FILTER's position = `filter_details.current_lifecycle_state` (a STAGE key from the pinned cleaning profile, or `CLEANING_CYCLE_COMPLETED`, or null); `filter_details.current_cycle_id`. Each transition writes a `filter_events` row with `checksum` (write-only, never verified) and `attributes.clientOpId`.

**Pipeline shape:** cleaning profile = STAGE / CHECKLIST nodes + edges, frozen per cycle by `cleaning_cycles.profile_id` at start (`cycle profile_id locked`). Checklists between stages gate the next advance; a DISABLED checklist is skipped wherever it sits (`enabledChecklistNodes`, `packages/shared/src/pipeline-executor/transitions.ts:294`; skips named in `attributes.skippedChecklists`).

| # | Transition | Endpoint (inventory row) | Who | Guards (in order) | Writes | Audit | Refuses |
|---|---|---|---|---|---|---|---|
| 1 | **Start** | `POST /api/filters/:id/start-cycle` (`routes.ts:294`) | `FILTER_OPERATE` → R `START_CLEANING_CYCLE` | not retired (`local-context.ts:90`); approvalStatus APPROVED (`start-cycle.ts:116`); profile assigned (`:121`); no IN_PROGRESS cycle (`:127`, re-checked under lock `:287`); AHU not replacement-overdue (`:140`, offline exempt); cross-block clearance (`filter-resolver.ts:89`; mode NONE/CONFIRM/APPROVAL; offline exempt); reason required + valid (`:155,:217`), justification ≥10 chars when reason demands (`:219`); missed-PM gate (`:195`, see WF-009); profile ACTIVE (`:239`); equipment group active (`:325`); block-change approval consumed single-use (`:306`) | `cleaning_cycles` (create, pins `profile_id`, `equipment_group_id`+version), `filter_events` CYCLE_STARTED, `filter_details` (currentCycleId set, lifecycleState null), `pm_schedule_entries.skipped*` + `deviations` closure when write-offs given, `block_change_requests.status=EXPIRED` on consume | `CYCLE_STARTED`, `PM_TASK_SKIPPED` per write-off | `FILTER_RETIRED`, `FILTER_NOT_APPROVED`, `NO_PROFILE`, `CYCLE_ACTIVE`, `AHU_REPLACEMENT_OVERDUE`, `BLOCK_CHANGE_REQUIRED`, `BLOCK_CHANGE_CONFIRM`, `BLOCK_MISMATCH`, `REASON_REQUIRED`, `INVALID_REASON`, `JUSTIFICATION_REQUIRED`, `PM_PREVIOUS_TASK_PENDING`, `PROFILE_DISABLED`, `INVALID_EQUIPMENT_GROUP`, `STATE_CHANGED`/`CYCLE_CHANGED` |
| 2 | **Advance** (stage → stage, incl. in-place dryer actions) | `POST /api/filters/:id/advance` (`routes.ts:338`) | `FILTER_OPERATE` → R `ADVANCE_FILTER_STAGE` + R `STAGE_<TARGET>` (`withStageAction`) | active cycle (`advance.ts:153`); replay payload fields (`:128`); clientOpId dedup → cached snapshot (`:143`); offlinePerformedAt window (`:164`); profile present (`:182`); **tape version fresh** (`STALE_TAPE`); checklist gate passed (guard #14); interlock leave-gate (`assertStageApprovedToLeave`, offline exempt, `:201-209`); not complete (#15); target reachable (#16) / exists (#17); parameters (#18/#19); equipment group (#20, #30 auto-resolve single group, #31, #32 version pin); dryer guards #21–#28 (SET_DURATION only into DRY_IN, positive duration, readings only in DRY_IN after start and half-time, cannot leave DRY_IN without readings/half-time, **cannot ENTER DRY_IN without SET_DURATION** `DRYER_DURATION_REQUIRED`); WASH_IN readings required (`:310`); instrument readings required/numeric/in-range (#27–#29 instruments.ts); terminal interlock stage cannot auto-complete (`:493`, offline exempt); row lock `lockAndVerifyFilterState` | `filter_events` STATE_TRANSITION (+DRYER_STARTED / DRYER_READINGS_SUBMITTED in attributes), `cleaning_cycles` (dryer fields, equipment pin, status COMPLETED + completedAt when END reached), `filter_details.current_lifecycle_state`, `cleaning_stage_approvals` PENDING row when entering an interlock stage, notification to approver role | `STATE_TRANSITION`, `CYCLE_COMPLETED` | `NO_ACTIVE_CYCLE`, `NO_PROFILE`, `STALE_TAPE`, `CHECKLIST_PENDING`, `STAGE_APPROVAL_PENDING` (423), `STAGE_APPROVAL_REJECTED` (423), `CYCLE_COMPLETE`, `OUT_OF_SEQUENCE`, `INVALID_TARGET`, `PARAM_REQUIRED`, `PARAM_OUT_OF_RANGE`, `INVALID_EQUIPMENT_GROUP`, `MULTIPLE_EQUIPMENT_GROUPS`, `NO_EQUIPMENT_GROUP`, `GROUP_VERSION_MISSING`, `INVALID_DRYER_ACTION`, `INVALID_DURATION`, `NOT_IN_DRY_IN`, `DRYER_NOT_STARTED`, `DRYER_NOT_READY`, `DRYER_DURATION_REQUIRED`, `DRYER_READINGS_REQUIRED`, `WASH_IN_READINGS_REQUIRED`, `READING_REQUIRED`, `INVALID_READING`, `READING_OUT_OF_RANGE`, `INTERLOCK_TERMINAL_STAGE` (422), `AHU_INTERLOCK_PENDING` (422), `STATE_CHANGED`, `CYCLE_CHANGED`, `OFFLINE_*` |
| 3 | **Submit checklist** | `POST /api/filters/:id/submit-checklist` (`routes.ts:515`) | `FILTER_OPERATE` → R `SUBMIT_CHECKLIST_WITH_SIGNATURE` | active cycle (`submit-checklist.ts:127`); a checklist at the stage (`:196`), not disabled (`:182`); schema drift (#4), required answers (#5), unknown keys (#6); not already submitted (`:389`) | `filter_events` CHECKLIST_COMPLETED (pins checklist version), cycle COMPLETED when the checklist is terminal | `CHECKLIST_COMPLETED`, `CYCLE_COMPLETED` | `NO_ACTIVE_CYCLE`, `NO_CHECKLIST_AT_TARGET`, `CHECKLIST_DISABLED`, `SCHEMA_DRIFT`, `VALIDATION_ERROR`, `INVALID_QUESTIONS`, `ALREADY_SUBMITTED` |
| 4 | **Advance with checklist** (atomic) | `POST /api/filters/:id/advance-with-checklist` (`routes.ts:428`) | `FILTER_OPERATE` → R `ADVANCE_FILTER_STAGE` + `SUBMIT_CHECKLIST_WITH_SIGNATURE` + stage action | advance guards then checklist guards in ONE transaction; refuses when no checklist at target (`advance-with-checklist.ts:85`) | both of the above | `STATE_TRANSITION` + `CHECKLIST_COMPLETED` | union of 2 and 3 |
| 5 | **Bypass** (deviation) | `POST /api/filters/:id/bypass` (`routes.ts:585`) | `FILTER_BYPASS` → R `BYPASS_FILTER_STAGE` | profile `flowMode === 'BYPASS_ENABLED'` (#38) else 403 `BYPASS_FORBIDDEN`; target is a STAGE (#39); justification; replay payload (`bypass.ts:39`) | `filter_events` BYPASS_DEVIATION, `filter_details.current_lifecycle_state` | `BYPASS_DEVIATION` | `BYPASS_FORBIDDEN`, `INVALID_TARGET`, `JUSTIFICATION_REQUIRED`, `NO_PROFILE` |
| 6 | **Terminate** | `POST /api/filters/:id/terminate-cycle` (`routes.ts:801`) | `FILTER_BYPASS` → R `TERMINATE_CLEANING_CYCLE` | active cycle; justification (sanitised); replay payload | `cleaning_cycles` TERMINATED + terminatedAt, `filter_details` (cycle null, state null), `filter_events` CYCLE_TERMINATED | `CYCLE_TERMINATED` | `NO_ACTIVE_CYCLE`, `JUSTIFICATION_REQUIRED` |
| 7 | **Complete** (implicit) | inside 2 / 3 | — | last STAGE leads to END and no pending checklist after target (`advance.ts:480`) | cycle COMPLETED, `filter_details.current_lifecycle_state = CLEANING_CYCLE_COMPLETED`, CYCLE_COMPLETED event | `CYCLE_COMPLETED` | `INTERLOCK_TERMINAL_STAGE` |
| 8 | **Manual cycle (SA console)** | `PATCH /api/assets/instances/:id/lifecycle-state`, super-admin data routes | `FILTER_STATUS_UPDATE` → R `UPDATE_FILTER_LIFECYCLE`; SA console `requireRole('SUPER_ADMIN')` + R `SUPER_ADMIN_DATA_EDIT` + `_changeReason` | reason validated against profile reasons (`manual-cycle.ts:35-51`); an in-progress cycle is "broken" (TERMINATED + `attributes.broken`) | cycles/events | `FILTER_LIFECYCLE_STATE_CHANGED`, `MANUAL_RECORD_*` | `REASON_REQUIRED`, `INVALID_REASON`, `JUSTIFICATION_REQUIRED` |

**Decision tape:** `tape/tape-generator.ts` + `actions.ts:computeTapeVersion`. The current-state response carries `tapeVersion`; cycle-bound writes must echo it (guard `assertTapeVersionFresh` → 409 `STALE_TAPE`). Bulk items without it are refused per item with 400 `TAPE_VERSION_REQUIRED` (`bulk-operate.ts:102`), except the advance half of `start-and-advance`.

**Concurrency:** `lockAndVerifyFilterState` (`locking.ts:30`) row-locks the filter inside the tx and compares expected stage/cycle → 409 `STATE_CHANGED` / `CYCLE_CHANGED`. DB-level: partial unique index `idx_cleaning_cycles_one_in_progress_per_filter` (one IN_PROGRESS cycle per filter) and trigger `trg_filter_event_consistency` (event.filter_id must equal cycle.filter_id).

### WF-002 Stage interlock approvals — `modules/stage-approvals/service.ts`, `filter-operations/stage-interlock.ts`

`cleaning_stage_approvals.status` ∈ {PENDING, APPROVED, REJECTED, SUPERSEDED}. Config `stage-interlock` (enabled + approver role per stage). Entering an interlock stage (WASH_OUT / DRY_OUT by default) creates a PENDING row (`requestStageApprovalTx`, `stage-interlock.ts:189`) and notifies the approver role; leaving needs the LATEST row for (cycle, stage) to be APPROVED (`assertStageApprovedToLeave`, `:92`).

| Transition | Endpoint | Who | Rules | Writes / Audit | Refuses |
|---|---|---|---|---|---|
| Approve | `POST /api/stage-approvals/:id/approve` (`routes.ts:43`) | `STAGE_APPROVAL_DECIDE` → RA `APPROVE_CLEANING_STAGE` | status PENDING; decider role == frozen `approverRole` (SA exempt) (`service.ts:55`); decider ≠ requester (`:66` `SELF_APPROVAL_FORBIDDEN`); filter still at the gate (`APPROVAL_STALE` `:156`); conditional update wins race (`CONCURRENT_DECISION` `:345`) | row APPROVED, `filter_events` APPROVAL_GRANTED; `STAGE_APPROVAL_APPROVED`; notify operator | `INVALID_STATUS`, `WRONG_APPROVER_ROLE`, `SELF_APPROVAL_FORBIDDEN`, `APPROVAL_STALE`, `CONCURRENT_DECISION`, `NOT_FOUND` |
| Reject | `POST /api/stage-approvals/:id/reject` (`:62`) | same → RA `REJECT_CLEANING_STAGE` | remarks ≥3 chars (`:408`); cycle still IN_PROGRESS (`CYCLE_NOT_ACTIVE` `:421-424`); same role/self/race rules; **rewinds** the filter to `rejectToStateKey` and clears dryer fields when rewinding past DRY_IN (`:455-510`) | row REJECTED, STATE_TRANSITION event with `deviationDetails.type=STAGE_APPROVAL_REJECTED`, `filter_details.current_lifecycle_state`, `cleaning_cycles.dryer*` nulled; `STAGE_APPROVAL_REJECTED`; notify operator | `REMARKS_REQUIRED`, `CYCLE_NOT_ACTIVE`, + approve set |
| Bulk decide | `POST /api/stage-approvals/bulk-decide` (`:84`) | same → RA for the kinds present | per-item, partial success | as above | as above |
| Supersede (lazy) | inside `queue()` (`:187-201`) | — | a PENDING row whose filter already left the gate becomes SUPERSEDED when the queue is read | `STAGE_APPROVAL_SUPERSEDED` | — |
| Queue visibility | `GET /api/stage-approvals/queue` (`:9`) | `STAGE_APPROVAL_VIEW` | non-SA see rows for their role OR requested by them; SA sees all (`:238,:284`) | — | — |

### WF-003 AHU completion gate — `filter-operations/ahu-completion-gate.ts`

Config `ahu-completion-process.mode`. `assertAhuInterlockSatisfied` (`:456`) refuses a filter's advance INTO the final stage until every counted sibling filter of the AHU (optionally per filter set SET_A/SET_B, `pm-ahu-config.ts`) is ready (`isReadyForFinalStage`, `:121`): 422 `AHU_INTERLOCK_PENDING`. Read endpoints `GET /api/filters/ahu/:ahuId/completion-status`, `POST /ahu-completion-status/batch`, `/ahu-set-availability`, `/cleaning-profiles/without-final-checklist` (all `ASSET_READ`).

### WF-004 Bulk operate — `cycle-write/bulk-operate.ts`

`POST /api/filters/bulk-operate` (`routes.ts:641`), `FILTER_OPERATE` → R for the union of actions in the batch (`reauthActionsForItems`: START_CLEANING_CYCLE / ADVANCE_FILTER_STAGE / SUBMIT_CHECKLIST_WITH_SIGNATURE / STAGE_*). Kinds: `advance`, `start-and-advance`, `advance-with-checklist`, `submit-checklist`. Per item: own transaction + audit; partial success; `start-and-advance` threads `<clientOpId>:start` into the start and treats `CYCLE_ACTIVE` from the start half as "already started, continue" (`:115-121`). Failures return `{code, message}` where message is only forwarded for `AppError` (`:135-139`).

### WF-005 Offline replay — see §2 row "Offline replay" + `apps/web/src/lib/sync-engine.ts` (client)

Grant: `POST /api/auth/offline-grant` (`auth/routes.ts:415`) always needs the live password (401 `PASSWORD_REQUIRED`); wrong password → `REAUTH_FAILED` audit + lockout counter; successful grant is deliberately NOT audited (operator decision 2026-08-27). Replay of start/advance/checklist/bypass/terminate: re-auth gates pass (`enforceReauth*` return early), interlock leave-gate, terminal-interlock, AHU-replacement-overdue, block-change, missed-PM question and dryer half-time (uses `offlineTime`) are exempt and recorded in `replayExemptGates`; `offlinePerformedAt` is validated (12 `OFFLINE_*` codes) and idempotency is by `clientOpId` scoped to the cycle (`lib/idempotency.ts:33-93`). Write-offs collected offline (`pmSkips`) ARE applied on replay (`start-cycle.ts:205-213`).

### WF-006 PM schedule entry approval — `pm-schedules/pm-approval.ts`, `pm-workflow.ts`

`pm_schedule_entries.approval_status` ∈ {PENDING, PENDING_REVIEW, PENDING_APPROVAL, APPROVED, REJECTED} (`PmEntryApprovalStatus`); `pm_schedules.status` ∈ {DRAFT, ACTIVE, ARCHIVED}. Config `pm-schedule-approval` = `{workflowEnabled, uploadRole, reviewRole, approvalRole}` (default OFF → entries land APPROVED / legacy PENDING single-step).

| Transition | Endpoint | Who | Rules | Audit | Refuses |
|---|---|---|---|---|---|
| Upload → PENDING_REVIEW (or APPROVED when workflow off) | `POST /api/pm-schedules/upload` (`routes.ts:202`) | `PM_CREATE`∨`PM_UPLOAD` → R `UPLOAD_PM_SCHEDULES`; `assertPmRole(uploadRole)` | see WF-007 | `PM_SCHEDULE_IMPORTED` + QNN per visit | `INVALID_FILE_TYPE`, `EMPTY_FILE`, `NO_ROWS`, `PARSE_ERROR`, `FORBIDDEN_ROLE`, `PM_DISABLED` |
| Review approve → PENDING_APPROVAL / reject → REJECTED(stage REVIEW) | `POST /entries/review` (`:395`) | `PM_REVIEW` → R `REVIEW_PM_SCHEDULE` | entry PENDING_REVIEW (or PENDING when workflow on); reviewer ≠ submitter (`assertNotOwnEntry` `:110-121`, applies to SA too); reject needs remarks ≥3 | `PM_SCHEDULE_REVIEWED` / `PM_SCHEDULE_REJECTED` | `SELF_APPROVAL_FORBIDDEN`, `REMARKS_REQUIRED`, `NOT_FOUND` |
| Approve → APPROVED (applies `pendingPlannedDate` if staged; re-checks separation) | `POST /entries/approve` (`:419`) | `PM_APPROVE` → R `APPROVE_PM_SCHEDULE` | entry PENDING_APPROVAL (or PENDING); approver ≠ submitter and ≠ reviewer; separation re-validated at approval (`pm-separation-guard.ts`) | `PM_SCHEDULE_APPROVED` | `SELF_APPROVAL_FORBIDDEN`, `PM_VISIT_OVERLAP`, `NOT_FOUND` |
| Reject → REJECTED(stage APPROVAL) | `POST /entries/reject` (`:442`) | `PM_APPROVE` → R `REJECT_PM_SCHEDULE` | remarks ≥3 | `PM_SCHEDULE_REJECTED` | `REMARKS_REQUIRED` |
| Resubmit REJECTED → PENDING_REVIEW/APPROVED | `POST /entries/:id/resubmit` (`:465`) | `PM_CREATE`∨`PM_RESUBMIT` → R `RESUBMIT_PM_ENTRY` | only REJECTED; valid date; separation | `PM_SCHEDULE_RESUBMITTED` | `INVALID_STATUS`, `INVALID_DATE`, `PM_VISIT_OVERLAP` |
| Edit APPROVED → stages `pendingPlannedDate`, status PENDING_APPROVAL | `PUT /entries/:id/edit` (`:493`) | `PM_UPDATE`∨`PM_EDIT_ENTRY` → R `EDIT_PM_SCHEDULE` | only APPROVED; separation checked now AND again at approval | `PM_SCHEDULE_EDIT_REQUESTED` | `INVALID_STATUS`, `INVALID_DATE`, `PM_VISIT_OVERLAP` |
| Reviewer modifies PENDING_REVIEW | `PUT /entries/:id/review-edit` (`:520`) | `PM_REVIEW` → R `REVIEW_PM_SCHEDULE` | only PENDING_REVIEW | `PM_SCHEDULE_REVIEW_MODIFIED` | `INVALID_STATUS` |
| Schedule create / update / delete | `POST /`, `PUT /:id`, `DELETE /:id` (`:660,:696,:732`) | `PM_CREATE`/`PM_UPDATE` → R `CREATE/UPDATE/DELETE_PM_SCHEDULE` | one ACTIVE schedule per (AHU, year) (`pm-schedule-crud.ts:46`); replace refuses when any dropped entry is APPROVED, skipped or executed (`PM_ENTRY_HAS_EVIDENCE` `:120`); delete refuses with executions in progress (`:205`); update archives the old schedule and creates version+1 | `CREATED`/`UPDATED`/`DELETED` | `CONFLICT`, `PM_ENTRY_HAS_EVIDENCE`, `VALIDATION_ERROR`, `NOT_FOUND` |

### WF-007 PM upload (append-only import) — `pm-import.ts`

Rows parsed (ahu_name, scheduled_date YYYY-MM-DD or DD-MM-YYYY, tolerance_days 0–365, default from settings). Per AHU: existing ACTIVE schedule for the year is reused or created; a date already present is **skipped unchanged** (idempotent re-upload, `:258-270`); separation (`assertSetSeparation`) is checked over existing + new entries and **every** offending new row is reported (`:290-310`); nothing is ever deleted. Audit `PM_SCHEDULE_IMPORTED` (counts + AHU names) and one QNN per visit (`generateQnn`, `pm-workflow.ts:161`). Module must be enabled (`pm-shared.ts:15`, 404 `PM_DISABLED`).

**Separation rule (BR-040):** windows `plannedDate ± toleranceDays`; sorted by date, violation when `next.windowStart <= prev.windowEnd` (`pm-separation.ts:74`) → 409 `PM_VISIT_OVERLAP`. Known gap: December/January pairs across schedule years are not compared.

### WF-008 PM execution — `pm-executions.ts`, `execution-routes.ts`

`pm_executions.status` ∈ {SCHEDULED, IN_PROGRESS, COMPLETED, OVERDUE, MISSED}. `POST /api/pm-executions/` (`PM_EXECUTE` → R `START_PM_TASK`): entry must be APPROVED (409 `ENTRY_NOT_APPROVED` `:33`), one IN_PROGRESS execution per entry (409 `CONFLICT` `:41`). Audit `PM_STARTED`. Due list `GET /api/pm-schedules/due` (`pm-due-tasks.ts`) credits an entry as done when a PM-reason cleaning of a sibling filter completed inside the window, **with no upper bound once the window closed**; `skippedAt` outranks that computation (`:286`).

### WF-009 Missed-PM gate ("previous scheduled task pending") — `pm-pending-tasks.ts`

On a PM-reason start (WF-001 #1): `getPendingEarlierPmTasks(filterId)` (`:60`) = APPROVED entries of the filter's AHU with `windowEnd < now`, not skipped, not satisfied by any completed PM-reason cycle of an active sibling since the earliest window start. If any remain unanswered → 409 `PM_PREVIOUS_TASK_PENDING` with `details.pendingPmTasks`; client retries with `pmSkips:[{entryId, reason ≥ MIN_SKIP_REASON}]`. `applyPmSkips` (`:147`) runs inside the cycle transaction: `skippedAt/skippedBy/skipReason` on the entry, `deviations` → CLOSED `closureKind=SKIPPED`, audit `PM_TASK_SKIPPED`. Asked once per AHU, offline replay exempt from asking but applies carried answers; `GET /pending-tasks-map` mirrors the question for the tablet.

### WF-010 PM overdue deviations (cron) — `pm-deviations.ts`

`deviations.status` ∈ {OPEN, ACKNOWLEDGED, CLOSED}; `closure_kind` ∈ {COMPLETED_LATE, SKIPPED}; `deviation_number` = `DEV-nnnnnn` sequence; `pm_schedule_entry_id` UNIQUE (one deviation per task). `sweepOverdueDeviations` (`:249`; cron 03:00 and `POST /deviations/sweep` with `PM_UPDATE`): opens a deviation for every APPROVED entry with `windowEnd < now` (within horizon) and no deviation (notifies roles from config, default ADMIN; audit `DEVIATION_OPENED`); closes OPEN/ACKNOWLEDGED ones when a late PM cleaning completes (`DEVIATION_CLOSED`, `closureKind=COMPLETED_LATE`, `delayDays`); a CLOSED deviation whose task is overdue again is **blocked**, audited `DEVIATION_OPEN_BLOCKED` and re-notified (`:208-234`). Acknowledge: `POST /deviations/:id/acknowledge` (`PM_EXECUTE` → RA `ACKNOWLEDGE_PM_OVERDUE`), refuses CLOSED (409 `CONFLICT` `:348`), audit `ACKNOWLEDGE_PM_OVERDUE`.

### WF-011 Filter creation approval — `assets/filter-approval.service.ts`, `filter-workflow.ts`

`asset_instances.approval_status` (reuses `PmEntryApprovalStatus`) default APPROVED; Block/Area/AHU always APPROVED. Config `filter-approval` `{workflowEnabled, uploadRole, reviewRole, approvalRole}` (default OFF).

| Transition | Endpoint | Who | Rules | Audit | Refuses |
|---|---|---|---|---|---|
| Create / bulk upload → PENDING_REVIEW when on | `POST /api/assets/instances`, `/instances/bulk-upload-filters`, `POST /api/hierarchy/filters` | `ASSET_CREATE`∨`FILTER_CREATE`∨`FILTER_HIERARCHY_CREATE` → R `CREATE_ASSET`/`CREATE_FILTER` (`BULK_UPLOAD_FILTERS`) | `assertPmRole(uploadRole)` when on (`instance.service.ts:140`) | `ASSET_CREATED`, `BULK_FILTER_UPLOAD` | `FORBIDDEN_ROLE`, `VALIDATION_ERROR` (duplicate active name, inactive parent) |
| Review → PENDING_APPROVAL | `POST /instances/review` (`instance.routes.ts:561`) | `FILTER_REVIEW` → R `REVIEW_FILTER` | ALL selected must be PENDING_REVIEW (all-or-nothing, `loadInState` `:49-67`) | `FILTER_REVIEWED` per filter | `NO_FILTERS`, `NOT_FOUND`, `INVALID_STATUS` |
| Approve → APPROVED | `POST /instances/approve` (`:576`) | `FILTER_APPROVE` → R `APPROVE_FILTER` | all PENDING_APPROVAL | `FILTER_APPROVED` | same |
| Reject → REJECTED | `POST /instances/reject` (`:591`) | `FILTER_REVIEW`∨`FILTER_APPROVE` → R `REJECT_FILTER` | reason required (`:133`); caller role must be reviewRole or approvalRole unless SA (`:137`); from PENDING_REVIEW or PENDING_APPROVAL | `FILTER_REJECTED` | `REASON_REQUIRED`, `FORBIDDEN_ROLE`, `INVALID_STATUS` |
| Resubmit REJECTED → PENDING_REVIEW | `POST /instances/:id/resubmit` (`:615`) | `ASSET_CREATE`∨`FILTER_CREATE`∨`FILTER_BULK_UPLOAD` → R `RESUBMIT_FILTER` | only REJECTED; name stays taken | `FILTER_RESUBMITTED` | `INVALID_STATUS` |
| Operability | `assertFilterOperable` | — | start-cycle, retire, replace, RFID assign and lifecycle-state PATCH refuse a non-APPROVED filter with 409 `FILTER_NOT_APPROVED` (`filter-workflow.ts:62-77`; callers listed in §4 BR-061) | — | `FILTER_NOT_APPROVED` |

**Note:** no self-review / self-approve check exists in this workflow (contrast WF-006, WF-012, WF-017).

### WF-012 Replacement schedule approval — `replacement-schedule/workflow.ts`, `service.ts`

`replacement_schedule_entries.approval_status` (PENDING_REVIEW → PENDING_APPROVAL → APPROVED / REJECTED) + `status` ∈ {PENDING, DUE, IN_PROGRESS, COMPLETED, MISSED} (`ReplacementEntryStatus`). Config `replacement-schedule-approval` inherits PM workflow fields when blank (`pm-workflow.ts:66-75`). Upload `POST /api/replacement-schedules/` (`REPLACEMENT_SCHEDULE_UPLOAD` → R `UPLOAD_REPLACEMENT_SCHEDULE`, audit `REPLACEMENT_SCHEDULE_UPLOADED`); review/approve/reject/resubmit/review-edit mirror WF-006 with `assertNotOwnEntry` (`workflow.ts:66`), remarks ≥3 on reject, audits `REPLACEMENT_SCHEDULE_{REVIEWED,APPROVED,REJECTED,RESUBMITTED,REVIEW_MODIFIED}`. Resubmit uses re-auth action `REVIEW_REPLACEMENT_SCHEDULE` (`routes.ts:141`), not a dedicated one.

### WF-013 Replacement execution (task) — `replacement-schedule/service.ts:376`

`POST /api/replacement-schedules/entries/:id/execute` (`FILTER_REPLACE` → R `REPLACE_FILTER`): entry APPROVED (409 `ENTRY_NOT_APPROVED`), old filter belongs to the task's AHU (409 `FILTER_NOT_IN_TASK_AHU`), task not already complete (400 `ALREADY_COMPLETE`). All-AHU-filters model: the task covers every active filter of the AHU; status is derived from window + remaining count (`:502`). A MISSED (overdue) entry **blocks cleaning starts** for the AHU's filters (`blockedFilterIdsForCleaning` `:551`, used by WF-001 #1).

### WF-014 Retire / replace / unretire — `filter-operations/filter-operations.service.ts`, `super-admin/routes.ts`

| Transition | Endpoint | Who | Rules | Writes / Audit | Refuses |
|---|---|---|---|---|---|
| Retire | `POST /api/filters/:id/retire` (`routes.ts:698`) | `FILTER_RETIRE` → R `RETIRE_FILTER` | operable (`:782`); not already retired (`:786`); in one tx: active cycle TERMINATED (+ CYCLE_TERMINATED event), `status='Retired'`, `isActive=false`, parent relationship removed, `customAttributes._preRetireParentId` stashed (`:820-860`); **RFID tag stays bound** (`:869`) | `FILTER_RETIRED` (remarks) | `ALREADY_RETIRED`, `FILTER_NOT_APPROVED`, `FILTER_RETIRED` |
| Replace | `POST /api/filters/:id/replace` (`:729`) | `FILTER_REPLACE` → R `REPLACE_FILTER` | operable (`:894`); new name must not collide with an active filter (409 `DUPLICATE_FILTER_NAME` `:919`); retires old (cycle marked REPLACED), creates new filter under same AHU, **moves** identifier rows to the new filter (`:1006`) | `FILTER_REPLACED` (old/new ids, `identifiersMoved`) — this audit row IS the replacement record read by `GET /api/filters/replacements` | `DUPLICATE_FILTER_NAME`, `ALREADY_RETIRED`, `NOT_FOUND` |
| Unretire (SA console) | `POST /api/super-admin/filter-data/retirements/:id/unretire` (`super-admin/routes.ts:441`) | `requireRole('SUPER_ADMIN')` + R `SUPER_ADMIN_DATA_EDIT` + `_changeReason` | filter must be `status='Retired'`; restore parent = body.parentId ∥ `_preRetireParentId` ∥ replacement's parent; parent must exist and be active (409 `PARENT_INACTIVE` `:502`); **if the filter was replaced, the replacement filter and ALL its traces are hard-deleted** (relationships, identifiers, filter_events, cleaning_cycles, asset_instance row; `:559-569`), counts recorded in `afterValue._sideEffects` | `MANUAL_RECORD_UPDATED` (+ cascade counts) | `NOT_FOUND`, `PARENT_INACTIVE` |
| Retirement DELETE (SA console) | `DELETE /api/super-admin/filter-data/retirements/:id` (`:364`) | SA + R + `_changeReason` | refuses 409 `HAS_HISTORY` when cycles, events, identifiers or children exist (`:390`); the `FILTER_RETIRED` audit row always survives | `MANUAL_RECORD_DELETED` | `HAS_HISTORY` |
| Replacement record edit / delete (SA console) | `PUT`/`DELETE /filter-data/replacements/:id` (`:578,:742`) | SA + R + `_changeReason` | edits/deletes a `FILTER_REPLACED` audit row ⇒ **breaks the hash chain**; writes `AUDIT_RECORD_UPDATED`/`AUDIT_RECORD_DELETED` first; returns `chainBroken:true` | as stated | `INVALID`, `NOT_FOUND` |

### WF-015 Block change request — `block-change-requests/block-change.service.ts`

`block_change_requests.status` ∈ {PENDING, APPROVED, REJECTED, EXPIRED}. Mode from config `block-change-approval.mode`: NONE (no check), CONFIRM (operator sends `acknowledgeBlockChange:true`, else 409 `BLOCK_CHANGE_CONFIRM`), APPROVAL (needs an APPROVED request, else 409 `BLOCK_CHANGE_REQUIRED`). Create `POST /api/block-change-requests/` (`BLOCK_CHANGE_REQUEST` → R `REQUEST_BLOCK_CHANGE`): one PENDING per (filter, toBlock) (409 `DUPLICATE_REQUEST` `:37`); audit `BLOCK_CHANGE_REQUESTED`; notifies configured approver role + SUPER_ADMIN. Approve/reject `POST /:id/approve|reject` (`BLOCK_CHANGE_APPROVE` → R `APPROVE_BLOCK_CHANGE`/`REJECT_BLOCK_CHANGE`): PENDING only (409 `ALREADY_PROCESSED`), requester ≠ decider (403 `SELF_APPROVAL_FORBIDDEN` `:136`), conditional update (`:143-152`). An APPROVED request is **single-use**: consumed to EXPIRED inside the cycle-start transaction (`consumeApprovalTx` `:252`, called `start-cycle.ts:300-308`); `autoExpireHours` from config (`:198`).

### WF-016 Admin requests — `admin-requests/admin-request.service.ts`

`admin_requests.status` PENDING → APPROVED / REJECTED. Create `POST /api/admin-requests/` is authenticated-any-role (inventory) with all text `stripHtml`'d; types: NEW_USER, UNLOCK, RESET, MODIFY_USER (role only, `:111-123`). Process `POST /:id/process` (`ADMIN_REQUEST_APPROVE` or `_REJECT` chosen per action in-handler `routes.ts:207-212` → R `APPROVE_ADMIN_REQUEST`): PENDING only, conditional claim (`:248-256`), approver cannot act on a target above their hierarchy (`:487`), only LOCKED is unlockable — EXPIRED is not (`:381-389`). Audits `ADMIN_REQUEST_SUBMITTED` + per-outcome rows; writes a notification for admins.

### WF-017 Report reviews (e-signature) — `report-reviews/service.ts`

`report_reviews.status` ∈ {PENDING_REVIEW, PENDING_APPROVAL, APPROVED, REJECTED}. Submit `POST /api/report-reviews/` (`REPORT_REVIEW_SUBMIT` → R `SUBMIT_REPORT_REVIEW`): needs reportType/title/dataSnapshot (400 `INVALID_INPUT`) and a user or role assignee (400 `ASSIGNEE_REQUIRED`); audit `REPORT_REVIEW_SUBMITTED`; notifies assignee. Review `POST /:id/review` (`REPORT_REVIEW` → RA `REVIEW_REPORT`): PENDING_REVIEW only; assignee check (403 `NOT_ASSIGNEE`); reviewer ≠ generator (403 `SELF_REVIEW` `:206`); reject remarks ≥3; approve → PENDING_APPROVAL with next assignee. Approve `POST /:id/approve` (`REPORT_APPROVE` → RA `APPROVE_REPORT`): PENDING_APPROVAL only; approver ≠ generator and ≠ reviewer (403 `SELF_APPROVE` `:238`). Conditional `decideIfStill` → 409 `CONCURRENT_DECISION`. Visibility `canViewReportReview` (`:90`).

### WF-018 Notifications and rules — `notifications/*`, `notification-rules/routes.ts`, `notification-delivery/*`

In-app `notifications`: addressed per user or `forRole`; two **gated types** whose visibility comes from config, not addressing: `PM_SCHEDULE_QNN` (`qnn-notifications.visibleRoles`) and `GUEST_CLEANING_REQUEST` (`guest-cleaning-requests.recipientRoles`) (`notification.service.ts:11-24`); SA sees all. Read/unread endpoints are auth-only; delete needs `NOTIFICATION_DELETE` → R `DELETE_NOTIFICATION`/`BULK_DELETE_NOTIFICATIONS` (audit `NOTIFICATION_DELETED` / `NOTIFICATIONS_BULK_DELETED`). Rules (`CONFIG_UPDATE` → R `MANAGE_NOTIFICATION_RULES`): `eventTypes[]`, recipients ROLE/GROUP/USER, email/sms/in-app flags, `cooldownMinutes`, `isActive`; audits `NOTIFICATION_RULE_{CREATED,UPDATED,DELETED}`. Dispatcher `dispatchNotification` (event types enum `NotificationEventType`: USER_LOGIN, USER_CREATED, USER_LOCKED, CHECKLIST_*, SYSTEM_ERROR, DEVICE_* legacy). Delivery `notification_logs.status` ∈ {PENDING, SENT, DELIVERED, FAILED, RETRYING}; email/SMS config writes R `UPDATE_EMAIL_CONFIG` / `UPDATE_SMS_CONFIG`; outbound URLs via `lib/ssrf.ts`.

### WF-019 User lifecycle — `users/user.service.ts`

`users.status` ∈ {ENABLED, DISABLED, LOCKED, EXPIRED} (`UserStatus`). Hierarchy guard `assertCanManageTarget` (`:34`): SA manages anyone; nobody below may manage a SA (or a role at/above their level); non-SA lists hide SA (and non-ADMIN hide ADMIN) (`:59-60,:87-88`).

| Transition | Endpoint | Who | Rules | Audit |
|---|---|---|---|---|
| Create | `POST /api/users/` | `USER_CREATE` → R `CREATE_USER` | user-id format from config `user-id` (`lib/user-id-validator.ts`); role exists and active; unique username/email (409); temp password + `forcePasswordChange` | `USER_CREATED` |
| Update (role/status) | `PUT /:id` | `USER_UPDATE` → R `UPDATE_USER` | role change or non-ENABLED status terminates sessions (`:235-252`) | `USER_UPDATED` |
| Enable / Disable | `POST /:id/enable|disable` | `USER_ENABLE_DISABLE` → R `ENABLE_USER`/`DISABLE_USER` | disable terminates sessions + cache invalidate | `USER_ENABLED` / `USER_DISABLED` |
| Unlock | `POST /:id/unlock` | `USER_UNLOCK` → R `UNLOCK_USER` | sets temp password, `forcePasswordChange`, resets attempts, terminates sessions | `ACCOUNT_UNLOCKED` |
| Reset password | `POST /:id/reset-password` | `USER_RESET_PASSWORD` → R `RESET_PASSWORD` | temp password, sessions terminated | `PASSWORD_RESET` |
| Delete / bulk delete | `DELETE /:id`, `POST /bulk-delete` | SA-only (inventory) → R `DELETE_USER`/`BULK_DELETE_USERS` | cannot delete self; cannot delete SUPER_ADMIN (`:273-298`) | `USER_DELETED` / `BULK_USER_DELETED` |
| Reset requests | `GET /reset-requests*`, `POST /reset-requests/:id/process` | `USER_RESET_PASSWORD` → R `PROCESS_RESET_REQUEST` | PENDING only; approve needs new password | `PASSWORD_RESET_REQUEST_APPROVED/REJECTED` |
| Lockout (automatic) | login / re-auth / change-password / offline-grant failures | — | `applyFailedPasswordAttempt` (`auth.service.ts:36`): after `maxFailedAttempts` (default 5) → LOCKED, TEMPORARY (default 30 min `lockoutUntil`) or PERMANENT per `login-security`; **SUPER_ADMIN exempt**; notifications to admins + user | `ACCOUNT_LOCKED` |
| Expiry (automatic) | auth plugin + cron | — | `isPasswordExpired` (`lib/password-expiry.ts:47`) anchors on max(passwordChangedAt, createdAt, policyUpdatedAt); non-SA gets `forcePasswordChange` on first request after expiry; cron 00:00 sends warnings | `PASSWORD_EXPIRED` |

### WF-020 Login and session — `auth/auth.service.ts:93-335`

Order of checks: user exists (401 `INVALID_CREDENTIALS`) → LDAP or local password (`LDAP_ERROR`; failure → lockout counter, audit `LOGIN_FAILED`, 403 `ACCOUNT_LOCKED` when it trips) → status LOCKED (SA auto-unlocks; temporary lock auto-expires; else 403 `ACCOUNT_LOCKED`) → DISABLED 403 `ACCOUNT_DISABLED` → EXPIRED (SA auto-recovers; temp-password users recover; else 403 `PASSWORD_EXPIRED`) → derived expiry sets `forcePasswordChange` → **tablet gate**: `client==='tablet'` and role lacks tablet `login` ⇒ audit `LOGIN_FAILED reason=TABLET_ACCESS_DENIED` and 403 `TABLET_ACCESS_DENIED` BEFORE any session is created or ended (`:254-261`, `lib/tablet-access.ts`) → existing active session and `force` not set ⇒ 409 `SESSION_CONFLICT` (`:270`); `force:true` terminates others, audit `FORCED_LOGOUT` → session created, attempts reset, audit `LOGIN_SUCCESS`. Logout `LOGOUT` (also `beacon-logout`, reason `tab_closed`). Refresh 401 `SESSION_INVALID`/`ACCOUNT_INACTIVE`. Session sweep cron (every 5 min) terminates idle/expired sessions and writes `LOGOUT`.

### WF-021 Password change — `auth.service.ts:415-485`

`POST /api/auth/change-password` (rate-limited 50/min; allowed under forced change): current password required and verified (wrong ⇒ lockout counter, 400 `INVALID_PASSWORD`/403 `ACCOUNT_LOCKED`); policy (`password-policy` config): min/max length, uppercase/lowercase/number/special counts, not equal to / not containing username, not the temp password, not in last N (`password_history`) ⇒ 400 `POLICY_VIOLATION`; other sessions terminated; audit `PASSWORD_CHANGED`. Forgot-password `POST /api/auth/forgot-password` (public) → reset request + audit `PASSWORD_RESET_REQUESTED`.

### WF-022 Re-authentication (electronic signature) — `lib/reauth-check.ts`

States per request: no password → 401 `REAUTH_REQUIRED` (not audited, first leg of handshake) → password compared → `REAUTH_FAILED` row (+lockout) or `REAUTH_SUCCESS` row whose id becomes `signature_audit_id` on every audit row the handler then writes (`lib/audit.ts:165`; inside the checksum only when present). Policy: `system_config['action-reauth']` = `{ACTION: [roles]}`; `PUT /api/config/action-reauth` needs `ROLE_MANAGE` → R `UPDATE_REAUTH_CONFIG`. 127 catalogued actions (`packages/shared/src/types/reauth-actions.ts`), 15 categories. Always-on (RA) sites: stage approve/reject/bulk-decide, report review/approve, PM overdue acknowledge, access-matrix PUT (`UPDATE_ROLE_CONFIG`), audit-templates, field-ids, report-signatories, tablet-access, SA api-lock toggle, dynamic-config secret writes (`config/routes.ts:133`), offline-grant (own check).

### WF-023 Audit trail record lifecycle — `modules/audit/routes.ts`, `lib/audit.ts`, `lib/audit-verify.ts`

Write: `auditLog()` (`lib/audit.ts:118`) builds canonical base fields (incl. optional back-dated `timestamp`, `signatureAuditId`), reads the prior row's checksum, computes V3 HMAC (keyed, `checksum_version=3`) or V2 SHA-256 fallback, inserts with `previous_checksum` and `chain_position` (BIGSERIAL). Read: `GET /api/audit/` + `/:id` (`AUDIT_READ`) scoped by `auditVisibilityScope` (`lib/audit-visibility.ts:69`): non-SA never see SA-authored rows nor the 8 `SUPER_ADMIN_ONLY_AUDIT_ACTIONS` (`MANUAL_RECORD_*`, `AUDIT_RECORD_*`, `AUDIT_RECORDS_BULK_*`). Same scope on `/api/debug/traces`.

| Operation | Endpoint | Who | Effect on chain | Audit |
|---|---|---|---|---|
| Redact / bulk redact | `POST /:id/redact`, `/bulk-redact` (`:550,:615`) | `requireSuperAdmin` → R `REDACT_AUDIT_RECORD`/`BULK_REDACT_AUDIT_RECORDS`; reason 5–500 | preserved (writes `redaction_reason`, masks fields); 409 `ALREADY_REDACTED` / `ALREADY_REDACTED_OR_MISSING` | `AUDIT_RECORD_REDACTED` / `AUDIT_RECORDS_BULK_REDACTED` |
| Edit | `PUT /:id` (`:718`) | `requireRole('SUPER_ADMIN')` → R `UPDATE_AUDIT_RECORD`; reason | **broken** downstream, permanently; `checksum/previousChecksum/chainPosition/checksumVersion` not editable; rows whose action is `AUDIT_RECORD_UPDATED/_DELETED` refuse (409 `META_AUDIT_IMMUTABLE` `:770`); redacted rows refuse (409 `REDACTED`); 400 `NO_CHANGES`/`INVALID`; returns `chainBroken:true` | `AUDIT_RECORD_UPDATED` (written FIRST) |
| Hard delete / bulk delete | `DELETE /:id`, `POST /bulk-delete` (`:827,:895`) | `AUDIT_DELETE` → R `DELETE_AUDIT_RECORD`/`BULK_DELETE_AUDIT_RECORDS`; reason | **broken**; meta-row written before; in-tx `ALTER TABLE audit_trail DISABLE TRIGGER` for every trigger on the table then re-enable (`:886,:949`); 404 `NO_MATCHING_RECORDS` | `AUDIT_RECORD_DELETED` / `AUDIT_RECORDS_BULK_DELETED` |
| Verify chain | `GET /verify-chain` (`:968`) | `requireSuperAdmin` | walks `chain_position` ASC; anomalies: checksum mismatch, link mismatch, **gap** (interior deletion), keyed-era row not v3 (downgrade), legacy V1 key-order rows classified PROVEN/UNVERIFIABLE (`audit-verify.ts:185-336`). Deletion of the LAST row is undetectable except via highest position. | — |
| Export log gate | `POST /report-export-log` (`:483`) | auth-only + in-handler role logic → R `EXPORT_<REPORT>` (12 actions) | every download first writes this row | `REPORT_GENERATED` |

### WF-024 Backup and restore — `modules/backup/*`

Export `GET /api/backup/export?format=dump|json|bak|sql|csv` (`BACKUP_EXPORT` → R `EXPORT_BACKUP`; default `dump` = pg_dump custom archive, the only full schema+data format). JSON/BAK carry SHA-256 `checksum` + HMAC `signature` over `checksum|timestamp` keyed with the audit chain key; users' `password_hash` and `password_history` hashes are replaced by a sentinel. Audit `BACKUP_CREATED`. Validate `POST /validate` (`BACKUP_EXPORT`∨`BACKUP_RESTORE`). Restore `POST /restore` (`BACKUP_RESTORE` → R `RESTORE_BACKUP`; multipart ≤100 MB, 413 `BACKUP_TOO_LARGE`): JSON/BAK path `restoreFromBackup` (`backup.repository.ts:505`): signature must verify (403 `BACKUP_UNSIGNED`), audit rows in the file must chain-verify unless `force=true` (400 `BACKUP_AUDIT_CHAIN_INVALID` + `chainReport`), tables present in DB but absent from the file refuse unless `force` (400 `BACKUP_INCOMPLETE` `:547`), all user triggers on target tables disabled in-tx, live `password_hash`es re-applied over sentinels, **live audit rows not present in the backup are preserved** (`preserveUnbackedAuditRows`, temp table `audit_trail_keep`), then `TRUNCATE … CASCADE` + reinsert. `.dump` path `restoreDump` (`backup.service.ts:616`): safety pg_dump first, `pg_restore --single-transaction --exit-on-error`, audit rows preserved via `digilog_keep.audit_trail`, rollback to safety dump on failure (500 `RESTORE_FAILED`, `RESTORE_FAILED_NO_ROLLBACK` when rollback also failed). Audit `BACKUP_RESTORED` (records `forced`). Nightly OS task: §6.

### WF-025 Configuration change — `modules/config/*`

Dynamic defs (38, §9): `GET /api/config/dynamic/:moduleKey` and `PUT` gated by `def.requiredRole` (SUPER_ADMIN for 31, ADMIN for `user-id`, permission `CONFIG_READ/UPDATE` for 6) → R `def.reauthAction` (`dynamic-routes.ts:38-76`). Static legacy keys `GET/PUT /api/config/:key` (`routes.ts:73-133`): secret-bearing keys use RA. Every write: Zod parse, `redactConfigSecrets` before audit, `CONFIG_CHANGED` audit with before/after, cache invalidation (`password-policy` → auth cache; `action-reauth` → reauth cache; role configs → RBAC cache). Public `/current` reads exist for password-policy, pagination, datetime, export-limit, backup-format, field-ids, cleaning-profile-assignment, tablet-access/my-features, report-labels, report-page-titles, dashboard-cards, export-options, ahu-completion-process, block-change-approval, pm-/replacement-schedule-filters, offline-cache, audit-templates (`static-routes/*`, `routes.ts:161-212`).

### WF-026 Tablet sync feed — `modules/sync/sync.service.ts`

`GET /api/sync/since` (`ASSET_VIEW`∨`FILTER_OPERATE`) returns rows whose `version` > the client cursor for cleaning profiles (live row only), filter profiles, equipment groups, checklist profiles, asset templates; filters by `updatedAt` watermark (instance OR its details) since `AssetInstance` has no version column (`:158-200`). Read-only; no refusals beyond RBAC.

### WF-027 Equipment groups (versioned) — `equipment-groups/equipment-groups.service.ts`

Create/update/delete (`ASSET_*`∨`EG_*` → R `CREATE/UPDATE/DELETE_EQUIPMENT_GROUP`). Exactly 3 instruments (`:175,:253`); per instrument: id, UOM, least count >0, instrumentMin<Max, operating range inside instrument range, opMin<opMax (`:89-107`); reading URL http/https only (`:123-126`, fetched via `hardenedFetch`). Update = snapshot current composite into `equipment_group_versions` then `version+1` (`snapshotAndBump` `:33`). Deactivate/delete refuses when used by IN_PROGRESS cycles (409 `IN_USE` `:333`) or when it would leave the block with zero active groups while filters exist (`:354`). Cycles pin `equipmentGroupId`+version at start (WF-001). Audits `EQUIPMENT_GROUP_{CREATED,UPDATED}` (+ delete).

### WF-028 Checklist profiles (versioned, disable rule) — `checklist-profiles/checklist-profile.service.ts`

Every mutation (metadata, add/update/delete question, reorder) snapshots then bumps `version` (`:56-75`). Disabling a profile referenced by a CHECKLIST node of any non-archived cleaning profile refuses 409 `CHECKLIST_IN_USE` (`:205`); enabling always allowed. Delete refuses when referenced by pipeline nodes or when cycles pin its versions (409 `IN_USE` `:257,:267`). Reorder must list every question exactly once (400 `INVALID_QUESTION_ORDER`). A disabled checklist is skipped at run time (WF-001) and a cleaning profile cannot be saved/activated pointing at one (400 `CHECKLIST_DISABLED`, `cleaning-profile.service.ts:486`). Audits `CREATED/UPDATED/DELETED`, `CHECKLIST_QUESTION_{ADDED,UPDATED,DELETED}`, `CHECKLIST_QUESTIONS_REORDERED`.

### WF-029 Cleaning profiles (lineage versioning) — `cleaning-profiles/cleaning-profile.service.ts`

`filter_cleaning_profiles.status` ∈ {DRAFT, ACTIVE, ARCHIVED}; `@@unique([lineageId, version])`. Create = new lineage v1. Update (`:178-272`) = new ACTIVE row (version+1, same lineage), previous archived; edges referencing archived stage ids remapped by sortOrder; invalid connection → 400 `VALIDATION_ERROR`. Toggle/archive refuse when active filter profiles reference it (409 `CONFLICT` `:292,:321`). Delete refuses when cycles pin the row or it is not the lineage head (409 `CONFLICT` `:408,:417`). In-progress cycles keep their pinned `profile_id` (never migrated). Audits `CREATED/UPDATED/ARCHIVED/DELETED`.

### WF-030 Hierarchy / asset instance lifecycle — `assets/services/instance.service.ts`, `assets/services/filter.service.ts`

Generic path `POST/PUT/PATCH/DELETE /api/assets/instances*`: template must exist; **active name unique, case-insensitive** (`:115`, `:311`; DB: partial unique index `asset_instances_active_name_key` on `lower(name) WHERE is_active`); parent must exist, be active (`validateParent` `:31` → 400 `VALIDATION_ERROR` "Parent entity is deactivated"), not self, respect template `maxParentConnections`; attributes validated against template schema; filter-kind instances get a `filter_details` sidecar and enter WF-011. Status PATCH (`ASSET_UPDATE` → R `UPDATE_ASSET`) audit `ASSET_STATUS_CHANGED`. Delete = soft delete cascade (`isActive=false` on descendants, identifiers removed, equipment groups of a block deactivated), refused when any descendant has an IN_PROGRESS cycle (409 `FILTER_CYCLE_IN_PROGRESS` `:671`). Typed path `POST /api/hierarchy/filters` (`filter.service.ts:24`): AHU must exist (**no `isActive` check**, `:28`), active name unique; delete refuses IN_PROGRESS cycle (`:196`). DB mirror triggers keep `asset_instances` ⇄ typed `filters` in step. Parent FK is `onDelete: Restrict` (`schema.prisma:696`).

### WF-031 RFID identifiers — `assets/services/identifier.service.ts`

Create `POST /api/assets/identifiers` (`ASSET_IDENTIFIER_CREATE`∨`FILTER_RFID_MANAGE` → R `CREATE_ASSET_IDENTIFIER`): target filter must be operable (`:29`); same tag on same filter → 409 `IDENTIFIER_ALREADY_ON_ENTITY`; tag held by a LIVE filter → 409 `DUPLICATE_IDENTIFIER_VALUE`; tag held by a Retired/inactive filter is **released** in the same tx with an `ASSET_IDENTIFIER_DELETED` audit naming the reason (`:55-94`); a filter's previous tag is released when a new one is bound (`:76`). `identifier_value` is globally UNIQUE in DB. Delete → R `DELETE_ASSET_IDENTIFIER`, audit `ASSET_IDENTIFIER_DELETED`. SA console RFID event edits refuse a tag live elsewhere (`rfid-event-edit.ts:151`).

### WF-032 Exports (report-export-log gate) — `audit/routes.ts:483`

Every PDF/XLSX download first POSTs `/api/audit/report-export-log`; the handler maps `reportName` → one of 12 `EXPORT_*` re-auth actions (fallback `EXPORT_AUDIT_TRAIL`) and writes `REPORT_GENERATED`. Server-side `.xlsx` GETs (`/api/pm-schedules/entries/export.xlsx` → R `EXPORT_PM_SCHEDULE`; `/api/replacement-schedules/export.xlsx` → R `EXPORT_REPLACEMENT_SCHEDULE`) gate themselves. Export row cap from config `export-limit`.

### WF-033 Role management — `roles/role.service.ts`

`ROLE_MANAGE` → R `CREATE_ROLE`/`UPDATE_ROLE`/`DELETE_ROLE`. Non-SA caller: cannot modify own role, a role at/above own hierarchy level, assign a level at/above own, or grant permissions they do not hold (`:28-49`, 403 `FORBIDDEN`). System roles cannot be deleted (409 `SYSTEM_ROLE`), roles with users cannot be deleted (409 `ROLE_HAS_USERS`), name unique (409). SUPER_ADMIN role is invisible to non-SA in every list (`:213`). Role-config picker writes (`PUT /api/config/roles/:role`, `/users/:userId`) need `ROLE_MANAGE` → R `UPDATE_ROLE_CONFIG`/`UPDATE_USER_CONFIG`; `updateRoleConfig` cannot revoke unmapped permissions (CLAUDE.md).

### WF-034 SUPER_ADMIN API lock — §2 + `super-admin/routes.ts:85-130`

OFF ⇒ SA frozen (403 `SUPER_ADMIN_API_LOCKED`) except 7 endpoints; flip needs RA `TOGGLE_SUPER_ADMIN_API_ACCESS`; audit `SUPER_ADMIN_API_ACCESS_CHANGED`; fail-open.

### WF-035 Guest cleaning request — `guest/routes.ts:13`

Public POST, all 7 fields required (400 `VALIDATION`), text stripped; writes a `GUEST_CLEANING_REQUEST` notification (visibility from config `recipientRoles`) and an audit row `GUEST_CLEANING_REQUEST_SUBMITTED`. No rate limit, no captcha, no dedup.

### WF-036 Filter profiles — `filter-profiles/filter-profile.service.ts`

`FP_*` perms → R `CREATE/UPDATE/DELETE_FILTER_PROFILE`, `ASSIGN_FILTER_PROFILE`. Referenced cleaning profile must exist and be ACTIVE (`:168,:229`); applicable template ids must exist (`:183,:244`); update snapshots then bumps version (`:35-67`); delete refuses while filters are assigned (`:301`); assign refuses non-active filter ids (400 `INVALID_FILTER_IDS` `:340`). Audits `CREATED/UPDATED/DELETED/ASSIGNED`.

### WF-037 LDAP — `ldap/ldap.service.ts`

Config (`CONFIG_UPDATE` → R `UPDATE_LDAP_CONFIG`), server URL must be `ldap://`/`ldaps://` (`:146`), TLS verification on by default (`:78`). Login path: bind, group → role mapping (`mapGroupsToRole`), auto-provision (`USER_CREATED` audit, `authSource: 'ldap'`) and attribute/role sync on each login (`USER_UPDATED`).

### WF-038 Dashboards — `dashboards/routes.ts`

`DASHBOARD_VIEW/CREATE/MANAGE/ASSIGN`; no re-auth; audits `DASHBOARD_*`, `DASHBOARD_WIDGET_*`, `DASHBOARD_LAYOUT_UPDATED`, `DASHBOARD_(UN)ASSIGNED`.

### WF-039 Help articles — `help/routes.ts`

Writes SUPER_ADMIN only → R `CREATE/UPDATE/DELETE_HELP_ARTICLE`; versions table `@@unique([helpArticleId, version])`; audits `HELP_ARTICLE_*`.

### WF-040 User groups — `user-groups/routes.ts`

`CONFIG_UPDATE` → R `MANAGE_USER_GROUPS`; `@@unique([groupId, userId])`; audits `USER_GROUP_*`.
## 4. Business rules (BR-nnn)

One row per enforceable rule. "Enforced by" = permission / re-auth / code path. Risk: H = compliance- or data-integrity-affecting, M = operational, L = cosmetic/validation. Each row names the workflow it belongs to.

| ID | WF | Rule | Enforced by (file:line) | Refusal | Risk |
|---|---|---|---|---|---|
| BR-001 | WF-001 | A retired or deactivated filter cannot be cleaned (any cycle write). | `filter-operations/local-context.ts:90-93` | 409 `FILTER_RETIRED` | H |
| BR-002 | WF-001 | A filter not in `approvalStatus=APPROVED` cannot start a cycle, be retired, replaced, RFID-tagged, or have its lifecycle state set. | `assets/filter-workflow.ts:62-77`; callers `start-cycle.ts:116`, `filter-operations.service.ts:782,894`, `identifier.service.ts:29`, `instance.service.ts:467` | 409 `FILTER_NOT_APPROVED` | H |
| BR-003 | WF-001 | A filter needs an assigned filter profile → cleaning profile to start. | `start-cycle.ts:121`; shared `assertProfileAssigned` | 400 `NO_PROFILE` | M |
| BR-004 | WF-001 | Only one IN_PROGRESS cycle per filter (app check before and under lock; DB partial unique index). | `start-cycle.ts:127,287`; baseline migration `idx_cleaning_cycles_one_in_progress_per_filter` | 409 `CYCLE_ACTIVE` / 409 `CONFLICT` (P2002) | H |
| BR-005 | WF-001 | A filter under an AHU with a MISSED replacement task cannot start cleaning (online). Offline replay exempt, recorded. | `start-cycle.ts:130-146`; `replacement-schedule/service.ts:551` | 409 `AHU_REPLACEMENT_OVERDUE` | H |
| BR-006 | WF-015 | Cleaning in a block other than the filter's home block follows config mode: NONE passes, CONFIRM needs `acknowledgeBlockChange`, APPROVAL needs an APPROVED request. Offline replay passes (flagged). | `filter-operations/filter-resolver.ts:89-145` | 409 `BLOCK_CHANGE_CONFIRM` / `BLOCK_CHANGE_REQUIRED` | H |
| BR-007 | WF-015 | A block-change approval is single-use: consumed to EXPIRED under the cycle-insert lock; a lost race is "not approved". | `start-cycle.ts:290-308`; `block-change.service.ts:252` | 409 `BLOCK_CHANGE_REQUIRED` | H |
| BR-008 | WF-001 | Cleaning reason is mandatory and must be one of the profile's configured reasons. | `start-cycle.ts:155,217`; `manual-cycle.ts:41-45` | 400 `REASON_REQUIRED` / `INVALID_REASON` | M |
| BR-009 | WF-001 | Reasons flagged `requiresJustification` need ≥10 characters of justification. | `start-cycle.ts:219`; `manual-cycle.ts:48` | 400 `JUSTIFICATION_REQUIRED` | M |
| BR-010 | WF-009 | A PM-reason start on an AHU with an earlier APPROVED PM whose window has closed and was neither performed nor written off is refused until a reason per visit is given. | `start-cycle.ts:160-215`; `pm-pending-tasks.ts:60-145` | 409 `PM_PREVIOUS_TASK_PENDING` (details.pendingPmTasks) | H |
| BR-011 | WF-009 | A written-off PM visit is NOT a completed visit: `skippedAt` set, no `pm_executions` row, deviation CLOSED with `closureKind=SKIPPED`, audit `PM_TASK_SKIPPED`; write-off runs inside the cycle transaction. | `pm-pending-tasks.ts:147-200` | — | H |
| BR-012 | WF-009 | `skippedAt` outranks the "cleaned" credit computation in the due-tasks view. | `pm-due-tasks.ts:265,286` | — | H |
| BR-013 | WF-001 | The cleaning profile must be ACTIVE to start; at advance the pinned profile must exist and be active. | `start-cycle.ts:239`; shared guards #13/#48 | 400 `PROFILE_DISABLED` | M |
| BR-014 | WF-001 | Equipment group passed to start/advance must exist and be active; when the block has exactly one active group it is auto-bound and its version pinned on the cycle. | `start-cycle.ts:320-345`; `advance.ts:322-384`; shared #20/#30/#31/#32 | 400 `INVALID_EQUIPMENT_GROUP`, `MULTIPLE_EQUIPMENT_GROUPS`, `NO_EQUIPMENT_GROUP`, 409 `GROUP_VERSION_MISSING` | M |
| BR-015 | WF-001 | Cycle-bound writes must echo the current `tapeVersion`; a stale screen is refused. Bulk items without it are refused per item (except advance half of start-and-advance). | shared `assertTapeVersionFresh` (`transitions.ts:246`); `bulk-operate.ts:98-104` | 409 `STALE_TAPE`; 400 `TAPE_VERSION_REQUIRED` | H |
| BR-016 | WF-001 | A pending (enabled) CHECKLIST node between current and target stage blocks the advance. Disabled checklists are skipped and named in `attributes.skippedChecklists`. | shared `assertChecklistGatePassed` (`transitions.ts:136`), `enabledChecklistNodes` (`:294`) | 400 `CHECKLIST_PENDING` | H |
| BR-017 | WF-001 | Target stage must exist in the pipeline and be reachable from the current stage along edges (dryer in-place actions excepted). | shared #16/#17 (`transitions.ts:200,220`) | 400 `OUT_OF_SEQUENCE` / `INVALID_TARGET` | H |
| BR-018 | WF-001 | A cycle whose only forward edge is END is complete; further advances refused. | shared #15 (`transitions.ts:179`) | 400 `CYCLE_COMPLETE` | M |
| BR-019 | WF-001 | PARAM_CAPTURE parameters: required ones present and inside min/max. | shared #18/#19 (`parameters.ts:40,65`) | 400 `PARAM_REQUIRED` / `PARAM_OUT_OF_RANGE` | M |
| BR-020 | WF-001 | Instrument readings on readings stages: required per instrument, numeric, within the PINNED equipment-group-version operating range. | shared #27–#29 (`instruments.ts:33-86`) | 400 `READING_REQUIRED` / `INVALID_READING` / `READING_OUT_OF_RANGE` | H |
| BR-021 | WF-001 | WASH_IN transition requires its instrument readings. | `advance.ts:310` | 400 `WASH_IN_READINGS_REQUIRED` | H |
| BR-022 | WF-001 | `dryerAction: SET_DURATION` only when target is DRY_IN; duration must be >0. | shared #21/#22 (`dryer.ts:18,33`) | 400 `INVALID_DRYER_ACTION` / `INVALID_DURATION` | M |
| BR-023 | WF-001 | ENTERING DRY_IN requires `SET_DURATION` unless `dryerStartedAt` already set (online, bulk and offline). | shared #28 (`dryer.ts:185`); `advance.ts:257-262` | 400 `DRYER_DURATION_REQUIRED` | H |
| BR-024 | WF-001 | `SUBMIT_READINGS` only while in DRY_IN, after the dryer started, and after half the duration elapsed (offline uses `offlinePerformedAt`). | shared #23/#24/#25 (`dryer.ts:48,63,93`) | 400 `NOT_IN_DRY_IN` / `DRYER_NOT_STARTED` / `DRYER_NOT_READY` | H |
| BR-025 | WF-001 | LEAVING DRY_IN requires the dryer to have run ≥ half its duration AND readings submitted; never started ⇒ `DRYER_DURATION_REQUIRED`. | shared #26/#27 (`dryer.ts:141-229`) | 400 `DRYER_NOT_READY` / `DRYER_READINGS_REQUIRED` / `DRYER_DURATION_REQUIRED` | H |
| BR-026 | WF-002 | Leaving an interlock stage (default WASH_OUT, DRY_OUT) requires the LATEST `cleaning_stage_approvals` row for (cycle, stage) to be APPROVED. Offline replay exempt (flagged `INTERLOCK_LEAVE`). | `stage-interlock.ts:92-116`; `advance.ts:190-209` | 423 `STAGE_APPROVAL_PENDING` / `STAGE_APPROVAL_REJECTED` | H |
| BR-027 | WF-002 | Entering an interlock stage creates a PENDING approval (one per cycle+stage attempt) and notifies the configured approver role. | `stage-interlock.ts:189-245` | — | H |
| BR-028 | WF-002 | A cycle may not COMPLETE directly out of an interlock stage (terminal interlock). Offline exempt, flagged. | `advance.ts:480-500` | 422 `INTERLOCK_TERMINAL_STAGE` | H |
| BR-029 | WF-002 | Only the frozen `approverRole` (or SUPER_ADMIN) may decide; decider ≠ requester. | `stage-approvals/service.ts:55-70` | 403 `WRONG_APPROVER_ROLE` / `SELF_APPROVAL_FORBIDDEN` | H |
| BR-030 | WF-002 | Approve/reject only while the filter is still at the gated stage and the row is PENDING; concurrent deciders: first conditional update wins. | `stage-approvals/service.ts:156,314,335-345,437-447` | 409 `APPROVAL_STALE`, 400 `INVALID_STATUS`, 409 `CONCURRENT_DECISION` | H |
| BR-031 | WF-002 | Reject needs remarks ≥3 chars, requires the cycle IN_PROGRESS, rewinds the filter to `rejectToStateKey`, writes a deviation event, and clears dryer timing when rewinding past DRY_IN. | `stage-approvals/service.ts:408-510` | 400 `REMARKS_REQUIRED`, 409 `CYCLE_NOT_ACTIVE` | H |
| BR-032 | WF-002 | A PENDING approval whose filter already left the gate is lazily SUPERSEDED when the queue is read. | `stage-approvals/service.ts:187-201` | — | M |
| BR-033 | WF-003 | With AHU completion mode on, a filter cannot enter the final stage until every counted sibling (per filter set when configured) is ready. | `ahu-completion-gate.ts:456-480` | 422 `AHU_INTERLOCK_PENDING` | H |
| BR-034 | WF-001 | Bypass only when the pinned profile has `flowMode=BYPASS_ENABLED`; target must be a STAGE; justification required. | shared #38/#39 (`bypass.ts:11,24`); `justification.ts:23` | 403 `BYPASS_FORBIDDEN`, 400 `INVALID_TARGET`, 400 `JUSTIFICATION_REQUIRED` | H |
| BR-035 | WF-001 | Terminate requires an active cycle and a justification; cycle → TERMINATED, filter state cleared. | `terminate-cycle.ts:20-120` | 400 `NO_ACTIVE_CYCLE` | M |
| BR-036 | WF-001 | Checklist submission: schema must match the live profile version, every required question answered, no unknown keys, not already submitted for the stage, checklist not disabled, a checklist must exist at the stage. | shared #4/#5/#6 (`checklist.ts`); `submit-checklist.ts:182,196,389` | 409 `SCHEMA_DRIFT`, 400 `VALIDATION_ERROR`, 400 `INVALID_QUESTIONS`, 409 `ALREADY_SUBMITTED`, 400 `CHECKLIST_DISABLED`, 400 `NO_CHECKLIST_AT_TARGET` | H |
| BR-037 | WF-001 | Advance-with-checklist is ONE transaction; refuses when the target has no checklist. | `advance-with-checklist.ts:52-90` | 400 `NO_CHECKLIST_AT_TARGET` | H |
| BR-038 | WF-001 | Every cycle write row-locks the filter and re-verifies expected stage and cycle id. | `cycle-write/locking.ts:30-48` | 409 `STATE_CHANGED` / `CYCLE_CHANGED` | H |
| BR-039 | WF-001 | A `filter_events` row must reference a cycle of the same filter (DB trigger). | baseline `trg_filter_event_consistency` | DB error → 400 `DATA_CONSTRAINT` | H |
| BR-040 | WF-007 | Two PM visits on one AHU must never be satisfiable by one cleaning: sorted by date, `next.windowStart <= prev.windowEnd` is a violation (windows = planned ± tolerance). Checked on create, replace, resubmit, edit (twice: request and approval), and upload against existing + new. | `pm-separation.ts:74`; `pm-separation-guard.ts:52-90` | 409 `PM_VISIT_OVERLAP` | H |
| BR-041 | WF-007 | Upload appends; a date already scheduled is skipped unchanged; nothing is deleted; every rejected row is reported. | `pm-import.ts:226-310` | — (reported in `skipped`) | H |
| BR-042 | WF-007 | Upload row validation: AHU must exist, date YYYY-MM-DD or DD-MM-YYYY, tolerance 0–365 (default from settings). | `pm-import.ts:128-194` | row skipped with reason | M |
| BR-043 | WF-006 | One ACTIVE PM schedule per (AHU, year); DB `@@unique([entityId, year, version])`. | `pm-schedule-crud.ts:44-46` | 409 `CONFLICT` | M |
| BR-044 | WF-006 | Schedule PUT (replace) refuses when any dropped entry is APPROVED, written off, or has executions. | `pm-schedule-crud.ts:116-122` | 409 `PM_ENTRY_HAS_EVIDENCE` | H |
| BR-045 | WF-006 | Schedule DELETE refuses while executions are in progress. | `pm-schedule-crud.ts:203-206` | 400 `VALIDATION_ERROR` | M |
| BR-046 | WF-006 | Entry dates are unique per schedule (`@@unique([scheduleId, plannedDate])`), replacing the old per-month key. | migration `20260827120000`; `schema.prisma:1224` | 409 `CONFLICT` (P2002) | M |
| BR-047 | WF-006 | PM review/approve/reject: a user may not review an entry they submitted, nor approve/reject one they submitted or reviewed (SUPER_ADMIN NOT exempt). | `pm-approval.ts:110-121` | 403 `SELF_APPROVAL_FORBIDDEN` | H |
| BR-048 | WF-006 | Rejecting a PM entry needs remarks ≥3 chars. | `pm-approval.ts:142-146,275-279` | 400 `REMARKS_REQUIRED` | M |
| BR-049 | WF-006 | Only REJECTED entries can be resubmitted; only APPROVED entries can be edited (edit stages the change for re-approval); only PENDING_REVIEW entries can be reviewer-modified. | `pm-approval.ts:327-329,367-369,417-419` | 400 `INVALID_STATUS` | M |
| BR-050 | WF-006 | Workflow role gates: `assertPmRole` on upload (uploadRole) when the workflow is on. | `pm-workflow.ts:86-93`; `routes.ts` | 403 `FORBIDDEN_ROLE` | M |
| BR-051 | WF-006 | PM module must be enabled (`pm-schedule-settings.enabled`). | `pm-shared.ts:12-16` | 404 `PM_DISABLED` | L |
| BR-052 | WF-008 | A PM execution can only start on an APPROVED entry; one IN_PROGRESS execution per entry. | `pm-executions.ts:32-41` | 409 `ENTRY_NOT_APPROVED` / `CONFLICT` | M |
| BR-053 | WF-010 | Overdue sweep opens exactly one deviation per overdue APPROVED entry (`pm_schedule_entry_id` UNIQUE), notifies configured roles once (`notified_at`), closes it when a late PM completes (`COMPLETED_LATE`), and BLOCKS + audits re-occurrence against a CLOSED deviation. | `pm-deviations.ts:208-340`; `schema.prisma:1407` | — | H |
| BR-054 | WF-010 | Acknowledging an overdue deviation always needs a password (RA) and refuses a CLOSED one. | `pm-schedules/routes.ts:594`; `pm-deviations.ts:348` | 409 `CONFLICT` | M |
| BR-055 | WF-006 | Every PM workflow action mints a QNN (`QN-YYYY-nnnnnn`, sequence `qnn_seq`) recorded in `quality_notifications`, visible to `qnn-notifications.visibleRoles`. | `pm-workflow.ts:100-220`; `qnn.ts:9` | — | M |
| BR-056 | WF-011 | When `filter-approval.workflowEnabled`, new FILTER instances land PENDING_REVIEW and only `uploadRole` may create; Block/Area/AHU always APPROVED. | `instance.service.ts:133-147`; `filter-workflow.ts:47` | 403 `FORBIDDEN_ROLE` | H |
| BR-057 | WF-011 | Review/approve/reject are all-or-nothing over the selected set; every filter must be in the expected state. | `filter-approval.service.ts:49-67` | 400 `NO_FILTERS`, 404 `NOT_FOUND`, 409 `INVALID_STATUS` | M |
| BR-058 | WF-011 | Reject requires a reason and (unless SA) the reviewRole or approvalRole. | `filter-approval.service.ts:133-139` | 400 `REASON_REQUIRED`, 403 `FORBIDDEN_ROLE` | M |
| BR-059 | WF-011 | Only REJECTED filters may be resubmitted (→ PENDING_REVIEW); their name stays reserved. | `filter-approval.service.ts:163-180` | 409 `INVALID_STATUS` | M |
| BR-060 | WF-011 | One audit row per filter per decision (never per batch). | `filter-approval.service.ts:69-80` | — | H |
| BR-061 | WF-011 | No separation-of-duties check in the filter approval workflow (same user may create, review and approve). | absence in `filter-approval.service.ts` | — | H (gap) |
| BR-062 | WF-012 | Replacement entries: self-review/approve forbidden; reject remarks ≥3; resubmit only REJECTED; reviewer edit only PENDING_REVIEW. | `replacement-schedule/workflow.ts:66,80,133,156,182` | 403 `SELF_APPROVAL_FORBIDDEN`, 400 `REMARKS_REQUIRED`, 400 `INVALID_STATUS` | H |
| BR-063 | WF-013 | Execute replacement: entry APPROVED, old filter in the task's AHU, task not complete. | `replacement-schedule/service.ts:376-401` | 409 `ENTRY_NOT_APPROVED`, 409 `FILTER_NOT_IN_TASK_AHU`, 400 `ALREADY_COMPLETE` | M |
| BR-064 | WF-014 | Retire: refuses already retired; terminates active cycle; sets Retired/inactive; detaches from parent; stashes `_preRetireParentId`; RFID stays bound. | `filter-operations.service.ts:775-886` | 400 `ALREADY_RETIRED` | H |
| BR-065 | WF-014 | Replace: new name must not collide with any active filter (case-insensitive); identifiers are MOVED to the new filter; the `FILTER_REPLACED` audit row is the replacement record. | `filter-operations.service.ts:888-1040` | 409 `DUPLICATE_FILTER_NAME` | H |
| BR-066 | WF-014 | Unretire restores parent from body ∥ stash ∥ replacement's parent; parent must be active; if the filter had been replaced, the replacement filter and all its cycles, events, identifiers and relationships are HARD-DELETED (counts recorded). | `super-admin/routes.ts:441-575` | 409 `PARENT_INACTIVE`, 404 | H |
| BR-067 | WF-014 | Retirement record DELETE refuses when the filter still has cycles, events, identifiers or children. | `super-admin/routes.ts:364-400` | 409 `HAS_HISTORY` | H |
| BR-068 | WF-030 | Active asset names are unique case-insensitively (app check + partial unique index). | `instance.service.ts:115,311`; `filter.service.ts:31,122`; migration `20260925091000` | 400 `VALIDATION_ERROR` / 409 `CONFLICT` | M |
| BR-069 | WF-030 | Generic path: a child may only be attached to an existing, ACTIVE parent, not itself, within the template's `maxParentConnections`. | `instance.service.ts:25-45` | 400 `VALIDATION_ERROR` | H |
| BR-070 | WF-030 | Typed path `POST /api/hierarchy/filters` checks the AHU exists but NOT that it is active. | `filter.service.ts:28` | — | M (probe) |
| BR-071 | WF-030 | Soft-deleting an instance refuses when it or any descendant has an IN_PROGRESS cycle; otherwise cascades `isActive=false`, removes identifiers, deactivates a block's equipment groups. | `instance.service.ts:655-740`; `filter.service.ts:190-200` | 409 `FILTER_CYCLE_IN_PROGRESS` | H |
| BR-072 | WF-030 | Parent FK is `onDelete: Restrict`; asset relationships must exist as bidirectional pairs (constraint trigger). | `schema.prisma:696`; baseline `trg_asset_relationship_pair` | DB error → 400 `DATA_CONSTRAINT` | M |
| BR-073 | WF-031 | An RFID tag value is globally unique; binding a tag held by a LIVE filter is refused; a tag held by a retired/inactive filter is released (audited) in the same transaction. | `identifier.service.ts:36-94`; `schema.prisma:792` | 409 `DUPLICATE_IDENTIFIER_VALUE` / `IDENTIFIER_ALREADY_ON_ENTITY` | H |
| BR-074 | WF-031 | Binding a new tag to a filter releases its previous tag with an `ASSET_IDENTIFIER_DELETED` audit. | `identifier.service.ts:70-83` | — | M |
| BR-075 | WF-020 | Login lockout: `maxFailedAttempts` (default 5) → LOCKED, TEMPORARY (`lockoutDurationMinutes`, default 30) or PERMANENT; counter shared by login, re-auth, change-password and offline-grant; SUPER_ADMIN exempt. | `auth.service.ts:36-90`; `lib/reauth-check.ts:50`; `auth/routes.ts:455` | 403 `ACCOUNT_LOCKED` | H |
| BR-076 | WF-020 | Status gates at login: LOCKED (auto-unlock for SA / expired temp lock), DISABLED, EXPIRED (SA and temp-password users auto-recover). | `auth.service.ts:195-222` | 403 `ACCOUNT_LOCKED` / `ACCOUNT_DISABLED` / `PASSWORD_EXPIRED` | H |
| BR-077 | WF-020 | Tablet login is decided before any session is created: role must hold tablet `login` in `system_config['tablet-access']`; SA always allowed; config absent ⇒ default-allow. | `auth.service.ts:254-261`; `lib/tablet-access.ts` | 403 `TABLET_ACCESS_DENIED` | H |
| BR-078 | WF-020 | One active session per user: a second login without `force` is refused; `force:true` terminates the others (audited `FORCED_LOGOUT`). | `auth.service.ts:265-295` | 409 `SESSION_CONFLICT` | H |
| BR-079 | WF-020 | Sessions expire on idle (`session` config hours, sliding) and on max duration; terminated sessions answer 401. | `plugins/auth.ts:262-295,410-420` | 401 `SESSION_EXPIRED` / `SESSION_INVALID` / `TOKEN_EXPIRED` | M |
| BR-080 | WF-021 | Under forced password change only 6 exact method+path pairs are reachable. | `plugins/auth.ts:310-370` | 403 `FORCE_PASSWORD_CHANGE` / `PASSWORD_EXPIRED` | H |
| BR-081 | WF-021 | Password policy: min/max length, character-class minimums, ≠ username, not containing username, ≠ temp password, not in last N history. | `auth.service.ts:430-470`; `lib/password-validator.ts` | 400 `POLICY_VIOLATION` | H |
| BR-082 | WF-021 | Password expiry anchor = latest of passwordChangedAt / createdAt / policy save time (grace on policy change); SA exempt. | `lib/password-expiry.ts:38-60`; `plugins/auth.ts:325-345` | 403 `PASSWORD_EXPIRED` | H |
| BR-083 | WF-021 | Changing the password terminates every OTHER session of the user. | `auth.service.ts:476` | — | M |
| BR-084 | WF-022 | A re-auth-gated handler never sees `_currentPassword`: stripped before any early return in both gates. | `lib/reauth-check.ts:214-224,281-292` | — | H |
| BR-085 | WF-022 | A failed signature attempt is audited (`REAUTH_FAILED`) and counts toward lockout; a successful one is audited (`REAUTH_SUCCESS`) and linked to the signed rows via `signature_audit_id`. The passwordless probe is NOT audited. | `lib/reauth-check.ts:40-100` | 401 `REAUTH_FAILED` / 403 `ACCOUNT_LOCKED` | H |
| BR-086 | WF-022 | Legacy nested `action-reauth` shape disables ALL policy-driven gates (treated as `{}`); surfaced by `getReauthHealth()`. | `lib/reauth-check.ts:119-190` | — | H |
| BR-087 | WF-005 | Offline-replay grants are honoured only under `/api/filters/`; the bare boolean header is rejected; the token is bound to user AND session and lives 24 h. | `plugins/auth.ts:442-477`; `lib/offline-replay-token.ts:69-170` | 401 `OFFLINE_REPLAY_HEADER_DEPRECATED`, `OFFLINE_REPLAY_TOKEN_*` | H |
| BR-088 | WF-005 | Issuing a grant always needs the live password; wrong password is audited and counted; success is not audited (operator decision). | `auth/routes.ts:415-480` | 401 `PASSWORD_REQUIRED` / `REAUTH_FAILED` | H |
| BR-089 | WF-005 | A verified replay write must carry `offlinePerformedAt` AND `clientOpId`; the time must be ≤5 min in the future, ≤30 days old, after cycle start and after the previous event. | `lib/offline-time-window.ts:37-190`; `assertOfflineReplayPayload` called in 5 writers | 400 `OFFLINE_REPLAY_FIELDS_REQUIRED`, `OFFLINE_TIME_*` | H |
| BR-090 | WF-005 | Every gate a replay skips is written to the event and audit row as `replayExemptGates` (`AHU_REPLACEMENT_OVERDUE`, `BLOCK_CHANGE`, `MISSED_PM`, `INTERLOCK_LEAVE`, `INTERLOCK_TERMINAL`). | `start-cycle.ts:145,152,208`; `advance.ts:209,498` | — | H |
| BR-091 | WF-005 | Idempotency: a replayed `clientOpId` already stored on a `filter_events.attributes` row of the same cycle (or latest cycle) returns the cached snapshot instead of writing again; start dedups on CYCLE_STARTED. | `lib/idempotency.ts:33-103`; `advance.ts:143-150` | — | H |
| BR-092 | WF-004 | Bulk-operate is per-item transactional with partial success; re-auth is taken once for the union of actions; `start-and-advance` tolerates `CYCLE_ACTIVE` on its start half; only `AppError` messages are returned. | `bulk-operate.ts:40-140`; `routes.ts:691` | per item `{code,message}` | H |
| BR-093 | WF-023 | `audit_trail` rows cannot be deleted at DB level (`audit_trail_no_delete` trigger); only the admin delete endpoints disable it inside their transaction after writing a meta-row. | baseline `block_audit_trail_delete`; `audit/routes.ts:860-890,930-955` | DB `restrict_violation` | H |
| BR-094 | WF-023 | Every audit row is hash-chained (`previous_checksum`, `chain_position`); new rows are keyed V3; verify-chain flags checksum, link, gap and keyed-era downgrade anomalies. | `lib/audit.ts:185-255`; `lib/hash-chain.ts`; `lib/audit-verify.ts:185-336` | — | H |
| BR-095 | WF-023 | Audit edit/delete need SUPER_ADMIN (edit) or `AUDIT_DELETE` (delete), re-auth, a 5–500 char reason, and break the chain from that row; checksum fields are not editable; meta rows and redacted rows cannot be edited. | `audit/routes.ts:718-823,827-960` | 409 `META_AUDIT_IMMUTABLE`, 409 `REDACTED`, 400 `NO_CHANGES`/`INVALID` | H |
| BR-096 | WF-023 | Redaction is chain-preserving and recorded; a row cannot be redacted twice. | `audit/routes.ts:550-680` | 409 `ALREADY_REDACTED` | M |
| BR-097 | WF-023 | Non-SA readers never see rows authored by a SUPER_ADMIN nor the 8 SA-only actions, on `/api/audit` and `/api/debug/traces`. | `lib/audit-visibility.ts:43-80` | — | H |
| BR-098 | WF-032 | Every report download is preceded by `POST /api/audit/report-export-log`, gated by the report's `EXPORT_*` re-auth action and audited `REPORT_GENERATED`. | `audit/routes.ts:483-540` | 401 `REAUTH_REQUIRED` | M |
| BR-099 | WF-024 | Restore refuses an unsigned/foreign backup, a backup whose audit rows fail chain verification (unless `force`), and a backup missing tables the DB has (unless `force`). | `backup.service.ts:623,948`; `backup.repository.ts:505-555` | 403 `BACKUP_UNSIGNED`, 400 `BACKUP_AUDIT_CHAIN_INVALID`, 400 `BACKUP_INCOMPLETE` | H |
| BR-100 | WF-024 | Restore never destroys live audit rows absent from the backup; never overwrites live password hashes with the export sentinel. | `backup.repository.ts:586-650`; `backup.service.ts:653` | — | H |
| BR-101 | WF-024 | `.dump` restore takes a safety dump first and rolls back to it on failure; a failed rollback is reported distinctly. | `backup.service.ts:603-700` | 500 `RESTORE_FAILED` / `RESTORE_FAILED_NO_ROLLBACK` | H |
| BR-102 | WF-024 | Restore upload ≤100 MB. | `backup/routes.ts:127` | 413 `BACKUP_TOO_LARGE` | L |
| BR-103 | WF-025 | Every config write is Zod-validated, secret-redacted before audit, audited `CONFIG_CHANGED`, and re-auth-gated by the def's action; secret-bearing static keys use always-on re-auth. | `config.service.ts:60-130`; `config/routes.ts:87-140` | 400 `VALIDATION_ERROR` | H |
| BR-104 | WF-025 | 31 of 38 dynamic defs are SUPER_ADMIN-only (`requiredRole`), `user-id` is ADMIN, 6 (backup, login-security, password-policy, report-labels, report-page-titles, report-signatories, session) are permission-gated `CONFIG_READ`/`CONFIG_UPDATE`. | `defs/*.def.ts`; `dynamic-routes.ts:38-67` | 403 `FORBIDDEN` | M |
| BR-105 | WF-033 | Non-SA role editors cannot touch their own role, a role at/above their level, assign such a level, or grant permissions they lack; system roles undeletable; roles with users undeletable. | `role.service.ts:28-49,354,364` | 403 `FORBIDDEN`, 409 `ROLE_HAS_USERS`, 409 `SYSTEM_ROLE` | H |
| BR-106 | WF-033 | SUPER_ADMIN is invisible to non-SA in role lists and role detail (404). | `role.service.ts:208-245` | 404 `NOT_FOUND` | M |
| BR-107 | WF-019 | Nobody below SUPER_ADMIN may manage a SUPER_ADMIN or a role at/above their own; SA accounts hidden from non-SA lists (ADMIN hidden from non-ADMIN). | `user.service.ts:34-45,59-60,87-88` | 403 `FORBIDDEN` / 404 | H |
| BR-108 | WF-019 | Cannot delete own account; cannot delete SUPER_ADMIN users (single or bulk). | `user.service.ts:273-298` | 400 `VALIDATION_ERROR`, 403 `FORBIDDEN` | H |
| BR-109 | WF-019 | New user id must satisfy the configured `user-id` format (prefix/length/pattern); role must exist and be active; username/email unique. | `user.service.ts:105-130`; `lib/user-id-validator.ts` | 400 `VALIDATION_ERROR`, 409 `CONFLICT` | M |
| BR-110 | WF-019 | Role change, disable, unlock and reset terminate the user's sessions and invalidate the auth cache immediately. | `user.service.ts:235-252,355,394,420` | — | H |
| BR-111 | WF-016 | Admin requests are decided once (conditional claim); approver may not act on a target above their hierarchy; only LOCKED accounts are unlockable via request. | `admin-request.service.ts:231-256,381-389,487` | 400 `VALIDATION_ERROR` | M |
| BR-112 | WF-016 | `POST /:id/process` chooses `ADMIN_REQUEST_APPROVE` or `ADMIN_REQUEST_REJECT` per body action inside the handler (not a static preHandler). | `admin-requests/routes.ts:204-215` | 403 `FORBIDDEN` | M |
| BR-113 | WF-017 | Report review: reviewer ≠ generator; approver ≠ generator and ≠ reviewer; assignee only; reject remarks ≥3; status-ordered; concurrent decisions resolved by conditional update. | `report-reviews/service.ts:65,199-256` | 403 `SELF_REVIEW` / `SELF_APPROVE` / `NOT_ASSIGNEE`, 400 `REMARKS_REQUIRED`, 400 `INVALID_STATUS`, 409 `CONCURRENT_DECISION` | H |
| BR-114 | WF-018 | Gated notification types (`PM_SCHEDULE_QNN`, `GUEST_CLEANING_REQUEST`) are visible only to roles named in their config, regardless of addressing; SA sees all. | `notification.service.ts:11-60` | — | M |
| BR-115 | WF-018 | Notification delete needs `NOTIFICATION_DELETE` and is audited; read/unread are user-scoped auth-only. | `notifications/routes.ts:161-290` | 403 `FORBIDDEN` | L |
| BR-116 | WF-035 | Guest cleaning request is public, unlimited, writes one notification and one audit row per call, requires all 7 fields. | `guest/routes.ts:13-65`; `plugins/auth.ts:184` | 400 `VALIDATION` | H (abuse) |
| BR-117 | WF-027 | Equipment group = exactly 3 instruments with consistent ranges; deactivate/delete refused while in use by IN_PROGRESS cycles or when the block would be left with no active group. | `equipment-groups.service.ts:89-107,175,253,328-360` | 400 `VALIDATION`, 409 `IN_USE` | M |
| BR-118 | WF-027/028/029/036 | Every mutation of equipment groups, checklist profiles and filter profiles snapshots the outgoing version first; cleaning profiles version by lineage (new row per update). | `equipment-groups.service.ts:33`; `checklist-profile.service.ts:56`; `filter-profile.service.ts:35`; `cleaning-profile.service.ts:178` | — | H |
| BR-119 | WF-028 | A checklist referenced by a non-archived cleaning profile cannot be disabled; delete refused when referenced or pinned by cycles. | `checklist-profile.service.ts:193-210,248-268` | 409 `CHECKLIST_IN_USE`, 409 `IN_USE` | H |
| BR-120 | WF-029 | A cleaning profile cannot be saved/activated pointing at a disabled checklist; cannot be deactivated/archived while active filter profiles reference it; delete refused when pinned or not lineage head. | `cleaning-profile.service.ts:292,321,408,417,486` | 400 `CHECKLIST_DISABLED`, 409 `CONFLICT` | H |
| BR-121 | WF-036 | Filter profile must reference an ACTIVE cleaning profile and existing templates; cannot be deleted while filters are assigned; assign refuses inactive filter ids. | `filter-profile.service.ts:168,183,229,244,301,340` | 400 `VALIDATION_ERROR`, 400 `INVALID_FILTER_IDS` | M |
| BR-122 | WF-034 | With the SA API lock off, a SUPER_ADMIN can only reach 7 endpoints; the lock reads fail-open. | `plugins/auth.ts:380-410`; `lib/super-admin-lock.ts:40-52` | 403 `SUPER_ADMIN_API_LOCKED` | H |
| BR-123 | WF-014/023 | Filter Data Management writes need SUPER_ADMIN, re-auth `SUPER_ADMIN_DATA_EDIT` and `_changeReason` (5–500 chars; `reason` would overwrite a real column); deletes audit BEFORE the row dies; editing/deleting a `FILTER_REPLACED` row breaks the chain and says so. | `super-admin/manual-change.ts:10-50`; `super-admin/routes.ts:45-60,578-650,742-780` | 400 `REASON_TOO_LONG`/`MISSING_FIELD`/`INVALID_VALUE` | H |
| BR-124 | §2 | SUPER_ADMIN bypasses every RBAC decorator including `requireRole(...)` lists that do not name it. | `plugins/rbac.ts:26,60,86` | — | H |
| BR-125 | §2 | `X_VIEW` is satisfied by `X_READ`; `X_{CREATE,UPDATE,DELETE,VIEW,READ,EXPORT}` by `X_MANAGE` (BACKUP_RESTORE deliberately excluded). | `packages/shared/src/types/permissions.ts:234-273` | — | M |
| BR-126 | §2 | Inverted date ranges are refused globally; bare end dates cover the whole day (three implementations must agree: guard, `listWhere`, console). | `lib/date-range-guard.ts:33-110` | 400 `INVALID_DATE_RANGE` | M |
| BR-127 | §2 | Only three rate limits exist (login 100/min, verify 50/min, change-password 50/min), keyed per IPv6 /64. | `app.ts:268-270`; `auth/routes.ts:26,295,329` | 429 `TOO_MANY_REQUESTS` | H |
| BR-128 | WF-031 | Photo upload: MIME allowlist (jpeg/png/gif/webp by default), magic-byte check, size limit; auth-only. | `uploads/routes.ts:17,84-146` | 400 `INVALID_FILE_TYPE` / `INVALID_FILE`, 413 `FILE_TOO_LARGE` | L |
## 5. Error codes

### 5.1 Codes thrown by API code (`new AppError(status, code, …)`, `new ConflictError(…, code)`, `reply.code(n).send({ error: code })`)

424 refusal sites in `apps/api/src` (tests and `e2e/` excluded), 123 distinct codes. Status column lists every status the code is thrown with. "Where" shows up to three sites; the full list is reproducible with footnote command 5. Semantics are given in §3/§4 where the code is referenced; generic ones: `NOT_FOUND` (resource missing or hidden from the caller's role), `FORBIDDEN` (RBAC/role/hierarchy), `VALIDATION`/`VALIDATION_ERROR`/`VALIDATION_FAILED` (input), `CONFLICT` (duplicate / state clash incl. Prisma P2002), `INVALID_STATUS` (state-machine precondition), `CREATE_FAILED`/`DELETE_FAILED`/`MISSING_FIELD`/`INVALID_VALUE`/`INVALID`/`NO_CHANGES` (Filter Data Management console input), `UPLOAD_FAILED` (bulk upload internal), `INTERNAL_ERROR` (unhandled, 500).

| Code | HTTP | Sites | Where (file:line) |
|---|---|---|---|
| `ACCOUNT_DISABLED` | 403 | 1 | apps/api/src/modules/auth/auth.service.ts:209 |
| `ACCOUNT_INACTIVE` | 401 | 2 | apps/api/src/modules/auth/routes.ts:171, apps/api/src/plugins/auth.ts:298 |
| `ACCOUNT_LOCKED` | 403 | 4 | apps/api/src/modules/auth/auth.service.ts:179, apps/api/src/modules/auth/auth.service.ts:426, apps/api/src/modules/auth/auth.service.ts:512 |
| `AHU_INTERLOCK_PENDING` | 422 | 1 | apps/api/src/modules/filter-operations/ahu-completion-gate.ts:475 |
| `AHU_REPLACEMENT_OVERDUE` | 409 | 1 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:140 |
| `ALREADY_COMPLETE` | 400 | 1 | apps/api/src/modules/replacement-schedule/service.ts:401 |
| `ALREADY_PROCESSED` | 409 | 2 | apps/api/src/modules/block-change-requests/block-change.service.ts:133, apps/api/src/modules/block-change-requests/block-change.service.ts:152 |
| `ALREADY_REDACTED_OR_MISSING` | 409 | 1 | apps/api/src/modules/audit/routes.ts:647 |
| `ALREADY_REDACTED` | 409 | 1 | apps/api/src/modules/audit/routes.ts:585 |
| `ALREADY_RETIRED` | 400/409 | 3 | apps/api/src/modules/filter-operations/filter-operations.service.ts:786, apps/api/src/modules/filter-operations/filter-operations.service.ts:937, apps/api/src/modules/super-admin/routes.ts:297 |
| `ALREADY_SUBMITTED` | 409 | 1 | apps/api/src/modules/filter-operations/cycle-write/submit-checklist.ts:389 |
| `APPROVAL_STALE` | 409 | 1 | apps/api/src/modules/stage-approvals/service.ts:156 |
| `ASSIGNEE_REQUIRED` | 400 | 1 | apps/api/src/modules/report-reviews/service.ts:51 |
| `BACKUP_AUDIT_CHAIN_INVALID` | 400 | 1 | apps/api/src/modules/backup/routes.ts:201 |
| `BACKUP_INCOMPLETE` | 400 | 1 | apps/api/src/modules/backup/backup.repository.ts:547 |
| `BACKUP_TOO_LARGE` | 413 | 1 | apps/api/src/modules/backup/routes.ts:78 |
| `BACKUP_UNSIGNED` | 403 | 2 | apps/api/src/modules/backup/backup.service.ts:623, apps/api/src/modules/backup/backup.service.ts:948 |
| `BLOCK_CHANGE_CONFIRM` | 409 | 1 | apps/api/src/modules/filter-operations/filter-resolver.ts:143 |
| `BLOCK_CHANGE_REQUIRED` | 409 | 2 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:306, apps/api/src/modules/filter-operations/filter-resolver.ts:136 |
| `BLOCK_MISMATCH` | 409 | 1 | apps/api/src/modules/filter-operations/filter-resolver.ts:185 |
| `BODY_TOO_LARGE` | 413 | 1 | apps/api/src/app.ts:323 |
| `CHECKLIST_DISABLED` | 400 | 2 | apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts:486, apps/api/src/modules/filter-operations/cycle-write/submit-checklist.ts:182 |
| `CHECKLIST_IN_USE` | 409 | 1 | apps/api/src/modules/checklist-profiles/checklist-profile.service.ts:205 |
| `CONCURRENT_DECISION` | 409 | 3 | apps/api/src/modules/report-reviews/service.ts:190, apps/api/src/modules/stage-approvals/service.ts:345, apps/api/src/modules/stage-approvals/service.ts:447 |
| `CONFLICT` | 409 | 11 | apps/api/src/app.ts:385, apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts:292, apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts:321 |
| `CREATE_FAILED` | 400 | 6 | apps/api/src/modules/super-admin/routes.ts:1012, apps/api/src/modules/super-admin/routes.ts:1131, apps/api/src/modules/super-admin/routes.ts:1217 |
| `CYCLE_ACTIVE` | 409 | 2 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:127, apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:287 |
| `CYCLE_CHANGED` | 409 | 1 | apps/api/src/modules/filter-operations/cycle-write/locking.ts:47 |
| `CYCLE_NOT_ACTIVE` | 409 | 2 | apps/api/src/modules/stage-approvals/service.ts:421, apps/api/src/modules/stage-approvals/service.ts:424 |
| `DATA_CONSTRAINT` | 400 | 1 | apps/api/src/app.ts:425 |
| `DELETE_FAILED` | 400 | 3 | apps/api/src/modules/super-admin/routes.ts:1049, apps/api/src/modules/super-admin/routes.ts:435, apps/api/src/modules/super-admin/routes.ts:908 |
| `DUPLICATE_FILTER_NAME` | 409 | 1 | apps/api/src/modules/filter-operations/filter-operations.service.ts:919 |
| `DUPLICATE_IDENTIFIER_VALUE` | 409 | 3 | apps/api/src/modules/assets/services/identifier.service.ts:67, apps/api/src/modules/super-admin/record-edit-routes.ts:224, apps/api/src/modules/super-admin/rfid-event-edit.ts:151 |
| `DUPLICATE_REQUEST` | 409 | 1 | apps/api/src/modules/block-change-requests/block-change.service.ts:37 |
| `EMPTY_FILE` | 400 | 1 | apps/api/src/modules/pm-schedules/routes.ts:259 |
| `ENTRY_NOT_APPROVED` | 409 | 2 | apps/api/src/modules/pm-schedules/pm-executions.ts:33, apps/api/src/modules/replacement-schedule/service.ts:383 |
| `FILE_TOO_LARGE` | 400/413 | 7 | apps/api/src/modules/uploads/routes.ts:146, apps/api/src/modules/assets/routes/instance.routes.ts:461, apps/api/src/modules/assets/routes/instance.routes.ts:497 |
| `FILTER_NOT_APPROVED` | 409 | 1 | apps/api/src/modules/assets/filter-workflow.ts:70 |
| `FILTER_NOT_IN_TASK_AHU` | 409 | 1 | apps/api/src/modules/replacement-schedule/service.ts:390 |
| `FILTER_RETIRED` | 409 | 1 | apps/api/src/modules/filter-operations/local-context.ts:92 |
| `FORBIDDEN_ROLE` | 403 | 3 | apps/api/src/modules/assets/filter-approval.service.ts:137, apps/api/src/modules/block-change-requests/routes.ts:24, apps/api/src/modules/pm-schedules/pm-workflow.ts:92 |
| `FORBIDDEN` | 403 | 16 | apps/api/src/modules/audit/routes.ts:516, apps/api/src/modules/pm-schedules/routes.ts:117, apps/api/src/modules/report-reviews/service.ts:163 |
| `HAS_HISTORY` | 409 | 1 | apps/api/src/modules/super-admin/routes.ts:390 |
| `IDENTIFIER_ALREADY_ON_ENTITY` | 409 | 1 | apps/api/src/modules/assets/services/identifier.service.ts:43 |
| `INTERLOCK_TERMINAL_STAGE` | 422 | 1 | apps/api/src/modules/filter-operations/cycle-write/advance.ts:493 |
| `INVALID_CARDS` | 400 | 1 | apps/api/src/modules/config/static-routes/dashboard-cards.routes.ts:51 |
| `INVALID_CARD_KEY` | 400 | 1 | apps/api/src/modules/config/static-routes/dashboard-cards.routes.ts:58 |
| `INVALID_CREDENTIALS` | 401 | 4 | apps/api/src/modules/auth/auth.service.ts:114, apps/api/src/modules/auth/auth.service.ts:139, apps/api/src/modules/auth/auth.service.ts:159 |
| `INVALID_DATE_RANGE` | 400 | 1 | apps/api/src/lib/date-range-guard.ts:109 |
| `INVALID_DATE` | 400 | 6 | apps/api/src/modules/assets/services/identifier.service.ts:175, apps/api/src/modules/pm-schedules/pm-approval.ts:332, apps/api/src/modules/pm-schedules/pm-approval.ts:372 |
| `INVALID_EQUIPMENT_GROUP` | 400 | 3 | apps/api/src/modules/filter-operations/cycle-write/advance.ts:370, apps/api/src/modules/filter-operations/cycle-write/advance.ts:384, apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:325 |
| `INVALID_FILE_TYPE` | 400 | 2 | apps/api/src/modules/pm-schedules/routes.ts:231, apps/api/src/modules/uploads/routes.ts:85 |
| `INVALID_FILE` | 400 | 1 | apps/api/src/modules/uploads/routes.ts:129 |
| `INVALID_FILTER_IDS` | 400 | 1 | apps/api/src/modules/filter-profiles/filter-profile.service.ts:340 |
| `INVALID_INPUT` | 400 | 1 | apps/api/src/modules/report-reviews/service.ts:107 |
| `INVALID_PASSWORD` | 400/401 | 3 | apps/api/src/modules/auth/auth.service.ts:420, apps/api/src/modules/auth/auth.service.ts:427, apps/api/src/modules/auth/auth.service.ts:513 |
| `INVALID_QUESTION_ORDER` | 400 | 1 | apps/api/src/modules/checklist-profiles/checklist-profile.service.ts:438 |
| `INVALID_REASON` | 400 | 2 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:217, apps/api/src/modules/filter-operations/manual-cycle.ts:45 |
| `INVALID_REQUEST` | 400 | 4 | apps/api/src/modules/assets/routes/instance.routes.ts:473, apps/api/src/modules/assets/routes/instance.routes.ts:509, apps/api/src/modules/pm-schedules/routes.ts:278 |
| `INVALID_STATUS` | 400/409 | 10 | apps/api/src/modules/pm-schedules/pm-approval.ts:328, apps/api/src/modules/pm-schedules/pm-approval.ts:368, apps/api/src/modules/pm-schedules/pm-approval.ts:418 |
| `INVALID_VALUE` | 400 | 15 | apps/api/src/modules/super-admin/record-edit-routes.ts:364, apps/api/src/modules/super-admin/record-edit-routes.ts:369, apps/api/src/modules/super-admin/record-edit-routes.ts:396 |
| `INVALID` | 400 | 4 | apps/api/src/modules/audit/routes.ts:791, apps/api/src/modules/super-admin/routes.ts:300, apps/api/src/modules/super-admin/routes.ts:687 |
| `IN_USE` | 409 | 4 | apps/api/src/modules/checklist-profiles/checklist-profile.service.ts:257, apps/api/src/modules/checklist-profiles/checklist-profile.service.ts:267, apps/api/src/modules/equipment-groups/equipment-groups.service.ts:333 |
| `JUSTIFICATION_REQUIRED` | 400 | 2 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:219, apps/api/src/modules/filter-operations/manual-cycle.ts:49 |
| `LDAP_ERROR` | 401 | 1 | apps/api/src/modules/auth/auth.service.ts:145 |
| `META_AUDIT_IMMUTABLE` | 409 | 1 | apps/api/src/modules/audit/routes.ts:770 |
| `METHOD_NOT_ALLOWED` | 405 | 1 | apps/api/src/app.ts:171 |
| `MISSING_FIELD` | 400 | 16 | apps/api/src/modules/super-admin/routes.ts:1113, apps/api/src/modules/super-admin/routes.ts:1114, apps/api/src/modules/super-admin/routes.ts:1206 |
| `NOT_ASSIGNEE` | 403 | 1 | apps/api/src/modules/report-reviews/service.ts:65 |
| `NOT_FOUND` | 404 | 92 | apps/api/src/app.ts:728, apps/api/src/modules/assets/filter-approval.service.ts:56, apps/api/src/modules/block-change-requests/block-change.service.ts:132 |
| `NOT_IMPLEMENTED` | 501 | 1 | apps/api/src/modules/pm-schedules/pm-due-tasks.ts:32 |
| `NO_ACTIVE_CYCLE` | 400 | 2 | apps/api/src/modules/filter-operations/cycle-write/advance.ts:153, apps/api/src/modules/filter-operations/cycle-write/submit-checklist.ts:127 |
| `NO_CHANGES` | 400 | 2 | apps/api/src/modules/audit/routes.ts:795, apps/api/src/modules/super-admin/record-edit-routes.ts:389 |
| `NO_CHECKLIST_AT_TARGET` | 400 | 2 | apps/api/src/modules/filter-operations/cycle-write/advance-with-checklist.ts:85, apps/api/src/modules/filter-operations/cycle-write/submit-checklist.ts:196 |
| `NO_FILE` | 400 | 3 | apps/api/src/modules/backup/routes.ts:129, apps/api/src/modules/backup/routes.ts:274, apps/api/src/modules/pm-schedules/routes.ts:223 |
| `NO_FILTERS` | 400 | 1 | apps/api/src/modules/assets/filter-approval.service.ts:50 |
| `NO_MATCHING_RECORDS` | 404 | 1 | apps/api/src/modules/audit/routes.ts:927 |
| `NO_PROFILE` | 400 | 3 | apps/api/src/modules/filter-operations/cycle-write/advance.ts:182, apps/api/src/modules/filter-operations/cycle-write/bypass.ts:75, apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:121 |
| `NO_ROWS` | 400 | 1 | apps/api/src/modules/pm-schedules/routes.ts:269 |
| `OFFLINE_REPLAY_HEADER_DEPRECATED` | 401 | 1 | apps/api/src/plugins/auth.ts:460 |
| `PARENT_INACTIVE` | 409 | 1 | apps/api/src/modules/super-admin/routes.ts:502 |
| `PARSE_ERROR` | 400 | 2 | apps/api/src/app.ts:372, apps/api/src/modules/pm-schedules/routes.ts:256 |
| `PASSWORD_REQUIRED` | 401 | 1 | apps/api/src/modules/auth/routes.ts:442 |
| `PM_DISABLED` | 404 | 1 | apps/api/src/modules/pm-schedules/pm-shared.ts:15 |
| `PM_ENTRY_HAS_EVIDENCE` | 409 | 1 | apps/api/src/modules/pm-schedules/pm-schedule-crud.ts:120 |
| `PM_PREVIOUS_TASK_PENDING` | 409 | 1 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:195 |
| `PM_VISIT_OVERLAP` | 409 | 2 | apps/api/src/modules/pm-schedules/pm-separation-guard.ts:74, apps/api/src/modules/pm-schedules/pm-separation-guard.ts:84 |
| `POLICY_VIOLATION` | 400 | 7 | apps/api/src/modules/auth/auth.service.ts:434, apps/api/src/modules/auth/auth.service.ts:435, apps/api/src/modules/auth/auth.service.ts:447 |
| `PROFILE_DISABLED` | 400 | 1 | apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:239 |
| `REASON_REQUIRED` | 400 | 4 | apps/api/src/modules/assets/filter-approval.service.ts:133, apps/api/src/modules/filter-operations/cycle-write/start-cycle.ts:155, apps/api/src/modules/filter-operations/manual-cycle.ts:41 |
| `REASON_TOO_LONG` | 400 | 1 | apps/api/src/modules/super-admin/manual-change.ts:47 |
| `REAUTH_FAILED` | 401 | 1 | apps/api/src/modules/auth/routes.ts:477 |
| `REAUTH_REQUIRED` | 401 | 2 | apps/api/src/lib/reauth-check.ts:251, apps/api/src/lib/reauth-check.ts:300 |
| `REDACTED` | 409 | 1 | apps/api/src/modules/audit/routes.ts:776 |
| `REMARKS_REQUIRED` | 400 | 8 | apps/api/src/modules/pm-schedules/pm-approval.ts:144, apps/api/src/modules/pm-schedules/pm-approval.ts:277, apps/api/src/modules/replacement-schedule/workflow.ts:133 |
| `RESTORE_FAILED` | 500 | 1 | apps/api/src/modules/backup/routes.ts:220 |
| `ROLE_HAS_USERS` | 409 | 1 | apps/api/src/modules/roles/role.service.ts:354 |
| `SELF_APPROVAL_FORBIDDEN` | 403 | 4 | apps/api/src/modules/block-change-requests/block-change.service.ts:136, apps/api/src/modules/pm-schedules/pm-approval.ts:125, apps/api/src/modules/replacement-schedule/workflow.ts:66 |
| `SELF_APPROVE` | 403 | 1 | apps/api/src/modules/report-reviews/service.ts:238 |
| `SELF_REVIEW` | 403 | 1 | apps/api/src/modules/report-reviews/service.ts:206 |
| `SERVICE_BUSY` | 503 | 1 | apps/api/src/app.ts:410 |
| `SESSION_CONFLICT` | 409 | 1 | apps/api/src/modules/auth/auth.service.ts:270 |
| `SESSION_EXPIRED` | 401 | 2 | apps/api/src/plugins/auth.ts:279, apps/api/src/plugins/auth.ts:290 |
| `SESSION_INVALID` | 401 | 2 | apps/api/src/modules/auth/routes.ts:161, apps/api/src/plugins/auth.ts:269 |
| `STAGE_APPROVAL_PENDING` | 423 | 1 | apps/api/src/modules/filter-operations/stage-interlock.ts:112 |
| `STAGE_APPROVAL_REJECTED` | 423 | 1 | apps/api/src/modules/filter-operations/stage-interlock.ts:106 |
| `STATE_CHANGED` | 409 | 1 | apps/api/src/modules/filter-operations/cycle-write/locking.ts:44 |
| `SUPER_ADMIN_API_LOCKED` | 403 | 1 | apps/api/src/plugins/auth.ts:399 |
| `SYSTEM_ROLE` | 409 | 1 | apps/api/src/modules/roles/role.service.ts:364 |
| `TABLET_ACCESS_DENIED` | 403 | 1 | apps/api/src/modules/auth/auth.service.ts:261 |
| `TAPE_VERSION_REQUIRED` | 400 | 1 | apps/api/src/modules/filter-operations/cycle-write/bulk-operate.ts:102 |
| `TOKEN_EXPIRED` | 401 | 1 | apps/api/src/plugins/auth.ts:262 |
| `TOO_MANY_REQUESTS` | 429 | 1 | apps/api/src/app.ts:316 |
| `UNAUTHORIZED` | 401 | 3 | apps/api/src/plugins/auth.ts:249, apps/api/src/plugins/rbac.ts:62, apps/api/src/plugins/rbac.ts:97 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 1 | apps/api/src/app.ts:362 |
| `UPLOAD_FAILED` | 500 | 2 | apps/api/src/modules/assets/routes/instance.routes.ts:478, apps/api/src/modules/pm-schedules/routes.ts:282 |
| `USER_NOT_FOUND` | 401 | 1 | apps/api/src/modules/auth/routes.ts:449 |
| `VALIDATION_ERROR` | 400 | 34 | apps/api/src/app.ts:330, apps/api/src/app.ts:352, apps/api/src/modules/assets/routes/identifier.routes.ts:146 |
| `VALIDATION_FAILED` | 500 | 1 | apps/api/src/modules/assets/routes/instance.routes.ts:513 |
| `VALIDATION` | 400 | 25 | apps/api/src/modules/assets/routes/instance.routes.ts:356, apps/api/src/modules/assets/routes/instance.routes.ts:464, apps/api/src/modules/assets/routes/instance.routes.ts:467 |
| `VALUE_TOO_LONG` | 400 | 1 | apps/api/src/app.ts:397 |
| `WASH_IN_READINGS_REQUIRED` | 400 | 1 | apps/api/src/modules/filter-operations/cycle-write/advance.ts:310 |
| `WRONG_APPROVER_ROLE` | 403 | 1 | apps/api/src/modules/stage-approvals/service.ts:58 |

### 5.2 Shared pipeline-executor guard codes (`packages/shared/src/pipeline-executor/*.ts`)

Thrown through `throwIfFailed` (`filter-operations/local-context.ts:334`), which maps the code to a status via `deriveStatusCode` (`:312`): 409 for `STALE_TAPE`, `SCHEMA_DRIFT`, `ALREADY_SUBMITTED`, `STATE_CHANGED`, `CYCLE_CHANGED`, `CYCLE_ACTIVE`, `GROUP_VERSION_MISSING`; 403 for `BYPASS_FORBIDDEN`; 400 for everything else. 30 distinct codes; the 24 not also thrown directly by API code:

| Code | Guard | File |
|---|---|---|
| `NO_CYCLE` | cycle must be active | `transitions.ts:27` |
| `CHECKLIST_PENDING` | #14 pending checklist before advance | `transitions.ts:170` |
| `CYCLE_COMPLETE` | #15 | `transitions.ts:187` |
| `OUT_OF_SEQUENCE` | #16 target reachable / `assertCanTransition` | `transitions.ts:214,435` |
| `INVALID_TARGET` | #17 / #39 target is a STAGE | `transitions.ts:229`; `bypass.ts:33,55,62` |
| `STALE_TAPE` | tape version | `transitions.ts:259` |
| `SCHEMA_DRIFT` | #4 checklist schema | `checklist.ts:59` |
| `INVALID_QUESTIONS` | #6 unknown answer keys | `checklist.ts:118` |
| `BYPASS_FORBIDDEN` | #38 | `bypass.ts:18` |
| `READING_REQUIRED` / `INVALID_READING` / `READING_OUT_OF_RANGE` | #27–#29 instruments | `instruments.ts:41,58,74` |
| `MULTIPLE_EQUIPMENT_GROUPS` / `NO_EQUIPMENT_GROUP` / `GROUP_VERSION_MISSING` | #30–#32 | `instruments.ts:118,133,160,167` |
| `PARAM_REQUIRED` / `PARAM_OUT_OF_RANGE` | #18/#19 | `parameters.ts:51,78,85` |
| `INVALID_DRYER_ACTION` / `INVALID_DURATION` / `NOT_IN_DRY_IN` / `DRYER_NOT_STARTED` / `DRYER_NOT_READY` / `DRYER_DURATION_REQUIRED` / `DRYER_READINGS_REQUIRED` | #21–#28 dryer | `dryer.ts:27,40,57,72,116,158,165,195,229` |

Also shared but duplicated in API code: `CYCLE_ACTIVE`, `NO_PROFILE`, `PROFILE_DISABLED`, `INVALID_EQUIPMENT_GROUP`, `JUSTIFICATION_REQUIRED`, `VALIDATION_ERROR`.

### 5.3 Offline replay codes (12)

| Code | HTTP | Meaning | File:line |
|---|---|---|---|
| `OFFLINE_REPLAY_TOKEN_MISSING` / `_EXPIRED` / `_INVALID` / `_WRONG_TYPE` / `_USER_MISMATCH` / `_SESSION_MISMATCH` | 401 | grant token absent / past 24 h / bad signature / wrong `typ` / not this user / not this session | `lib/offline-replay-token.ts:132-168`, surfaced `plugins/auth.ts:455` |
| `OFFLINE_REPLAY_HEADER_DEPRECATED` | 401 | legacy bare `x-offline-replay: true` | `plugins/auth.ts:460` |
| `OFFLINE_REPLAY_FIELDS_REQUIRED` | 400 | verified replay without `offlinePerformedAt` + `clientOpId` | `lib/offline-time-window.ts:102-115` |
| `OFFLINE_TIME_INVALID` / `_FUTURE` (>5 min ahead) / `_TOO_STALE` (>30 d) / `_BEFORE_CYCLE` / `_BEFORE_PREVIOUS_EVENT` | 400 | `offlinePerformedAt` window | `lib/offline-time-window.ts:140-190` |

### 5.4 Framework-level codes (global error handler, `app.ts:296-480`)

`TOO_MANY_REQUESTS` 429 · `BODY_TOO_LARGE` 413 · `VALIDATION_ERROR` 400 (Fastify schema + Zod) · `UNSUPPORTED_MEDIA_TYPE` 415 · `PARSE_ERROR` 400 · `CONFLICT` 409 (Prisma P2002) · `VALUE_TOO_LONG` 400 (P2000) · `SERVICE_BUSY` 503 (P2024/P2028) · `DATA_CONSTRAINT` 400 (other known Prisma) · `INTERNAL_ERROR` 500 · `METHOD_NOT_ALLOWED` 405 (`app.ts:171`) · `NOT_FOUND` 404 for unknown routes (`app.ts:728`).

## 6. Scheduled jobs

| Job | Schedule | Where | What it does | Evidence |
|---|---|---|---|---|
| `session_sweep` | every 5 min | `app.ts:853` → `sweepExpiredSessions` | terminates idle / max-duration sessions, writes `LOGOUT` audit rows | `app.ts:852-853` |
| `password_expiry_check` | daily 00:00 | `app.ts:855` → `sweepPasswordExpiryNotifications` | warning notifications before expiry (same anchor as the login block) | `app.ts:854-855`; `lib/password-expiry.ts:71` |
| `log_retention` | daily 00:05 **and once at boot** (only when file logging enabled) | `app.ts:847-849` → `pruneLogs` | keeps newest 7 dates per log channel | `app.ts:847-850` |
| `pm_overdue_check` | daily 03:00 | `app.ts:857` → `sweepOverdueDeviations` | opens / closes / blocks PM overdue deviations, notifies, audits (WF-010) | `app.ts:856-857`; `pm-deviations.ts:249` |
| **Windows task** "DigiLog Nightly Backup" | daily 01:30, SYSTEM, 2 h limit, StartWhenAvailable | `scripts/register-backup-task.ps1:37-66` → `scripts/backup-db.ps1` | `pg_dump` to `<DataRoot>\backups\nightly-*.sql`, prunes dumps older than 14 days (`RetainDays`) | `backup-db.ps1:35,42,129-139`; removed by `uninstall.ps1:35` |

All four cron jobs run only while the API process is up; `/api/health` reports `jobRunner` (`running`/`failed`). There is no job queue. A manual trigger exists for the PM sweep (`POST /api/pm-schedules/deviations/sweep`, `PM_UPDATE`) and the password-expiry sweep (`POST /api/users/password-expiry-sweep`, `CONFIG_UPDATE`).

## 7. Validation layer

| Aspect | Finding | Evidence |
|---|---|---|
| JSON-schema coverage | Every route registration in every `routes*.ts` under `modules/` carries a `schema:` block (58 files; e.g. `pm-schedules/routes.ts` 27/27, `super-admin/routes.ts` 38/38 once single-line registrations are counted). The only registration the 4-line scan flagged (`super-admin/routes.ts:96` `PUT /api-lock`) has `schema.body` at `:104`. | footnote cmd 10 |
| Write routes with no `body` schema | Legitimate: multipart uploads (`POST /api/assets/instances/bulk-upload-filters[/validate]`, `/api/backup/restore`, `/api/backup/validate`, `/api/pm-schedules/upload`, `/api/replacement-schedules/validate` + `POST /`, `/api/uploads/photo`), parameter-only actions (`DELETE …/:id` across modules, `POST /api/users/:id/enable|disable`, `PUT /api/notifications/:id/read|unread`, `/mark-all-read`, `PUT /api/notification-rules/:id/toggle`, `POST /api/notification-rules/:id/test`, `PUT /api/debug/traces/entity/:id/toggle`, `POST /api/pm-schedules/deviations/sweep`, `/deviations/:id/acknowledge`, `POST /api/users/password-expiry-sweep`), and `POST /api/auth/login` / `/refresh` (schema present; body defined inline beyond the 14-line scan window – verify when writing tests). `POST /api/admin-requests/:id/process` and `POST /api/assets/instances/:id/resubmit` take only a small body and were also flagged – confirm their `body` in the file before relying on 400s. | footnote cmd 10 (approximate awk) |
| Zod | Config writes (`config.service.ts:60-80`), roles (`role.service.ts:250-293`), admin-request field values (`admin-request.service.ts:454-459`); ZodError → 400 `VALIDATION_ERROR` (`app.ts:336-358`). | — |
| HTML sanitizer | `lib/sanitize.ts` (`stripHtml`, `sanitizeStrings`, sanitize-html with no allowed tags, `recursiveEscape`). **Applied per call site, not globally** — 11 files: admin-requests, assets/filter-fields, auth profile (`sanitizeStrings(data, ['photoUrl'])`), equipment-groups create/update, cycle-write advance (remarks), bypass (justification), start-cycle, terminate-cycle, guest, replacement-schedule, users. Free-text fields elsewhere (e.g. PM approval remarks, stage-approval remarks, notification rule names, help articles, config values) are stored as sent (schema `maxLength` only). The CLAUDE.md claim "strips HTML on all text fields" is NOT what the code does. | footnote cmd 11 |
| Date-range guard | global preHandler, see §2. | `lib/date-range-guard.ts` |
| Rate limits | three, see §2 / BR-127. Locked by `lib/__tests__/rate-limit-policy.test.ts`. | — |
| Body size | Fastify body limit → 413 `BODY_TOO_LARGE`; multipart `fileSize` limits per route (backup 100 MB; uploads/photo per `UPLOAD_MAX_BYTES`-style env; bulk-upload per route). | `app.ts:319-330`; `backup/routes.ts:127`; `uploads/routes.ts:107` |
| Outbound URLs | `lib/ssrf.ts` `hardenedFetch`/`checkOutboundUrl` for instrument readings and SMTP/SMS/LDAP-typed URLs; LDAP scheme allowlist. | `equipment-groups/instrument-fetch.ts`; `ldap.service.ts:146` |
| Error-text leakage | Only `AppError.message` is forwarded; Prisma/other messages replaced (`app.ts:420-480`; `bulk-operate.ts:135-139`). | — |

## 8. Database constraints that encode rules

Prisma: 61 models, 24 enums (`schema.prisma`). Migrations: baseline `00000000000000_baseline` + 13 incremental (listed in footnote cmd 9). Note the baseline still CREATEs tables later dropped by migrations (`latest_telemetry`, `qr_codes`, `checklist_reviews`, `report_*`); the live schema is the END state.

### 8.1 Triggers (baseline migration)

| Trigger | Table | Function | Rule |
|---|---|---|---|
| `audit_trail_no_delete` BEFORE DELETE | `audit_trail` | `block_audit_trail_delete()` (`:403`) | raises `restrict_violation`: audit rows are immutable; only the admin delete endpoints disable it in-tx (`:3903`). No UPDATE trigger exists — edits are possible at DB level. |
| `trg_filter_event_consistency` BEFORE INSERT/UPDATE OF cycle_id, filter_id | `filter_events` | `check_filter_event_consistency()` (`:462`) | event's cycle must exist and belong to the same filter (`:3917`). |
| `trg_asset_relationship_pair` CONSTRAINT, DEFERRABLE INITIALLY DEFERRED, AFTER INSERT/DELETE | `asset_relationships` | `check_asset_relationship_pair()` + `inverse_relationship_type()` (`:417,:639`) | every relationship must have its inverse pair; cannot delete one half (`:3910`). |
| `trg_mirror_asset_instance_iud` AFTER I/U/D | `asset_instances` | `fn_mirror_asset_instance()` (`:490`) | mirrors into typed `blocks/areas/ahus/filters` incl. `is_active` (`:3924`). |
| `trg_mirror_typed_to_asset_instance` AFTER I/U/D | `filters` | `fn_mirror_typed_to_asset_instance()` (`:600`) | reverse mirror (`:3931`). |

### 8.2 Unique constraints / indexes that are business rules

| Constraint | Rule | Source |
|---|---|---|
| `idx_cleaning_cycles_one_in_progress_per_filter` UNIQUE (filter_id) WHERE status='IN_PROGRESS' | one active cycle per filter | baseline `:3399` |
| `asset_instances_active_name_key` UNIQUE (lower(name)) WHERE is_active | active asset names unique, case-insensitive; migration-only (not expressible in Prisma) | `20260925091000_active_name_unique:9` |
| `asset_identifiers.identifier_value` UNIQUE | one holder per RFID tag, globally | `schema.prisma:792` |
| `pm_schedule_entries (schedule_id, planned_date)` UNIQUE | one visit per date; replaced `(schedule_id, month)` | `20260827120000`; `schema.prisma:1224` |
| `pm_schedules (entity_id, year, version)` UNIQUE | schedule versioning per AHU/year | `schema.prisma:1149` |
| `deviations.pm_schedule_entry_id` UNIQUE; `deviation_number` UNIQUE default `DEV-` + seq | one deviation per PM task; numbered | `schema.prisma:1406-1407`; seq `deviation_number_seq` |
| `quality_notifications.qnn` UNIQUE | QNN numbers unique (seq `qnn_seq`) | `schema.prisma:1237` |
| `cleaning_cycles.cycle_code` UNIQUE | | `schema.prisma:1583` |
| `filter_cleaning_profiles (lineage_id, version)` UNIQUE | lineage versioning | `schema.prisma:1463` |
| `filter_profile_versions`, `checklist_profile_versions`, `equipment_group_versions`, `asset_template_versions`, `help_article_versions` `(parent_id, version_number)` UNIQUE | snapshot versioning | `schema.prisma:634,857,1576,1746,1855` |
| `filter_details.asset_instance_id` UNIQUE | 1:1 sidecar | `:725` |
| `users.username`, `users.email`, `roles.name`, `sessions.token_hash`, `system_config.config_key`, `field_id_config.field_id`, `role_configs.role`, `user_configs.user_id`, `template_kinds.code`, `asset_templates.name`, `user_groups.name`, `notification_templates.name`, `user_group_members (group_id,user_id)`, `asset_relationships (source,target,type)` | identity uniqueness | `schema.prisma:113-962` |
| `audit_trail.chain_position` BIGSERIAL (seq `audit_trail_chain_position_seq`) | strictly increasing chain order; gaps = deletion | baseline `:867` |

CHECK constraints: none (`grep -i "CHECK (" migrations` returns nothing). All range/format rules are application-level.

### 8.3 FK cascade behaviour (`onDelete`)

- `Cascade` (child dies with parent): template assignments, entity assignments, dashboard widgets/assignments, sessions and password history → users, template versions → template, `filter_details` → asset instance, asset relationships (both sides) → asset instance, asset identifiers → asset instance, help article versions, user group members, notification rule recipients → rule, PM schedule entries → schedule, replacement entries → schedule and replacement executions → entry, pipeline stages/edges → cleaning profile, filter profile applicable templates → profile/template, filter profile versions, equipment instruments and versions → group, checklist questions and versions → profile (`schema.prisma:25-1853`).
- `Restrict`: `asset_instances.parent_id` → parent (`:696`) — a parent with children cannot be hard-deleted (soft delete is the app path).
- `SetNull`: notification rule recipient `group_id` (`:1014`).
- No FK at all (soft references): `deviations.pm_schedule_entry_id`, `audit_trail.*`, `cleaning_cycles.profile_id` pin, `block_change_requests.filter_id` — integrity is application-side.

### 8.4 Enums (state vocabularies)

`UserStatus` {ENABLED, DISABLED, LOCKED, EXPIRED} · `CleaningCycleStatus` {IN_PROGRESS, COMPLETED, TERMINATED} · `FilterEventType` {STATE_TRANSITION, PARAMETER_CAPTURE, CHECKLIST_COMPLETED, BYPASS_DEVIATION, EQUIPMENT_LINKED, REMARK_ADDED, APPROVAL_GRANTED, SCRIPT_EXECUTED, CYCLE_STARTED, CYCLE_COMPLETED, CYCLE_TERMINATED} · `CleaningStageApprovalStatus` {PENDING, APPROVED, REJECTED, SUPERSEDED} · `PmScheduleStatus` {DRAFT, ACTIVE, ARCHIVED} · `PmEntryApprovalStatus` {PENDING, APPROVED, REJECTED, PENDING_REVIEW, PENDING_APPROVAL} (also used by `asset_instances.approval_status` and replacement entries) · `PmExecutionStatus` {SCHEDULED, IN_PROGRESS, COMPLETED, OVERDUE, MISSED} · `DeviationStatus` {OPEN, ACKNOWLEDGED, CLOSED} · `DeviationClosureKind` {COMPLETED_LATE, SKIPPED} · `ReplacementEntryStatus` {PENDING, DUE, IN_PROGRESS, COMPLETED, MISSED} · `BlockChangeStatus` {PENDING, APPROVED, REJECTED, EXPIRED} · `ReportReviewStatus` {PENDING_REVIEW, PENDING_APPROVAL, APPROVED, REJECTED} · `CleaningProfileStatus` {DRAFT, ACTIVE, ARCHIVED} · `PipelineFlowMode` {STRICT, BYPASS_ENABLED} · `PipelineNodeType` {STAGE, START, END, CHECKLIST, REMARKS, DURATION_INTERLOCK, PARAM_CAPTURE, CUSTOM_SCRIPT, APPROVAL, EQUIPMENT_LINK} · `FilterSetLabel` {SET_A, SET_B} · `BlockRestriction` {OWN_BLOCK_ONLY, ANY_BLOCK, SPECIFIC_BLOCKS} · `NotificationChannel` {EMAIL, SMS, IN_APP, TELEGRAM, WHATSAPP, SLACK} · `NotificationDeliveryStatus` {PENDING, SENT, DELIVERED, FAILED, RETRYING} · `NotificationEventType` (10) · `NotificationType` (long) · `ChecklistQuestionType` (12) · `RelationshipType` (12) · `AssigneeType` {USER, ROLE}.

## 9. Config definitions (38) — `modules/config/defs/*.def.ts`

All 38 carry `requiresReauth: true`. Access: `requiredRole` when set, else `permissions.read/write`.

| moduleKey | Access | Re-auth action | Drives |
|---|---|---|---|
| access-matrix | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT uses RA `UPDATE_ROLE_CONFIG`) | Configuration Access grant matrix |
| action-reauth | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT: `ROLE_MANAGE` + R `UPDATE_REAUTH_CONFIG`) | WF-022 policy |
| ahu-completion-process | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-003 mode |
| ahu-filter-set-config | SUPER_ADMIN (perms PM_READ/PM_UPDATE) | UPDATE_CONFIG_PAGE | per-AHU SET_A/SET_B counting |
| audit-templates | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT RA `UPDATE_AUDIT_TEMPLATES`) | audit row rendering |
| backup | CONFIG_READ / CONFIG_UPDATE | UPDATE_CONFIG_PAGE | backup settings |
| backup-format | SUPER_ADMIN | UPDATE_CONFIG_PAGE | default export format |
| block-change-approval | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-015 mode, approver role, autoExpireHours |
| branding | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT R `UPDATE_BRANDING`) | public branding |
| datetime | SUPER_ADMIN | UPDATE_DATETIME_CONFIG | display tz/format (public `/current`) |
| export-limit | SUPER_ADMIN | UPDATE_CONFIG_PAGE | max export rows + message |
| export-options | SUPER_ADMIN | UPDATE_CONFIG_PAGE | export menu options |
| field-ids | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT `FIELD_ID_UPDATE` + RA `UPDATE_FIELD_ID`) | field labels |
| filter-approval | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-011 roles/enabled |
| filter-cleaning-reasons | SUPER_ADMIN | UPDATE_CONFIG_PAGE | BR-008/009 |
| filter-field-options | SUPER_ADMIN | UPDATE_CONFIG_PAGE | filter attribute dropdowns |
| guest-cleaning-requests | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-035 recipientRoles |
| help | SUPER_ADMIN | UPDATE_CONFIG_PAGE | help settings |
| login-security | CONFIG_READ / CONFIG_UPDATE | UPDATE_LOGIN_SECURITY | lockout type/duration (BR-075) |
| notification-email / notification-sms | SUPER_ADMIN | UPDATE_CONFIG_PAGE (delivery routes R `UPDATE_EMAIL_CONFIG`/`UPDATE_SMS_CONFIG`) | channels |
| notification-logs | SUPER_ADMIN | UPDATE_CONFIG_PAGE | log retention/visibility |
| notification-rules | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-018 |
| offline-cache | SUPER_ADMIN | UPDATE_OFFLINE_CACHE_CONFIG | tablet cache TTLs |
| pagination | SUPER_ADMIN | UPDATE_CONFIG_PAGE | default page size (public `/current`) |
| password-policy | CONFIG_READ / CONFIG_UPDATE | UPDATE_PASSWORD_POLICY | BR-081/082 (public `/current`) |
| pm-schedule-approval | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-006 roles/enabled |
| pm-schedule-settings | SUPER_ADMIN | UPDATE_CONFIG_PAGE | PM enabled, default tolerance, overdue roles |
| qnn-notifications | SUPER_ADMIN | UPDATE_CONFIG_PAGE | QNN visibleRoles |
| replacement-schedule-approval | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-012 (inherits PM) |
| replacement-schedule-filters | SUPER_ADMIN | UPDATE_CONFIG_PAGE | list filters |
| report-labels / report-page-titles / report-signatories | CONFIG_READ / CONFIG_UPDATE | UPDATE_CONFIG_PAGE (signatories static PUT RA `UPDATE_REPORT_SIGNATORIES`) | PDF content |
| roles | SUPER_ADMIN | UPDATE_CONFIG_PAGE (static PUT `ROLE_MANAGE` + R `UPDATE_ROLE_CONFIG`) | role sidebar/permission picker |
| session | CONFIG_READ / CONFIG_UPDATE | UPDATE_SESSION_CONFIG | idle/max duration (BR-079) |
| stage-interlock | SUPER_ADMIN | UPDATE_CONFIG_PAGE | WF-002 enabled + approver roles |
| user-id | ADMIN | UPDATE_CONFIG_PAGE | BR-109 format |

Static (non-def) config routes also gated: tablet-access (`CONFIG_UPDATE` + RA `UPDATE_TABLET_ACCESS`), cleaning-profile-assignment (`CONFIG_UPDATE` + R `UPDATE_CONFIG_PAGE`), dashboard-cards, pm-schedule-filters, LDAP (`UPDATE_LDAP_CONFIG`).

## 10. Highest-risk rules and probes for the QA campaign

1. **BR-066 unretire hard-deletes the replacement filter's cleaning history** (cycles, events, identifiers) — the only code path that physically destroys cleaning records; recorded only in `afterValue._sideEffects`.
2. **BR-026/028/090 interlock + terminal-interlock + AHU-overdue + block-change + missed-PM are all bypassed by offline replay**; the grant proves possession of a password, not offline-ness, and a successful grant is not audited (BR-088).
3. **BR-095 / BR-123 audit edit and hard delete break the hash chain permanently**; no UPDATE trigger exists at DB level (§8.1), so a DB-level edit is undetectable except by verify-chain.
4. **BR-086 legacy `action-reauth` shape silently disables every policy-driven e-signature gate** (only RA sites survive); detect via deployment-check `effectivelyDisabled`.
5. **BR-061 filter approval has no separation of duties** while PM, replacement, block-change and report review all enforce it.
6. **BR-124 SUPER_ADMIN bypasses every RBAC decorator including `requireRole` lists**, combined with BR-075/082 (SA exempt from lockout and expiry) and BR-122 (API lock fail-open).
7. **BR-116 guest cleaning request is public and unlimited** and writes an audit row per call (audit-trail flooding); only three rate limits exist (BR-127).
8. **BR-010/011/012 missed-PM gate**: `pm-due-tasks` gives an overdue entry unbounded credit; correctness depends on the write-off running inside the cycle tx and the offline cache mirroring the server answer.
9. **BR-040 PM separation** is checked in five places (create, replace, resubmit, edit-request, approval, upload); any path that skips it allows two visits satisfiable by one cleaning; known December/January cross-year gap.
10. **BR-070 typed hierarchy filter create does not check the AHU is active** (generic path does, BR-069) — verify whether `POST /api/hierarchy/filters` can attach a filter to a deactivated AHU.

Secondary probes: BR-015 tape version only required when the client sends `tapeVersion` on single-filter routes (guard treats absent as "no check" — confirm each route schema makes it required); BR-004 relies on the partial unique index when two starts race past the app check; BR-053 deviation re-occurrence is blocked rather than recorded as a new deviation; §7 sanitizer coverage is per call site.

## 11. Footnote — commands run (read-only, from repo root unless noted)

1. `ls apps/api/src/modules/ | wc -l` → 33; `ls apps/api/src/modules/config/defs/*.def.ts | wc -l` → 38.
2. `grep -nE "cron\.schedule\(" apps/api/src/app.ts` → 4 jobs (lines 849, 853, 855, 857); `grep -nE "schtasks|Register-ScheduledTask|New-ScheduledTaskTrigger" scripts/*.ps1`.
3. `grep -nE "app\.(get|post|put|patch|delete)\(|requirePermission|requireAnyPermission|requireRole|requireSuperAdmin|enforceReauth" <module>/routes.ts` for every module (gates in §3).
4. `grep -nE "AppError\(|ConflictError\(|action: '[A-Z_]+'|export (async )?function" <service files>` per module (rules in §3/§4).
5. Error codes: `grep -rnoE "new AppError\(\s*[0-9]{3},\s*'[A-Z0-9_]+'" --include=*.ts apps/api/src | grep -v __tests__ | grep -v .test.ts` (213) + multi-line `grep -rnE -A3 "new AppError\(\s*$"` (22) + `grep -rnoE "reply\.code\(([0-9]{3})\)\.send\(\{\s*error:\s*'([A-Z_]+)'"` and its 2-line variant (194) + `new ConflictError(…,'CODE')` (4); `e2e/` rows removed → 424 sites, `cut -f2 | sort -u | wc -l` → 123.
6. `grep -hoE "code: '[A-Z0-9_]+'" packages/shared/src/pipeline-executor/{transitions,actions,dryer,checklist,bypass,instruments,justification,parameters}.ts | sort -u | wc -l` → 30; `comm -23` against the API set → 24 new.
7. `grep -nE "'OFFLINE_[A-Z_]+'" apps/api/src/lib/offline-time-window.ts apps/api/src/lib/offline-replay-token.ts | sort -u` → 12 codes.
8. `grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/permissions.ts` → 106; `grep -cE "^\s+[A-Z_]+:" packages/shared/src/types/reauth-actions.ts` → 127; `grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/audit-actions.ts` → 98; `grep -cE "^\s+\{?\s*id:\s*'" packages/shared/src/types/sidebar-items.ts` → 27; `grep -oE "category:\s*'[^']+'" reauth-actions.ts | sort | uniq -c` → 15 categories.
9. `grep -cE "^model " apps/api/prisma/schema.prisma` → 61; `grep -cE "^enum "` → 24; `ls apps/api/prisma/migrations | grep -v migration_lock | wc -l` → 14; `grep -rniE "CREATE (OR REPLACE )?(TRIGGER|FUNCTION)|CREATE UNIQUE INDEX|CHECK\s*\(|CREATE SEQUENCE" apps/api/prisma/migrations/*/migration.sql`; `grep -nE "@@unique|@unique|onDelete:" apps/api/prisma/schema.prisma`.
10. Schema coverage: for each `find apps/api/src/modules -name "*routes*.ts"`: `grep -cE "app\.(get|post|put|patch|delete)\("` vs `grep -cE "^\s*schema:\s*\{"`; awk 4-line window check for `schema`; awk 14-line window check for `body:` on write verbs (approximate, see §7).
11. `grep -rl "sanitizeStrings\|stripHtml" --include=*.ts apps/api/src/modules apps/api/src/lib | grep -v __tests__ | grep -v lib/sanitize.ts | wc -l` → 11.
12. `grep -nE "name:\s*'[A-Z_]+'|hierarchyLevel:\s*[0-9]+|isSystem" apps/api/prisma/default-roles.ts` → 6 roles.
13. Targeted `sed -n` reads of: `plugins/auth.ts`, `plugins/rbac.ts`, `lib/reauth-check.ts`, `lib/tablet-access.ts`, `lib/offline-*.ts`, `lib/idempotency.ts`, `lib/sanitize.ts`, `lib/date-range-guard.ts`, `lib/password-*.ts`, `lib/audit*.ts`, `lib/hash-chain.ts`, `modules/filter-operations/cycle-write/*.ts`, `stage-interlock.ts`, `ahu-completion-gate.ts`, `filter-resolver.ts`, `local-context.ts`, `filter-operations.service.ts`, `stage-approvals/service.ts`, `pm-schedules/*.ts`, `assets/*`, `auth/auth.service.ts`, `auth/routes.ts`, `users/user.service.ts`, `roles/role.service.ts`, `audit/routes.ts`, `backup/*.ts`, `super-admin/*.ts`, `block-change-requests/*.ts`, `admin-requests/*.ts`, `report-reviews/service.ts`, `replacement-schedule/*.ts`, `notifications/*.ts`, `equipment-groups/*.ts`, `checklist-profiles/*.ts`, `cleaning-profiles/*.ts`, `filter-profiles/*.ts`, `hierarchy/*.ts`, `guest/routes.ts`, `config/defs/*.def.ts`, `config/dynamic-routes.ts`, `config/routes.ts`, `config/static-routes/*.ts`, `apps/api/src/app.ts:296-480,640-680,847-870`, baseline migration `:403-490`.
