# DigiLog — CLAUDE.md

## Project
DigiLog (21cfrlogbook) — IoT data logging platform with 21 CFR Part 11 compliance and an integrated Digital Filter Management System for pharmaceutical cleanrooms.

## Repository
- **Remote:** github.com/Controlytics/FMS.git (private; `origin`). Mirrored from github.com/pankajexa/21cfrlogbook 2026-10-06, kept locally as remote `pankajexa`.
- **Active branch:** `RFID` (feature work) → merges to `DigitalFMS` → `main`

## Monorepo Structure
```
apps/api/         — Fastify backend (TypeScript, port 3000)
apps/web/         — React SPA (Vite, port 5175 dev)
apps/android/     — Capacitor Android wrapper (DigiLog-FilterOps.apk)
rfid_scan_app/    — Native Kotlin RFID scanner (KC-series UHF readers)
packages/shared/  — Permissions (106), privileges (87), reauth (127), sidebar items (27), zod schemas
docs/             — Project docs (current)
old/              — Archived superseded docs and tasks
future/           — Forward-looking design notes
```

## Local Dev Environment (Windows)
The app runs ONLY on local Windows for development. There is no live EC2 / Linux production environment to push to.

- Node.js 20+, PostgreSQL 18
- **No Redis dependency.** Phase 2 of windows-friendly-rewrite moved the job
  queue to graphile-worker on Postgres. Phase 4 (2026-05-01) retired Redis
  for pub/sub too (in-process EventEmitter bus); `ioredis` is no longer in
  package.json. Those pub/sub consumers (WebSocket events, pipeline tracing,
  debug recorder) were all torn out in Phase 6/7, and the now-orphaned bus
  (`lib/internal-bus.ts`) + the `@fastify/websocket` plugin were removed
  2026-07-03 as dead code — there is no pub/sub layer anymore.
  (The device-RPC correlation cache `lib/rpc-cache.ts` was removed 2026-07-01
  as dead code — its only consumer, the data-ingestion MQTT RPC handler, went
  in the Phase 7 tear-out.)
- **No TimescaleDB or MQTT dependency** (removed 2026-06-11..2026-06-17 — see
  Phase 7 below). `digilog_tsdb` database dropped, `packages/db` workspace
  deleted, `mqtt` + `aedes` + `@types/pg` deps uninstalled, Mosquitto Windows
  service removed. 47 transitive npm packages dropped with the cleanup.
- Convenience: `start-digilog.bat` / `stop-digilog.bat`
- API runs via `tsx watch` in dev (no PM2 locally), Vite serves frontend
- See `LOCAL_SETUP_WINDOWS.md` and `DEPLOY-WINDOWS.md` for full details

## Build Commands
```bash
# Backend (dev — auto-reload)
cd apps/api && npx tsx watch src/app.ts

# Backend (prod-style local build)
npx tsc -p apps/api/tsconfig.json && node apps/api/dist/app.js

# Frontend (dev)
cd apps/web && npx vite --host

# Frontend (build)
cd apps/web && npx vite build

# Shared packages
npm run build -w @digilog/shared && npm run build -w @digilog/queue

# APK
cd apps/android && npx cap copy android && cd android && ./gradlew assembleDebug
```

## Default Login
- **Username:** `superadmin`
- **Password:** `Admin@123` (forced change on first login)

## Key Local URLs
- App: http://localhost:5175 (Vite dev)
- API: https://localhost:3000 — `API_HTTPS=true` in `apps/api/.env` (mkcert certs at `certs/server.{key,crt}` rooted by `certs/rootCA.pem`)
- Swagger: https://localhost:3000/docs — **opt-in and fail-closed**: served only when
  `API_DOCS=on` is set in `apps/api/.env` (it is, locally). `NODE_ENV` has no say.
  Unset it and `/docs` is not registered at all, answering like any unknown path.
  Security assessment 2026-08-17, F-01 / API-07. Never enable on a customer machine.

### TLS notes
- **APK requires HTTPS** — plain HTTP causes a Capacitor TLS parse error on login. Tablet must trust `rootCA.pem` (Settings → Security → Install certificate). `apps/web/.env.production` is **`skip-worktree` and tracked blank** on purpose (no dev's IP in the repo); it is set locally only (currently `https://192.168.1.53:3000`, = this PC's static IP). **The baked value only affects a FRESH install** — `getApiBase()` (`apps/web/src/lib/api-base.ts`) reads `localStorage['digilog.serverUrl']` FIRST, so a tablet with an existing Server Address keeps using it across APK updates; change it on-device. See the network IP-change runbook in memory.
- **Browser dev** — `http://localhost:5175 → https://localhost:3000` is fine (browser allows it; no mixed-content issue for fetch).
- **Verify TLS up** — `curl -sk -o /dev/null -w "%{http_code}" https://localhost:3000/health` should return a code (even 401 means TLS is up).
- **Don't use HTTPS with self-signed in Capacitor *dev* mode** — WebView's `fetch()` rejects self-signed certs (Capacitor's `BridgeActivity` overrides the WebViewClient after `onCreate`). Keep dev cleartext if testing in-WebView, or install root CA on the device.

## System Stats (current — 2026-06-17, verified post data-ingestion + TimescaleDB removal)
- **Backend:** **33** API modules under `apps/api/src/modules/`, 200+ endpoints (verified `ls` 2026-07-04). 2026-06-11..2026-06-17 dropped 4 modules (`data-ingestion`, `uns`, `connectivity`, `queries`) and re-added `debug-traces` (now reads from `audit_trail` instead of dropped `ts_pipeline_traces`). **2026-07-04 dropped 2 modules** (`reports`, `report-templates`) as dead code — the orphaned report generate/sign engine; the active `report-reviews` module + the report-config defs (`report-page-titles`, `report-labels`, `report-signatories`) SURVIVE.
- **Database:** **61 Prisma models, 24 enums**; **2026-09-04 filter creation workflow:** +16 columns on `AssetInstance` (`approvalStatus` + submitted/reviewed/approved/rejected attribution), purely additive. `approvalStatus` REUSES `PmEntryApprovalStatus` (no new enum — `ReplacementEntry` already reuses it) and **defaults to APPROVED**, so all 511 existing rows and every non-filter asset (Block/Area/AHU) are untouched and operable. Migration `20260904064500_filter_approval_workflow`; drift guard PASS. **TimescaleDB DROPPED entirely** (was 6 hypertables — `ts_telemetry`, `ts_attributes`, `ts_checklist_responses`, `ts_device_events`, `ts_binary_data`, `ts_pipeline_traces`). Only `digilog_db` (Prisma) + `digilog_test_db` remain. **2026-06-11..2026-06-17 dropped 6 models** (`DeviceCredential`, `UnsMapping`, `ConnectivityStatus`, `DataStream`, `DeadLetterQueue`, `IngestionSystemConfig`) and 33 rows of dead ingestion config. TemplateKind is a lookup table (admin-editable since Step 1); not an enum. Phase A.3 added `FilterProfileVersion` sidecar; Phase A.4 added `EquipmentGroupVersion` sidecar; Step 4 (2026-05-02) replaced `FilterProfile.applicableTemplates` JSONB array with the `FilterProfileApplicableTemplate` join table. Audit C3 (2026-05-04) added `audit_trail.previous_checksum` + `chain_position BIGSERIAL` for tamper-evident hash chain. **2026-05-17 dropped 5 models** (`RuleChain`, `RuleChainVersion`, `RuleNode`, `RuleNodeConnection`, `Alarm`). **2026-07-01 dropped 2 orphaned tables** (`QrCode`/`qr_codes`, `LatestTelemetry`/`latest_telemetry` — both 0 rows, no FKs; the QR module went 2026-06-06 and the telemetry pipeline went in Phase 7, but the model+table lingered). Migration `20260701071802_drop_qrcode_latesttelemetry`; drift guard PASS. **2026-07-04 dropped 2 more orphaned tables** (`ChecklistReview`/`checklist_reviews`, `ElectronicSignature`/`electronic_signatures` — both 0 rows, 0 code refs, no relations; introduced with the data-ingestion feature set and stranded by the Phase 6/7 tear-outs: ChecklistReview linked to the dropped `ts_checklist_responses` hypertable, ElectronicSignature keyed off the removed `Alarm.id`/`ChecklistReview.id`. Live e-signature surface uses `ReportReview` + the hash-chained `audit_trail`). Migration `20260704062157_drop_checklistreview_electronicsignature`; drift guard PASS. **2026-07-04 dropped 4 models** (`ReportTemplate`, `ReportTemplateVersion`, `ReportInstance`, `ReportSignature`) + 2 enums (`ReportTemplateStatus`, `ReportStatus`) with the reports generate/sign tear-out (`ReportSignature` was orphaned — only the deleted reports module wrote it; the active e-signature surface is `ReportReview`). Migration `20260704121326_drop_reports_generate_sign`. **2026-08-26 recurring PM schedules + missed-PM gate:** +1 enum (`DeviationClosureKind`, 23->24), +13 nullable columns - `PmSchedule.{frequencyDays,anchorDate,seriesId}`, `PmScheduleEntry.{skippedAt,skippedBy,skippedByName,skipReason,lateReason,lateReasonBy,lateReasonAt}`, `Deviation.{closureKind,closureReason}`, `CleaningCycle.pmScheduleEntryId`. Purely additive. Migration `20260826075635_pm_frequency_days_and_missed_pm_resolution`; drift guard PASS. **The recurring-PM LOGIC was reverted 2026-08-27 (operator request) but these columns and the `DeviationClosureKind` enum were deliberately KEPT** — all are nullable with zero rows, dropping them would be a destructive migration for no gain, and the schema must keep matching the live DB. **2026-09-25:** +1 nullable column `AuditTrail.signatureAuditId` (+index; migration `20260925090000_audit_signature_link`) and the partial unique index `asset_instances_active_name_key` (migration `20260925091000_active_name_unique`, not expressible in `schema.prisma`). Both additive; drift guard PASS. Models/enums unchanged (61 / 24).
- **Permissions:** **106** constants, **87** feature privileges, **127** reauth actions, **27** sidebar items. **2026-10-01 — list-page View toggles (104→106 / 85→87):** `retirement.view` ("View Retirement List", `RETIREMENT_LIST_VIEW`) and `replacement.view` ("View Replacement List", `REPLACEMENT_LIST_VIEW`) are configurable; both nodes existed as enforced-only and rode on `assets.view`, so the Permissions tab offered Export for each page but no View. Each grants its ONE permission and nothing else — `isSidebarItemVisible` ORs over the GRANT set, so a read dependency (`ASSET_READ`) there would show the menu to every role and make the toggle inert. Route guards: `/filter-retirements` = `RETIREMENT_LIST_VIEW`; `/filter-replacements` = `REPLACEMENT_LIST_VIEW` or any `REPLACEMENT_SCHEDULE_*` (without the list permission only the Schedule tab is offered). `GET /api/filters/{retirements,replacements}` accept the new permission OR `ASSET_READ` (kept: lifecycle report, cycle timeline and tablet read the same feeds — so the toggle hides the PAGE, it does not seal the data from an `ASSET_READ` holder). Existing roles keep their pages through the data migration `20261001090000_list_view_permissions` (grants the permission to every role that could see the page: asset read perm AND not excluded by its sidebar allow-list; also writes the two keys into stored `role_configs.permissions`). **2026-09-24 — re-auth coverage sweep (100→127):** every operation now has a row on Config → Action Re-auth and is enforced server-side: +12 `EXPORT_*` (one per report; the gate is `POST /api/audit/report-export-log`, the audit write every download makes first, plus the two server-side `.xlsx` GETs), +6 `STAGE_*` station rows (Wash In … Storage Out; enforced IN ADDITION to `ADVANCE_FILTER_STAGE` / `START_CLEANING_CYCLE` from `targetState` on `/advance`, `/advance-with-checklist`, `/bulk-operate`), +`REQUEST_BLOCK_CHANGE`, `RESUBMIT_FILTER`, `UPLOAD_REPLACEMENT_SCHEDULE`, `SUBMIT_REPORT_REVIEW`, `MANAGE_NOTIFICATION_RULES`, `MANAGE_USER_GROUPS`, `DELETE_NOTIFICATION_LOG`, `MANAGE_DEBUG_TRACES`, `TOGGLE_SUPER_ADMIN_API_ACCESS` (was enforced-always but absent from the catalog). Every dynamic config def now carries `requiresReauth: true` + `reauthAction` (`UPDATE_CONFIG_PAGE` umbrella; session/datetime/login-security their own rows — `UPDATE_SESSION_CONFIG`/`UPDATE_DATETIME_CONFIG` had been inert because the derived key never matched). `useReauth().execute` accepts `string | string[]`. See `tasks/REAUTH-COVERAGE-PLAN.md`. 🔴 A web page that calls a gated endpoint MUST go through `reauth.execute`/`executeWithResult` and render `<ReauthPrompt reauth={reauth} />` — eleven pages (user-id, roles tabs, role-assignments, report-labels, …) called gated endpoints with no prompt, so an enabled row was a bare 401. **2026-09-04 — filter creation workflow:** +2 perms (`FILTER_REVIEW`, `FILTER_APPROVE`; 102->104), +2 feature privileges (`filters.review`, `filters.approve`; 83->85), +3 reauth actions (`REVIEW_FILTER`, `APPROVE_FILTER`, `REJECT_FILTER`; 97->100), +4 audit templates (`FILTER_{REVIEWED,APPROVED,REJECTED,RESUBMITTED}`). These implement rows 13/14 of the operator's `Role privileges.docx`, which had no counterpart in the app before; granted to MANAGER (review) and QA (approve). Inert until the workflow is enabled. **2026-08-27 - recurring-PM revert:** the 2026-08-26 `PM_TASK_SKIP` perm, `SKIP_PM_TASK` reauth action and `pm.skip_task` tree node were removed with the feature (103->102 / 94->93 / 84->83). `UPDATE_AUDIT_RECORD` (2026-08-27) keeps reauth at 93. **2026-09-03: reauth 93 -> 97** —
`UPDATE_TABLET_ACCESS`, `UPDATE_AUDIT_TEMPLATES`, `UPDATE_REPORT_SIGNATORIES`,
`UPDATE_FIELD_ID`, for four config writes that took no signature at all. All four
use `enforceReauthAlways`, so their row on the Action Re-auth page is
informational, like the existing always-on actions. **2026-07-13 — Home sidebar item:** `home` (Module Guide) added to `SIDEBAR_ITEMS` (26→27) and its force-show in `sidebar.tsx` removed, so it is now a normal Roles-&-Access-managed sidebar item (toggleable per role/user on Config → Roles & Access → Sidebar; visible-to-all by permission since it has no `PERMISSION_TREE` group; SUPER_ADMIN bypasses). Existing role_configs backfilled with `home`. NOT added to the Permissions/Feature-Privileges tab (grants no capability). **2026-07-04 — reports generate/sign removal:** dropped 7 perms (`REPORT_TEMPLATE_{READ,CREATE,UPDATE,DELETE}`, `REPORT_VIEW`, `REPORT_SIGN`, `REPORT_DELETE`; 109→102), 7 reauth actions (`{CREATE,UPDATE,DELETE}_REPORT_TEMPLATE`, `GENERATE_REPORT`, `SIGN_REPORT`, `REJECT_REPORT`, `DELETE_REPORT`; 99→92), 9 feature-privilege tree nodes (90→83). The ACTIVE cleaning-record + lifecycle PDF export were re-gated by making `cleaning_record.export`/`lifecycle.export` configurable (kept `REPORT_EXPORT` + `REPORT_GENERATE` perms). `REPORT_REVIEW_SUBMIT/REVIEW/APPROVE` perms + `REVIEW_REPORT`/`APPROVE_REPORT` reauth actions SURVIVE (ad-hoc report-review workflow). **2026-07-02 — RFID picker re-added (regression fix):** `filters.rfid_manage` ("Assign / Unassign RFID Tags") made **configurable again** (89→90 FP), reversing the 2026-07-01 enforced-only removal. With the toggle gone, only SUPER_ADMIN (+ OPERATOR via a leftover `ASSET_IDENTIFIER_CREATE` grant) could assign RFID — every other role got a 403 on the tablet RFID-assign page with no UI way to grant it. Enabling the toggle grants `[FILTER_RFID_MANAGE, ASSET_IDENTIFIER_CREATE, ASSET_IDENTIFIER_DELETE, ASSET_READ]` (satisfies the `POST/DELETE /api/assets/identifiers` `requireAnyPermission` gate). Re-added to `CONFIGURABLE_PRIVILEGE_ORDER` + frozen snapshot (both count tests 89→90). **2026-07-01 — Audit hard-delete (compliance-affecting; operator-requested):** re-added the physical audit-record DELETE that was torn out in 2026-05 for 21 CFR §11.10(e). New `AUDIT_DELETE` perm (+1 constant), `audit.delete` picker toggle ("Delete Audit Record (permanent)", gate `['AUDIT_DELETE']`, grant-set `[AUDIT_DELETE, AUDIT_READ]`, FP 88→89), 2 reauth actions `DELETE_AUDIT_RECORD`/`BULK_DELETE_AUDIT_RECORDS` (100→102; **2026-07-04 removed 3 dead `*_TEMPLATE_KIND` reauth actions — theater, never enforced by any endpoint; 102→99**). Backend `DELETE /api/audit/:id` + `POST /api/audit/bulk-delete` (audit/routes.ts) require `AUDIT_DELETE` (SUPER_ADMIN bypasses) + reauth + a `reason`; each disables the `audit_trail_no_delete` immutability trigger for its transaction (query pg_trigger → `ALTER TABLE … DISABLE/ENABLE TRIGGER`, ACCESS-EXCLUSIVE lock closes the window), writes a meta-audit row (`AUDIT_RECORD_DELETED`/`AUDIT_RECORDS_BULK_DELETED`) recording who/what/why BEFORE the row is destroyed. **WARNING: physical deletion BREAKS the tamper-evident hash chain** — `GET /api/audit/verify-chain` reports the downstream chain invalid, permanently; verify-chain/`verifyAuditChecksum` were deliberately NOT taught to tolerate deletions (breakage stays loud). REDACT (`POST /:id/redact`, chain-preserving) remains the recommended path. Frontend audit page adds a distinct "Delete Permanently" affordance (`can('audit.delete')`) alongside the existing amber "Redact" (`can('audit.redact')`, SA-only); the shared confirm dialog is now mode-aware. Off by default (no role granted `AUDIT_DELETE`; grant per role via the picker). **2026-07-01 — Notifications picker:** `notifications.manage` ("Manage Notifications") made enforced-only (removed from picker; `NOTIFICATION_MANAGE` is enforced by no route). `notifications.delete` ("Delete Notifications") made a **real grantable perm** — its gate was `[]` (SUPER_ADMIN-only) so enabling the toggle did nothing; now gate `['NOTIFICATION_DELETE']` and the backend delete routes (`bulk-delete`, `DELETE /:id`) use `requirePermission('NOTIFICATION_DELETE')` instead of `requireSuperAdmin()` (reverses the 2026-06-30 M5 SA-only decision; SUPER_ADMIN still bypasses). FP 89→88. **2026-07-01 — Filters picker RFID→Export swap:** `filters.rfid_manage` ("Assign / Unassign RFID Tags") made enforced-only (removed from picker per user request; RFID still gated on `FILTER_RFID_MANAGE`, held only by SUPER_ADMIN so no practical impact). Added `filters.export` (`FILTER_LIST_EXPORT`, +1 constant, enforce:'c') gating the Filters page Export (PDF/Excel) menu (`can('filters.export')` in filter-list.tsx) — off by default (SUPER_ADMIN bypasses; enable per role to unhide), mirrors `retirement_list.export`. Net feature-privileges unchanged (89). **2026-07-01 — ASSET_* over-grant fix (privilege leak):** removed the broad `ASSET_CREATE/UPDATE/DELETE` from the grant-sets of `filters.status_update` / `filters.bulk_upload` / `filters.hierarchy_create` + `equipment_groups.create/edit/delete`. Those broad perms leaked edit/create/delete across the Filters page via `useCan` (granting "Update Filter Status" handed out `ASSET_UPDATE`, which satisfies the `filters.edit` / `filters.hierarchy_edit` gate → every edit control lit up; a real backend escalation too since the edit endpoints accept `ASSET_UPDATE`). `ASSET_*` now grants via **no** picker toggle → it LEFT `allMappedPerms` and is **manual-managed** (edit/create granted via the `FILTER_*` toggles; this reverses the 2026-06-30 "keep ASSET_* in grant-sets" decision). Perm constants KEPT; existing roles' `ASSET_*` preserved on re-save. **2026-07-01 — picker redundancy audit (92→89):** `checklists.toggle` (identical gate to `checklists.edit`), `cleaning_profiles.toggle` (redundant with `cleaning_profiles.edit`), and `checklists.submit` (same `FILTER_OPERATE` gate as `filters.operate`; `CHECKLIST_SUBMIT` never enforced) made **enforced-only** (dropped from picker; perms/nodes kept). Also re-tagged `notifications.view`/`notifications.manage` `enforce:'a'→'c'` — `NOTIFICATION_VIEW/MANAGE` are enforced by **no route** (notification endpoints are user-scoped/auth-only, delete is SUPER_ADMIN-only), so those toggles are visibility-only. **2026-07-01 — RFID/Relationships toggle de-dup:** `assets.identifiers.create`/`assets.identifiers.delete` (RFID assign/unassign) + `assets.relationships.create`/`assets.relationships.delete` made enforced-only (dropped from the picker; 96→92 FPs). RFID is fully covered by the single `filters.rfid_manage` toggle (both identifier endpoints accept `FILTER_RFID_MANAGE` via `requireAnyPermission`; `ASSET_IDENTIFIER_DELETE` added to its grant so the map stays complete). `ASSET_RELATIONSHIP_CREATE/DELETE` were grant-only perms never used as a route gate (real gate = `ASSET_UPDATE/FILTER_EDIT/FILTER_HIERARCHY_EDIT` on PUT-instance) — so their nodes **AND the perm constants were removed entirely** (constants 109→107; also stripped from default-roles + live DB SUPER_ADMIN; relationship writes go through the edit gate / `assets.edit`). RFID `ASSET_IDENTIFIER_*` constants KEPT (real gates). `assets.view` label renamed "View Assets"→"View Filters". Roles unchanged. **2026-06-30 — Filters/Assets toggle de-dup:** `assets.create`/`assets.edit`/`assets.delete` made enforced-only (dropped from the role-config picker; 99→96 FPs). They duplicated the filter-specific Create/Edit/Delete Filters + Block/Area/AHU toggles — same capability under different names (backend create/edit/delete endpoints accept `ASSET_*` OR `FILTER_*`/`FILTER_HIERARCHY_*` via `requireAnyPermission`). The `ASSET_CREATE`/`UPDATE`/`DELETE` **permission constants are KEPT** (still granted in roles + accepted as backend alternates); only the duplicate picker toggles were hidden, so roles are unchanged. See `tasks/ASSET-FILTER-PERM-CONSOLIDATION-PLAN.md`. The 2026-06-11..2026-06-17 tear-out removed 2 perms (`UNS_VIEW`, `UNS_MANAGE`), 2 privileges (`uns.view`, `uns.manage`), 6 reauth actions (`MANAGE_DEVICE_CREDENTIAL`, `OVERRIDE_UNS_PATH`, `DELETE_UNS_MAPPING`, `UPDATE_UNS_CONFIG`, `UPDATE_RETENTION_POLICY`, `EXECUTE_RETENTION`), and 2 reauth categories (`UNS`, `Retention`). Audit-action and audit-template registry entries for old subsystems (UNS, RETENTION, DEVICE_CREDENTIAL, RULE_CHAIN, ALARM) are **retained** per 21 CFR §11 (no longer emitted; inspector contract preserved).
- **Config:** **38 definitions** (`apps/api/src/modules/config/defs/*.def.ts`) + auto-discovery, **34** corresponding pages (`filter-approval.def.ts` added 2026-09-04 — the filter create/upload → review → approve workflow's role assignment; edited on the Role Assignments page, so it adds no `routes/config/*.tsx`; `uns.def` + `retention.def` removed 2026-06-17; `ahu-completion-process.def.ts` added 2026-07-01; `export-limit.def.ts` added 2026-07-14 — configurable max export records + message, renders via the dynamic config page so no new `routes/config/*.tsx`; `backup-format.def.ts` added 2026-08-08 — default backup file format, same dynamic-page pattern)
- **Themes:** 10 preset color themes (Ocean / Sapphire / Emerald / Amethyst / Sunset / Slate / Ruby / Forest / Midnight / Coral)
- **Frontend:** **77 Routes** in `main.tsx`, **29** custom hooks, **45** lib modules (hook/lib counts re-verified by `ls` 2026-09-24 — the prior 39 was stale)
- **Scheduler:** **in-process `node-cron`** in `apps/api/src/app.ts` — **4 jobs**: `session_sweep` (5 min), `password_expiry_check` (00:00), `log_retention` (00:05, added 2026-08-31 — also runs once at boot), `pm_overdue_check` (03:00). (`pm_series_rollover` at 03:30 went with the 2026-08-27 recurring-PM revert.) **No job queue.** `packages/queue` + the `graphile-worker` dependency were DELETED 2026-08-26: `startJobRunner` had no caller after the 2026-07-25 move to node-cron, and the queue's job types all belonged to the Phase-7 ingestion tear-out. These jobs only run while the API process is up — `/api/health` reports `jobRunner`. The ONLY scheduler outside the app is the Windows Scheduled Task the installer registers for DB backups (daily 01:30).
- **Tenancy:** **single-tenant, single-site, single-company.** Multi-tenancy was removed 2026-04-30 (`Organization` model + `organizationId` columns + `org-admin`/`tenant-admin` modules dropped). JWT `scope` always stamps `GLOBAL`. The `RoleScope` enum and `AssigneeType` enum are retained but trimmed to one/two values respectively.

## Important Notes
- 🔴 **Strict audit 2026-09-24** (see CHANGELOG): the offline-replay grant is honoured ONLY on
  `/api/filters/*` (`isOfflineReplayRoute`, `plugins/auth.ts`) — never widen it without a reason;
  `_currentPassword` is stripped INSIDE `enforceReauth`/`enforceReauthAlways` before any early
  return, so handlers must never persist `req.body` expecting the field to be gone by other means;
  only `AppError` messages may be forwarded to clients from catch blocks (Prisma text embeds the
  source path). The grant header still does not PROVE offline-ness, but since 2026-09-25 a
  grant-bearing write must carry `offlinePerformedAt` + `clientOpId` (400
  `OFFLINE_REPLAY_FIELDS_REQUIRED`, `assertOfflineReplayPayload`) and every gate a replay skips is
  recorded on the event + audit row as `replayExemptGates` — the bypass is visible, not silent.
- 🔴 **Strict-audit follow-up 2026-09-25** (see CHANGELOG): `audit_trail.signature_audit_id` links a
  signed row to its `REAUTH_SUCCESS` row via `lib/request-store.ts` (AsyncLocalStorage filled by the
  re-auth gate) — it is inside the checksum ONLY when present; never make it an always-present key
  or every existing row stops verifying. `auditLog()` returns the new row id. Restore (JSON/BAK and
  pg_dump) never destroys live audit rows the backup lacks (`preserveUnbackedAuditRows`).
  `retire()` KEEPS the RFID tag bound (2026-07-15 invariant test); a tag held by a retired /
  deactivated filter is released, audited, when it is assigned again (`identifier.service.create`).
  A FILTER may only sit under an ACTIVE AHU (create/update), and unretire refuses a deactivated
  parent (409 `PARENT_INACTIVE`). Bulk cycle-bound items
  need `tapeVersion`. Offline replay applies the tablet's missed-PM write-offs (it never did).
  Partial unique index `asset_instances_active_name_key` (`lower(name) WHERE is_active`) is
  migration-only — `schema.prisma` cannot express it; the drift guard covers it.
- Only one database now: `digilog_db` (Prisma). TimescaleDB (`digilog_tsdb`) was dropped 2026-06-11 with the data-ingestion tear-out.
- Input sanitization strips HTML on all text fields (`apps/api/src/lib/sanitize.ts`)
- **Outbound calls to admin-typed URLs must use `apps/api/src/lib/ssrf.ts`** (
  `hardenedFetch` / `checkOutboundUrl`) — scheme allowlist, DNS-resolved destination
  check blocking loopback/link-local/metadata, no redirect-follow, hard timeout.
  Private LAN is allowed on purpose (instruments + on-prem SMS gateways). Never
  add a bare `fetch()` on a configurable URL. (SAST-01, 2026-08-18.)
- **Rate limiters must use `rateLimitKeyGenerator`** (`apps/api/src/lib/rate-limit-key.ts`).
  Keying on `req.ip` alone lets an IPv6 attacker rotate the host portion of their
  /64 for an unlimited budget. (DEP-5, 2026-08-18.)
- 🔴 **Only THREE rate limits exist (2026-10-10, operator decision):** `POST /api/auth/login`
  (100/min), `/verify` (50/min), `/change-password` (50/min). No app-wide limit
  (`global: false` in `app.ts`); every other route/public endpoint is unlimited. They are the
  only brake on guessing the SUPER_ADMIN password (SA is exempt from lockout) — don't remove
  them without asking. Locked by `lib/__tests__/rate-limit-policy.test.ts`.
- Capacitor APK uses **HTTPS** baked at build via `VITE_API_URL` (cert install required on tablet)
- Light theme only — `bg-white`, `bg-slate-50`, `border-slate-200`, gradient dialog headers OK
- **Design system = `apps/web/src/app.css`** (UI redesign 2026-10-01): IBM Plex Sans/Mono
  self-hosted, `brand-*` / `accent-*` scales derived from the selected theme (`cyan-*` /
  `teal-*` are remapped onto them), tight radii, low shadows, sentence-case labels. Use
  `brand-*` for anything brand-coloured; status colours stay semantic. Rules + the list of
  what must NOT be recoloured: `apps/web/CLAUDE.md` § "Theme / design system".
- **Sidebar RBAC redesign (2026-06-30, branch RFID):** `packages/shared/src/types/permission-tree.ts`
  (`PERMISSION_TREE`) is the **single source of truth** — a Sidebar→Page→Action catalog. Each node
  carries `permissions` (grant-expansion set = the role-config toggle), `gate` (the *discriminating*
  backend permission `useCan()` checks — `[]` = SUPER_ADMIN-only), `reauthAction`, `enforce` (a/b/c),
  `configurable` (is it a role-toggle), and per-group `visibilityPrivilegeIds`. `FEATURE_PRIVILEGES`,
  `FEATURE_PRIVILEGE_CATEGORIES`, `FEATURE_TO_PERMISSION_MAP`, and `SIDEBAR_PRIVILEGE_MAP` are now
  **derived** from the tree (hand-maintained originals retired; frozen-snapshot test locks zero drift).
- SUPER_ADMIN bypasses frontend permission checks. **Button gating uses the `useCan('<node-id>')` hook**
  (`apps/web/src/hooks/use-can.ts`, ~19 pages) which gates on the node's `gate`; sidebar visibility uses
  `isSidebarItemVisible()` over the tree. The older inline `isSuperAdmin || perms.includes(...)` pattern
  remains only for non-button logic (PM workflow-role checks, data-layer queries). Grant set ≠ gate:
  never OR over `permissions`/`resolveNodePermissions` as an auth check (it includes read deps).
- Feature toggles need BOTH frontend visibility perm AND backend route perm — encoded in each tree node;
  `FEATURE_TO_PERMISSION_MAP` (derived) still drives the backend role→permissions expansion (`config.service.ts`).
- 🔴 **A node's grant set must never contain another node's GATE.** That is how a
  read/adjacent toggle silently hands out a write capability. Three found so far:
  `ASSET_*` (2026-07-01), and on **2026-09-04** `replacement_schedule.view` →
  `REPLACEMENT_SCHEDULE_UPLOAD` (viewing granted uploading) and `filters.retire` →
  `FILTER_OPERATE` (retiring granted the whole cleaning operation, though
  `/filters/:id/retire` gates on `FILTER_RETIRE` alone). Still open, benign today
  because its only holder has the perm anyway: `filters.replace` → `FILTER_OPERATE`.
- **Only the 87 ids in `FEATURE_TO_PERMISSION_MAP` grant anything**; the other 43
  `PERMISSION_TREE` nodes are enforced-only and their toggles are inert. `PM_EXECUTE`
  comes only from `pm.execute` — `my_tasks.perform` grants nothing.
- **`updateRoleConfig` cannot revoke an unmapped permission**: it keeps
  `currentPerms.filter(p => !allMappedPerms.has(p))`, so `ASSET_*`, `ENTITY_ASSIGN`
  and dead constants survive every save. Clear those with `PUT /api/roles/:name`.
- **Live role↔permission matrix** (applied from the operator's `Role privileges.docx`,
  2026-09-04): [`tasks/ROLE-PRIVILEGES-DOC-ALIGNMENT.md`](tasks/ROLE-PRIVILEGES-DOC-ALIGNMENT.md)
  + `tasks/role-privileges-baseline/` (target matrix, before/after, per-role delta).
  Change a role's access there, not ad hoc.
- RBAC redesign analysis + phase plans: `tasks/RBAC-SIDEBAR-REDESIGN-ANALYSIS.md`, `docs/superpowers/plans/2026-06-30-rbac-sidebar-phase-{1..5}.md`. Phases 1–3 + 5 done; Phase 4 (per-page View) optional/not executed.
- New config defs must be imported in `config-discovery.ts` AND registered as a card in `config/index.tsx`
- Approval/decision flows require remarks; filter cleaning stage remarks stay optional
- Cycle `profile_id` is locked at start — reassigning a block's profile does NOT migrate in-progress cycles
- **Tablet Stage Approvals IS the web page (2026-10-01).** `/m` renders `StageApprovalsPage`
  (`routes/stage-approvals/index.tsx`); the separate tablet copy in `mobile-wrapper.tsx` was deleted
  after it drifted (no select-all / bulk approve). The wrapper keeps only the offline notice and passes
  `overlayBackRef` so Android back closes the page's dialog. Never grow a second copy — guarded by
  `routes/mobile/__tests__/stage-approvals-single-implementation.test.ts`.
- 🔴 **`reauth.execute` does not re-throw.** A callback failure reaches ONLY `onError`; with no handler
  the server's refusal vanishes, and it returns before the callback runs when a password prompt is
  needed — so state cleared "after" it is cleared on failure too. That is how a refused cycle START on
  the tablet became a permanent "No active cleaning cycle" (2026-10-01: start-cycle 409 hidden, start
  payload cleared, every further Submit sent a bare `/advance`). In `mobile-operations.tsx` a
  single-filter start goes through `startWithPmGate` (missed-PM question, offline + online), a batch
  start through `retryBulkStartsForMissedPm`, and the start payload is cleared only on success.
  "No active cleaning cycle" in the field usually means an EARLIER start was refused — look for the
  409 just before it in `logs/app/http` (the line now names the refusal code). The same holds offline:
  `sync-engine.ts` marks a filter when a queued start is refused — including the START half of a compound
  `start-and-advance` op (`markStartRefused`) — and skips its later queued steps instead of sending them.
  A start parked behind a first-stage checklist asks the missed-PM question on checklist submit
  (`SubmitChecklistArgs.extraCycleFields`).
- 🔴 **A cycle may only ENTER Dry In with the dryer running (2026-10-06).** `advance` into
  `DRY_IN` needs `dryerAction: 'SET_DURATION'` unless `dryerStartedAt` is already set (guard #28,
  400 `DRYER_DURATION_REQUIRED`), and leaving `DRY_IN` with the dryer never started is refused with
  the same code — both on online writes, bulk-operate and offline replay. The executor offers
  `SET_DRYER_DURATION` IN PLACE (target = current stage) for a cycle sitting at Dry In without a
  dryer, so such a cycle recovers by scanning Dry In again. The live "DRY STORAGE" profile begins
  with Dry In, which is how a cycle entered the stage with no duration and completed with no dryer
  time. Every START payload for a Dry In first stage carries the queue-header duration
  (`dryerFieldsForStart` on both pages); a QUEUED `SET_DURATION` writes the dryer timing onto the
  cache row BEFORE the tape recompute (`rememberQueuedDryerStart`, `use-core.ts`) or the next
  offline Dry Out scan is refused as a wrong stage.
- **Field labels: `GET /api/config/field-ids/current`** (any signed-in user, `{fieldId, displayName}` only).
  Same pattern (2026-10-06): `GET /api/config/cleaning-profile-assignment/current` — the tablet's
  offline block→profile map; the CONFIG_READ list 403'd for every operator. **Every RFID scan path
  normalises through `apps/web/src/lib/rfid-scan.ts`** (upper-case + doubled/tripled EPC collapse).
  `useFieldLabels` and the tablet read this; the bare `/field-ids` list needs `CONFIG_READ` and 403'd for
  every operator on every page from 2026-05-26 until 2026-10-01.

## Phase Snapshots (history is in `CHANGELOG.md`)

### Phase 2 — Digital Filter Management
Cleaning profiles, filter operations (cycle start/advance/bypass/checklist), PM scheduling, equipment groups, checklist profiles, filter traceability.

### Phase 3 — RFID & Offline
RFID Scanner Android app (Reader_Usb.jar SDK), web RFID keyboard guard, offline IndexedDB queue + sync engine, cached identifier→filter map, "Data Synced" indicator, responsive collapsible sidebar.

### Phase 4 — Permissions, Themes, Reports
18 granular feature toggles introduced (Filters / Checklists / Cleaning Profiles / Equipment / PM) — total privileges grew to 91 over Phases 4 + 5 (later trimmed to 89 in MT removal 2026-04-30, then 90 after VERSION_HISTORY 2026-05-02); 10 color themes; configurable report header/footer/layout; dynamic bulk upload from template attributeSchema; reauth actions grew to 81 across 16 categories.

### Phase 6 — Subsystem Reduction (2026-05-17)
**Rule chain + alarm tear-out.** Deleted both subsystems wholesale: 5 Prisma models, 22 source files (`apps/api/src/modules/rule-chain/`), 12 web files (`apps/web/src/routes/{rule-chains,alarms}/`, `config/alarm-columns.tsx`), 7 perms / 7 privileges / 5 reauth actions / 2 sidebar items, 6 role permission arrays + 11 alarm field-IDs + 5 `rule_engine.*` configs + 7 help articles from seed, and stale runtime rows from `roles` / `role_configs` / `system_config`. Telemetry ingest pipeline lost Stages 7 + 8 (rule-chain execution + alarm dispatch); the cleaning-cycle pipeline is unrelated and survives. **Retained**: `audit-actions.ts` + `audit-templates.ts` entries for both subsystems (21 CFR §11 inspector contracts — no longer emitted, still rendered for historic rows). Hash chain unaffected; only 4 historic `audit_trail` JSON-detail UUIDs become orphans (accepted per user "hard delete" decision). Plan + execution: `tasks/REMOVE-RULECHAIN-ALARM-PLAN.md`. Pre-removal git tag: `pre-rulechain-alarm-drop`.

### Phase 7 — Data-Ingestion + TimescaleDB Removal (2026-06-11..2026-06-17)
**Complete tear-out of the dormant ingestion layer.** Pre-removal verification confirmed 5 of 6 hypertables were always empty and only 234 debug-trace rows in `ts_pipeline_traces` — the whole subsystem was carrying weight without serving traffic. Removed in 10 phases:
- **Phase 1** — 2 frontend route files (`config/uns.tsx`, `config/retention.tsx`) + their config cards + Route entries
- **Phase 2** — 55 backend files: `modules/{data-ingestion,uns,connectivity,queries}/`, `transport/`, `workers/ingestion.worker.ts`, `workers/maintenance-retention.ts`
- **Phase 3** — Wire-up cleanup: deleted `lib/operation-tracer.ts` + `workers/maintenance.worker.ts` + 6 other touchpoints (app.ts hooks, instance.service auto-provision block, deployment-check TSDB/MQTT checks, audit.ts dynamic import)
- **Phase 4** — Dropped 6 Prisma models (`DeviceCredential`, `UnsMapping`, `ConnectivityStatus`, `DataStream`, `DeadLetterQueue`, `IngestionSystemConfig`) — 33 rows of dead `ingestion_system_config` data dropped via `prisma db push --accept-data-loss`
- **Phase 5** — `DROP DATABASE digilog_tsdb` — all 6 hypertables gone
- **Phase 6** — Deleted `packages/db/` workspace; uninstalled `@digilog/db`, `mqtt`, `aedes`, `@types/pg` from `apps/api/package.json`; migrated `/api/health` to local `lib/prisma.js`; stubbed `dashboards/routes.ts` timeseries_chart widget + `reports/data-sources/telemetry-source.ts`; `npm install` removed **47 transitive packages**
- **Phase 7** — Cleaned `apps/api/.env` (TSDB_*, MQTT_*, EMQX_*, UNS_ROOT_PREFIX gone); deleted dead `lib/uns-path.ts`; uninstalled Mosquitto Windows service
- **Phase 8** — Fixed `e2e/test-helper.ts` (was importing 2 deleted route modules → broken until fixed); fixed `instance.service.test.ts` Prisma-client mock; deleted 2 orphan test files (`workers/__tests__/ingestion.worker.test.ts`, `e2e/connectivity.test.ts`)
- **Phase 9** — Deleted 2 dead config defs (`uns.def.ts`, `retention.def.ts`); removed 2 perms / 2 privileges / 6 reauth actions / 2 reauth categories from `packages/shared`; stripped DB rows in `roles.permissions` (1 row updated) + `system_config['action-reauth']` (5 stale keys removed)
- **Phase 10** — Doc sync (this update)

**Section 14 (Debug Traces repurpose)** — landed 2026-06-12 as commit `8619d24`: `/api/debug/traces` repointed onto `audit_trail` so the existing Debug Traces UI keeps working (each audited action → single-stage SUCCESS PipelineTrace). 9.8k records render. Limits: only successes (no error codes / durations).

**What survived**: cleaning-cycle pipeline, PM workflows, audit trail (hash chain unaffected), reports, dashboards (timeseries_chart returns `[]` cleanly), offline sync, RFID, all 35 active modules. Reports module's `{{ts.<slot>.<key>}}` template tags return `{value: null, error: "Telemetry data source has been removed."}` instead of crashing.

**Retained per 21 CFR §11**: `audit-actions.ts` registry entries for `UNS_*`, `RETENTION_*`, `DEVICE_CREDENTIAL_REGENERATED` — historic audit rows still render correctly in inspector UI even though new code never emits these.

Pre-removal git tag: `pre-ingestion-removal` (commit `ed88400`). Phases 1-6 landed as commit `a95f6eb` on `RFID` (82 files, -16736 LoC). Runbook: `~/Downloads/DigiLog-Data-Ingestion-Removal-Plan.docx`.

### Phase 5 — Reports, Offline Hardening, RFID SDK, Filter Data Console (Apr 15–29, 2026)
Reports module A–F complete (visual template designer + puppeteer-core/Edge / @napi-rs/canvas / Handlebars PDF engine + digital signatures — Phase 3 of windows-friendly-rewrite swapped from `puppeteer` + `chartjs-node-canvas` to eliminate the bundled Chromium download and the node-gyp/MSVC dependency), offline overhaul (TTL cache, idempotency keys, tombstones, LRU, JWT refresh, server-side `stageLookup`, Capacitor Network plugin + SW hook), RFID SDK plugin in DigiLog APK (`Reader_Usb.jar` via `RfidPlugin.java`), Filter Data Management console mirroring 10 user-facing pages, DRY_IN two-step flow with persisted countdown panel, dynamic backup/restore covering all 64 tables, bloat audit 12/14 resolved, EC2/PM2 production assets removed (local-Windows-only), decision-tape proposal for future client/server pipeline drift elimination. Full architectural detail in `PHASE_5_RECENT_WORK.md`.

**Phase 5 verification harness** (Apr 29–30, 2026) — closed the verification gap left by Phases 1–4:
- **5.1** — `tests/integration/windows-server-stack.test.ts` originally exercised aedes MQTT broker + 100 telemetry publishes → `ts_telemetry` → graphile-worker → puppeteer-core PDF render. **2026-07-15 (M39-batch audit, finding M05): the dead halves were REMOVED, not just noted stale.** The top-level `aedes`/`mqtt` imports failed module resolution — which `describe.skipIf` cannot prevent — so **every root-level `npx vitest run` died at collection**, gate or no gate. Dropped: the MQTT→`ts_telemetry` test (aedes/mqtt uninstalled; `transport/`, `workers/ingestion.worker.ts`, `packages/db/` deleted; `digilog_tsdb` dropped; the `Organization`/`UnsMapping`/`ConnectivityStatus`/`DeviceCredential` models its fixture needed are all gone). The PDF-render test was already removed 2026-07-04 with the reports generate/sign tear-out — so the pre-2026-07-15 claim here that "PDF assertions still valid" was itself stale. **KEPT**: the API-boot/`/api/health` check. (The graphile-worker `addJob` → dispatch check was removed 2026-08-26 with the queue package — it exercised a subsystem nothing started.) The file + its `vitest.workspace.ts` entry survive; ungated it now registers 2 skipped tests and exits 0.
- **5.2** — `scripts/verify-windows-deployment.ps1`: operator-facing smoke check (health endpoint, graphile-worker schema via psql, real PDF render via login → reports/generate). **Mosquitto :1883 check stale post-Phase-7** (service uninstalled); the `graphile_worker` schema check was removed 2026-08-26 with the queue package, leaving a single `/api/health` check. PS 5.1 + 7+ compatible.

## Key API Endpoints (filter operations)
```
POST /api/filters/:id/start-cycle       — Start cleaning cycle
POST /api/filters/:id/advance           — Advance to next stage
POST /api/filters/:id/submit-checklist  — Submit checklist answers
POST /api/filters/:id/bypass            — Bypass stage (deviation)
POST /api/filters/:id/terminate         — Terminate cycle (with reason)
POST /api/filters/bulk-operate          — Batch advance / start-and-advance / submit-checklist in ONE request (partial success; per-item tx + audit; reauth once). Tablet 50–100 tag submit.
GET  /api/filters/:id/current-state     — Filter state + next actions (full server snapshot)
GET  /api/filters/cycles                — List cleaning cycles (mounted by filter-operations/events-routes.ts under the /api/filters prefix)
GET  /api/filters/events                — List filter events
GET  /api/filter-cleaning-profiles                       — List cleaning profiles (latest version per lineage)
GET  /api/filter-cleaning-profiles/:id/versions          — Phase A.2: list lineage version history
GET  /api/filter-cleaning-profiles/:id/versions/:n       — Phase A.2: frozen snapshot at version n
GET  /api/filter-profiles/:id/versions                   — Phase A.3: list archived FilterProfile versions
GET  /api/filter-profiles/:id/versions/:n                — Phase A.3: frozen FilterProfile snapshot at version n
GET  /api/equipment-groups/:id/versions                  — Phase A.4: list archived EquipmentGroup versions (group + 3 instruments composite)
GET  /api/equipment-groups/:id/versions/:n               — Phase A.4: frozen EquipmentGroup composite snapshot at version n
GET  /api/checklist-profiles?expand=questions — Used for offline cache
GET  /api/config/report-settings/current — Report layout config
GET  /api/config/password-policy/current — Password policy (public endpoint)
```

## Pipeline Flow
- CHECKLIST nodes between STAGE nodes trigger automatic question dialogs
- Server-side enforcement: `advance()` blocks if pending checklist not completed
- Cycle auto-completes when last STAGE leads to END node
- Stage chain may include multiple consecutive CHECKLIST nodes — server uses `stageLookup` to resolve
## Filter Data Management - audit-trail retrofit (2026-08-27)

Config -> Filter Data Management is no longer a silent-edit console. Every
create / edit / delete across all 9 tabs writes an audit row.

- **Mandatory reason.** Body key is **`_changeReason`** (min 5 chars), NOT
  `reason` - `reason` is a real column on `BlockChangeRequest` and a shared key
  would overwrite the record's own field. Enforced twice: JSON-schema `required`
  plus a runtime `readChangeReason()` (so routes whose schema predates the
  retrofit still refuse).
- **3 generic actions, not one per table**: `MANUAL_RECORD_CREATED` /
  `_UPDATED` / `_DELETED`. The `{recordType}` placeholder resolves from
  `targetType` (`audit-helpers.ts`), so one template still renders
  "Cleaning Cycle record manually edited by ...". `+ AUDIT_RECORD_UPDATED`
  (audit actions 91 -> 95, reauth 93 -> 94 via `UPDATE_AUDIT_RECORD`).
  **2026-09-03: audit actions 95 -> 97** — `REAUTH_SUCCESS` / `REAUTH_FAILED`.
  **2026-09-24: audit actions 97 -> 98** — `PASSWORD_RESET_REQUESTED` (forgot-password had no row).
  A re-authentication is the §11 electronic signature and used to write NO audit
  row at all; see the CHANGELOG entry of that date.
  **No new permission constants** - the whole console is
  `requireRole('SUPER_ADMIN')`.
- **Deletes audit BEFORE the row dies**, in the same transaction: `beforeValue`
  needs the record while it exists, and a rolled-back delete must not leave an
  audit row claiming it happened. Cascading deletes (cleaning cycle -> its
  filter events + `FilterDetails` pointers; unretire -> the replacement filter)
  record the blast radius in `afterValue._sideEffects`.
- **`auditLog()` accepts an optional `timestamp`** for back-dated manual
  records. Chain-safe: the same value feeds the row AND the checksum, and the
  chain is ordered by `chain_position`, not time.

**Records that ARE audit rows.** A *replacement* record is an `audit_trail` row
(`FILTER_REPLACED`); `getReplacements()` reads straight from it. A *retirement*
record is the filter's own `AssetInstance` (status `Retired`) joined to its
`FILTER_RETIRED` audit row for remarks/performer/date.

- **Editing or deleting a replacement breaks the hash chain** from that row
  onward. `audit_trail` has only a no-DELETE trigger, never a no-UPDATE one, so
  the pre-existing `PUT /filter-data/replacements/:id` had been doing this
  **silently since it was written**. It now writes an `AUDIT_RECORD_UPDATED`
  meta-row first and returns `chainBroken: true`. Checksums are deliberately NOT
  recomputed - repairing one row means recomputing every downstream row, which
  is the exact rewrite the chain exists to prevent.
- **Creating** a replacement/retirement record ADDS to the chain (written
  through `auditLog()`, correctly linked) - only edit/delete break it.
- Retirement DELETE removes the `AssetInstance` and **refuses with 409
  `HAS_HISTORY`** when the filter still has cleaning cycles, filter events,
  identifiers or children, naming each. No cascade: one click must not erase
  cleaning history. The `FILTER_RETIRED` audit row always survives.
- Retirement CREATE retires an EXISTING live filter (mirrors
  `filter-operations.service.ts` `retire()` exactly - cycle termination,
  `_preRetireParentId` stash, relationship teardown - so Restore can undo it).
  It does not invent a filter.
- The **Audit Trail tab** now offers Edit / Redact / Delete. Edit is
  `PUT /api/audit/:id` (SUPER_ADMIN + `UPDATE_AUDIT_RECORD` reauth + reason);
  delete and redact reuse the 2026-07-01 `/api/audit/:id` endpoints. `checksum`,
  `previousChecksum`, `chainPosition` and `checksumVersion` are NOT editable -
  editable, they would let an operator forge a link and hide the break. Rows
  whose action is `AUDIT_RECORD_UPDATED` / `_DELETED` refuse editing (409
  `META_AUDIT_IMMUTABLE`): the record of a previous audit change must not itself
  be rewritable. Redact stays the recommended path - it preserves the chain.

**Visibility: these audit rows are SUPER_ADMIN-only** (`lib/audit-visibility.ts`,
one definition shared by `/api/audit` list + detail + hard-delete and by
`/api/debug/traces`). Two rules, both applied to non-SUPER_ADMIN readers:
1. **Actor** (pre-existing) - no rows authored by a SUPER_ADMIN.
2. **Action** (2026-08-27) - no `MANUAL_RECORD_*` / `AUDIT_RECORD_*` rows,
   whoever wrote them.

Rule 2 exists because rule 1 alone is incidental - it protects these rows only
while a SUPER_ADMIN is the one performing them. `FILTER_RETIRED` /
`FILTER_REPLACED` are deliberately NOT restricted: they drive the Retirement and
Replacement lists operators are meant to read. The `MANUAL_RECORD_CREATED`
marker written beside a manual entry carries the "a human keyed this in" fact,
and that marker IS restricted. **Visibility, not existence** - the rows are
always written, hash-chained and backed up.

🔴 **`/api/debug/traces` had NO row scoping at all** until this change, and
`toTrace()` returns the whole row (before/after, reason, actor, role, IP). Only
SUPER_ADMIN holds `READ_DEBUG_TRACE` today, but it is grantable - the leak was
one role-config toggle away. Verified: with the permission granted to ADMIN, the
endpoint returned 10413 of 18307 rows and zero restricted actions.

**The page itself is SUPER_ADMIN-only too.** All its endpoints are
`requireRole('SUPER_ADMIN')`, so 2026-08-27 also removed the three places that
implied otherwise: `EXPLICIT_GRANT_KEYS` (now empty), the `/config/filter-data-management`
route (was gated on `CONFIG_READ`/`CONFIG_UPDATE`, now `RequireRole roles={[]}`
= SUPER_ADMIN only), and its row in the Configuration Access grant matrix
(`EXTRA_MODULES`, now empty). No role had been granted it, so nothing was taken
away - the affordance had never worked.

**Offline-replay grants are no longer audited (2026-08-27, operator decision).**
`POST /api/auth/offline-grant` used to write a `GRANT_OFFLINE_REPLAY` row per
issuance. Every tablet offline window mints a grant, so it became the
highest-volume action in the trail (1,585 rows across all 8 roles) and buried
what an inspector actually reads. **What that costs:** the row was the only
record of WHO could replay offline work, from which session and IP. The grant
itself is unchanged - still password-gated (hard-coded, not configurable) and
still bound to user + session; only the record is gone. The 1,585 historic rows
are untouched, still render, and are SUPER_ADMIN-only. `GRANT_OFFLINE_REPLAY`
stays in `AUDIT_TEMPLATE_DEFAULTS` per the never-delete policy (it was never in
`AUDIT_ACTIONS` - the endpoint emitted the string directly).

**Scope of the retrofit:** audit coverage + the missing CRUD. It does NOT change
what each handler writes downstream - e.g. editing a cycle's `status` still does
not reconcile `FilterDetails.currentLifecycleState`.

Plan + decision log: [`tasks/FILTER-DATA-MGMT-AUDIT-RETROFIT.md`](tasks/FILTER-DATA-MGMT-AUDIT-RETROFIT.md).

## Date ranges + list filters (2026-08-27)

**`apps/web/src/components/ui/date-range-filter.tsx` is the one From/To control.**
11 ranges across 10 files were hand-rolled and none clamped To >= From; the API
accepts an inverted range and returns empty, so it read as "no records".

- `max` on From / `min` on To greys out invalid days in the picker; a JS re-check
  on every change is the actual guard (a browser still lets you TYPE an
  out-of-range value).
- **The component NEVER calls the sibling's `onChange`** — invalid edits are
  rejected, not auto-corrected. Call sites do more than set state (`setPage(1)`,
  `setSelected(new Set())`), so firing both callbacks would run one site's reset
  and not the other's, and change two SWR keys in one tick.
- Comparison is `>` / `<`, never `>=`: same-day ranges are legitimate.
- The Audit Trail filter keeps its own markup and imports `checkRangeEdge`, so
  the rule lives in one place. Rule locked by
  `components/ui/__tests__/date-range-filter.test.ts`.
- The tablet task range carries `disabled={!online}` — forward it.

**Filter Data Management tabs paginate for real.** Every tab was pinned to
`?page=1&limit=50` (50 of 18,329 audit rows) and the header record count was
hard-wired to a `genericTabs` array that has been empty for months, so 7 of 9
tabs displayed `0 records`. Each tab now pages and offers its page's filters.
Filtering is **server-side wherever the endpoint supports it** — filtering a
server-paginated list in the browser filters only the rows that came back. The
four `/api/super-admin/data/*` lists gained `from`/`to` + a status/type param
(`listWhere` / `listQuery` in `super-admin/routes.ts`); retirements, replacements
and admin-requests return whole arrays and are paged client-side. A bare `to`
date covers the **whole day**, on both sides. When adding a tab filter, check the
endpoint really supports the param — a dropdown that silently does nothing is
worse than no dropdown.

**Backend guard:** `lib/date-range-guard.ts` is a global Fastify `preHandler`
registered in `app.ts` BEFORE the route plugins (a hook only covers routes
registered after it). It 400s `INVALID_DATE_RANGE` on any inverted range in
`from`/`to`, `startDate`/`endDate` or `dateFrom`/`dateTo`. It ignores values that
don't parse as dates — it matches on parameter NAME, so it must never become a
new way for a non-date `from`/`to` to break — and expands a bare end date to
end-of-day so single-day filters pass. **Three places implement that same
end-of-day rule** (this guard, `listWhere` in super-admin/routes.ts, and
`asInstant`/`inDateRange` in the console); change one and change all three.
Note `/api/filters/{cycles,events}` require `format: date-time`, so a bare
`yyyy-mm-dd` is rejected by schema validation before the guard ever runs — the
console widens bare dates to instants for that reason.

## PM schedules: many irregular visits per AHU (2026-08-27)

A year is uploaded in ONE file. The same AHU appears in it many times with
**irregular** gaps — some near a month, some longer, some shorter. Dates are
supplied explicitly; nothing is generated. (This is NOT the 2026-08-26
`frequency_days` feature, which generated dates from a fixed 30-day multiple and
was reverted the next day.)

**The rule — two visits must never be satisfiable by one cleaning.** Windows are
symmetric (`plannedDate ± toleranceDays`), so for consecutive visits sorted by
date it is a violation when **`next.windowStart <= prev.windowEnd`**.

Deliberately stricter than "next date after previous date + tolerance": the next
visit's BACKWARD tolerance reaches into the past, so dates that look far apart
still overlap. 10 Mar ±15 and 5 Apr ±20 are 26 days apart and overlap 16–25 Mar.
The live data had three such pairs on AHU-0A at gaps of 31–32 days — the DATES
looked fine, the TOLERANCES overlapped. A gap-only check passes all three.

- Rule lives once, pure, in `pm-schedules/pm-separation.ts`; `pm-separation-guard.ts`
  is the thin DB layer that throws **409 `PM_VISIT_OVERLAP`**.
- **Four write paths, all guarded** — create, replace (`pm-schedule-crud.ts`),
  re-submit a rejected entry, and edit an approved entry (`pm-approval.ts`).
  The fourth needs the check **twice**: `editApprovedEntry` only STAGES
  `pendingPlannedDate`, and it goes live later at QA approval, by which time
  another entry may have moved. Validating only at request time lets two
  individually-fine approvals combine into an overlap.
- **The upload APPENDS; it never replaces (2026-08-27).** It used to hard-delete
  every entry for the (AHU, year) and recreate them, with two guards refusing the
  wipe when it would destroy execution evidence or APPROVED entries. Those guards
  made a whole-year re-upload impossible in practice — **13 of 15 live AHUs held
  an approved entry** and were refused outright, and the suggested remedy (edit
  each month by hand) does not scale to a year of visits per AHU. Nothing is
  deleted now, so the guards went with the wipe.
  - An uploaded date that already exists is the SAME visit: **skipped and left
    unchanged**, so re-uploading a corrected file is idempotent rather than
    failing on every unchanged row.
  - Separation is checked against **existing entries as well as new ones** — the
    operator cannot see the current schedule from inside their spreadsheet.
  - Removing a visit is a deliberate per-entry act, never a side effect of
    uploading a file. That preserves a past APPROVED visit that WAS performed
    (evidence it was scheduled), a past APPROVED visit that was NOT performed
    (an obligation the missed-PM gate still tracks), and any QA approval given.
  - Rows are validated per AHU **before any write**, and **every** rejected row
    is reported, not only the offending one, or the operator reads "1 skipped"
    while three rows went nowhere.
- **`@@unique([scheduleId, plannedDate])`** replaced `[scheduleId, month]`
  (migration `20260827120000_pm_entries_unique_by_date`; drift guard PASS). The
  old key capped an AHU at 12 visits a year and made the importer silently
  collapse same-month rows ("last wins") — real schedule rows discarded with no
  error. `month` survives as a **display label only**.
  Note Prisma may materialise `@@unique` as a CONSTRAINT or a bare unique INDEX:
  the migration drops both spellings, because dropping only the constraint left
  the index still enforcing one-per-month (observed on digilog_db).
- Pre-existing overlaps are **grandfathered and flagged**, not blocked
  (`pm-schedules/detail.tsx` amber badge) — blocking would take a live AHU out
  of service mid-year.

**Known gap:** a late-December visit with a large tolerance has a window running
into January, but the next year is a separate `PmSchedule` row, so that pair is
not compared. Only bites large tolerances near year end (live data has 21 Dec
±25). Decide with the operator before closing it.

Plan + decision log: [`tasks/PM-IRREGULAR-SCHEDULE-PLAN.md`](tasks/PM-IRREGULAR-SCHEDULE-PLAN.md).

## Missed-PM gate: "previous scheduled task is pending" (2026-08-27)

Starting a **PM-reason** cleaning on an AHU that still owes an earlier PM is
refused with **409 `PM_PREVIOUS_TASK_PENDING`**, whose `details.pendingPmTasks`
carries the outstanding visits so the client renders the dialog with no second
round trip. The operator gives a reason **per visit**; the same call is retried
with `pmSkips: [{ entryId, reason }]`.

**Why the gate has to exist:** PM tasks stack, and `pm-due-tasks.ts` gives an
overdue entry NO upper bound on credit (`windowClosed || completedAt <=
windowEnd`). Without the gate, the April cleaning silently marks March done too
— a PM recorded as performed on a day nobody performed it.

- **A written-off visit is NOT a completed visit.** `skippedAt` is a separate
  terminal state; no `PmExecution` is written; My Tasks shows amber
  **"Not Performed"** with the reason, never a green Completed, and the
  Completed stat tile excludes it. Recording it as done would be a false record.
- **`skippedAt` OUTRANKS the cleaned computation** in `pm-due-tasks.ts` —
  otherwise the very cleaning that prompted the write-off would satisfy the
  no-upper-bound credit rule and flip the task from "not performed" to
  "completed".
- The write-off runs **inside the cleaning's transaction**: a reason recorded
  against a cycle that never started is a phantom justification.
- Scope: only PM-reason cleanings (a breakdown clean neither satisfies nor is
  blocked by a PM task); **offline replay is EXEMPT** — the tablet asked at scan
  time and the answers ride in the queued payload, so re-asking on replay would
  strand the op; asked **once per AHU**, not once per tag (the first item of a
  50-tag batch writes the write-offs).
- Deviations close as `closureKind = SKIPPED` with the reason; each write-off
  emits a `PM_TASK_SKIPPED` audit row.
- **Offline (tablet).** There is no 409 to react to when disconnected, so the
  tablet answers the same question from `lib/pm-pending-cache.ts`, a mirror of
  `GET /api/pm-schedules/pending-tasks-map` refreshed whenever it is online. The
  endpoint reuses `getPendingEarlierPmTasks` per AHU, so the cached answer and
  the server gate cannot disagree by construction. Answers ride in the queued
  payload and replay is exempt from re-asking. Staleness is bounded in the safe
  direction: a task resolved since the last refresh is asked about but writes
  nothing (`applyPmSkips` ignores entries that are no longer pending); a task
  newly overdue is caught by the next ONLINE start. Blocking cleaning because we
  cannot check would stop real work over a bookkeeping gap. Written-off entries
  are dropped from the cache on both paths, so a second scan in the same offline
  session does not re-ask.
- Files: `pm-schedules/pm-pending-tasks.ts` (detection + write-off),
  `components/pm-pending-tasks-dialog.tsx` (ONE dialog for web + tablet).

## Filter Data Management: cache invalidation (2026-08-27)

**An edit that saves but does not appear is a cache bug, not a save bug.** A
cleaning-cycle edit refreshed `/api/filters/cycles` but NOT
`/api/filters/cleaning-record` — which is what the user-facing Cleaning Record
page actually reads (`history.tsx:129`). The write was always correct; the
operator saw a stale page and reasonably concluded it had not saved.

Root cause was **three divergent copies** of the invalidation list (edit, create,
delete). There is now ONE map, `REVALIDATE_KEYS`, listing every SWR key each
entity can affect, with a comment per key saying why. **Over-invalidate on
purpose**: a needless refetch costs one request; a missed one shows wrong data.
When adding a screen that reads cycle/event/PM data, add its key there.

Cycle data is served by more keys than are obvious: `cleaning-record`, `cycles`,
`manual-status-changes`, `dashboard-stats`, `batch-states`,
`ahu-completion-status`.

**Per-cycle lifecycle.** The Cleaning Cycles tab has a Lifecycle expander showing
that cycle's own ordered stage events, each editable/deletable in place. It needs
no extra request — the cycles feed is already fetched with `includeEvents=true` —
and it reuses the SAME event dialog and audited endpoint as the Filter Events
tab. A second edit path would be a second set of rules to keep in step.

**The columns on the Cleaning Cycles row come from EVENTS, not the cycle.** RO
water pressure, compressed air pressure, dryer temperature, the per-stage times
and the per-stage performer all live on `filter_events` — readings inside
`attributes.instrumentReadings`. The cycle's own edit dialog only ever held
cycle columns, which is why none of them appeared there. They are edited from
the **Lifecycle** expander, on the event they belong to.

- **Readings are editable from BOTH the cycle dialog and the event dialog.** They
  are STORED on individual events — and only two of a cycle's ~12 steps carry any
  (the WASH_IN transition holds RO water + compressed air, one DRY_IN holds dryer
  temperature). So opening Edit on the cycle, or on any of the other ten steps,
  showed no reading fields at all, which reads as "not editable". The cycle
  dialog now surfaces every reading the cycle has, grouped by stage, and writes
  each back to the event that owns it through the same audited event endpoint.
  The Lifecycle panel also shows each step's readings inline, so it is obvious
  which step to open.
- Editing a reading changes **only its `value`**. `instrumentId`, `description`,
  `uom` and `leastCount` describe the instrument, not the operator's reading, and
  are written back untouched — rebuilding the array from the form would quietly
  drop the identity that makes a reading traceable.
- **From/To State are dropdowns, not text.** The live data shows what free text
  cost: `WASH_IN`, `WASHIN`, `washin` and `WASH-IN` all exist as separate values,
  as do `washout`/`WASHOUT`/`WASH_OUT`. Every variant is invisible to
  `getStageInfoFromEvents` (which matches `toState === 'WASH_IN'`), so one typo
  silently blanks that stage's column for the whole cycle. `statesWith()` adds
  the row's current value to the list so opening the dialog on a legacy row never
  discards it.
- **Performed By is a user picker** — `performed_by` is a UUID FK, and a
  hand-typed uuid is either wrong or unverifiable.

**Row actions are no longer hover-only.** 17 action clusters used
`opacity-0 group-hover:opacity-100`; there is no hover on a tablet, and an
operator cannot discover an action they cannot see.

## Operational logging (2026-08-31)

**When something is broken, read `logs/app/error/` first.** Every warning and
error from every module is duplicated there, so one file answers "what broke?".

`LOG_DIR` (installer: `C:\ProgramData\DigiLog\logs`; dev default:
`apps/api/logs`) resolves through `lib/log-dir.ts`, mirroring `uploads-dir.ts`.
Our files live under `<LOG_DIR>/app/`; WinSW's service logs stay in `<LOG_DIR>/`.

**These are NOT the §11 audit trail.** `audit_trail` is hash-chained, immutable
and retained permanently. These files ROTATE — they are deleted after 7 days.
Nothing that is a §11 record may ever live only here.

### The 8 log types

| # | Channel | Directory | What it answers |
|---|---|---|---|
| 1 | *(fan-in of every warn+)* | `error/` | "something broke — what?" |
| 2 | `application` | `application/` | boot, resolved config, shutdown, crash |
| 3 | `http` | `http/` | one line/request: method, url, status, **errorCode + errorMessage on a refusal**, ms, user, IP, reqId |
| 4 | `database` | `database/` | connect/disconnect, Prisma errors, slow queries (>`SLOW_QUERY_MS`, default 500) |
| 5 | *(Postgres itself)* | `<DataRoot>/db/log/` | the DB refusing connections — see `provision-db.ps1` |
| 6 | `services` | `services/` | cron ticks, notifications, LDAP, SMTP, backup |
| 7 | `security` | `security/` | login/logout, rejected tokens, 403s, rate limits |
| 8 | `mod:<name>` | `modules/<name>/` | filter-operations, sync, pm-schedules, backup |

**See what every channel looks like:** `cd apps/api && npm run logs:sample`
writes a fully-populated set of all 10 files to `apps/api/logs-sample/app/`
(gitignored, excluded from the production build — it writes FABRICATED events and
must never run against a customer machine). Useful as a format reference and as a
smoke test after touching the formatter.

Write to one with `getLogger('<module>', '<channel>')`, or `getModuleLogger()`
for a type-8 channel. **A module channel must be in `MODULE_CHANNELS`
(`lib/logger.ts`)** — streams are opened up front because the write path is
synchronous; an unlisted `mod:` channel falls back to `application` with a
one-time warning rather than being dropped.

### Rules that are load-bearing

- **stdout is never removed.** WinSW captures it and is the only thing that sees
  a crash before the logger exists (e.g. the TLS `readFileSync` at module load).
  Files are an addition, not a replacement.
- **Retention is ours, not pino-roll's.** pino-roll only prunes inside `roll()`,
  which fires on the midnight timer — on a PC powered off overnight that never
  happens and files accumulate forever. And its two cleanup branches disagree by
  one, so "7" could mean 8. `lib/log-retention.ts` keeps the newest 7 **dates**
  per channel (a size-split day counts once), runs at boot AND at 00:05, and
  deletes only files matching `<base>.<yyyy-MM-dd>.<n>.log`. Locked by
  `lib/__tests__/log-retention.test.ts`.
- **One directory per channel.** pino-roll's `detectLastNumber()` scans the whole
  directory and takes the highest trailing number from *any* file in it, so
  co-locating channels makes one inherit another's file number.
- **Streams are `sync: false`.** Crash-safety comes from `flushLogs()`, wired
  into all four death paths (uncaughtException, SIGTERM/SIGINT, shutdown
  timeout, failed listen). `sync: true` would put a blocking disk write on the
  request path.
- **Redaction is explicit paths in `lib/logger.ts`**, NOT `mask-secrets.ts` —
  that is an allowlist for audit config payloads and would redact a whole body.
- 🔴 **Routing is bound as `__chan` / `__mod`, never `channel` / `module`.** pino
  merges a call's context object OVER the child's bindings, so a call site
  passing a field with one of those names silently re-routed its own line to a
  different FILE. Live case: a notification carries `channel: 'EMAIL'`, and
  `notify.info({ channel: 'EMAIL' }, …)` landed in `application/` instead of
  `services/`. Found by generating realistic samples, not by a unit test — now
  locked by one in `__tests__/logger-redaction.test.ts`.
- **`formatValue` escapes embedded quotes (`\"`), never substitutes them.** An
  earlier version replaced `"` with `'`, which rewrote logged SQL: Postgres
  identifiers are double-quoted, so the recorded query was not the query that ran.
- **Login is logged in `modules/auth/routes.ts`, not the global hook**: a failed
  login has no `req.user`, so the hook could only say "anonymous", and the
  attempted username is the point. A 401 with **no** Authorization header is
  deliberately NOT a security event — the auth hook runs before routing, so
  every scanner probe and typo answers 401 and would flood the channel.
- **A refused request logs WHY (2026-10-01).** `→ 409 PM_PREVIOUS_TASK_PENDING`, plus `errorCode=` /
  `errorMessage=` fields, on the http, error and security lines. Captured in an `onSend` hook from the
  response BODY (`lib/refusal-log.ts`), not in the error handler — the auth / rbac / re-auth gates answer
  directly and never reach it. `details` is never logged. Before this a 409 on `/start-cycle` named none
  of the six rules that produce it.
- No config def for log level — `LOG_LEVEL` / `LOG_RETENTION_DAYS` are env vars.
- `scripts/collect-logs.ps1` zips all four sources (app, WinSW, Postgres, Windows
  Event Log) plus a live snapshot. Read-only; safe to run while services are up.

Plan + decision log: [`tasks/LOGGING-INTEGRATION-PLAN.md`](tasks/LOGGING-INTEGRATION-PLAN.md).

## Documentation Sync Rule

**Hard rule:** every numerical claim in any doc must be backed by a `grep`/`ls` against live code at the moment the doc is touched. Don't trust prior docs — verify.

**Active doc set** (kept current together):
- Root: `README`, `CLAUDE`, `AGENTS`, `CHANGELOG`, `PROJECT_SUMMARY`, `PROJECT_ARCHITECTURE`, `API_REFERENCE`, `BACKEND_GUIDE`, `FRONTEND_GUIDE`, `OFFLINE_SYNC_ARCHITECTURE`, `PHASE_5_RECENT_WORK`, `DEPLOY-WINDOWS`, `LOCAL_SETUP_WINDOWS`, `windowsIssues`
- Per-package: `apps/{api,web}/{CLAUDE,DECISIONS}.md`, `packages/shared/CLAUDE.md`
- Reference: `docs/`, `future/`, `tasks/todo.md`, `PROJECT_HANDOVER/`
- **Compliance/admin architecture flow:** [`docs/architecture-flows/digilog-architecture.md`](docs/architecture-flows/digilog-architecture.md) (+ `.html` artifact) — deep end-to-end flows for the **21 CFR Part 11 admin surface**: user management/RBAC, audit trail + hash chain, password policy, re-auth, notifications, backup/restore, configuration, electronic signatures. 12 Mermaid diagrams, ER schema, endpoint + model-field tables, an auditor verification matrix (with `file:line` proof + 2 known RBAC gaps), and §11 coverage. **Filter-management/FMMS operations are deliberately excluded (separate project).** Verified against branch `RFID` 2026-07-18.

**Per-change mapping:** see [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) "Change → Docs map" — read it before touching code that affects counts, modules, shared types, or any public surface. Same file holds the **12-touchpoint rule** for new config defs and the **pre-deletion rule** with receipts.

**Live-count verification (run before quoting any count):**

```bash
grep -cE "^model "                              apps/api/prisma/schema.prisma
grep -cE "^enum "                               apps/api/prisma/schema.prisma
grep -cE "^\s+[A-Z_]+:\s*'"                     packages/shared/src/types/permissions.ts
grep -cE "^\s+[A-Z_]+:"                         packages/shared/src/types/reauth-actions.ts
ls apps/api/src/modules/                        | wc -l
ls apps/api/src/modules/config/defs/*.def.ts    | wc -l
ls apps/web/src/routes/config/*.tsx             | wc -l
ls apps/web/src/hooks/ apps/web/src/lib/        | wc -l
grep -cE "<Route"                               apps/web/src/main.tsx
```

**Stale-stat sweep:** when changing any count, generate a regex from the *previous* numbers and grep across the active doc set; every match needs an update. Don't bake hardcoded numbers into the regex — derive them on the spot from the System Stats above.

**Always-update on any feature change:** `CHANGELOG.md`, `PHASE_5_RECENT_WORK.md` § 11 if closing an open gap, memory after corrections, `tasks/todo.md` audit-log entry for non-trivial doc work.

**Pre-deletion:** read each file's actual content for unique knowledge before deleting; when in doubt, restore. Receipts in `docs/CONTRIBUTING.md`.


## Defaults, not absolutes
If a rule below would produce a worse outcome in a specific case, say so 
and explain — don't silently comply with a rule that's misfiring.

## Never
- Don't swallow exceptions to silence errors.
- Don't hardcode values or comment out assertions to make tests pass.
- Don't invent APIs, function signatures, or config keys. If unsure, check or ask.
- Say "I don't know" when you don't know. Don't guess at fixes.
- Confirm before destructive actions (deleting files, dropping data, 
  rewriting git history).
- State assumptions explicitly in your response so I can correct them.
-while testing front end check for unlined Ui elements and consle logs that return unexpceted responses

## Correctness
- before editing the code fnd and list all the touch point this code change will effect, after code change, test all touch points, if you find a bug, fix it even if it not in your scope, only then consider the task done.
- Find root causes. No temporary fixes, no swallowing symptoms.
-be brutally honest

## Multi-session work
- For tasks spanning multiple sessions or 5+ steps, maintain `tasks/todo.md` 
  with checkable items. Skip this for smaller tasks.
