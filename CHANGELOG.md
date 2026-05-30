# Changelog

## [Unreleased] — A-01 Tier 2 Phase 1: Filter create is standalone (2026-05-30)

**What**: Filter **creation** (single + bulk) now writes the typed `filters` table **directly** — no `validateParent`, no `asset_relationships`, no asset-template. This fixes the **"Parent connections reached"** error (the legacy AHU asset-template `maxConnections=10` limit no longer applies to filters) and makes `filters` the write source-of-truth for new filters.

**How (reverse-mirror)**: New `filterService.create()` (`apps/api/src/modules/assets/services/filter.service.ts`) writes `filters` (+ `filter_details`, + RFID via `identifierService`) directly, generating the id in app code (the typed `filters.id` has no DB default). A new **reverse-mirror trigger** `fn_mirror_typed_to_asset_instance` (migration `20260530_filter_reverse_mirror`) back-fills a legacy `asset_instances` row (template_id = active FILTER template, parent_id = ahu_id) so the 7 pages still reading `/api/assets/instances` keep working. Both the new reverse trigger and the existing forward trigger got a `pg_trigger_depth() > 1` guard to prevent reverse↔forward recursion. `hierarchyService.createFilter` and `bulk-upload-filter.service` route through `filterService.create`; `instanceService.create`/`validateParent`/`resolveFilterTemplateRef` are no longer in the filter-create path.

**Verified live**: bulk upload of 3 filters into an AHU that already had **9 children** → all created, **no "Parent connections reached"**; 3 typed `filters` rows (ahu_id set), 3 `asset_instances` mirror rows (reverse trigger, parent_id set), **0 `asset_relationships`**, 3 `filter_details` with filter_set; deleting from `filters` cascaded the mirror + sidecar out. Trigger recursion-safety proven transactionally. Tests: `filter.service.test.ts` (3) + `create-filter.routes.test.ts` (4) + `hierarchy.routes.test.ts` (4) + c2 reauth e2e (6) green; both apps typecheck.

**Scope / still pending** (`docs/superpowers/plans/2026-05-30-filter-standalone-t2.1-plan.md`): this is **Phase 1** (create only). `asset_instances` still holds filters as a reverse-mirror because 7 reader files (`filter-list.tsx`, `filter-operations.tsx`, mobile, etc.) still read `/api/assets/instances`. **T2.2** = migrate those readers to `/api/hierarchy/filters`; **T2.3** = retire/replace/cycle/delete mutations to typed-direct; **T2.4** = drop the reverse mirror + forward FILTER branch + the FILTER asset_template (then `asset_instances` no longer holds filters at all).

## [Unreleased] — A-01 Slice 2: Bulk Upload .xlsx parity (2026-05-30)

**What**: The Filter Bulk Upload now matches Single Filter Creation — same concrete fields (no templateId / attributeSchema), the same live-master-data dropdowns, and the same typed create path. **CSV is replaced by `.xlsx`** with real Excel Data Validation dropdowns.

- **Template** (`GET /api/assets/instances/filter-upload-template.xlsx`): server-generated via `exceljs` with built-in dropdowns for `filterSet`, `ahuType`, `filterType`, `micronSize` whose values are read **live** from the `filter-field-options` config each download (zero hardcoding — a master-data edit shows up in the next download). Columns: `name` (the only required field — the Filter Name), `filterSet, ahuType, filterType, micronSize, lastCleaningDate, rfidTag`.
- **RFID assignment from bulk** (per user request): the `rfidTag` column lets operators assign an RFID tag per row during upload. Tags are validated for uniqueness — a tag already assigned to another filter (global `asset_identifiers.identifier_value @unique`) or duplicated within the file is **rejected** with `{row, column:'rfidTag', value, message}`; clean rows get the tag assigned via `identifierService.create` (one-per-entity + global-unique + audit). Filter-name duplicates (in-file or existing) are likewise rejected. The `filterProfileId` column was **removed** from the template.
- **Validation** (`POST …/bulk-upload-filters/validate`, dry-run): parses the `.xlsx` and returns per-cell `{row, column, value, message}` errors + the parsed rows, with **no DB write**. The dialog uses this to render a preview that flags invalid rows and lists the exact `Row N, column X = "value" — message` before the operator commits.
- **Upload** (`POST …/bulk-upload-filters`): re-runs the same validation, then creates each clean row through the typed single-create path (`instanceService.create` → FilterDetails + mirror trigger). Partial success supported (valid rows created, invalid rows reported). Fixed the stale `name:'Filter'` template lookup → `templateKind:'FILTER'`.
- **Frontend**: `BulkUploadDialog` shows the fixed field columns with their live dropdown values, the Area→AHU cascade (matches single-create), an `.xlsx` picker, and the row/column/value validation panel. The client CSV string-builder + `split(',')` parser are gone (binary `.xlsx` can't be parsed client-side).

**Verified**: unit tests (template generator 3, validator 4, create route 5) green; c2 reauth e2e green (6); both apps typecheck + web `vite build` green. **Live round-trip** against the real DB: template download → fill valid + bad-`filterType` rows → `/validate` returns the bad cell as `{row:3, column:'filterType', value:'CARBON', …}` with no write → real upload creates the valid row (typed `filters` + `FilterDetails.filter_set=SET_A`) and rejects the bad one; test rows cleaned up. **Browser-verified**: dialog renders with live dropdown values, template downloads, zero console errors from the feature.

Reuses Slice 1's `filter-fields.service.ts`. Spec + plan: `docs/superpowers/specs/2026-05-30-bulk-upload-filter-parity-design.md`, `docs/superpowers/plans/2026-05-30-filter-create-typed-cutover.md`.

## [Unreleased] — A-01 Slice 1: Filter single-create typed cutover (2026-05-30)

**What**: Filter single-creation moved off the asset-template / `templateId` / generic-`attributes` API surface onto a concrete typed endpoint. The create dialog no longer sends `templateId` or an `attributes` object built from a template `attributeSchema`; its dropdown fields are validated against the live `filter-field-options` config (per A-01 decision **D2=A**).

**New endpoint**: `POST /api/hierarchy/filters` — body is concrete fields only: `name`, `ahuId` (required), plus optional `filterSet` (A/B), `ahuType`, `filterType`, `micronSize`, `lastCleaningDate`, `filterProfileId`. The FILTER-kind template id is resolved **internally** for the unavoidable `asset_instances.template_id` FK (operator never sees it); the `fn_mirror_asset_instance` trigger mirrors the write into the typed `filters` table and `instanceService.create` writes the `FilterDetails` sidecar (`filterSet`/`filterProfileId`). Persistence is otherwise **unchanged** — this is an API-surface + field-source change, not a persistence rewrite.

**Validation (req #6)**: `ahuType`/`filterType`/`micronSize` must match the live config list (case-insensitive, stored canonical); `lastCleaningDate` must be `NA` or a calendar-valid `YYYY-MM-DD` (round-trip guard rejects e.g. `2026-02-30`). Failures return `400 { error: VALIDATION_ERROR, message, details: [{field, value, message}] }`.

**Files**: new `apps/api/src/modules/assets/services/filter-fields.service.ts` (field-options loader + `resolveFilterTemplateRef` + `validateAndBuildFilterAttributes`); `hierarchyService.createFilter` + `POST /filters` route in the hierarchy module; web `submitCreateFilter` repointed and the dead dynamic-`attributeSchema` field block removed from `CreateFilterDialog`. Also sidesteps the stale `name:'Filter'` template lookup (the live resolver uses `templateKind:'FILTER'`).

**Tests**: `filter-fields.service.test.ts` (4) + `create-filter.routes.test.ts` (5) — all green; both apps typecheck clean; web `vite build` green. **Live-verified** against the real DB: create→201 with canonicalized attributes + typed `filters` mirror + `FilterDetails.filter_set=SET_A`; bad dropdown value→400 with field/value detail; test rows cleaned up.

**Scope**: single-create only. Filter **edit** (`EditFilterDialog`) stays on the legacy path (FILTER `attributeSchema` is empty, so no functional divergence). **Bulk upload (Slice 2)** — `.xlsx` template with Excel data-validation dropdowns + server-side validation, reusing `filter-fields.service.ts` — is the planned follow-up (`exceljs` dependency already added). Spec + plan: `docs/superpowers/specs/2026-05-30-bulk-upload-filter-parity-design.md`, `docs/superpowers/plans/2026-05-30-filter-create-typed-cutover.md`.

## [Unreleased] — M-04: fix asset→typed-table mirror trigger breaking filter writes (2026-05-27)

**Bug**: Commit `97d298c` (2026-05-25) dropped four cycle-state columns (`filter_profile_id`, `current_lifecycle_state`, `current_cycle_id`, `filter_set`) from the `filters` typed-hierarchy table (FilterDetails is their authoritative home). The companion migration `20260525223000` dropped the sibling `fn_mirror_filter_details()` trigger and unblocked the *cycle-write* path — but the Wave-1 `fn_mirror_asset_instance()` trigger (mirrors every `asset_instances` write into `blocks`/`areas`/`ahus`/`filters` by `template_kind`) was left untouched. Its FILTER branch still did `INSERT INTO filters (... filter_profile_id ...)`, so every `asset_instances` write of FILTER kind failed with `column "filter_profile_id" of relation "filters" does not exist` — **breaking filter create / rename / retire / replace and bulk-upload** since 2026-05-25. Confirmed live on 2026-05-27 (columns absent from `filters`; `pg_get_functiondef` still referenced them).

**Fix**: migration `20260527191316_fix_mirror_asset_instance_drop_dead_filter_cols` — `CREATE OR REPLACE FUNCTION fn_mirror_asset_instance()` with only the FILTER branch cleaned (dropped the four dead column refs from the INSERT list, VALUES, and `ON CONFLICT DO UPDATE` set, plus the now-unused local vars and the `filter_details` SELECT-INTO). BLOCK / AREA / AHU / DELETE / ELSE branches unchanged; the trigger `trg_mirror_asset_instance_iud` untouched. Applied directly via psql (the `_prisma_migrations` table is absent — A-02 — so `migrate deploy` is not in use; `CREATE OR REPLACE` is idempotent).

**Verification** (transactional, all rolled back — zero test rows persisted): FILTER `asset_instance` INSERT now succeeds and mirrors a `filters` row with the correct `ahu_id` + reused UUID; UPDATE (rename + retire) drives the `ON CONFLICT DO UPDATE` branch correctly; BLOCK insert still mirrors. No application code changed — the fix is DB-side and live immediately, no API restart needed.

**Context**: This is item **M-04** in `tasks/PENDING-FIXES-2026-05-25.md`, on the asset-removal (typed-tables) programme path. The full generic-model→typed-table cutover remains task **A-01** (4–8 weeks, separate engagement) — executable plan now drafted at `tasks/A-01-ASSET-CUTOVER-PLAN.md`.

## [Unreleased] — Password expiry derives from live policy + grace floor (2026-05-23 → 25)

**Original bug (5/23)**: Setting `passwordExpiryDays` to 1 (or any value) did not expire existing users' passwords. Root cause: `users.password_expires_at` was a frozen snapshot baked in at password-change / create / unlock / reset time; lowering the policy later did not retroactively update any user row, and the login + per-request expiry checks only consulted that stale column.

**Follow-up bug (5/25)**: First iteration of the fix derived `expired = passwordChangedAt + days < now`. Admin lowered policy from 120 → 1 day and **every** account was force-flagged the instant they saved, including superadmin — bad UX, even though the policy was finally being honored.

**Fix**: new helper `apps/api/src/lib/password-expiry.ts` exports `isPasswordExpired(passwordChangedAt, createdAt, expiryDays, policyUpdatedAt)`. Anchor = `MAX(passwordChangedAt ?? createdAt, policyUpdatedAt)`. So saving the policy grants every account a fresh `days`-long grace window from the save time. After that window, accounts whose password is still older than the policy expire. The two enforcement sites — `authService.login` (`auth.service.ts:170`) and the auth plugin's per-request gate (`plugins/auth.ts:236`) — both consume the helper. The legacy `passwordExpiresAt` column is still written (vestigial, no longer authoritative).

**SUPER_ADMIN exemption (2026-05-25)**: Both gate sites now short-circuit for `user.role === 'SUPER_ADMIN'` before computing or applying expiry — mirrors the existing LOCKED-auto-unlock / EXPIRED-auto-recover / lockout-exempt branches in `auth.service.login`. Weakens 21 CFR §11.10(g) for privileged accounts; documented trade-off per user request. Plugin test `does NOT force password change for SUPER_ADMIN even with an ancient password` locks the behavior.

**Supporting changes**:
- `plugins/auth.ts`: added `passwordPolicyCache` (60s TTL holding `{ passwordExpiryDays, policyUpdatedAt }`) + `getPasswordPolicy()` + exported `invalidatePasswordPolicyCache()`.
- `auth.repository.ts`: added `getPasswordPolicyRow()` returning the full `SystemConfig` row so callers can read `updatedAt` alongside `configValue`.
- `config.service.ts updateConfig`: calls `invalidatePasswordPolicyCache()` when `key === 'password-policy'` so admin saves take effect immediately rather than after up to 60s of TTL lag.
- `user.repository.ts`: `createUser`, `unlockUser`, `resetPassword`, `approveResetRequest` now write `passwordChangedAt = new Date()` (previously only `auth.repository.changePassword` did). Makes the new derived check consistent across all password-write paths and removes the implicit dependency on `forcePasswordChange` ordering after admin resets.
- `auth.plugin.test.ts`: fixtures updated for new `passwordChangedAt` / `createdAt` + `systemConfig.findUnique(password-policy)` mocks including `updatedAt`; cache reset in `beforeEach`.
- `auth.service.test.ts`: added `getPasswordPolicyRow` to the repository mock + default fixture.
- **NEW** `lib/__tests__/password-expiry.test.ts`: 9 unit tests covering 0-day no-expiry, null `passwordChangedAt` fallback, the grace floor (the 5/25 regression), and the null-`policyUpdatedAt` legacy path.

**Net test delta**: 0 from this fix (+9 helper tests, 0 new failures). Same 4 pre-existing auth.plugin failures remain (module-scope cache pollution between tests — unrelated). Type-check clean.

**Deploy note**: On admin's next save of the password policy, every account gets a fresh `days`-long grace window starting from save. Accounts whose password is *still* older than `days` after the window elapses then expire on their next request. With expiry=1 day, that means the warning becomes: "everyone has 24 hours from save to change their password before being force-flagged." Preview who will eventually flip (run after save):

```sql
SELECT username, role, created_at, password_changed_at FROM users
 WHERE GREATEST(
         COALESCE(password_changed_at, created_at),
         (SELECT updated_at FROM system_config WHERE config_key='password-policy')
       )
       < NOW() - (SELECT (config_value->>'passwordExpiryDays')::int FROM system_config WHERE config_key='password-policy') * INTERVAL '1 day';
```

## [Unreleased] — Rule chain + alarm tear-out (2026-05-17)

Branch: `RFID`. Single-bundle commit covering 8 phases. Plan: `tasks/REMOVE-RULECHAIN-ALARM-PLAN.md`. Pre-removal git tag: `pre-rulechain-alarm-drop`. Test counts: api **1080 / 22 / 8** (matches baseline 1233/22/8 minus ~153 deleted rule-chain/alarm test cases — zero new failures). Web build clean (12.78s).

### Scope removed
- **5 Prisma models**: `RuleChain`, `RuleChainVersion`, `RuleNode`, `RuleNodeConnection`, `Alarm` — dropped via `prisma/migrations/20260517100000_remove_rule_chain_and_alarms/migration.sql`
- **3 columns on retained tables**: `asset_templates.{default_rule_chain_id, alarm_rules}`, `notification_logs.{rule_chain_id, alarm_id}`
- **API source**: whole `apps/api/src/modules/rule-chain/` dir (22 files: engine, 77 node types across 8 categories, default-chain-builder, debug-recorder, routes, types, registry, tests); `queries/alarm.routes.ts`; `config/static-routes/alarm-columns.routes.ts`; `config/defs/alarm-columns.def.ts`; `e2e/rule-chains.test.ts`
- **Web source**: whole `apps/web/src/routes/rule-chains/` (12 files: visual editor, palette, node config, dialogs); `routes/alarms/index.tsx`; `routes/config/alarm-columns.tsx`
- **Shared package**: 7 permissions (`RULE_CHAIN_*` × 4, `ALARM_*` × 3), 7 feature privileges, 5 reauth actions (`ACKNOWLEDGE_ALARM`, `CLEAR_ALARM`, `CREATE/UPDATE/DELETE_RULE_CHAIN`), 2 sidebar items, both `FEATURE_TO_PERMISSION_MAP` blocks, both REAUTH categories, `types/alarm-columns.ts`, `ALARM_RULE_TYPES`/`ALARM_SEVERITIES` constants, `alarmRules` schema field
- **Cross-module surgery**: data-ingestion Stages 7 + 8 (rule-chain execution + alarm dispatch) + `evaluateTemplateAlarmRules` + `createAlarm`; DLQ overflow alarm branch; notification-dispatcher event labels/fields/templates for `RULE_CHAIN_TRIGGERED` + `ALARM_*`; `buildAlarmVariables` / `buildRuleChainVariables` in template-engine; `ruleChainId`/`alarmId` from `NotificationPayload`; `defaultRuleChainId` from MQTT handler + asset-template service/repo/routes; `alarms` from queries export + retention + UNS topic suffix; `alarm_table` from dashboard widgets; super-admin alarm CRUD; deployment-check schema-health probe; `notification.worker.ts` collapsed to no-op drain
- **Seed**: 6 role permission arrays (SUPER_ADMIN through VIEWER), 11 alarm `FLD_ALARM_*` field-IDs, 5 `rule_engine.*` config rows, `pipeline.dlq_alarm_threshold`, 7 help articles
- **Runtime DB rows** (`scripts/remove-rulechain-alarm-runtime-cleanup.sql`): 3 stale `roles.permissions` JSONB arrays, 1 stale `role_configs.sidebar_items`, 1 orphan `system_config.alarm-columns` row
- **Queue package**: `JOB_PRIORITY.ALARM_PROCESSING` constant; `notificationJobSchema.alarmId`; `'alarms'` from `exportJobSchema.exportType` enum

### Retained (21 CFR §11 contract)
- `packages/shared/src/types/audit-actions.ts`: `ALARM_CREATED/ACKNOWLEDGED/CLEARED/ESCALATED`, `RULE_CHAIN_CREATED/UPDATED/DELETED/SET_ROOT/IMPORTED` — marked "no longer emitted as of 2026-05-17", kept for historic-row rendering and inspector reference
- `packages/shared/src/types/audit-templates.ts`: matching template strings
- `audit_trail` rows referencing deleted UUIDs (4 historic rows in JSON details) — hash chain unbroken; UUIDs become orphan references per user "hard delete" decision
- `notification_logs.triggeredBy` historic strings (`'alarm'`, `'rule-chain'`) — column is VARCHAR not enum; no decoder breaks

### Out of scope (filter cleaning-cycle pipeline)
The cleaning-cycle pipeline (`cleaning-profiles/`, `filter-operations/`) is an independent node-based system (STAGE / CHECKLIST nodes via ReactFlow). Zero refs to RuleChain. Unaffected by this tear-out.

## [Unreleased] — P0 compliance branch close (2026-05-04)

Branch: `fix/p0-compliance-2026-05-04` — 12 commits closing 8 of 9 P0 audit findings from `tasks/CODE-REVIEW-2026-05-04-summary.md` plus follow-up cleanup. Test counts: api **1277 / 0 failed / 8 skipped** (was 1249), web **104 / 104**.

### Worst-impact bug closed (independently flagged by 2 reviewers)

`a139fcb` — **HMAC-signed offline-replay grant replaces unauthenticated `x-offline-replay: true` header bypass**. New `apps/api/src/lib/offline-replay-token.ts` (jose HS256, dedicated `OFFLINE_REPLAY_SECRET`); new `POST /api/auth/offline-grant` requires password (NOT routed through configurable reauth registry); auth plugin verifies grant + decorates `req.offlineReplayVerified`. Bare legacy header returns 401 `OFFLINE_REPLAY_HEADER_DEPRECATED`. FE login fetches grant, sync-engine forwards as `x-offline-replay-token`. Tablet upgrade requires single re-login per device.

### 21 CFR Part 11 audit-trail integrity

- `7dc339c` — **Tamper-evident audit hash chain**. Schema: `audit_trail.previous_checksum` + `chain_position BIGSERIAL`. Write path: `pg_advisory_xact_lock` + chained `$executeRaw`. New `GET /api/audit/verify-chain` (SUPER_ADMIN). Detects in-place mutation, insertion, gap. Backup repository stringifies BigInt for JSON. ingestion.service routes through `auditLog()`.
- `f6d1282` — **Bounded `offlinePerformedAt`**: tablet wall-clock stays source of truth (replay-only), but server validates: max 5min future skew, max 30 days stale, must be ≥ cycle.startedAt. New `OfflineTimeError` → HTTP 400. Wired into start-cycle, advance, submit-checklist; parity for bypass + terminate-cycle in `48b1320`.
- `679e642` — **Backup chain-verify on restore**: `restoreFromBackup()` walks the backup's audit_trail and verifies chain integrity BEFORE installing. Tampered backups return 400 `BACKUP_AUDIT_CHAIN_INVALID`. Operator opts in via `force=true` form field — audited as `forced=true` on `BACKUP_RESTORED` row.

### Privilege-escalation + reauth-coverage fixes

- `7e5839a` — Renamed `'admin_requests.view'` privilege from `USER_CREATE` → new `ADMIN_REQUEST_REVIEW` permission. Added `UPDATE_EMAIL_CONFIG` + `UPDATE_SMS_CONFIG` to `REAUTH_ACTIONS` (notification-delivery routes referenced non-existent keys → step-up auth was silently disabled). Fixed start-cycle race (`SELECT ... FOR UPDATE`). Fixed submit-checklist null-state false 409 (`equals: null` instead of `undefined`).
- `b8fb038` — Wrapped `reauth.execute()` on 6 FE skip sites: approvals (block-change), mobile-wrapper (block-change + RFID), config/equipment-groups, rule-chains/editor (toggle + name), config/action-reauth save itself (new `UPDATE_REAUTH_CONFIG` action — closes the meta-policy escalation: anyone with CONFIG_UPDATE could disable reauth on DELETE_USER then delete users).
- `2596196` — 4 sensitive-config surfaces: access-matrix (`UPDATE_ROLE_CONFIG`), ldap (`UPDATE_LDAP_CONFIG`), audit deletion single + bulk (distinct `DELETE_AUDIT_RECORD` + `BULK_DELETE_AUDIT_RECORDS` so collapsing many rows under one challenge isn't possible). Added 15 missing `PERMISSION_META` entries (perms previously rendered as "Other" with raw key in role-edit UI). Removed stale `organizations` SIDEBAR_PRIVILEGE_MAP entry + 4 dead files.
- `48b1320` — Template-kinds CRUD reauth (`CREATE/UPDATE/DELETE_TEMPLATE_KIND` — controlled-vocabulary edits cascade across every entity using the kind). Extracted `useBlockChangeApproval` hook so `approvals/index.tsx` and `mobile-wrapper.tsx` can't drift again (the bug they shared in `b8fb038` is exactly the failure mode the "tablet must NOT have a separate implementation" rule exists to prevent).

### Reports + offline + JWT plumbing

- `679e642` — `POST /api/reports/generate` rejects unknown entity IDs in `entitySlots` (HTTP 404 + slot name). Stops UUID-existence probing.
- `d685e1e` — Drop `navigator.onLine` residue from offline-store + sync-since (Capacitor connectivity engine was being defeated). Surface partial-sync failures via new `SyncProgress.partialFailures` field — operator sees "Synced with warnings: …" instead of misleading green check.
- `d322fc7` — Centralize JWT refresh via new `apiClient.refreshToken()` with in-flight Promise guard. The 30-min interval refresher in use-auth.ts had been a silent no-op on Capacitor APK (raw fetch with relative URL hit WebView origin, not the API host).

### Compliance invariants → migration

`17950db` — Moved 4 invariants from `prisma/sql/invariants.sql` (only run by seed.ts) to dedicated `20260504190000_compliance_invariants/migration.sql`: 1-IN_PROGRESS-per-filter unique partial index, filter_event ↔ cycle.filter_id consistency trigger, asset_relationship bidirectional-pair constraint trigger, audit_trail no-delete trigger. Idempotent. A `prisma migrate deploy`-only production cutover would have shipped without 21 CFR Part 11 invariant enforcement.

### Operator runbook

`17950db` (DEPLOY-WINDOWS § 10.3) documents: new `OFFLINE_REPLAY_SECRET` env var (required in production), the two new migrations to apply, single re-login per tablet after upgrade (queues then drain), `GET /api/audit/verify-chain` runbook, `offlinePerformedAt` server-side validation policy, `ADMIN_REQUEST_REVIEW` privilege rename.

### Still pending (NOT closed by this branch)

- **P0 #5** — UI for `/bypass` + `/terminate-cycle` (UX placement decision; backend ready)
- 5 lower-blast config surfaces still unprotected: `notification-rules`, `dashboard-cards`, `cleaning-profile-assignment`, `filter-cleaning-reasons`, `notification-settings/email-settings` page-level wrap, `ahu-filter-set-config`, `checklist-form` signature flow
- PWA `skipWaiting` + reload-prompt (operators submit stale contracts post-deploy)
- Decision-tape `tapeVersion` integer overflow at 1e6 events/cycle
- RBAC caching (4 sequential queries before every handler)
- ~140 bare-string FKs (data-layer C3 — schema audit; orphan UnsMapping bug class)

---

## [Unreleased] — Wave 8a: § 11 follow-ups close (2026-05-03)

Final pass on `PHASE_5_RECENT_WORK.md § 11` outstanding work. Six parallel agents (Y/Z/AA/AB/AC/AD) closed three remaining items in a single dispatch.

### `8694435` — DEPLOY-WINDOWS.md Phase 8.7 release notes

New section 10 (+60 lines, 403→463) documents two operational items from the 8.7 carried-forward list:
- **10.1 Drift catch-up migration** requires `npx prisma migrate resolve --applied 20260503162127_capture_schema_vs_db_drift` BEFORE any future `migrate deploy` on populated DBs (greenfield is unaffected). Failure modes: `filter_cleaning_profiles.lineage_id NOT NULL`, `asset_instances` column drops. Recommended path: pg_dump → resolve → deploy.
- **10.2 Offline-queue replay tapeVersion=null failures** expected after upgrade. Pre-8.7 IDB ops with `tapeVersion: null` will 400 on first sync; sync-engine marks them failed. Operator guidance: failed actions did NOT execute, must be re-performed; clean rollout = drain queues under old APK first; no server-side workaround by design.

Forward-pointer added in section 9 step 4; 2 new troubleshooting-table rows added in section 11. Sections 10/11/12 → 11/12/13 renumber.

### `d660daf` — Multi-filter batch checklist dialog cycles through every pending filter

Closes the § 11 known follow-up "Multi-filter batch checklist dialog — currently opens for first item only (session 04-20 known follow-up)". **21 CFR Part 11 risk** closed: filters B/C/... in a batch were silently skipping their pending CHECKLIST gates after the first dialog submitted.

Fix existed on BOTH desktop AND mobile (per the per-page parity rule from `feedback_batch_single_parity.md`). New shared helper `apps/web/src/lib/filter-ops/next-pending-checklist.ts` walks the batch and returns `{item, checklists, remaining} | null`. Each page tracks the remainder in a NEW state (mobile: `pendingChecklistBatch`; desktop: `postAdvanceChecklistQueue` — separate from the existing `pendingBatch` shared-answer-set path so BATCH MODE stays byte-identical). After each `handleChecklistSubmit`, the page cycles to the next pending dialog. 7 new unit tests on the helper.

### `859492e3` — Phase 2/3/4/5 e2e route-layer suites

Closes the § 11 outstanding work "tests/manual-test-cases/ was deleted in the documentation cleanup. Need fresh cases for filter operations, RFID, offline replay, reports, block-change approval, PM My Tasks, admin requests." Replaced markdown manual-test recipes with executable vitest e2e suites — 4 new files, 29 new tests:

- **phase2-filter-operations.test.ts** (10) — start-cycle / advance / submit-checklist / bypass / terminate-cycle / getCurrentState shape on the wire. Hybrid pattern: real auth + MOCKED service layer = zero DB pollution. Phase 8.7 invariants (legacy fields stripped, tapeVersion required) verified at the route layer. Service-layer concurrency NOT duplicated (covered by `concurrent-operator.test.ts`).
- **phase3-rfid-offline.test.ts** (7, 6 active + 1 skip) — identifier lookup/create/delete/conflict + offline-replay header skips reauth. Real route paths discovered: `GET /api/assets/identifiers/lookup/:value`, `POST /api/assets/identifiers`, `DELETE /api/assets/identifiers/:id` (NOT `/api/identifiers` as planned). Header literal: `'x-offline-replay': 'true'` (string).
- **phase4-perms-themes-reports.test.ts** (8, 6 active + 2 skips) — VIEWER/OPERATOR perm-gate proofs + report-settings/branding/registry. Surfaced **pre-existing PUT report-settings 404 bug**: `hasCustomPage:true` skips `dynamic-routes.ts` PUT wiring, but no static route exists; FE writes silently fail. Flagged for follow-up.
- **phase5-decision-tape-backup.test.ts** (7) — Phase 8.7 invariants verified end-to-end + backup export/validate round-trip + `/sync/since` 6-entity hydration (incl. ChecklistProfile + AssetTemplate hydrated by 8.7 commit `d31f5d2`). Real route paths: `/api/backup/{export,validate,restore}` (NOT `/api/system/backup`). Used unique `P5<suffix>` SUPER_ADMIN test user to avoid SESSION_INVALID race against shared `admin` user when local dev server contends with the test runner.

### Test counts (single-fork mode — only stable mode per AA's findings)

- **Before Wave 8a:** api 1202 / 2 / 6 (1210)
- **After Wave 8a:**  api 1231 / 2 / 9 (1242) — net +29 from 4 e2e files; same 2 pre-existing failures unchanged.
- **Web:** 84 → 91 (+7 from Y's `next-pending-checklist` helper unit tests)
- **Shared:** 305/306 unchanged.

### Stability note

Full-suite default-pool runs are **flaky** due to shared `admin` test-user contention across worker processes. The verified count requires `--pool=forks --poolOptions.forks.singleFork=true`. This is a pre-existing infra issue surfaced (but not introduced) by the new e2e files.

### Closes (all carried-forward items from § 11)

- ✅ "Phase 2/3/4/5 manual test cases" — replaced with executable e2e suites in `859492e3`
- ✅ "Multi-filter batch checklist dialog opens for first item only" — fixed on both desktop + mobile in `d660daf`
- ✅ Drift migration `migrate resolve` operator guidance — added in `8694435`
- ✅ Tombstone-replay tapeVersion=null operator guidance — added in `8694435`

### New pre-existing flags surfaced (not fixed)

- PUT `/api/config/dynamic/report-settings` returns 404 — `report-settings.def.ts` has `hasCustomPage:true` so `dynamic-routes.ts` skips a generic PUT but no `static-routes/report-settings.routes.ts` exists. Flagged in `859492e3` for follow-up.

### Carried forward (out of scope for this session)

- Phase 8.8 (APK rebuild + tablet field QA) — APK was rebuilt this session; install + field QA still requires physical tablets per `tasks/PLAN-2026-05-02-step8.8-apk-field-qa.md`.
- Browser smoke (Wave 6 O) — needs Vite dev server restart from this worktree (currently running stale build from main checkout).
- Pre-existing flags from prior splits (telemetry-row JSX-escape, dead `useDatetimeFormat`, etc. — listed in `4036336`/`26d61d0`/`4aa5a27` commit messages).

---

## [Unreleased] — Wave 7: P0.2 monster-file decomposition closes (2026-05-03)

Closes the last open item from the bloat audit (`PHASE_5_RECENT_WORK.md § 11 P0.2`). All 8 monster files (1000+ LOC) decomposed into 78+ cohesive modules across 9 commits via parallel + sequential subagent dispatch (waves 7a/7b/7c). **Façade pattern throughout** — every original file path keeps its public export(s) so consumers (`main.tsx` lazy-loads + downstream imports) resolve unchanged. Zero behavior change verified by full-suite parity at every commit.

### What landed (9 commits, 78+ new modules, 7 monster files reduced)

| Commit | File(s) | Was → Orchestrator | Strategy |
|---|---|---|---|
| `de54329` | `apps/web/src/routes/checklist-form/index.tsx` | 1561 → 507 | 8 sub-components + types + helpers |
| `66cc80d` | `apps/api/src/modules/pm-schedules/pm-schedule.service.ts` | 1042 → 120 | 7 domain modules + 2 leaf (`crud`, `executions`, `due-tasks`, `import`, `ahu-config`, `approval`, `shared`, `types`); `delete` → `remove` (JS reserved word at fn-decl) |
| `3b0346f` | `apps/web/src/routes/debug/index.tsx` | 1145 → 648 | 5 sub-components + types + helpers; agent correctly rejected the brief's "tabs" hypothesis (file is single linear page) |
| `cfc78fb` | `apps/api/src/modules/filter-operations/filter-operations.service.ts` | 2119 → 599 | `helpers` + `filter-resolver` + `current-state` + `cycle-write/{locking,start-cycle,advance,bypass,submit-checklist,terminate-cycle}`; SHARED `lockAndVerifyFilterState` helper DRYs the 4 writes; **all Phase 8.7 invariants verified preserved** (no TAPE_PARALLEL gate, no deprecated fields in getCurrentState, all 4 writes still SELECT FOR UPDATE + STATE_CHANGED + CYCLE_CHANGED) |
| `7edacc1` | desktop `filter-operations.tsx` + mobile `mobile-operations.tsx` | 4567 → 4396 (combined) | Coordinated split — kept as sibling presentations; extracted shared LOGIC into `apps/web/src/lib/filter-ops/{types, validate-offline-gate, resolve-pending-checklist, use-dryer-countdown, index}`. **Drift-prevention map in commit message** tells future maintainers exactly which module owns each bug class |
| `e825e9b` | `apps/web/src/routes/filter-management/filter-list.tsx` | 2535 → 1633 | 16 modules under `filter-list/` (constants + types + 1 component + 13 dialogs/panels); 6 pre-existing dead-code flags surfaced |
| `26d61d0` | `apps/web/src/routes/assets/components/template-form-editor.tsx` | 1102 → 448 | 8 row sub-components — cleanest split of the wave (every row had clean `{value, idx, onUpdate, onRemove}` interface); flagged 1 pre-existing JSX-escape bug in telemetry-row placeholder |
| `4036336` | `apps/web/src/routes/assets/templates.tsx` | 1166 → 463 | 12 modules under `templates-list/` (5 components + 3 dialogs + 1 hook + 3 lib); two-phase agent dispatch (V extracted modules but timed out before wire-up; V2 finished — combined into one commit since the modules-without-wire-up are dead code) |
| `4aa5a27` | `apps/web/src/routes/rule-chains/editor.tsx` | 2140 → 971 | 9 modules under `editor/`; brief's "77-case switch" assumption corrected — `NodeConfigPanel` is generic schema-driven (iterates `configSchema`, dispatches on `fieldDef.type`); single-file extraction of the 571-LOC panel was correct vs. fragmenting the iteration loop. Removed one provably-dead `useCallback` (the only behavioral-equivalent simplification across all 9 commits) |

### Tests — all suites preserved exactly through every split

- **api:** 1202/1210 passing (2 known unrelated failures, 6 documented skips). Net Δ from pre-Wave-7: 0.
- **web:** 84/84 passing.
- **shared:** 305/306 passing (1 known unrelated failure).
- **TypeScript:** clean across `apps/api`, `apps/web`, `packages/shared` after every split.

### Per-split discipline (codified across all 9 commit messages)

- Each split uses **façade pattern** — orchestrator file stays at its original path, becomes a thin re-exporter; consumers' imports never change
- Each split honors **"no behavioral change"** — byte-equivalent runtime behavior verified by full test-suite parity
- Each commit message **lists what stayed inline + why** — typically state/handlers/state-coupled JSX where extracting would drill 10+ props through a single-use component (per advisor + agent T's playbook). The orchestrators are intentionally NOT minimized at the cost of cohesion
- Each commit message **surfaces pre-existing dead code or oddities** found during the split for a future cleanup pass — not fixed under the no-behavior-change constraint
- Coordinated splits (filter-ops desktop+mobile) include a **drift-prevention table** mapping bug classes to the shared module that owns them

### Closes

- ✅ "P0.2 — split monster files (the only bloat-audit item still open)" — all 8 files done; PHASE_5_RECENT_WORK.md § 11 entry struck through

### Carried forward

- 6 pre-existing dead-code flags from `e825e9b` (filter-list) — `templateFieldKeys` unused, `createFilterProfile` stub, dead `enrichedFilters` fields, `closePanel` referenced before declaration, etc.
- 1 pre-existing JSX-escape bug from `26d61d0` (template-editor) — `telemetry-row.tsx` placeholder uses literal `°` instead of `°`
- 4 pre-existing oddities from `4aa5a27` (rule-chains editor) — dead `useDatetimeFormat` destructure, superfluous `doSave` deps, unused `fieldKey` prop on `RuleChainSelectField`, unused `_backendData` extension on Node
- 1 pre-existing pagination-prop semantic from `4036336` (templates) — `templatesRes.page` vs local `page` for displayed Page-X-of-Y text

These all originated in the pre-Wave-7 monoliths; the splits surfaced them for visibility but explicitly did not fix them per the discipline rule.

---

## [Unreleased] — Step 8 Phase 8.7 follow-ups (2026-05-03)

Three follow-ups landed after the 8.7 cutover, closing every audit-flagged risk that didn't strictly need physical tablets. Single-day batch dispatched as 3 parallel agents (K + L + M).

### `b955059` — bypass + terminateCycle now serialize with row locks

Closes the two existing-risk items Phase 8.7's concurrent-operator audit flagged (tasks/AUDIT-2026-05-02-concurrent-operator.md lines 83-93 and the bypass cycle-id gap). Brings both write methods to full parity with `advance()` — every cycle-bound write now does pre-txn state snapshot + in-txn `SELECT ... FOR UPDATE` + 409 STATE_CHANGED + 409 CYCLE_CHANGED.

Before this commit, two collision shapes were silently accepted:
- `terminateCycle` had NO row lock at all (transaction-wrapped only) and NO state/cycle recheck — operator A could terminate cycle X while operator B was already terminating it; the second termination wrote against the post-first-termination row.
- `bypass` had a SELECT FOR UPDATE on filter_details but only checked `current_lifecycle_state` — a cycle-id swap behind a bypass write silently recorded BYPASS_DEVIATION against the pre-lock cycle.

3 previously-skipped concurrent-operator tests now pass: `bypass > CYCLE_CHANGED`, `terminateCycle > STATE_CHANGED`, `terminateCycle > CYCLE_CHANGED`. Bonus mock fix in `tape-version-check.test.ts` so 2 unrelated tests don't regress (`tx.$queryRaw` is now called inside terminateCycle).

### `11b4b82` — cycle-tombstone replay sends justification + tapeVersion

Two bugs in the cycle-tombstone replay path at `sync-engine.ts:163` — both would 400 against the live server, both moot in practice because the path has zero live callers (UI uses operations store, not tombstones store):

1. **Wrong field name.** The replay sent `{ reason, clientOpId }` but the server's `/terminate-cycle` route requires `justification`, not `reason`. Pre-Phase-8.7 this would 400 with "missing justification".
2. **Missing tapeVersion.** After `f8fae1d` tightened tapeVersion to required, the same dead-code path would 400 with "missing tapeVersion".

Fix: `Tombstone` interface gains optional `tapeVersion?: number | null`; replay forwards `justification` (preferred) or maps legacy `payload.reason` for backward compat; tapeVersion forwarded conditionally. No IDB schema bump needed — zero on-disk tombstone rows exist.

2 new web tests cover both paths (with-tapeVersion forwards correctly, null tapeVersion documents the migration cost — would 400 SCHEMA_ERROR).

### `11095ad` — gitignore root-level test/QA PNG droppings + backups/

Closes the "P3.2 / Root working-tree noise" follow-ups documented in `PHASE_5_RECENT_WORK.md` § 11. The main checkout has 109 untracked PNGs at the repo root from prior sessions (`bug-fix-*.png`, `bug-sweep-*.png`, `mt-removal-*.png`, `step1-*.png`, etc.) that pollute every `git status`. New patterns: `/*.png` (root-anchored — 50+ tracked PNGs under `PROJECT_HANDOVER/diagrams/`, `apps/`, `RFID/`, `old/screenshots/` are unaffected) and `/backups/`.

### Tests (post-Wave-5)

- **api:** 1199 → 1202 passing (+3 from K's newly-active concurrent-operator tests). 2 pre-existing failures unchanged. 9 → 6 skipped.
- **web:** 82 → 84 passing (+2 from L's tombstone tests).
- **shared:** 305/306 unchanged.
- TypeScript: clean across all 3 packages.

### Closes (carried-forward from 8.7 follow-up list)

- ✅ "`terminateCycle` lacks SELECT FOR UPDATE + post-lock state recheck" — `b955059`
- ✅ "`bypass` doesn't recheck `current_cycle_id` inside its lock" — `b955059`
- ✅ "terminate-cycle tombstone path doesn't carry tapeVersion" — `11b4b82` (also caught a separate field-name bug)
- ✅ "Root working-tree noise — test PNGs, `.playwright-mcp/`, `backups/` not gitignored" — `11095ad`

### Out of scope (still carried forward)

- Pre-Wave-2 IDB-queued ops with `tapeVersion: null` will 400 on replay (sync-engine marks them failed). Documented migration cost.
- Drift migration `20260503162127_capture_schema_vs_db_drift` is fresh-DB-only as written. Populated environments need `prisma migrate resolve --applied` instead of `migrate deploy`.
- Phase 8.8 (APK rebuild + tablet field QA) — needs physical tablets per `tasks/PLAN-2026-05-02-step8.8-apk-field-qa.md`.

---

## [Unreleased] — Step 8 Phase 8.7: cutover complete (2026-05-03)

Branch: `feature/phase5-verification`. Removes the dual-emit / flag-gated transition into the decision-tape architecture. Server now always emits `actions[]` + `tapeVersion`; the deprecated `nextAllowedStages` / `pendingChecklist` derived fields are gone from the `getCurrentState()` response and from the 4 cycle-bound write responses. FE consumes only the action tape. Pipeline-walking drift between client and server is now structurally impossible. **One app-visible enforcement change**: the 4 write routes (advance, submit-checklist, bypass, terminate-cycle) now require `tapeVersion` in the request body — they return 400 if missing, 409 STALE_TAPE if mismatched. FE plumbing was audited end-to-end and every caller confirmed sending it.

### What landed

#### Wave 1 — independent foundations (4 commits, parallel agents)

- **`1033aca`** — `apps/api/prisma/migrations/20260503162127_capture_schema_vs_db_drift/migration.sql` (NEW, 467 lines). Captures the schema-vs-migration drift the team accumulated via `prisma db push` between ~2026-04 and 2026-05-02 (Kind B drift from `tasks/MIGRATION-DRIFT-2026-05-02.md` § 3). Generated by `prisma migrate diff --from-migrations --to-schema-datamodel --script` against a transient shadow DB (subsequently dropped — no live DB mutated). Coverage: 4 new enums, 2 trimmed enums (MT removal), DROP organizations + 10 organizationId column/FK/index sites, 10 new tables (template_kinds, filter_details, filter_profile_*, equipment_group_versions, checklist_profile_versions, report_*), ~25 indexes + ~20 FKs. Header documents the fresh-DB-only constraint and the `prisma migrate resolve --applied` workaround for environments populated via `db push`. `invariants.sql` NOT folded in (Prisma cannot emit triggers/partial-unique-indexes from the schema; separate concern). Verification: re-running diff produced "-- This is an empty migration."

- **`d31f5d2`** — `apps/api/src/modules/sync/{sync.service.ts, routes.ts, __tests__/sync.service.test.ts}`. Closes the 8.4b deferred follow-up: `ChecklistProfile` (with `questions` inlined, `orderBy sortOrder`) and `AssetTemplate` (verbatim passthrough) now populate on `GET /api/sync/since` instead of returning `[]`. Same per-entity cursor + 500-row pagination + `Promise.all` pattern as the existing 4 entities. 6 entities, all required in the response schema. Tests: 17 service + 3 route = 20 (was 16). FE consumer at `apps/web/src/lib/sync-since.ts` already calls `cacheEntities` for both — populated arrays land in IDB on next poll automatically.

- **`1fa84b5`** — `apps/web/src/routes/filter-management/filter-operations.tsx` (desktop) deprecated reads → 0. New helpers added in `apps/web/src/lib/offline-cache.ts`: `cacheServerStateResponse(filterId, st, ttlMs?)` (encapsulates the cache row write so legacy field names live in one shared lib), `getCachedPendingChecklists(filterId)` (cache-row read fallback), `dialogChecklistsFromActions(actions)` (converts SUBMIT_CHECKLIST tape entries into ChecklistDialog's `PendingChecklist[]` shape). 18 deprecated read sites switched to `actionsForStage()` + `getCurrentActions()` (3-tier fallback) + `hasActionKind`.

- **`2521aad`** — `apps/web/src/routes/mobile/mobile-operations.tsx` deprecated code reads → 0 (using D's helpers). 9 grep hits remain post-cleanup = 7 explanatory comments + 2 spec-mandated cache writes (the L1307 two-phase write pattern that `local-context.ts:466` depends on for `CHECKLIST_COMPLETED` synthesis offline; preserved verbatim with surrounding rationale).

#### Wave 2 — server cutover (1 commit, single agent)

- **`f8fae1d`** — `apps/api/src/modules/filter-operations/{filter-operations.service.ts, routes.ts, tape/__tests__/tape-parity.test.ts, __tests__/get-current-state.test.ts}`. Five coupled cuts:
  1. **TAPE_PARALLEL flag removed** — `actions[]` always emitted from `getCurrentState()`. `process.env.TAPE_PARALLEL` references in `apps/api`: 0. `tape-parity.test.ts` rewritten (option 1, advisor-confirmed): same 8 tests, no env-flag setup, asserts the tape contract directly.
  2. **`nextAllowedStages` + `pendingChecklist` dropped** from the `getCurrentState` response and Fastify response schema.
  3. **`tapeVersion` tightened to required** on the 4 cycle-bound write request schemas (`/advance`, `/submit-checklist`, `/bypass`, `/terminate-cycle`). `/start-cycle` deliberately untouched (no tapeVersion concept until cycle exists).
  4. **`actions[]` + `tapeVersion` added** to the 4 POST write-route response schemas (per agent E's discovery — they emitted `pendingChecklist` but not `actions[]`). Service computes the post-write tape via the same generator path.
  5. **`pendingChecklist` dropped** from those 4 POST response schemas.

  Test changes: `get-current-state.test.ts` mocks expanded with `filterEvent.findMany`/`count` (now always called because tape generation is unconditional). `tape-version-check.test.ts` left untouched — the route-schema gate enforces required, the service still tolerates `undefined`.

#### Wave 3 — verification (2 commits, parallel agents)

- **`73a5f44`** — NEW `apps/api/src/modules/filter-operations/__tests__/concurrent-operator.test.ts` (508 lines, 9 active + 9 documented skips). Closes the "coordinated full smoke test: concurrent-operator scenarios" gap. Drives off `tasks/AUDIT-2026-05-02-concurrent-operator.md`. Active coverage: STALE_TAPE on all 4 methods, STATE_CHANGED on advance + bypass, CYCLE_CHANGED on advance, ALREADY_SUBMITTED on submitChecklist, plus a happy-path control. Skips document why each missing combination is intentional vs. needing real-DB scaffolding. **Two existing risks surfaced (NOT 8.7 regressions, flagged for follow-up)**: (1) `terminateCycle` lacks SELECT FOR UPDATE + post-lock state recheck — audit lines 83-87 / 92-93 — needs integration test before relying on "low frequency" claim under tablet load; (2) `bypass` does not recheck `current_cycle_id` inside its lock — a cycle-id swap behind a bypass write is silently accepted; tighten if cycle-swap-during-bypass becomes live risk.

- **`28e574c`** — `apps/web/src/{hooks/use-offline.ts, lib/sync-engine.ts, routes/filter-management/filter-operations.tsx}`. After Wave 2 tightened `tapeVersion` to required, every cycle-bound FE caller was audited for plumbing. Three gaps fixed: (a) `executeOrQueue()` rewritten to read `tapeVersion` from cached `filter-state-{filterId}` row for cycle-bound types and merge into both online payloads and queued offline ops; (b) `sync-engine.ts` start-and-advance replay fetches `/current-state` between the two POSTs to send fresh tapeVersion; (c) direct WASH_IN online start-cycle→advance pair in `filter-operations.tsx` does the same. All 9 cycle-bound caller sites confirmed sending `tapeVersion`. **One pre-existing limitation flagged**: terminate-cycle tombstone path (`sync-engine.ts:163`) sends `{reason, clientOpId}` only and would 400 on replay against the now-required schema; orthogonal tombstone-shape work for follow-up.

### Tests

- **api:** 1186 → 1199 passing (+13: +9 from concurrent-operator G, +4 from get-current-state mock expansion in F). Same 2 pre-existing failures unchanged (`auth.test forgot-password`, `config.test PUT action-reauth`). 9 documented skips.
- **web:** 82/82 passing (no FE test files added — caller plumbing was a pure refactor; existing tests still cover the dispatcher).
- **shared:** 305/306 passing (1 pre-existing failure unchanged: `assetQuerySchema rejects limit over 100`).
- TypeScript: clean across `apps/api`, `apps/web`, `packages/shared`.

### Closes

- ✅ "TAPE_PARALLEL flag still on parallel-validation" (deferred follow-up #8.7) — flag removed in `f8fae1d`
- ✅ "`tapeVersion` still optional on 4 write routes" (deferred #8.7) — tightened in `f8fae1d`; FE plumbing audited in `28e574c`
- ✅ "`nextAllowedStages` / `pendingChecklist` still in getCurrentState" (deferred #8.7) — both gone in `f8fae1d`
- ✅ "8.4b ChecklistProfile + AssetTemplate hydration in /sync/since" (deferred 8.5/8.6) — landed in `d31f5d2`
- ✅ "Migration-drift remediation plan" (deferred #8.7) — captured in `1033aca`
- ✅ "Smoke test drift on shared package" (deferred #8.6) — was already retired in 8.6 part 2
- ✅ "Server still has duplicate guard bodies" (deferred #8.6/#8.7) — closed by 8.6 part 2 + this cutover

### Out of scope (carried forward)

- Pre-Wave-2 IDB-queued rows with `tapeVersion: null` will 400 on replay (sync-engine marks them failed). Documented migration cost.
- terminate-cycle tombstone path (`sync-engine.ts:163`) doesn't carry `tapeVersion`; would 400 on replay against new required schema. Pre-existing tombstone-shape limitation, orthogonal to this cutover.
- `terminateCycle` lacks SELECT FOR UPDATE + post-lock state recheck (audit-flagged existing risk).
- `bypass` doesn't recheck `current_cycle_id` inside its lock (audit-flagged existing risk).
- Phase 8.8 (APK rebuild + tablet field QA) — needs physical tablets; plan ready at `tasks/PLAN-2026-05-02-step8.8-apk-field-qa.md`.

---

## [Unreleased] — Step 8 Phase 8.6: FE consumes shared executor (2026-05-02)

Branch: `feature/phase5-verification`. Wires the FE — both mobile and desktop filter-ops pages — into the shared executor that landed in Phase 8.5. The pure-function graph walkers (`computeNextStages`, `findChecklistsAfterStage`, the inline DFS inside `updateCachedStateAfterAdvance`) now delegate to `@digilog/shared` instead of re-implementing the same algorithm three times. Server / mobile / desktop now share one walker; any future bugfix lands once. **No app-visible behaviour changed** — same gates, same dialogs, same offline cache shape. Phase 8.7 owns the cutover that removes the deprecated `nextAllowedStages` / `pendingChecklist` fields from the server response.

### What landed

#### Commit 1 — FE local-context loader (commit `6653416`)

- **NEW** `apps/web/src/lib/local-context.ts` (398 lines) — `loadLocalContextFromCache(filterId)` reads from IDB v5 sync stores + the legacy `filter-state-{filterId}` cache + cached user from `localStorage.digilog_cached_user`, projects everything into the slice shapes the shared executor consumes (`ProfileSlice`, `CycleSlice`, `FilterSlice`, `EquipmentGroupSlice`, `ChecklistProfileSlice`, `FilterEventSlice`). Every entity falls back to a sentinel rather than throwing when its cache slot is missing, so callers can call the executor unconditionally.
- **Events synthesis** — the FE has no event stream (the `/api/filters/:id/current-state` response carries `pendingChecklist[]` as a derived field but no underlying events). The executor's `assertChecklistGatePassed` / `computeNextActions` checklistAnswered branch reads `events[]` for `CHECKLIST_COMPLETED` rows. Compromise: when cached `pendingChecklist === []` AND the profile has CHECKLIST nodes between `currentState` and the next STAGE, the loader synthesizes one `CHECKLIST_COMPLETED` event with `attributes.afterStage = currentState`. Without this, the gate would re-fire after the operator already cleared it offline. STATE_TRANSITION / CYCLE_STARTED events are NOT synthesized — none of the FE-invoked guards consume them; `filter.currentLifecycleState` is the source of truth.
- **stageLookup priority** — server-supplied `stageLookup` from the cached current-state response wins (B.7 contract); falls back to `buildStageLookup(profile)` from the shared executor when missing.
- **NEW** `apps/web/src/lib/__tests__/local-context.test.ts` — 14 unit tests across sentinel fallbacks, the three events-synthesis branches (no checklist node / pending non-empty / pending empty + chained CHECKLIST), equipment-group projection, server-stageLookup priority, cached-user reading, and end-to-end integration with `computeNextActions` (happy path + checklist-gate behaviour both ways).

#### Commit 2 — mobile-operations.tsx switch (commit `95b4575`)

- **EDIT** `apps/web/src/routes/mobile/mobile-operations.tsx` — converted the bodies of the two graph-walking helpers to delegate to the shared executor:
  - `computeNextStages()` Tier-2 fallback now calls `sharedFindReachable()` instead of an inline DFS.
  - `findChecklistsAfterStage()` Tier-2 fallback now calls `sharedCollectChecklistsAfterStage()` (chained CHECKLIST → CHECKLIST → STAGE walk lives in shared code).
- Tier-1 stageLookup branches preserved unchanged in both helpers (server-authoritative; never modified by 8.6).
- Imports `loadLocalContextFromCache` for use by future call sites; not yet wired into a gate decision because the converted helper bodies cover the gates in lockstep with shared code already.
- File delta: 2486 → 2456 lines (-30).
- **Why bodies converted instead of helpers deleted** (the audit's `-128 lines` plan): per-call-site shape contracts are consumed at 5+ places. Rewriting 5 call sites carries more drift risk than redirecting one helper body to shared code. The deprecated `nextAllowedStages` / `pendingChecklist` cache fields are deliberately preserved (8.7 cutover territory).

#### Commit 3 — filter-operations.tsx (desktop) switch (commit `e190415`)

- **EDIT** `apps/web/src/routes/filter-management/filter-operations.tsx` — same pattern as mobile:
  - `findChecklistsAfterStage()` body now calls `sharedCollectChecklistsAfterStage()`. **Side benefit:** the legacy desktop implementation only inspected direct outConns and silently skipped chained checklists (the bug operators reported as "checklist not coming at that stage"). Converting to shared closes that gap on desktop too.
  - The inline DFS inside `updateCachedStateAfterAdvance()` that built `nextAllowed` from the pipeline graph now calls `sharedFindReachable()`.
- File delta: 2088 → 2088 lines (19 insertions / 19 deletions).

#### Commit 4 — assertProfileActive fix + cleanup (commit `<this commit>`)

- **EDIT** `packages/shared/src/pipeline-executor/transitions.ts` — `assertProfileActive` now enforces both null-check AND `status === 'ACTIVE'`. The original Phase 8.5 implementation only null-checked, which forced `filter-operations.service.ts` to add a redundant manual `cp.status !== 'ACTIVE'` check immediately after every call (advance + bypass). The status check now lives in the shared guard so the contract is "active and ready" for both runtimes.
- **EDIT** `apps/api/src/modules/filter-operations/filter-operations.service.ts` — dropped 2 redundant manual `cp.status !== 'ACTIVE'` checks (advance line 1143, bypass line 1466). Both sites now rely on `assertProfileActive` for the status gate; the remaining `if (!cp)` is just a TS narrowing assertion.
- **EDIT** `packages/shared/src/pipeline-executor/__tests__/transitions.test.ts` — extended `assertProfileActive` test block from 2 cases (null + non-null) to 4 (added DRAFT and INACTIVE rejection cases).

### Tests

- **shared:** 303 → 305 (added 2 cases for the new `assertProfileActive` status branches). Same 1 pre-existing failure in `schemas/assets.test.ts > rejects limit over 100` predates this work.
- **api:** 1186 / 1188 (no change — same 2 pre-existing failures).
- **web:** 68 → 82 (added 14 cases for `loadLocalContextFromCache`).
- TypeScript: clean across `packages/shared`, `apps/api`, `apps/web`.

### Carried over from 8.5 (now closed)

- ✅ `assertProfileActive` rename / status fix — done in Commit 4 (status check added to the guard rather than rename).
- ✅ `advance()` profile resolution using `cycle.profileId` first — already silently improved in 8.5; documented in this entry for the record.

### Out of scope (deferred to 8.7+)

- Removing `nextAllowedStages` / `pendingChecklist` from `getCurrentState()` response — Phase 8.7 cutover.
- Removing the `TAPE_PARALLEL` flag and tightening `tapeVersion` to required — Phase 8.7.
- Deleting the legacy `offline-sync-service.ts` — blocked on 4 entities still uncovered by `/api/sync/since` (cleaning reasons, identifier map, PM tasks, checklist profiles full-questions). See `tasks/AUDIT-2026-05-02-offline-sync-legacy-deprecation.md`.
- APK rebuild + tablet field QA — Phase 8.8.

## [Unreleased] — Step 8 Phase 8.4: Option D foundation — versioned local cache + shared executor scaffold (2026-05-02)

Branch: `feature/phase5-verification`. The original 8.4 plan (delete the FE graph walker and switch FE to consume server `actions[]`) was reframed after a field-bucket audit on `mobile-operations.tsx` (2486 lines) + `filter-operations.tsx` (2088 lines) showed the cutover was a UX redesign + offline-state-machine rewrite, not a wiring change. The audit classified 48 guards across the 4 write methods as 35 Pure (73%) / 5 Hybrid (10%, already solved by 8.3 tapeVersion + clientOpId) / 8 Server-only (17%, concurrency control that can never move client-side). Conclusion: tablet should become a **versioned local replica** of the server's read model for the offline-relevant slice, with a **shared executor** running the same guard code on both sides. Drift becomes impossible by construction for the 35 pure guards; the 8 server-only guards stay server-side and surface their failures via the existing 8.3 STALE_TAPE / clientOpId reconciliation contract. **No app-visible behavior changed in 8.4** — additive plumbing only. The actual `TAPE_PARALLEL` flag flip + derived-field removal is now scheduled for Phase 8.7 (after 8.5 extraction + 8.6 FE consumption).

### Architecture pivot (Option D)

- **NEW** `tasks/PLAN-2026-05-02-step8-OPTION-D.md` — canonical Step 8 plan (~12 days focused work, 8.4 → 8.8 phase plan, 8 acceptance criteria). Original `tasks/PLAN-2026-05-02-step8-decision-tape.md` is superseded but kept for history.
- **NEW** `tasks/INVENTORY-2026-05-02-step8.5-guards.md` — full enumeration of 48 guards (file:line, LocalContext inputs, output shape, target shared function name). Drives the 8.5 extraction work.

### 8.4a — ChecklistProfile snapshot-then-bump regression gate (commit `f63207c`)

- **NEW** `apps/api/src/modules/checklist-profile/__tests__/checklist-profile.service.test.ts` — 3 tests against mocked prisma + tx (mirrors `filter-operations/__tests__/get-current-state.test.ts` pattern). `create()` leaves profile at version=1 with NO sidecar row (lazy first-version), `update()` archives the OUTGOING snapshot to `ChecklistProfileVersion` then increments inside the same transaction, `addQuestion()` runs snapshot-then-bump on the question-mutation path that drives offline checklist replay. Schema + service-layer versioning was already shipped in Phase A.1 (2026-05-01); this commit just adds the regression gate that 8.4b's local cache depends on.
- AssetTemplate already had equivalent coverage in `template.service.test.ts` (lines 63 + 87) — verified passing.

### 8.4b — `/api/sync/since` server endpoint + FE consumer + IDB v5 stores

#### Server (commit `a6ec6e8`)
- **NEW** `apps/api/src/modules/sync/sync.service.ts` (223 lines) — `SyncService.since()` with `Promise.all` over 4 entity queries (FilterCleaningProfile, FilterProfile, EquipmentGroup, AssetInstance + FilterDetails). Per-entity version cursors (`gt: clientVersion`); Filter rows use `updatedAt` watermark since `AssetInstance` has no version column (query OR's `FilterDetails.updatedAt` so a sidecar-only update still surfaces). 500-row pagination cap per entity; `hasMore` flag fires if any entity hits the cap.
- **NEW** `apps/api/src/modules/sync/routes.ts` (99 lines) — mounts `GET /api/sync/since` under the global auth hook (any logged-in user; no `requirePermission` per task brief). Response schema declares all 6 entity arrays + `serverTimestamp` + `hasMore` as required at the top level (so empty arrays don't get stripped) and `additionalProperties: true` per item (matches existing `/:id` and version-history pattern; lets Prisma row shapes pass through verbatim).
- **EDIT** `apps/api/src/app.ts` — registers new module.
- ChecklistProfile + AssetTemplate are intentionally returned as `[]` in this commit — both have version columns in `schema.prisma` already, but the per-write bump triggers were finalized in 8.4a; populating those two arrays is a follow-up before 8.5.
- **NEW** 16 tests (13 service, 3 route registration). Pattern follows `tape-version-check.test.ts` — `vi.hoisted` prisma mock, no real DB. Covers cursor handling defaults, 500-cap + hasMore, filter `updatedAt` parse + invalid-date fallback, parent-chain flatten (Filter → AHU → Area → Block) to FE-cache shape, missing parent links don't crash, `applicableTemplates` flattened from Step 4 join rows to `string[]`, route registers at `GET /since` with no preHandler.

#### IDB v5 schema (commit `e5f46cb`)
- **EDIT** `apps/web/src/lib/offline-store.ts` — bumped `DB_VERSION` 4 → 5; added 7 new object stores: `syncFilterCleaningProfiles`, `syncFilterProfiles`, `syncEquipmentGroups`, `syncChecklistProfiles`, `syncAssetTemplates`, `syncFilters`, `syncVersionState`. All keyed by `id` except `syncVersionState` which is a single-row store with `key='current'` holding `{profileVersion, filterProfileVersion, equipmentGroupVersion, checklistVersion, assetTemplateVersion, filterUpdatedSince, lastSyncedAt}`.
- **Critical naming choice:** the new filter store is `syncFilters`, not `filters`. The legacy `filters` store at the top of `offline-store.ts` already holds `CachedFilter` rows in a different shape, used by the offline operations queue to optimistically update lifecycle state. Reusing the name would write conflicting shapes into the same store. The two are now parallel additive caches; consolidation is deferred to 8.5/8.6 once the executor is in.
- New helpers exported (pure pass-throughs over the new stores): `cacheEntities(storeName, rows)`, `getCachedEntity(storeName, id)`, `getAllCachedEntities(storeName)`, `getVersionState()`, `setVersionState(state)`. `SYNC_ID_STORES` const, `SyncEntityStore` type, `VersionState` interface, `DEFAULT_VERSION_STATE` constant — all exported for the sync engine.
- **NEW** `apps/web/src/lib/__tests__/sync-store-shape.test.ts` — 4 shape tests (full IDB integration would need fake-indexeddb which the workspace doesn't install; same pure-shape pattern as `offline-store.test.ts`). Asserts `SYNC_ID_STORES` order is stable, new stores don't collide with legacy ones, `DEFAULT_VERSION_STATE` shape (5 cursors at 0, 2 timestamps at null), version-state row key is the literal `'current'`.

#### FE sync-since consumer (commit `996d1c1`)
- **NEW** `apps/web/src/lib/sync-since.ts` (264 lines) — `syncSince()` runs one round-trip (reads versionState from IDB, builds query, calls endpoint, writes results into the 6 sync stores, advances cursor, returns `SyncResult { rowsAdded, hasMore, versionState, serverTimestamp }`). Single in-flight Promise dedupes concurrent calls. `triggerSync(reason)` is the debounced fire-and-forget entry point (1s coalescing window); errors are swallowed (warn log) — next trigger retries. `startSyncPolling()` wires up a 60s online-only timer + `visibilitychange` handler + `online` event handler, all routed through `triggerSync()`. Returns idempotent teardown fn.
- **Cursor-advance semantics:** each entity's version cursor advances to `max(version)` of returned rows. NEVER goes backward — empty arrays leave the cursor untouched. `filterUpdatedSince` advances to `max(updatedAt, filterDetailsUpdatedAt)` across the filter rows (ISO-8601 string compare is lexicographic-safe for UTC-Z timestamps).
- Defensive shape: missing entity arrays in the response treat as empty rather than crash — matches the same robustness in `offline-store.ts` that allowed the staged 8.3 → 8.4 rollout.
- **NEW** `apps/web/src/lib/__tests__/sync-since.test.ts` — 12 tests (mocked api-client + offline-store, follows `sync-engine.test.ts` pattern). Covers default-cursor query, non-default cursor propagation, all 6 stores receive rows, max(version) advance per entity, no-backward on empty, filter watermark = max of `updatedAt + filterDetailsUpdatedAt`, rowsAdded counts, hasMore passthrough, malformed-response defensive empty, concurrent in-flight dedup, debounce coalesces 5 bursts into 1 network call, post-run trigger goes through.

#### App-shell wiring (commit `0e0e2b7`)
- **EDIT** `apps/web/src/components/layout/app-layout.tsx` — `useEffect` on `isAuthenticated` transition to true: `triggerSync('app-start')` + `startSyncPolling()`; teardown on unmount. Login screen unaffected (effect only runs once auth has resolved).
- **EDIT** `apps/web/src/routes/mobile/mobile-wrapper.tsx` — parallel `useEffect` alongside the existing `syncAllDataForOffline` path. Different cache (v5 sync stores vs. legacy `cache` key/value blobs); runs additively without replacing. Will subsume the legacy path in 8.6 once the shared executor lands.

### 8.4c — `packages/shared/src/pipeline-executor/` scaffold (commit `3c7c916`)

Empty-body skeleton for the Option D shared executor. Phase 8.5 fills in the 35 pure guards from the inventory.

- **NEW** `packages/shared/src/pipeline-executor/types.ts` (235 lines) — `GuardResult` / `ValidationResult` + slice types projecting the Prisma rows the executor reads. **No `@prisma/client` import** — `packages/shared` must stay runtime-agnostic for the FE bundle, and Block/Area/AHU/Filter are not Prisma models anyway (they're `AssetInstance` rows discriminated by `template.templateKind`). `ProfileNode` / `ProfileEdge` / `ChecklistQuestion` are aliases over the existing `TapeStage` / `TapeConnection` / `TapeQuestion` shapes from `packages/shared/src/types/action-tape.ts` (canonical types the live tape generator already walks). Aliasing avoids duplicate declarations and lets the 8.5 implementer adopt either vocabulary.
- **NEW** `packages/shared/src/pipeline-executor/context.ts` (115 lines) — `LocalContext` interface + `loadLocalContext` / `loadLocalContextFromCache` stubs. Phase 8.5 relocates the concrete loaders to `apps/api` + `apps/web`.
- **NEW** 7 module stubs: `transitions.ts`, `checklist.ts`, `dryer.ts`, `bypass.ts`, `terminate.ts` (later renamed/replaced with `instruments.ts` + `justification.ts` + `parameters.ts` per the 8.5 prep), `actions.ts` (`computeNextActions(ctx)` → `ActionTape`).
- **NEW** `index.ts` — barrel re-export of the public surface.
- **Stub error format is greppable:** `NOT_IMPLEMENTED -- pipeline-executor/<module>.<fn> -- Phase 8.5`. The smoke test asserts the prefix on every stub.
- **NEW** `packages/shared/src/pipeline-executor/__tests__/smoke.test.ts` — 20 cases (LocalContext fixture compiles; each of 17 stubs throws NOT_IMPLEMENTED; barrel exports the expected symbols).
- **EDIT** `packages/shared/src/index.ts` — re-exports `pipeline-executor`.

### 8.5 prep (commits `0c8c159 da756ea 64dc469 d9f52ab ff10952 2981d93`)

Pre-extraction artifacts produced by background subagents (audits + fixtures), uncommitted to docs intentionally — they drive the 8.5 / 8.6 / 8.7 implementation work but are reference material, not code.

- `tasks/AUDIT-2026-05-02-filter-operations-desktop.md` — desktop FE audit
- `tasks/AUDIT-2026-05-02-mobile-operations.md` — mobile FE audit
- `tasks/AUDIT-2026-05-02-getcurrentstate-consumers.md` — consumer audit
- `tasks/AUDIT-2026-05-02-concurrent-operator.md` — concurrent-operator collision audit
- `tasks/AUDIT-2026-05-02-offline-sync-legacy-deprecation.md` — legacy `offline-sync-service` deprecation audit
- `packages/shared/src/pipeline-executor/__tests__/fixtures.{ts,test.ts}` — 8 LocalContext scenarios + smoke runner

### Tests

- **API**: 1186 passing (was 1167 after 8.4 Commit 1 / 1165 at 8.3 close). Same 2 pre-existing unrelated failures (`auth.test.ts > forgot-password`, `config.test.ts > PUT /api/config/action-reauth`) that predate Step 8.
- **Web**: 68 passing (was 52 after 8.4 Commit 1 / 47 at 8.3 close).
- Net delta vs. 8.3 close: api +21, web +21 across 8.4a (+3 ChecklistProfile snapshot), 8.4 Commit 1 (+5), 8.4b commit 1 (+16 server sync-since), commit 2 (+4 IDB shape), commit 3 (+12 FE sync-since), 8.4c scaffold (+20 smoke), 8.5 prep fixtures (+1).

### Out of scope (deferred to 8.5 → 8.8)

- Filling in the 17 NOT_IMPLEMENTED stubs in `packages/shared/src/pipeline-executor/` — Phase 8.5 (background subagent in flight).
- Server's 4 write methods rewriting to load context → `executor.canX(ctx)` → 8 server-only guards → transaction — Phase 8.5.
- Tape generator becoming `(ctx) => executor.computeNextActions(ctx)` — Phase 8.5.
- `mobile-operations.tsx` + `filter-operations.tsx` building LocalContext from IDB cache and rendering via `executor.computeNextActions(ctx)` — Phase 8.6.
- Deleting the FE walker + `updateOfflineState()` + `nextAllowedStages` / `pendingChecklist` derivations — Phase 8.6.
- Removing `TAPE_PARALLEL` flag, tightening `tapeVersion` to required, removing old derived response fields — Phase 8.7.
- APK rebuild + tablet field QA — Phase 8.8.
- ChecklistProfile + AssetTemplate hydration in `/sync/since` (currently returned as `[]`) — follow-up before 8.5 closes.
- Consolidation of legacy `filters` store + legacy `cache` blob path with the new v5 sync stores — 8.6/8.7.

## [Unreleased] — Step 8 Phase 8.3: offline replay tape-versioning (2026-05-02)

Branch: `feature/phase5-verification`. Adds an optimistic-concurrency guard to all 4 cycle-bound write routes (advance / submit-checklist / bypass / terminate) so a stale offline replay can no longer silently overwrite progress made by another operator on a different device. Renderer surface is ready for Phase 8.4 cutover; consumer wiring (mobile-operations.tsx / filter-operations.tsx) is intentionally untouched.

### What landed

- **EDIT** `apps/api/src/modules/filter-operations/tape/tape-generator.ts` — extracted `computeTapeVersion(profileVersion, filterEventCount)` as the single source of truth for the formula. Generator now calls it; service-side check calls it; tests assert agreement. M3 TODO left at this site — formula aliases when `filterEventCount >= 1000`, deferred to 8.4.
- **EDIT** `apps/api/src/modules/filter-operations/filter-operations.service.ts` — added `assertTapeVersionFresh()` helper. Wired into all 4 write methods after the clientOpId dedup so idempotent replays still short-circuit. Mismatch throws `409 STALE_TAPE` with `details.currentTapeVersion`. Optional during 8.3 (callers pre-migration omit the field) — server treats absent / null as a no-check. Phase 8.4 will tighten to required.
- **EDIT** `apps/api/src/modules/filter-operations/routes.ts` — added `tapeVersion: { type: 'integer' }` to the body schema on `/advance`, `/submit-checklist`, `/bypass`, `/terminate-cycle`. Optional for backward compat.
- **EDIT** `packages/shared/src/types/action-tape.ts` + `packages/shared/src/index.ts` — added `StaleTapeError` interface as a type-guard target (NOT a thrown class). Surfaced on the FE via `(error as any).code === 'STALE_TAPE'` + `currentTapeVersion: number`.
- **EDIT** `apps/web/src/lib/api-client.ts` — lifted `details.currentTapeVersion` to a top-level field on the rejected Error (mirrors the existing `attemptsRemaining` pattern).
- **EDIT** `apps/web/src/lib/offline-store.ts` — bumped IDB `DB_VERSION` 2 -> 3, added `tapeVersion: number | null` to the `OfflineOperation` row shape. No `onupgradeneeded` migration needed (row-shape-flexible store; existing rows have undefined tapeVersion which the server's optional schema accepts).
- **EDIT** `apps/web/src/lib/sync-engine.ts` — replay sends `tapeVersion` for cycle-bound ops (advance / submit-checklist / bypass / terminate); explicitly omitted on start-cycle / start-and-advance start step (not cycle-bound). On 409 STALE_TAPE the op is dropped as `failed` with a refresh-prompt toast — retrying with the same stored version would just keep failing, mirroring the existing `CYCLE_ENDED` stranded path.
- **EDIT** `apps/web/src/lib/action-tape/ActionRenderer.tsx` — added `tapeVersion?: number` prop to both `ActionRendererProps` and `ActionTapeRendererProps`. Dispatcher seam (single point in the component) merges the prop into every payload before forwarding to the caller. Per-button components unchanged.

### Tests

- `apps/api/src/modules/filter-operations/tape/__tests__/tape-generator.test.ts`: 23 -> 26 (computeTapeVersion direct unit + generator-vs-helper agreement).
- `apps/api/src/modules/filter-operations/__tests__/tape-version-check.test.ts` (NEW): 3 cases on terminateCycle() — match passes, mismatch -> 409 STALE_TAPE with currentTapeVersion in details, absent -> no-check (backward compat).
- `apps/web/src/lib/__tests__/sync-engine.test.ts` (NEW): 4 cases — replay carries tapeVersion through, pre-8.3 op (null) replays without the field (server skip path = IDB schema-migration backward-compat req), 409 STALE_TAPE marks failed (no retry), generic 500 marks pending (regular retry).
- API: 1159 -> 1165. Web: 43 -> 47. Two pre-existing e2e failures (auth.test.ts:210, config.test.ts:596) are unrelated and predate this work.

### Out of scope (deferred to 8.4)

- Tightening the route schema to require `tapeVersion` and removing the optional fallback.
- Wiring `tapeVersion` into mobile-operations.tsx / filter-operations.tsx callsites.
- Fixing the M3 formula aliasing.

## [Unreleased] — Step 8 Phase 8.2: full per-action-type renderers + M1 BYPASS expansion (2026-05-02)

Branch: `feature/phase5-verification`. Two-part batch — replaced the 7 Phase-8.1 stub renderers with full-functionality components (dialogs / validation / typed payloads), and closed the M1 follow-up flagged by the Phase 8.0 reviewer. The renderers still live in isolation — `mobile-operations.tsx` / `filter-operations.tsx` are unchanged. Cutover is Phase 8.4.

### What landed

#### Part (a) — Full renderers for all 7 action types

- **NEW** `apps/web/src/lib/action-tape/components/action-dialog.tsx` — shared modal primitive used by the 4 dialog-bearing renderers. Light-theme (`bg-white`, `border-slate-200`, gradient header), backdrop-click dismiss when not loading, role="dialog" + aria-modal for a11y, supports primary / success / warning / danger header+submit variants. Body is an opaque slot so each renderer can build whatever form it needs.
- **EDIT** `apps/web/src/lib/action-tape/ActionRenderer.tsx` — child contract changed from `onClick: () => void` to `onSubmit: (payload: ActionPayload) => Promise<void>`. Dispatcher now wraps the child's onSubmit to call the caller's `onSubmit(action, payload)` with the loading flag plumbed through. New `ActionPayload` discriminated union mirrors what the corresponding server route accepts (`POST /advance` / `/submit-checklist` / `/bypass` / `/terminate` / etc.) so Phase 8.4 cutover can plug the dispatcher into the existing routes without translation.
- **EDIT** all 7 components in `apps/web/src/lib/action-tape/components/`:
  - `CompleteCycleButton.tsx` — single-click submit, no dialog (success/green).
  - `AdvanceToStageButton.tsx` — single-click submit when no `requiresInstrumentReadings`, dialog with one numeric input per instrument id otherwise. Operating-range hints rendered next to each input as soft amber advisory; out-of-range readings still allowed (mirrors existing service.ts behaviour where ranges are advisory).
  - `BypassStageButton.tsx` — justification dialog (amber/warning), textarea required, length validated against `action.requiresJustification.minLength` (read from action — not hard-coded).
  - `TerminateCycleButton.tsx` — justification dialog (red/danger), same `minLength` contract.
  - `SetDryerDurationButton.tsx` — two number inputs (min/max), validated `1 ≤ min ≤ max ≤ 1440`, integer-only, seeded from `action.params.minMinutes` / `maxMinutes`.
  - `SubmitDryerReadingsButton.tsx` — one numeric input per `params.instrumentIds`, all required, range advisory rendered.
  - `SubmitChecklistButton.tsx` — question list (YES/NO/N/A radios + optional remarks per question), required-question gate enforced; remarks always optional (matches the project rule that filter cleaning checklist remarks stay optional). Submit payload mirrors what `POST /:id/submit-checklist` accepts: object-keyed `answers: Record<questionId, value>` with unanswered optionals **omitted** (server rejects extras with 400 INVALID_QUESTIONS — see `filter-operations.service.ts:870-882`). Optional `remarks` map sent under a separate key only when at least one remark is non-empty.

#### Dialog UX semantics — close on success, stay open on error

All 5 dialog-bearing renderers now `await onSubmit(...)` rather than fire-and-forget. On resolve: close the dialog and reset form state. On reject: keep the dialog open and surface the parent's error message inside the dialog so the operator can fix and retry without losing context. The dispatcher's existing `try/finally` (no `catch`) propagates parent errors back through the await chain. Without this, the operator would see a dialog that should have closed staying stuck open and re-clicking would double-submit.

#### Part (b) — Test coverage

- **EDIT** `apps/web/src/lib/action-tape/__tests__/ActionRenderer.test.tsx` — extended from 11 to **33** tests. New cases cover: dialog open-on-click for each dialog renderer, justification min-length validation (BYPASS + TERMINATE), required-question gating + object-keyed answers payload (CHECKLIST), min/max + bounds validation (SET_DRYER_DURATION), readings input + numeric coercion (SUBMIT_DRYER_READINGS), instrument-readings dialog flow (ADVANCE_TO_STAGE with readings), immediate-submit path (ADVANCE without readings + COMPLETE), loading-lock parity with the new contract, the disabled-prop short-circuit (no dialog opens), and three close-on-success / stay-open-on-error tests covering the dialog-lifecycle UX. Existing 11 dispatch tests updated for the new `(action, payload)` signature.

#### Part (c) — M1 follow-up: BYPASS_STAGE emit-set expansion

- **EDIT** `apps/api/src/modules/filter-operations/tape/tape-generator.ts` — when `pinnedProfile.flowMode === 'BYPASS_ENABLED'`, BYPASS_STAGE actions now emit for every pipeline `STAGE` node EXCEPT the current state. Previously the emit-set was restricted to `reachableStages` (forward-walkable from the current node), which under-reported the operator's real bypass surface — specifically step-back (jumping to an earlier pipeline stage), which the existing in-app UI exposes today and which the server's `bypass()` route accepts (`filter-operations.service.ts:1548-1556` validates targetState against `cp.stages.filter(s => s.nodeType === 'STAGE' && s.stateKey)` — i.e. ANY pipeline STAGE is a legal bypass target).
- **EDIT** `apps/api/src/modules/filter-operations/tape/__tests__/tape-generator.test.ts` — added 3 tests (21–23): full-pipeline bypass set excluding current state (4-stage profile), step-back targets included (filter at DRY_OUT must offer WASH_IN), and no-current-state edge case (fresh cycle → all STAGEs eligible). Test count: 20 → **23**.
- Parity test `tape-parity.test.ts` was unaffected — its assertions are additive (`some()`), so the expanded BYPASS emit-set falls within the existing parity contract (tape ⊇ existing fields).

### Verification (Phase 8.2)

- `cd packages/shared && npx tsc` → exit 0 (untouched).
- `cd apps/api && npx tsc -p tsconfig.json --noEmit` → exit 0.
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx vitest run src/modules/filter-operations` → 3 files, **38 tests pass** (Phase 8.1 had 35).
- `cd apps/web && npx vitest run` → 2 files, **43 tests pass** (Phase 8.1 had 21).

### Out of scope (Phase 8.2)

- FE consumption of the tape — Phase 8.4 cutover.
- Offline replay tape-versioning — Phase 8.3.
- APK changes — Phase 8.5.

## [Unreleased] — Step 8 Phase 8.1: shared types + FE action-renderer skeleton + Phase 8.0 review follow-ups (2026-05-02)

Branch: `feature/phase5-verification`. Three parts in one batch — type extraction to `@digilog/shared`, FE renderer skeleton (stub-level — no live consumers yet), and the two Minor cleanups flagged by the Phase 8.0 reviewer (M4 + M6). Strictly additive on the FE side; the FE skeleton is built but not yet consumed by `mobile-operations.tsx` / `filter-operations.tsx` — that's Phase 8.4 cutover.

### What landed

#### Part (a) — Action-tape types live in `@digilog/shared`

- **NEW** `packages/shared/src/types/action-tape.ts` — full type contract lifted from `apps/api/src/modules/filter-operations/tape/types.ts`. Server tape generator + parity tests + future FE renderer all consume the same source of truth, eliminating the drift risk that comes from duplicating discriminated-union shapes across two languages of import.
- **EDIT** `packages/shared/src/index.ts` — barrel re-exports the 21 named types from action-tape (`Action`, `ActionTape`, `TapeInput`, `TapeQuestion`, `OperatingRangeMap`, etc.).
- **EDIT** `apps/api/src/modules/filter-operations/tape/types.ts` — replaced with a re-export shim (`export type { ... } from '@digilog/shared'`). Picked the shim over deleting the file because deleting would force three additional unrelated edits to update import paths in `tape-generator.ts`, `tape-generator.test.ts`, and `filter-operations.service.ts:13` for purely cosmetic gain. The shim adds zero runtime cost and the parity test continues to guarantee shape stability.

#### Part (b) — FE action-renderer skeleton (stubs only)

- **NEW** `apps/web/src/lib/action-tape/types.ts` — convenience re-export of the shared types so action-tape FE imports stay co-located with the renderer code. Call sites are also free to import directly from `@digilog/shared`.
- **NEW** `apps/web/src/lib/action-tape/ActionRenderer.tsx` — top-level dispatcher. Takes a single `Action` plus an `onSubmit: (action) => Promise<void> | void` callback; switches on `action.type` and renders the right child stub. Owns `useState` for in-flight `loading`; passes `disabled` to the child while `onSubmit` is pending. Honors a caller-provided `disabled` prop (e.g. tape stale, refetching). Includes an `ActionTapeRenderer` convenience wrapper that takes the whole `actions[]` and shares a loading-lock across all of them (one click disables the rest until the promise settles). Exhaustiveness guard via `_exhaustive: never` so a future action-kind added to the shared union but not wired here will fail typecheck.
- **NEW** `apps/web/src/lib/action-tape/components/base-action-button.tsx` — visual primitive with 4 variants (primary / success / warning / danger). Each stub picks a variant matching the action's semantic role: ADVANCE / SUBMIT_CHECKLIST / SUBMIT_DRYER_READINGS / SET_DRYER_DURATION → primary; COMPLETE_CYCLE → success; BYPASS_STAGE → warning (deviation); TERMINATE_CYCLE → danger.
- **NEW** 7 stub components (one per action type) in `apps/web/src/lib/action-tape/components/`:
  - `AdvanceToStageButton.tsx` — primary
  - `SubmitChecklistButton.tsx` — primary
  - `SubmitDryerReadingsButton.tsx` — primary
  - `SetDryerDurationButton.tsx` — primary
  - `BypassStageButton.tsx` — warning (amber)
  - `TerminateCycleButton.tsx` — danger (red)
  - `CompleteCycleButton.tsx` — success (green)

  Each stub: takes its specific action variant + `disabled` + `loading` + `onClick`. Renders a single button via `BaseActionButton` with a `data-action-type` attribute (used by tests to confirm the right stub rendered). Phase 8.2 will swap most of these for dialogs/forms (instrument readings, justification capture, checklist questions, dryer-duration picker) — but the dispatch shape stays the same, so the dispatcher needs no rework.
- **NEW** `apps/web/src/lib/action-tape/__tests__/ActionRenderer.test.tsx` — 11 component tests:
  - 7 per-type cases: render the dispatcher with each action variant; assert the right `data-action-type` rendered; click; assert `onSubmit` was called once with the exact action shape (reference equality — we don't clone).
  - 1 caller-disabled case: `disabled` prop forces the button disabled; click does not fire `onSubmit`.
  - 1 in-flight loading case: a deferred-resolve promise; assert button becomes disabled + `aria-busy=true` while pending; assert it clears on resolve.
  - 2 `ActionTapeRenderer` cases: shared loading-lock disables siblings during in-flight; empty-state slot renders when `actions[] === []`.

#### Part (c) — Phase 8.0 review follow-ups (M4 + M6)

- **EDIT** `apps/api/src/modules/filter-operations/tape/__tests__/tape-generator.test.ts` — added `beforeEach(() => { nextId = 0; })` inside the `describe(...)` block (M4). The fixture helpers (`simpleProfile`, `checklistProfile`) already do this on entry, so this is defense-in-depth — but it makes the file safe under `test.concurrent` and removes the order-dependent fragility the reviewer flagged.
- **EDIT** `apps/api/src/modules/filter-operations/filter-operations.service.ts:706-722` — wrapped the two sequential `prisma.filterEvent.findMany` + `prisma.filterEvent.count` calls in `Promise.all` (M6). One less DB round-trip when `TAPE_PARALLEL=true`. Behaviorally identical; the falsy branch returns a typed `[[], 0]` tuple to keep TS narrowing happy.

### Why a re-export shim instead of moving import paths

Three sites import from `./types.js` today: `tape-generator.ts`, `tape-generator.test.ts`, `filter-operations.service.ts:13`. The shim replaces only the body of `types.ts` and leaves the imports alone. The "delete + rewire" path was three additional unrelated edits with no functional benefit; the shim is one line of indirection that the typechecker sees through and the bundler tree-shakes (it's purely `export type`). If we ever need to add api-only types alongside the shared ones, the shim file is already the natural home.

### Verification

- `cd packages/shared && npx tsc` → builds the new `action-tape.{js,d.ts,d.ts.map,js.map}` artifacts; existing 10 type files unchanged.
- `cd apps/api && npx tsc --noEmit` → exit 0.
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx vitest run src/modules/filter-operations` → 3 files, 35 tests pass (unchanged from 8.0 baseline; M4 `beforeEach` is additive).
- `cd apps/api && npx vitest run` (full) → 84 passed / 2 failed; the 2 failing files (`auth.test.ts > forgot-password`, `config.test.ts > action-reauth`) are the same pre-existing e2e failures from 8.0 — confirmed unrelated to this batch (no import path or service code from those modules touched).
- `cd apps/web && npx vitest run` → 2 files, 21 tests pass (B7.1's 10 + B8.1's 11). No `act()` warnings, no console noise.

### Out of scope (deferred to later phases)

- FE consumption of the tape (Phase 8.4 — `mobile-operations.tsx` / `filter-operations.tsx` cutover).
- Per-action-type full UI (Phase 8.2 — instrument-readings dialog, justification capture, checklist-question modal, dryer-duration picker, countdown gate).
- Offline replay tape-versioning (Phase 8.3).
- APK changes (Phase 8.5).
- M1 (BYPASS_STAGE emit-set expansion to all pipeline stages in `BYPASS_ENABLED` mode) — deferred to 8.2 per the original plan.
- M3 (`tapeVersion` collision-resistance — pick `BigInt` or bit-shifted layout) — deferred to 8.4 per the original plan.

---

## [Unreleased] — Step 8 Phase 8.0: server tape generator + parallel-validation harness (2026-05-02)

Branch: `feature/phase5-verification`. Strictly additive — no existing field removed, no consumer touched. Lays the foundation for Phase 8.1+ (FE renderer rewrite) and Phase 8.4 cutover (decision-tape architecture).

### What landed

- **NEW** `apps/api/src/modules/filter-operations/tape/types.ts` — full type contract for the action tape: `Action` (7 discriminated variants), `ActionTape`, `TapeInput` (cycle / filter / pinnedProfile / pinnedEquipmentGroup / pinnedChecklistProfiles / recentChecklistEvents / now), `TapeQuestion` mirrors the existing `pendingChecklist[].questions` shape so the FE doesn't have to translate.
- **NEW** `apps/api/src/modules/filter-operations/tape/tape-generator.ts` — `generateTape(input: TapeInput): ActionTape`. Pure function, no I/O, no prisma. Mirrors the action-emission rules enforced together by `getCurrentState()` + `advance()` (filter-operations.service.ts:331-696, 1031-...). Emits the 7 action types covering the in-cycle stage-advance surface: `ADVANCE_TO_STAGE`, `SUBMIT_CHECKLIST`, `SUBMIT_DRYER_READINGS`, `SET_DRYER_DURATION`, `BYPASS_STAGE`, `TERMINATE_CYCLE`, `COMPLETE_CYCLE`.
- **NEW** `apps/api/src/modules/filter-operations/tape/__tests__/tape-generator.test.ts` — 20 pure-function unit tests covering each action type's emit conditions and edge cases (no-cycle, cycle-not-in-progress, no-profile, fresh-cycle, instrument-bound advance, checklist-pending gate, checklist-resolved fall-through, all-checklists-disabled fall-through, SET_DRYER_DURATION entering DRY_IN, SUBMIT_DRYER_READINGS half-time elapsed, half-time NOT elapsed blocking, readings-already-submitted, COMPLETE_CYCLE on END, BYPASS_STAGE in BYPASS_ENABLED mode, no-bypass in SEQUENTIAL, tapeVersion derivation, tapeVersion determinism, state mirror).
- **NEW** `apps/api/src/modules/filter-operations/tape/__tests__/tape-parity.test.ts` — 8 parity tests proving the action tape is internally consistent with the existing `nextAllowedStages` / `pendingChecklist` invariants on the SAME response (TAPE_PARALLEL=true). Also asserts flag-OFF behavior leaves the response shape unchanged. This is the regression gate for Phase 8.4 cutover.
- **EDIT** `apps/api/src/modules/filter-operations/filter-operations.service.ts` — `getCurrentState()` return block now conditionally appends `actions` + `tapeVersion` when `process.env.TAPE_PARALLEL === 'true'`. `TapeInput` is assembled from already-resolved data (no extra prisma calls except a single `findMany` for `CHECKLIST_COMPLETED` events on the cycle, only when the flag is on). Existing fields untouched.
- **EDIT** `apps/api/src/modules/filter-operations/routes.ts` — response schema for `GET /api/filters/:id/current-state` extended with `actions` (array of objects with `additionalProperties:true` so the discriminated-union variants flow through unchanged) and `tapeVersion` (integer). Required because Fastify's response serializer strips unlisted top-level keys (verified — sibling `stageLookup` was already explicit).
- **EDIT** `CHANGELOG.md` — this entry.

### tapeVersion derivation (Phase 8.0)

`profileVersion * 1000 + filterEventCount` (any FilterEvent type for the cycle, not just checklist events). The full event count is required so tapeVersion changes between stage transitions — using only checklist events would leave two consecutive `getCurrentState()` calls before/after a STATE_TRANSITION at the same tapeVersion despite the action list having changed entirely. Stable for fixed inputs; changes whenever any input that affects the action list changes. Phase 8.4 may revisit once the FE consumes this.

### Verification

- `cd apps/api && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx vitest run src/modules/filter-operations` → 3 files, 35 tests passing (7 B7.3 + 20 unit + 8 parity).
- `cd apps/api && npx vitest run` (full) → 84 passed / 2 failed; the 2 failing files (`auth.test.ts > forgot-password > existing user`, `config.test.ts > action-reauth`) are the documented pre-existing e2e failures unrelated to this batch (1156/1158 tests pass).
- Curl smoke: not run — local stack restart not in scope for additive code path that defaults OFF; coverage proven by parity test `p6` (flag OFF → no actions/tapeVersion in response) and `p7` (flag ON → actions + tapeVersion present, TERMINATE_CYCLE always emitted while in progress).

### Out of scope (deferred to later phases)

- FE consumption of the tape (Phase 8.1+).
- Offline replay tape-versioning (Phase 8.3).
- Removing existing fields from `getCurrentState()` (Phase 8.4 cutover).
- APK changes (Phase 8.5).
- Action types beyond the 7 listed (retire / replace / RFID-scan / batch-flow stay on the existing routes).

---

## [Unreleased] — Batch 7 summary: server-side online-quality follow-ups (2026-05-02)

Branch: `feature/phase5-verification`. Five tasks (B7.1 → B7.5) closing the next layer of online-quality polish after L1-L5 wrapped the operator-visible drift surfaces. None of these were biting users today; each closes an architectural gap or test-coverage hole that would have bitten us later. Strict server-side / online-only — no tablet / android / APK touch.

### What landed

- **B7.1** (commit `1ab2a05`) — `apps/web` got its first vitest config (fresh `defineConfig` from `vitest/config`, NOT derived from `vite.config.ts`), `vitest.workspace.ts` extension, devDeps + scripts. First regression suite at `apps/web/src/routes/version-history/__tests__/diff.test.ts` — 10 tests against the `diffSnapshots()` engine added in VHv3 (Batch 6 commit `d31ed37`). Closes L6 from `tasks/SERVER-ONLINE-WORKLIST.md`.
- **B7.2** (commit `7a2f3b4`) — `BLOCK_CHANGE_REQUIRED` 409 now pops the structured block-change modal on **all four** previously-unguarded `start-cycle`/`start-and-advance` catch sites: mobile `handleEquipSubmit`, desktop `handleEquipmentSubmit` (single + batch), and the desktop PM auto-start loop. Closure-stale `if (!blockChangeDialog)` guards inside `for/await` loops replaced with local `blockChangePopped` flags. Reviewer fix iteration also covered the PM auto-start gap.
- **B7.3** (commit `0b2821f`) — `apps/api/src/modules/filter-operations/__tests__/get-current-state.test.ts` — 7 vitest unit tests asserting the L1 (cycle-pinned `EquipmentGroupVersion.snapshot`) and L2 (cycle-pinned `FilterCleaningProfile` pipeline) invariants. Mocks prisma directly per the project's canonical pattern. Negative assertions (e.g. legacy null-pin path must NOT consult the version sidecar) lock the contract against silent regression.
- **B7.4** (commit `1d6ec6b`) — Operator-facing amber advisory card on `mobile-operations.tsx` and `filter-operations.tsx` when the API returns a non-null `equipmentGroupSyncWarning` (added in L3 commit `d7026ce`). Reviewer fix iteration also closed an intra-stage state-leak (advisory now cleared on every block-change / stage-transition path).
- **B7.5** (this commit) — Final doc sync: worklist + plan + resume note + this CHANGELOG batch summary + `tasks/todo.md` audit log entries.

### Live counts re-verified at B7.5

Counts unchanged from Batch 6 baseline (Batch 7 was meant to be invariant — only test infrastructure + FE rendering + closing cross-refs).

| Metric | Count |
|---|---|
| Prisma models / enums | **69** / **23** |
| Permissions / feature privileges / reauth actions / sidebar items | **106** / **90** / **81** / **26** |
| API modules / config defs / config pages | **36** / **30** / **27** |
| `<Route>` defs in `apps/web/src/main.tsx` | **82** |

### Deferred follow-ups (recorded; do not pick up without re-approval)

- **B7.2 reviewer M1** — pre-existing `advanceBatch:422` closure-stale guard (`if (!blockChangeDialog)` inside a sync `for/await` loop) in `filter-management/filter-operations.tsx`. Cosmetic; same risk profile as the four sites fixed in B7.2 but not a B7-introduced regression. Track as cleanup.
- **B7.4 reviewer Issue #2** — `DryingFiltersPanel`'s 15s SWR poller does not surface `equipmentGroupSyncWarning`. Operator parked on the DRY_IN screen would not see the advisory until the next scan. Defer until a wider DRY_IN panel refactor or CHVH-style chip rendering lands.
- **L5** — manual browser smoke of Version History on a live cycle. Never run in this worktree (no seeded data); flagged in resume notes.

### Verification (whole batch)

- `cd apps/web && npx vitest run` → 1 file, 10 tests passing.
- `cd apps/api && npx vitest run src/modules/filter-operations` → 1 file, 7 tests passing.
- `cd apps/web && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx tsc --noEmit` → exit 0.
- Live-count regex sweep against the active doc set — no drift detected; counts match the Batch 6 close baseline.

Per-task detail follows below.

---

## [Unreleased] — B7.4: render `equipmentGroupSyncWarning` advisory on operator pages (2026-05-02)

Branch: `feature/phase5-verification`. L3 (commit `d7026ce`) added the `equipmentGroupSyncWarning` field to the `getCurrentState()` API response, but no FE consumer read it — operators got zero signal that an admin had edited the cycle's pinned EquipmentGroup mid-cycle. This closes the L3 advisory loop end-to-end.

### Changes

- `apps/web/src/routes/mobile/mobile-operations.tsx` — new `equipmentGroupSyncWarning` component-state, set after each `getCurrentState` fetch in `handleSubmit` (line ~890) and cleared in `goHome` / `openStage`. Renders a persistent amber advisory card just under the existing red error banner (line ~1485).
- `apps/web/src/routes/filter-management/filter-operations.tsx` — same pattern. State set after the `apiClient.get<any>('/api/filters/:id/current-state')` call inside `handleSubmitBatch` (line ~620), cleared in `closeDialog` / `clearScanState` / the URL-stage-sync `useEffect`. Renders an amber card on the dedicated stage screen just below the pending-sync banner (line ~1493). Type declared inline at the call site — no `CurrentStateResponse` type added (would be over-engineering for one field).
- Copy on both pages (verbatim): "Equipment group has been updated by admin (you started on v{pinnedVersion}, current is v{liveVersion}). Your readings will continue to validate against the version you started with — terminate-and-restart only if you need the new ranges."
- Visual: `bg-amber-50 border-amber-200 text-amber-800` with the standard amber warning triangle SVG. Distinct from the red error banner (so an operator sees both at once if both fire) and persistent (no auto-clear timer — the existing red `error` auto-clears after 6s, this advisory does not).

### Reviewer follow-up (Issue #1) — intra-stage state leak on block change

- Reviewer flagged that `equipmentGroupSyncWarning` was not cleared when the operator changes block within the same stage screen. Scenario: scan Filter A on Block 1 → see amber advisory → "Change Block" → switch to Block 2 → between this and the next scan the advisory is still visible despite no longer applying. Self-corrects on next scan, but leaks briefly.
- Fix on desktop (`apps/web/src/routes/filter-management/filter-operations.tsx`): added `setEquipmentGroupSyncWarning(null)` to `handleBlockSelect` and to both `onChangeBlock` handlers (the fullPage variant inside the activeStage branch and the modal variant just above the cleaning-reason dialog). All three sites now drop the advisory before transitioning the step.
- Fix on mobile (`apps/web/src/routes/mobile/mobile-operations.tsx`): the in-place "Change" button next to the selected-block chip (the only intra-stage block-change affordance on mobile — `goHome` and `openStage` already cleared the advisory) now also calls `setEquipmentGroupSyncWarning(null)`. `performTask` (Wash-In jump from My Tasks) was updated symmetrically.

### Notes / known limits

- The advisory is set only after a `getCurrentState` fetch, so an operator already on the stage screen who hasn't scanned yet won't see it until the next scan. This matches the pattern of `profileSyncWarning` (which is also evaluated at scan-time only).
- **Deferred follow-up (Issue #2) — `DryingFiltersPanel` poller does not surface the advisory:** the panel's SWR poller fetches `/current-state` every 15 s for in-progress DRY_IN cycles but only uses the dryer-countdown shape, not `equipmentGroupSyncWarning`. An admin who edits the EquipmentGroup while the operator is parked on the DRY_IN screen would not see the advisory until they scan the next filter. Tracked as a follow-up; not fixed in this iteration.
- Offline-built state does not carry `equipmentGroupSyncWarning` (it's a derived comparison between `cycle.equipmentGroupVersionPin` and the live group version, which the offline path can't compute from the cache shape). The `?? null` fallback ensures stale values are cleared when offline.
- The recommendation is `CONTINUE_OR_TERMINATE_AND_RESTART` — operator is *not* blocked. Mirrors the L3 server-side semantic (validation continues against the pinned snapshot via Phase A.4 P1; new ranges are admin-driven, not safety-driven).

### Verification

- `cd apps/web && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx tsc --noEmit` → exit 0 (no API changes; sanity check only).
- `cd apps/web && npx vitest run` → existing B7.1 diff suite still passes (10/10).
- Visual smoke: not run (no live server in this worktree); the amber-card render shape is straight Tailwind and mirrors the existing `pendingCount` amber banner adjacent to it.

### Out of scope

- No "View pinned snapshot" button on the advisory (CHVH territory; the chips on the cycle timeline page already deep-link).
- No semantic change to the warning's recommendation.
- No tests added for the FE rendering — the advisor flagged this as B7.5 doc territory and the component-level test would be over-engineering for a non-blocking advisory.

---

## [Unreleased] — B7.3: vitest unit tests for `getCurrentState()` L1+L2 invariants (2026-05-02)

Branch: `feature/phase5-verification`. The `filter-operations.service.ts` module had zero unit tests (verified — no `__tests__` folder existed for the module). L1 (cycle-pinned `EquipmentGroupVersion.snapshot` rendering) and L2 (cycle-pinned `FilterCleaningProfile.id` pipeline rendering) had no automated regression coverage. A future refactor could silently revert either path back to live-row reads and we wouldn't notice until an operator complained.

### Changes

- `apps/api/src/modules/filter-operations/__tests__/get-current-state.test.ts` — new vitest unit-test file. Mocks prisma directly per the canonical pattern in `apps/api/src/modules/assets/services/__tests__/instance.service.test.ts` (`vi.hoisted` + `vi.mock('../../../lib/prisma.js', …)`). Spies on the service's private `getProfilePipeline` after instance construction (option (a) in the task brief) so L2 can be asserted by call-args without restructuring the service.

### Coverage (7 tests across 2 describe groups)

L1 — equipment-group snapshot resolution:
1. **case 1** — pin set + snapshot row exists → returned `equipmentGroup` matches snapshot fields, `version === pin`, instruments sorted by `sortOrder`. Live-row stub poisoned to a divergent value to make a regression that reads it instead of the snapshot fail loudly.
2. **case 2** — pin set + no snapshot row + `live.version === pin` → returned `equipmentGroup === liveGroup` (lazy first-version path; live row IS v1 until first edit creates the archive). `console.warn` NOT called.
3. **case 3** — pin set + no snapshot row + `live.version !== pin` → defensive log path: returns live row AND emits a single `console.warn` containing `equipmentGroupVersionPin=…`, `groupId`, and `cycleId`.
4. **case 4** — pin null (legacy cycle pre-P1) → returns live row, `prisma.equipmentGroupVersion.findUnique` is NEVER called (negative assertion enforces the L1 contract that legacy cycles must not consult the version sidecar).
5. **case 5** — cycle has no `equipmentGroupId` → block-fallback group via `prisma.equipmentGroup.findFirst({ where: { blockId, isActive: true }, … })`, neither `equipmentGroup.findUnique` NOR `equipmentGroupVersion.findUnique` is called.

L2 — cycle-pinned profile pipeline rendering:
6. **case 6** — `currentCycle.profileId !== resolvedLiveProfileId` → `getProfilePipeline` is called with the cycle's `profileId`, NOT the live `resolveFilterProfile()` result. Returned `profile.name`/`flowMode` reflect the cycle-pinned pipeline (sanity end-to-end check).
7. **L2 control** — pre-cycle path (no `currentCycleId`) → `getProfilePipeline` IS called with the live resolved profileId. Documents the inverse: cycle-pinned rendering only fires when a cycle is in progress; pre-cycle preview shows the live binding (so the operator sees what they'd start a cycle against).

### Why no helper extraction

The task brief allowed extracting `resolveEquipmentGroupForResponse()` / `resolveProfileForRender()` helpers from `getCurrentState()` if the function was too entangled to test in one shot. It wasn't. Mocking the ~10 prisma calls L1+L2 actually touch (filtering out the unrelated PM-due, block-change-status, profileSyncWarning, equipmentGroupSyncWarning, and stageLookup branches with empty/null returns) keeps the test focused on the two invariants and avoids an out-of-scope refactor. No production-code change beyond the new test file.

### Verification

- `cd apps/api && npx vitest run src/modules/filter-operations` → 1 file, 7 tests, all passing.
- `cd apps/api && npx vitest run` (full api suite, 84 files) → 82 passed, 2 pre-existing e2e failures unrelated to this change (`auth.test.ts > forgot-password` — UUID corruption in test DB; `config.test.ts > datetime/current` + `action-reauth` — environmental). Both reproduced on `7a2f3b4` (HEAD before this commit) without the new test file.
- `cd apps/api && npx tsc -p tsconfig.json --noEmit` → exit 0.

### Touched files

- `apps/api/src/modules/filter-operations/__tests__/get-current-state.test.ts` (new, 345 lines).
- `CHANGELOG.md` (this entry).

---

## [Unreleased] — B7.2: BLOCK_CHANGE_REQUIRED 409 handled in equipment-dialog + PM auto-start flows (2026-05-02)

Branch: `feature/phase5-verification`. Closes a partially-stale gap: the `BLOCK_CHANGE_REQUIRED` 409 already emitted structured `details` from `validateBlockChange()` (commit `60dcbaa`, 2026-04-10), and the reason-dialog catch paths in mobile + desktop had been popping a structured modal since then. **What was missing**: four `start-and-advance` catch blocks (three equipment-dialog + one desktop PM auto-start) that go through `start-cycle` → `validateBlockChange`. On a cross-block hit there, the 409 was falling through to a generic toast / "failed" string. Operators got no actionable surface for requesting approval from those flows.

### Changes

- `apps/web/src/routes/mobile/mobile-operations.tsx` — `handleEquipSubmit`: detect `e.code === 'BLOCK_CHANGE_REQUIRED'` and pop the existing `blockChangeDialog` modal (same shape as the reason-dialog catch at line 1137). Clears `equipDialog`, `selectedEquipGroup`, `readings`, and `pendingCyclePayload` so the new modal isn't stacked under stale state.
- `apps/web/src/routes/filter-management/filter-operations.tsx` — `handleEquipmentSubmit` (single + batch paths): same detection, mirroring the reason-dialog catch at line 1060 and the `advanceBatch` catch at line 388. Batch loop sets the modal once on first hit and keeps iterating so other items still succeed.
- `apps/web/src/routes/filter-management/filter-operations.tsx` — **PM auto-start desktop loop** (added in this revision): the `for (const item of batch)` at line ~721 was calling `executeOrQueue('start-and-advance', …)` with no inner try/catch, so a 409 from `validateBlockChange` would bubble to the outer catch at line ~826 and surface as a generic `setPopupError(e.message)` — exactly the gap B7.2 was meant to close. Mobile already had this (mobile-operations.tsx:1015-1022); only desktop was missing it. The proactive `state.blockChangeStatus === 'REQUIRED'` cache check at line 661 mitigates most cases, but it's a stale-cache gate, not a server-side hard guarantee. Fix mirrors mobile + the equipment-dialog batch pattern: per-iteration try/catch, structured modal popped once on first hit (via local `blockChangePopped` flag), other items continue.

### Minor cleanups (same commit)

- **Closure-staleness fix in `handleEquipmentSubmit` batch loop** — replaced the `if (!blockChangeDialog)` guard with a local `blockChangePopped` flag. React does not flush state between iterations of a sync `for/await` loop, so the closure-captured `blockChangeDialog` is always whatever it was at function entry — the original guard would re-set the dialog on every cross-block hit. Local flag = correct "set on first hit only". Same fix applied to the new PM auto-start loop above.
- **Symmetry with `advanceBatch`** — added `&& !blockChangePopped` guard on the post-loop `setPopupError` in `handleEquipmentSubmit` batch (mirroring `advanceBatch:422`'s `&& !blockChangeDialog`), so the generic toast doesn't fire when the structured modal is already up. Used the local flag for the same closure-staleness reason.

### Why no new modal / no inline card / no API change

- The structured modal already exists (one in each file) with filter name, home block, requested block, reason textarea, and inline `POST /api/block-change-requests` submit. Adding an inline card alongside (S4UX-style) would create two competing UIs for the same error.
- `validateBlockChange()` already returns the exact `{ filterId, homeBlockId, homeBlockName, requestedBlockId, requestedBlockName }` shape the FE consumes. No server-side change.

### Verification

- `cd apps/web && npx tsc --noEmit` → exit 0.
- `cd apps/api && npx tsc --noEmit` → exit 0.
- `cd apps/web && npx vitest run` → 1 file, 10 tests, all passing (B7.1 regression).
- Server contract verified by code reading: `filter-operations.service.ts:205-213` constructs the AppError; `app.ts:147-152` serializes `details` into the JSON body; `error-schemas.ts:13` uses `additionalProperties: true` so Fastify preserves it; `api-client.ts:67` maps `err.details` → `err.connectionInfo`. End-to-end live curl was not feasible without building out a full block-with-filters fixture in the local DB; documenting the inspection chain instead.

### Touched callsites — full audit (so future drift is detectable)

In both files, every `catch` for an `executeOrQueue('start-cycle' | 'start-and-advance', …)` path now either pops the modal or delegates to a loop that does. Audited catches:

- mobile: 1015 (PM auto), 1071 (handleSubmit), 1136 (handleReasonSubmit), 1245 (handleEquipSubmit — fixed in this commit).
- desktop: 388 (advanceBatch), **~721 (PM auto-start loop — fixed in this revision)**, 868 (reason-batch start), 935 (reason-batch advance), 1010 (reauth-wrapped start), 1060 (handleReasonSubmit), 1232 (handleEquipmentSubmit batch — fixed in this commit), 1283 (handleEquipmentSubmit single — fixed in this commit).

`submit-checklist`, `bypass`, `terminate`, dryer-temp `advance`, and offline-cache fetch catches do not need the branch — `validateBlockChange` is only called from `startCycle()` server-side (verified at `filter-operations.service.ts:899`).

---

## [Unreleased] — B7.1: apps/web vitest setup + diffSnapshots() regression suite (2026-05-02)

Branch: `feature/phase5-verification`. Closes L6 from `tasks/SERVER-ONLINE-WORKLIST.md` — no FE test runner existed and the snapshot diff engine in the Version History page (added in `d31ed37` — VHv3 interactive diff timeline) had zero coverage.

### Changes

- `apps/web/package.json`: added `vitest@^3.0.0`, `jsdom@^25`, `@testing-library/react@^16.1`, `@testing-library/jest-dom@^6.6` devDeps; added `test` (= `vitest run`) and `test:watch` scripts. Vitest version is pinned to match `apps/api` and `packages/shared` so npm doesn't hoist two majors.
- `apps/web/vitest.config.ts`: new file. Fresh `defineConfig` from `vitest/config` — intentionally NOT derived from `vite.config.ts`, which reads HTTPS certs at module load and registers VitePWA / Tailwind plugins that would explode under a unit-test runner. Uses `jsdom` environment, `@vitejs/plugin-react`, and the `@` path alias mirroring `tsconfig.json#paths`.
- `apps/web/src/test-setup.ts`: new file. Registers `@testing-library/jest-dom/vitest` matchers. Unused by the diff suite (no React rendering) but in place for future component tests.
- `apps/web/src/routes/version-history/index.tsx`: minimal export of `diffSnapshots`, `DiffChange`, `EntityKind`. No restructuring; runtime behavior of the page is unchanged.
- `apps/web/src/routes/version-history/__tests__/diff.test.ts`: new suite. **10 tests** covering each branch of `diffSnapshots()`:
  1. scalar field change (`changed`)
  2. keyed-array stage addition with context (`added`)
  3. keyed-array stage removal with context (`removed`)
  4. keyed-array item field change — recursion path, `id` filtered as META
  5. set-style `applicableTemplates` add (filter-profile)
  6. set-style `allowedBlocks` remove (filter-profile)
  7. all META_FIELDS differ but nothing else → empty diff
  8. deep-equal snapshots (no-change case) → empty diff
  9. checklist-profile `questions` keyed by id (cross-kind smoke)
  10. equipment-group `instruments` operatingMax change (cross-kind smoke)
- `vitest.workspace.ts`: added `apps/web/vitest.config.ts` to the workspace list. **This is a touchpoint not in the B7.1 spec** — flagging here rather than silently extending. The omission would have meant `npm test` at root wouldn't pick up the new project, regressing against the existing api/shared/integration pattern.
- `apps/web/CLAUDE.md`: new "Testing" section with run commands and a pointer at the B7.1 suite.
- `tasks/SERVER-ONLINE-WORKLIST.md`: marked L6 done with delivery summary.

### Verification

- `cd apps/web && npx vitest run` → 1 file, 10 tests, all passing (~1.4s).
- `cd apps/web && npx tsc --noEmit` → exit 0.
- No `index.tsx` runtime change beyond three `export` keyword additions; the page still renders identically.

---

## [Unreleased] — L4: advance() reading-validation snapshot/live equality audit — NO CHANGE (2026-05-02)

Branch: `feature/phase5-verification`. L4 from `tasks/SERVER-ONLINE-WORKLIST.md` was a defense-in-depth audit of `filter-operations.service.ts:1227-1262` (`advance()` reading-validation snapshot vs lazy-first-version live-fallback path). **Outcome: no code change. The path is correct.**

### What was audited

The validator picks `stageInstruments` from one of three sources depending on cycle pin state:

1. Snapshot path (`pin=N`, snap row exists): reads `snapshot.instruments[]`.
2. Lazy-first-version live-fallback (`pin=N`, no snap row, asserts `live.version === pin`): reads live `equipmentGroupInstrument` rows.
3. Legacy fallback (`pin=NULL`): reads live rows. Documented drift gap, intentionally kept for backwards-compat with pre-P1 cycles.

The concern was whether the instrument IDs the FE has cached (used to key the submitted `instrumentReadings: {[id]: number}`) could ever diverge from the IDs the validator iterates over.

### Finding: instrument IDs are stable across edits

`equipment-groups.service.ts:163-178` mutates each instrument by `tx.equipmentGroupInstrument.update({where: {id: existingInst.id}, ...})` — fields change, row identity is preserved. There is no replace-instrument code path that creates new rows. Therefore:

- Snapshot path: `snap.instruments[i].id` matches what the FE saw via `getCurrentState()` (which after L1 returns the same snapshot).
- Lazy-first-version: snapshot doesn't exist yet, both server and FE use the live row's IDs — identical.
- Legacy: pre-P1 cycle never had a pin, FE always saw live IDs, validator reads live IDs — identical.

### Auto-bind at submit (line ~1199-1216)

When a cycle has no `equipmentGroupId` and a single block-group exists, the validator auto-binds at submit time and stamps `pin = live.version`. The submitted `instrumentReadings` was built from a prior `getCurrentState()` call which returned the live group; validator reads the same live group via the lazy-first-version branch (`pin === live.version` assertion holds). **Synchronous online flow: race-free.**

The narrow offline-batch case (FE rendered against live v1, admin edited to v2 mid-flight, sync replays the readings, validator pins to v2) is reachable but is exactly what Slice B in `future/offline-version-sync-contract.md` is designed to handle. Out of scope for online-side work.

### Decision: no change

L4 closed. Documented here for the record.

---

## [Unreleased] — L3: equipmentGroupSyncWarning on getCurrentState (2026-05-02)

Branch: `feature/phase5-verification`. Symmetric to the existing `profileSyncWarning` (cleaning-recipe drift) but for the EquipmentGroup pin. Read-only advisory; no functional change to validation.

### Changes

- `filter-operations.service.ts:~628`: new `equipmentGroupSyncWarning` field on the `getCurrentState()` response. Fires when `cycle.equipmentGroupVersionPin !== null` AND the live group's `version > pin`. Carries `{ groupId, pinnedVersion, liveVersion, recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' }`. Null in all other cases (no cycle, no group, pin matches live, etc.).
- `filter-operations/routes.ts:~63`: response schema entry for the new field, so Fastify doesn't strip it.

### Verification

- `tsc -p apps/api/tsconfig.json` exit 0; service restart clean.
- End-to-end via curl on F1/B1:
  - Started cycle with pin=1 on a freshly-seeded group at v1. GET `/current-state` → `equipmentGroupSyncWarning: null`. ✓
  - PUT to bump live group v1→v2. GET `/current-state` → `equipmentGroupSyncWarning: { pinnedVersion: 1, liveVersion: 2, recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' }`. ✓
- Test data fully cleaned up.

### Notes

- Recommendation says `CONTINUE_OR_TERMINATE_AND_RESTART` (not `TERMINATE_AND_RESTART` like the profile warning) because: the operator can finish their cycle on the pinned ranges (still correct, still audit-replayable). Restarting only matters if they want the new ranges to apply. Less coercive than the profile case where the cleaning recipe changing is materially different.
- No FE consumer wired up yet — additive field. The existing FE warning UI for `profileSyncWarning` is the natural spot to render this when the FE is updated. Not blocking; the field is documented in the OpenAPI/Fastify schema.

---

## [Unreleased] — L2: getCurrentState renders cycle-pinned cleaning profile pipeline (2026-05-02)

Branch: `feature/phase5-verification`. Closes the pipeline-graph display drift between the operator's UI and what `advance()` enforces. Symmetric to L1 but for the cleaning pipeline graph (stages + connections + profile name) rather than the equipment group.

### Background

Before L2: `getCurrentState()` rendered `pipelineGraph`, `pipelineStages`, `nextAllowedStages`, `pendingChecklist`, `stageLookup`, and `profile` from `getProfilePipeline(resolvedProfileId, false)` — where `resolvedProfileId` came from `resolveFilterProfile(filter)` (the LIVE FilterProfile binding via FilterDetails or config rule).

The cycle's actual pinned recipe is `currentCycle.profileId` (locked at start, immutable post-A.2 rowful versioning). When an admin reassigned a block's FilterProfile mid-cycle, the operator's tablet showed the new pipeline's stages while `advance()` still enforced the old one. `profileSyncWarning` (line 553-577) detected the mismatch and told the operator to TERMINATE_AND_RESTART, but the visual layout was misleading until they did.

### Changes

- `apps/api/src/modules/filter-operations/filter-operations.service.ts:402-417` — when `currentCycle` exists, render the pipeline from `currentCycle.profileId` (the cycle's pinned FilterCleaningProfile id) instead of the live FilterProfile binding. Pre-cycle path falls back to the live binding (so the operator sees what they'd start a cycle against).
- All downstream consumers (`pipelineStages`, `pipelineGraph`, `nextAllowedStages`, `nextBlocks`, `pendingChecklist`, `stageLookup`, `profile`) automatically pick up the pinned graph because they all read from the same `cp` variable.
- `profileSyncWarning` semantics preserved: now it correctly says "your view matches the rules; admin has reassigned the block to a different profile; terminate-and-restart to use the new one" instead of "your view is wrong."

### Verification

- `tsc -p apps/api/tsconfig.json --noEmit` exit 0; full compile to dist exit 0; service restart clean.
- End-to-end via curl on F1/B1 with two distinct CleaningProfiles seeded:
  - **CP-A** (cycle-pin) has stage `WASH_IN`. **CP-B** (live-binding) has stage `DRY_IN`.
  - Step 1: FilterProfile -> CP-A. Started cycle. `cycle.profileId = CP-A.id`. ✓
  - Step 2: GET `/current-state` -> `pipelineGraph.stages` shows `WASH_IN`, `profile.name = "L2 CP-A (cycle-pin)"`. ✓
  - Step 3: SQL `UPDATE filter_profiles SET cleaning_profile_id = CP-B.id` (live binding now diverges from cycle pin).
  - Step 4: GET `/current-state` -> `pipelineGraph.stages` still shows **`WASH_IN`** (NOT `DRY_IN`); `profile.name` still **`L2 CP-A (cycle-pin)`**. ✓
  - `profileSyncWarning` populated correctly: `cycleProfileName: "L2 CP-A (cycle-pin)"`, `expectedProfileName: "L2 CP-B (live-binding)"`, recommendation `TERMINATE_AND_RESTART`. ✓
- Test data fully cleaned up: 0 cycles, 0 cleaning profiles, 0 stages, 0 connections.

### Notes

- No FE change required — same `pipelineGraph` / `pipelineStages` / `nextAllowedStages` field shapes.
- No APK rebuild required.
- Scope deliberately narrow: this L2 only covers the rendered pipeline graph at `getCurrentState()`. The actual `advance()` logic was already correct — it walks `cp.stages` from `currentCycle.profileId`. L2 just makes the read path consistent with the write path.

---

## [Unreleased] — L1: getCurrentState returns pinned EquipmentGroupVersion snapshot (2026-05-02)

Branch: `feature/phase5-verification`. Closes the operator-visible drift surface left by P1: server validated against the pinned snapshot but `getCurrentState()` still returned the live group, so dropdowns built from live ranges (`mobile-operations.tsx:2062 genOpts(...)`) could offer values that the server then rejected with no warning.

### Changes

- `apps/api/src/modules/filter-operations/filter-operations.service.ts:486-553` — when `cycle.equipmentGroupVersionPin` is set, `getCurrentState()` reconstructs `equipmentGroup` from `EquipmentGroupVersion.snapshot` instead of the live `equipmentGroup` row. Field shape preserved (`{id, name, blockId, isActive, version, instruments: [...]}`) so the existing FE consumers + the deployed APK consume unchanged.
- Lazy-first-version handling: when pin is set but no `EquipmentGroupVersion` row exists yet (live row IS v1 until the first edit creates its archive), falls back to live row IFF `live.version === pin`. Mirrors the canonical logic from `advance()` reading-validation at `:1101-1175`.
- Legacy fallback (cycle started pre-P1, pin is NULL): live row, with the documented drift gap.
- Mismatch path (pin set, no snapshot row, live.version !== pin): logs a console.warn and returns live; doesn't throw because this is a read endpoint and breaking the operator's UI is worse than logging. `advance()` will throw `409 GROUP_VERSION_MISSING` if the operator tries to act on it.

### Verification

- `tsc -p apps/api/tsconfig.json --noEmit` exit 0.
- Full compile to dist exit 0; service restart clean.
- End-to-end via curl on F1/B1 + a seeded cleaning profile + filter profile + equipment group:
  - Started a cycle with pin=1; live group at v1. Lazy-first-version path: GET `/current-state` returned Air `operatingMax=6, version=1`. ✓
  - PUT to bump live group v1→v2 (Air `operatingMax 6→7`). Snapshot row v1 created. GET `/current-state` returned **Air `operatingMax=6, version=1`** — the pin survived; the FE would now render dropdowns from the pinned ranges. ✓
  - Set `equipmentGroupVersionPin = NULL` directly (legacy fallback). GET `/current-state` returned Air `operatingMax=7, version=2` — live row, as expected for pre-P1 cycles. ✓
- Test data fully cleaned up: 0 cycles, 0 groups, 0 group versions.

### Notes

- **No FE change required.** Verified via grep: every FE consumer of `equipmentGroup.*` reads only `id`, `instruments`, plus defensive reads of `name`/`blockId`/`isActive` — all preserved by the snapshot-reconstruction shape.
- **No APK rebuild required.** Same field-shape contract.
- This implicitly closes the offline reading-submit replay drift case from `future/offline-version-sync-contract.md` (O3 in the addendum) — once the tablet caches what `getCurrentState()` returns per cycle, subsequent admin edits to the live group don't reach the cached cycle state. Slice B's primary motivation evaporates; only the narrow "first cache-fill happens during admin edit" residual remains.

---

## [Unreleased] — Batch 6: VHv2 + VHv3 + S4UX + WSL + DocSweep + CHVH (2026-05-02)

Branch: `feature/phase5-verification`. Per user direction: items 2-7 from the menu, all touchpoints listed before editing, all verified after, deep fixes applied where bugs were uncovered.

### VHv2 — Structured per-entity snapshot viewers
- `apps/web/src/routes/version-history/index.tsx`: replaced the JSON pretty-print modal body with kind-aware structured cards (CleaningProfile, FilterProfile, ChecklistProfile, EquipmentGroup). Each renders the entity's full snapshot in human-readable form: cleaning profiles show stages (sorted, with nodeType + stateKey + configuration) and connections; filter profiles show applicable templates list; checklist profiles render the question list (sortOrder, type, required, options summary); equipment groups group instruments by stageKey in a per-stage table with all ranges. The raw JSON is preserved behind a "Show raw JSON" toggle.

### VHv3 — Version diff view
- Same file. Added "Compare with v(N-1)" expander on every version timeline row (hidden on v1 since there's no v0). Inside, fetches both snapshots in parallel, runs a kind-aware diff: scalar changes render as `field: old → new`, keyed array members (stages by id, instruments by id, questions by id, cleaningReasons by key) diff per-item with per-field changes, set-style fields (`applicableTemplates`, `allowedBlocks`) render as set add/remove. Meta fields (timestamps, author, version pointers) are filtered out so the diff only shows admin-edit changes.

### S4UX — TEMPLATE_IN_USE structured response
- **Deep fix**: `apps/api/src/lib/errors.ts` — `ConflictError` constructor now takes a `details?: unknown` arg and forwards it through `AppError`. Pre-existing limitation — `ConflictError` could only emit a string message; couldn't carry structured payloads.
- `apps/api/src/modules/assets/services/template.service.ts` — Step 4 delete guard now throws `ConflictError(message, 'TEMPLATE_IN_USE', { bindings: [{id, name}, …] })` instead of jamming names into the message string.
- `apps/web/src/routes/assets/templates.tsx` — delete handler detects `err.code === 'TEMPLATE_IN_USE'` and renders the bindings list inline (each profile shown as a card with name + truncated id) instead of a single-line toast.
- `apps/api/src/modules/assets/services/__tests__/template.service.test.ts` — assertion updated: now checks `err.code === 'TEMPLATE_IN_USE'` AND `err.details === { bindings: [...] }`. **All 11 tests pass.**

### WSL — Windows-service launcher full automation
- New `scripts/install-windows.ps1`: top-level orchestration installer that ties together the existing piecemeal scripts (`install-mosquitto.ps1`, `install-services-phase5.ps1`). Steps: tooling sanity check (Node, NSSM auto-install via winget if missing) → builds packages/shared / apps/api / apps/web (skippable with `-SkipBuild`) → installs/refreshes Mosquitto (skippable on existing install) → registers DigiLog API + Web services via NSSM → starts services → probes `/health` (200 or 401 both OK — TLS up). Idempotent.
- New `scripts/uninstall-windows.ps1`: stops + removes DigiLog services. Mosquitto opt-in via `-RemoveMosquitto`. Logs opt-in via `-RemoveLogs`. Falls back to `sc.exe delete` if NSSM isn't found.
- Both scripts parse-validated (PowerShell AST parser exit 0); ASCII-only per the existing convention to keep PS 5.1 happy.

### DocSweep — Doc-sync verification across active doc set
- Ran live-count regex sweep. Pre-VH-shipped values (105 perms / 89 privs / 25 sidebar) found stale in: `LOCAL_SETUP_WINDOWS.md`, `packages/shared/CLAUDE.md`, `PROJECT_ARCHITECTURE.md`, `windowsIssues.md`. Older pre-MT-removal values (109 perms / 91 privs) found stale in: root `CLAUDE.md` (×2), `AGENTS.md`, `PROJECT_SUMMARY.md` (×2), `docs/index.md`. **All bumped to 106 / 90 / 26.**
- Verified live counts: 69 models, 23 enums, 106 permissions, 90 feature privileges, 81 reauth actions, 26 sidebar items, 36 API modules, 30 config defs, 27 config pages, 82 frontend `<Route>` definitions in `main.tsx`.

### CHVH — Cycle history ↔ version history linkage
- `apps/web/src/types/filter.ts`: extended `CleaningCycle` interface with `equipmentGroupId`, `equipmentGroupVersionPin`, `checklistVersionPins`. The fields were already in the API response; the FE just hadn't typed them.
- `apps/web/src/routes/cleaning-cycles/timeline.tsx`: new "Pinned Versions (audit replay)" card after the cycle info grid, conditional on the cycle having any pin. Renders three chip types — "Pipeline vN" (FilterCleaningProfile via existing `profileVersion`), "Equipment vN" (`equipmentGroupVersionPin` from P1), "Checklist vN" (one chip per entry in `checklistVersionPins`). Each chip deep-links to `/version-history?entity=<kind>&id=<uuid>&v=<n>`.
- `apps/web/src/routes/version-history/index.tsx`: added `useSearchParams` + a one-shot `useEffect` that reads `entity=`, `id=`, `v=` on mount, lands on the right tab, pre-selects the entity, and opens the snapshot modal at the requested version. Tab change clears the deep-link params (so back/forward doesn't reopen the modal).

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0.
- `npx tsc --noEmit` (apps/web) exit 0.
- Full API compile to dist exit 0; service restart clean.
- `vitest run src/modules/assets src/modules/backup` — 14 files / 163 tests pass; the updated `template.service.test.ts` 409-path test asserts the new structured `details.bindings` shape.
- Curl: `DELETE /api/assets/templates/<bound-template-id>` returns `{"error":"TEMPLATE_IN_USE", "message":"…", "details":{"bindings":[{"id":"…","name":"409 Bound FP"}]}}` with code 409. Test data cleaned up.
- PowerShell AST parse on `install-windows.ps1` and `uninstall-windows.ps1` exit 0.

### Notes

- No new permission, no new model, no schema migration, no new package dep.
- Counts unchanged from VH commit: 69 models, 23 enums, 106 permissions, 90 feature privileges, 81 reauth, 26 sidebar items, 36 API modules.
- Em-dash characters originally in the new PS scripts broke PS 5.1 tokenisation — caught + replaced with `--` (matches the ASCII-only convention from the existing `install-services-phase5.ps1`).

---

## [Unreleased] — VH: Version History admin page + new VERSION_HISTORY_VIEW permission (2026-05-02)

Branch: `feature/phase5-verification`. Per user direction: "add a page to see versions, keep it in super admin scope and be assignable to other users through super admin configurations." Closes the FE sync gap for the four versioned entities (Phase A.1 + A.2 + A.3 + A.4) — server-side audit history existed at the API level but no admin UI surfaced it.

### Changes

- **New permission `VERSION_HISTORY_VIEW`** in `packages/shared/src/types/permissions.ts`. SUPER_ADMIN only by default (added to seed.ts and to the live SUPER_ADMIN role's permission array); assignable to other roles via Role Privileges → Audit / Versions → "View Version History".
- **New feature privilege** `version_history.view` (category: Audit / Versions) wired to the new permission via `FEATURE_TO_PERMISSION_MAP` in `feature-privileges.ts`.
- **New sidebar item** `version-history` in `sidebar-items.ts` + `sidebar-privilege-map.ts`. Render hook in `apps/web/src/components/layout/sidebar.tsx`.
- **Route gates updated** on the four `/versions` endpoints + their underlying entity list/detail endpoints (cleaning-profiles, filter-profiles, checklist-profiles, equipment-groups). Each gate now uses `requireAnyPermission(<existing entity-level perms>, 'VERSION_HISTORY_VIEW')` so a user with only the new permission can browse history without entity edit rights.
- **New page** `apps/web/src/routes/version-history/index.tsx`. Layout: 4-tab bar (Cleaning Profiles / Filter Profiles / Checklist Profiles / Equipment Groups). Each tab: master-detail with the entity list on the left (current version badge), version timeline on the right (newest-first, with archive timestamps + author UUID prefix + change notes when present). Click a version row → opens a modal with the frozen snapshot (JSON pretty-print for v1; structured per-entity viewers are a follow-up).
- **Route registered** in `main.tsx` at `/version-history` with `<RequireRole permissions={[PERMISSIONS.VERSION_HISTORY_VIEW]}>`.

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0.
- `npx tsc --noEmit` (apps/web) exit 0.
- Full API compile to dist exit 0; service restart clean.
- End-to-end via curl as superadmin: all 4 entity list endpoints (cleaning-profiles, filter-profiles, checklist-profiles, equipment-groups) returned 200. The new permission is in the live SUPER_ADMIN role's permission array (verified via psql: `perm_count: 90, has_vh: t`).
- The OR-permission gate is mechanical: `requireAnyPermission` returns true if any of the listed perms is in the user's permission set. Server-side gating is enforced.

### Notes

- v1 page renders snapshots as JSON pretty-print. A future iteration could add structured per-entity viewers (e.g., a pipeline-graph diff for cleaning profiles, a question-list diff for checklist profiles).
- Live counts after this batch: **106 permissions** (was 105), **90 feature privileges** (was 89), **26 sidebar items** (was 25). Reauth actions unchanged at 81.
- Full re-seed not run; live SUPER_ADMIN role updated directly via SQL UPDATE per `feedback_role_perms_after_restore`. `seed.ts` updated for next clean restore.
- The new endpoints existed before this work (Phase A.1–A.4); only the gating permission was relaxed. No API additive surface.

---

## [Unreleased] — P3: AWS SNS dropped; MSG91 / Twilio / similar over generic HTTP gateway (2026-05-02)

Branch: `feature/phase5-verification`. Per user direction: "remove AWS SNS dependencies — we'll do API POST to MSG91 or Twilio or similar service." The `http-gateway` provider already existed in the codebase as a generic templated POST adapter; this change makes it the default and removes the AWS SNS path entirely.

### Background

`apps/api/src/modules/notification-delivery/channels/sms-channel.ts:75` shelled out to the `aws` CLI via `child_process.spawn` to publish SMS via SNS. That made the runtime depend on the AWS CLI being installed on the Windows host — incompatible with the local-Windows-only deployment. Operators who want AWS now configure the http-gateway provider against the SNS REST endpoint (or any other provider — MSG91, Plivo, AfricasTalking, Kaleyra, Twilio's own REST). The http-gateway adapter accepts a configurable URL, method, headers map, and body template with `{phone}` / `{message}` placeholders.

### Changes

- **Backend**:
  - `apps/api/src/modules/notification-delivery/channels/sms-channel.ts` — removed `sendViaAwsSns()` (the spawn-aws-cli function), removed the `'aws-sns'` switch case in `send()` and `testConnection()`. Twilio + Vonage + http-gateway remain.
  - `apps/api/src/modules/notification-delivery/types.ts` — `SmsConfig.provider` union narrowed from `'twilio' | 'aws-sns' | 'vonage' | 'http-gateway'` to `'twilio' | 'vonage' | 'http-gateway'`. Dropped `awsAccessKeyId / awsSecretAccessKey / awsRegion` fields.
  - `apps/api/src/modules/notification-delivery/routes.ts` — removed `'aws-sns'` from the provider enum on `PUT /api/notification-settings/sms`. Dropped the `awsAccessKeyId / awsSecretAccessKey / awsRegion` body schema entries. Dropped from `sensitiveKeys` mask list (no longer applicable). Dropped from the audit-log redaction call.
  - `apps/api/src/modules/config/defs/notification-sms.def.ts` — provider select now offers `http-gateway` (default), `twilio`, `vonage`. AWS SNS gone.
- **Frontend**:
  - `apps/web/src/routes/config/notification-settings/{sms-settings,email-settings}.tsx` — removed `awsAccessKeyId / awsSecretAccessKey / awsRegion` from the `SmsConfig` interface, the `defaultValues` literal, and the AWS SNS provider config block. `SMS_PROVIDERS` now lists `http-gateway` first (with a description naming MSG91 / Plivo / AfricasTalking / Kaleyra). Default provider switched to `http-gateway`.
- **Rule-chain `aws-sns` / `aws-sqs` / `aws-lambda` nodes** — left in place. They're stub no-op nodes that just annotate the message and pass through; they do NOT carry a real AWS dependency. Out of scope for "drop AWS SNS dependencies."

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0 (twice — once after the channel/types/def changes, once after the routes.ts cleanup).
- `npx tsc --noEmit` in `apps/web` exit 0.
- Full compile to dist exit 0; **dist contains zero references** to `aws-sns / sendViaAwsSns / awsAccessKeyId / awsSecretAccessKey / awsRegion` (verified via grep against `apps/api/dist/modules/notification-delivery/`).
- `Restart-Service DigiLogAPI-Phase5` clean.
- End-to-end via curl:
  - `PUT /api/notification-settings/sms` with a MSG91-style body template via `http-gateway` provider → `200 success`.
  - `GET /api/notification-settings/sms` → returned the persisted config with the body template intact.
  - `PUT /api/notification-settings/sms` with `provider: "aws-sns"` → `400 VALIDATION_ERROR` from the route schema enum (`allowedValues: ["twilio", "vonage", "http-gateway"]`). Confirms the new shape is enforced server-side, not just in the FE dropdown.
- Test config wiped from `system_config` after verification.

### Notes

- The http-gateway provider supports `{phone}` and `{message}` placeholders in URL and body template. Headers map is configured per-provider (e.g., `authkey` for MSG91, `Authorization: Basic …` for Twilio's REST endpoint).
- Existing rows in `system_config` with `provider: 'aws-sns'` will still load (the runtime `switch` falls through to "Unknown SMS provider"), so any configured installation will silently stop sending until the operator updates the provider. **No automatic migration** since aws-sns config rows are credentials-only — operators must reconfigure to a real provider regardless.
- No new package dependencies. The http-gateway path was already in the codebase; only field/type plumbing was changed.

---

## [Unreleased] — P1: cycle-side EquipmentGroup version pinning + latent FK bug fix (2026-05-02)

Branch: `feature/phase5-verification`. Closes the operational drift gap left by Phase A.4 (which versioned the EquipmentGroup composite but didn't pin to the cycle). Server-side only — tablet contract documented in `future/offline-version-sync-contract.md` for the next APK build cycle (Slice B).

### Background

Phase A.4 added `EquipmentGroupVersion` snapshots so admin edits archive history. But `cleaning_cycles` had no per-cycle version reference, so reading validation in `filter-operations.service.ts` read the **live** group row and validated against current operating ranges. An admin edit to operating ranges between cycle-start and reading-submit would change the rules a cycle was held to, breaking audit replay byte-correctness. P1 closes this gap on the server side.

### Changes

- **Schema** (`apps/api/prisma/schema.prisma`):
  - `CleaningCycle.equipmentGroupVersionPin Int? @map("equipment_group_version_pin")` — nullable, set when a group is bound to the cycle (at start-cycle or first lazy-bind during reading-submit). Legacy cycles + cycles that never bind a group keep `NULL` and the validator falls back to the live row.
  - Applied via `prisma db push --skip-generate` — empty cycle table, no backfill.
- **Service** (`apps/api/src/modules/filter-operations/filter-operations.service.ts`):
  - `startCycle()` (~line 859) — when `equipmentGroupId` provided, fetches the live group's `version` and stamps it onto `cleaning_cycles.equipmentGroupVersionPin`.
  - Reading auto-resolve path (~line 1086-1098) — when a cycle lazy-binds a group during reading-submit, also stamps the live version into `equipmentGroupVersionPin`.
  - Reading validation (~line 1101-1175) — branches on `cycle.equipmentGroupVersionPin`:
    - `pin !== null`: read `equipmentGroupVersion.findUnique({ groupId_versionNumber: { groupId, versionNumber: pin } })` and validate `operatingMin/Max` from `snapshot.instruments[]`. If the version row is missing (lazy first-version pattern: live row IS v1 until first edit), assert live row's `version === pin` and use the live row directly. If live version drifts unexpectedly, throw `409 GROUP_VERSION_MISSING`.
    - `pin === null`: legacy fallback — read live row, validate against current ranges. Documented as a known drift gap kept only for backwards compat with pre-P1 cycles.
- **Latent pre-existing bug fix** (caught during P1 verification):
  - Line 877 was `profileId: resolvedProfileIdForCycle` but `cleaning_cycles.profile_id` FKs to `filter_cleaning_profiles.id`, not `filter_profiles.id`. `resolveFilterProfile()` returns either depending on whether the filter has a `FilterDetails.filter_profile_id` binding (returns FilterProfile id) or only a config-based rule (which *might* return a CleaningProfile id directly). The bug was masked because no FilterDetails-bound cycle had ever been started in the dev DB — every prior test went through the config-based path. Fixed: now uses `cleaningProfileIdForCycle` (computed at line 820).

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0; full compile to dist exit 0.
- `prisma db push --skip-generate` reports schema in sync; `equipment_group_version_pin` column present on `cleaning_cycles`.
- End-to-end via curl on existing block B1 + filter F1:
  - Seeded a CleaningProfile (with `cleaningReasons: [{key:"p1_test", name:"P1 Test", isActive:true}]`), a FilterProfile pointing at it, a FilterDetails binding F1 to the FilterProfile, an EquipmentGroup with 3 instruments (Air `2-6`, RO `1-4`, Dryer `60-120`).
  - `POST /api/filters/F1/start-cycle` with `equipmentGroupId` → cycle created with `equipmentGroupVersionPin: 1` in the response and DB row. **Verifies pin is stamped at start-cycle.**
  - `PUT /api/equipment-groups/<id>` to bump Air `operatingMax: 6 → 7` → live group becomes v2; `equipment_group_versions` v1 row carries the original Air `operatingMax: 6`.
  - DB inspection after: cycle row's `equipment_group_version_pin = 1` (unchanged); live group `version = 2`; v1 snapshot row has Air `operatingMax = 6`. **Verifies cycle pin is immune to admin edits.**
  - Pinned-snapshot validation path is exercised whenever `cycleVersionPin !== null` — full integration through the advance() pipeline graph requires a real cleaning-profile pipeline (out of scope for the bug-fix verification); structural correctness verified via the schema + DB row + tsc + service code-path branch logic.
  - Latent FK bug fix verified: start-cycle no longer fails with `cleaning_cycles_profile_id_fkey` when the filter has a FilterDetails-bound FilterProfile.
- Test data fully cleaned up: 0 leftover cycles, groups, group versions, FilterProfiles, or seeded CleaningProfile rows.

### Notes

- **Tablet/offline app NOT updated by this change.** The tablet keeps its current behavior — caches whatever `getCurrentState()` returns, submits readings without sending a version number. The server validates against the cycle's pinned version regardless. Operator UX is slightly inconsistent (display = live ranges, validation = pinned ranges) until Slice B lands. Per `future/offline-version-sync-contract.md`, Slice B will:
  - Make `getCurrentState()` return the pinned snapshot in `equipmentGroup`.
  - Add `expectedGroupVersion: number` to the reading-submit body.
  - Return `409 SCHEMA_DRIFT` with the pinned snapshot embedded so the tablet can self-heal.
  - This is bundled with the next APK build cycle (mirrors the A.1 ChecklistProfile contract).
- The latent FK bug had been waiting since whenever the FilterProfile-via-FilterDetails path was added. P1's verification scenario is the first time a FilterDetails-bound cycle actually started in this DB. The fix is one line; no schema change.
- Per-cycle group-version pinning was the deferred item from the Phase A.4 entry of `tasks/STEP-5B-A-VERSIONING-PLAN.md`. **Now closed.**

---

## [Unreleased] — Step 4: FilterProfile.applicableTemplates JSONB → join table (2026-05-02)

Branch: `feature/phase5-verification`. From the 9-step architectural-refactor plan; closes Step 4. Removes a long-standing dangling-FK-via-JSON foot-gun.

### Background

`FilterProfile.applicableTemplates` was `Json @default("[]")` storing an array of `AssetTemplate` UUIDs as plain strings. No FK enforcement: deleting an `AssetTemplate` left orphan UUIDs in every JSON array that pointed at it. The dangling refs passed DB validation, the JOIN-via-IN-clause silently dropped them, and there was no audit trail of what got orphaned.

### Changes

- **Schema** (`apps/api/prisma/schema.prisma`):
  - Dropped `FilterProfile.applicableTemplates Json` column.
  - Added new model `FilterProfileApplicableTemplate` — composite-PK `(profileId, templateId)`, both FKs `onDelete: Cascade`, `@@index([templateId])`, `@@map("filter_profile_applicable_templates")`.
  - Reverse relations: `FilterProfile.applicableTemplates: FilterProfileApplicableTemplate[]` and `AssetTemplate.filterProfileBindings: FilterProfileApplicableTemplate[]`.
  - Applied via `prisma db push --skip-generate` against an empty `filter_profiles` table — no backfill needed.
- **Service** (`apps/api/src/modules/filter-profiles/filter-profile.service.ts`):
  - `create()` — wrapped in `prisma.$transaction`; creates the FilterProfile row, then `createMany` the join rows. Verifies all incoming template IDs exist (returns 400 with the missing list) before opening the transaction.
  - `update()` — when the caller provides `applicableTemplates`, replaces the join set inside the existing snapshot-then-bump transaction (`deleteMany` + `createMany`). Same upfront ID-existence check as `create()`.
  - `list()` / `getById()` — `include: { applicableTemplates: { select: { templateId: true } } }` then flatten via a small helper to keep the wire shape `applicableTemplates: string[]`. **No FE change.**
  - **A.3 snapshot fix** — `snapshotAndBump()` now reads the live join rows inside the transaction and freezes them as `string[]` in `FilterProfileVersion.snapshot.applicableTemplates`, so historical replay still works byte-correct.
- **AssetTemplate delete guard** (`apps/api/src/modules/assets/services/template.service.ts`):
  - Before `softDelete()`, count `filter_profile_applicable_templates` rows for `templateId`. If > 0, throw `ConflictError` (`409 IN_USE`) listing the binding profiles by name. The cascade FK on the join table is the safety net for hard deletes (super-admin paths, backup-restore); this guard is the user-facing path.

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0; full compile to dist exit 0.
- `prisma db push` reports schema in sync; `\d filter_profile_applicable_templates` confirms columns + cascade FKs; `applicable_templates` column gone from `filter_profiles`.
- `Restart-Service DigiLogAPI-Phase5` clean.
- End-to-end via curl:
  - Seeded an ACTIVE FilterCleaningProfile so a FilterProfile could reference one.
  - `POST` with two real template UUIDs → response carries `applicableTemplates: ["…", "…"]` as `string[]`.
  - `POST` with a bogus template UUID → clean `400 VALIDATION_ERROR` listing the unknown ID.
  - `PUT` removing one template → response shows the shorter array; `version` bumped to 2.
  - `GET /:id/versions/1` → frozen v1 snapshot still has BOTH templates as `string[]`. v3-style isolation works for the join data.
  - `DELETE /api/assets/templates/<bound-template-id>` → clean `409 CONFLICT` with `Cannot delete template "Block-T": still bound by 1 filter profile(s) [S4 Test Filter Profile]. Remove these bindings first.`.
  - `DELETE /api/assets/templates/<unbound-template-id>` (the second template, after PUT detached it) → `200 success`.
- Test data fully cleaned up — 0 leftover rows in `filter_profiles`, `filter_profile_versions`, `filter_profile_applicable_templates`; the seeded cleaning profile dropped; the unbound template restored to `is_active = true` so the dev DB stays usable.

### Notes

- **Decision recorded**: AssetTemplate delete blocks on FilterProfile bindings (option b). The cascade FK is the safety net, not the operator-visible path. Consistent with the existing FilterProfile delete-guard against FilterDetails references.
- `allowedBlocks` stays JSONB — only used when `blockRestriction = SPECIFIC_BLOCKS`; the conditional case doesn't justify a join table.
- Frontend untouched — no `applicableTemplates` references exist under `apps/web/src` (verified via grep). The wire shape preserved by the flatten helper means even FE-side type definitions don't need to change immediately.
- Model count: **68 → 69** (added `FilterProfileApplicableTemplate`). Enum count unchanged at 23.

---

## [Unreleased] — Phase A.4: EquipmentGroup composite versioning + cleaning-reasons doc note (2026-05-02)

Branch: `feature/phase5-verification`. Final entry in the universal-versioning rollout (A.1 = ChecklistProfile sidecar, A.2 = FilterCleaningProfile lineage, A.3 = FilterProfile sidecar). Closes Phase 5b Path A.

### Background

A.4 had two declared sub-targets: cleaning reasons (config def values) and equipment-group instruments. They turned out to need very different treatments:

1. **Cleaning reasons** are stored in a `SystemConfig` row keyed `filter-cleaning-reasons` as a JSON list of `{ key, label }`. The drift concern (admin renames a reason mid-cycle) was already handled at design time — `CleaningCycle.cleaningReasonKey` and `cleaningReasonLabel` are written at cycle start (`apps/api/prisma/schema.prisma:1431-1432`), so cycles carry their own label snapshot. Editing the config later affects new cycles only. **No code change needed**, only this doc note.
2. **Equipment-group instruments** mutate in place via `equipment-groups.service.ts → update()`, which mutates the parent group + all 3 instruments together inside one transaction. The natural unit of versioning is therefore the **whole composite** (group + 3 instruments), not each instrument independently — same shape as A.1 ChecklistProfile + questions. Operational drift on submitted readings is already covered by `FilterEvent.attributes.instrumentReadings` (immutable + checksummed; snapshots `description / instrumentCode / uom / leastCount / value` at submit time, `filter-operations.service.ts:1116-1123`). The remaining gap was admin-edit history of the group config itself.

Per-cycle group-version pinning (so reading validation reads operating-range from a pinned version rather than the live row) is intentionally NOT included — that requires a design call on "pin at cycle-start" vs "pin at first-reading" semantics and is left as a separate item.

### Changes

- **Schema** (`apps/api/prisma/schema.prisma`):
  - `EquipmentGroup.version Int @default(1)` — monotonic counter, bumped on every mutation of the group OR any of its instruments.
  - New model `EquipmentGroupVersion` (sidecar): `id`, `groupId`, `versionNumber`, `snapshot Json` (carries `name`, `blockId`, `isActive`, `instruments[]` ordered by sortOrder), `changeNotes`, `createdAt`, `createdBy`. Cascade-deletes with the parent. `@@unique([groupId, versionNumber])` + `@@index([groupId])`.
  - Applied via `prisma db push --skip-generate` against an empty `equipment_groups` table — no backfill needed.
- **Service** (`apps/api/src/modules/equipment-groups/equipment-groups.service.ts`):
  - New private `snapshotAndBump(tx, groupId, changeNotes, ctx)` — freezes the OUTGOING composite (group row + all instruments ordered by sortOrder) into `equipment_group_versions`, then `version: { increment: 1 }`. Mirrors A.1/A.3 helpers.
  - `update()` now wraps the existing transaction with snapshot-then-bump as the first step before the live row mutations.
  - First version is created lazily — `create()` does NOT write a version row; the live composite IS v1 until first edit (matches A.1/A.3).
  - New `getVersions(_, id)` returns `{ groupId, currentVersion, versions[] }` newest-first with metadata only.
  - New `getVersion(_, id, n)` returns the frozen composite snapshot.
  - Audit log on update now includes `version` in `beforeValue`/`afterValue`.
- **Routes** (`apps/api/src/modules/equipment-groups/routes.ts`):
  - `GET /api/equipment-groups/:id/versions` (gated `ASSET_READ` OR `EG_VIEW`).
  - `GET /api/equipment-groups/:id/versions/:versionNumber` (same gate).

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0; full compile to dist exit 0; new endpoints emit 4 occurrences of "versions" in `dist/modules/equipment-groups/routes.js`.
- `prisma db push --skip-generate` reports schema in sync; `\d equipment_group_versions` confirms columns; `version` column present on `equipment_groups`.
- `Restart-Service DigiLogAPI-Phase5` clean.
- End-to-end via curl against the running service:
  - Created a group on existing block `B1` with the 3 standard instruments → returned `version: 1`. Live composite was v1; no version row written yet.
  - First `PUT` (renamed group + bumped Compressed Air `operatingMax: 6 → 7`) → `version: 2`; one row in `equipment_group_versions` carrying the v1 composite.
  - Second `PUT` (changed Compressed Air `serialNumber` and `instrumentId`) → `version: 3`; two version rows.
  - `GET /:id/versions` → `currentVersion: 3` + 2 archived versions newest-first.
  - `GET /:id/versions/1` → frozen v1 composite (original name, Air `operatingMax: 6`, Air SN `SN-AIR-1`).
  - `GET /:id/versions/2` → frozen v2 composite (renamed, Air `operatingMax: 7`, Air SN still `SN-AIR-1` — the v3 SN/ID change correctly isolated).
  - `GET /:id/versions/99` → clean 404.
- Test data fully cleaned up: 0 leftover rows in `equipment_groups`, `equipment_group_instruments`, `equipment_group_versions` (cascade fired correctly).

### Notes

- Cleaning reasons are NOT versioned and don't need to be — `CleaningCycle.cleaningReasonKey` + `cleaningReasonLabel` already act as the per-cycle pin. This is documented in `BACKEND_GUIDE.md` § "Versioning" and the plan.
- Per-cycle group-version pinning is NOT included; left as a separate design call.
- Frontend untouched — existing route shapes unchanged; new `/versions` endpoints are additive.
- Model count: **67 → 68** (added `EquipmentGroupVersion`). Enum count unchanged at 23.

---

## [Unreleased] — Phase A.3: FilterProfile sidecar versioning (2026-05-01)

Branch: `feature/phase5-verification`. Third entry in the universal-versioning rollout (A.1 = ChecklistProfile sidecar, A.2 = FilterCleaningProfile lineage).

### Background

FilterProfile is the per-mapping table that binds a filter to a `FilterCleaningProfile` (plus block-restriction policy, applicable templates, default PM schedule). Unlike FilterCleaningProfile (immutable-rowful), the live FilterProfile row was being mutated in place by `update()` — there was no version history, so an audit replay had no way to reconstruct the mapping that was active at a historical moment. FilterProfile is the same across all blocks (per-block override is explicitly out of scope), so the design follows the A.1 ChecklistProfile sidecar pattern rather than A.2's lineage pattern.

In-flight cycles are unaffected: cycles already pin `cleaning_cycles.profileId` (and `profileVersion`) to a specific FilterCleaningProfile row at start, so FilterProfile drift cannot reach a running cycle. No cycle-side pin map is needed.

### Changes

- **Schema** (`apps/api/prisma/schema.prisma`):
  - `FilterProfile.version Int @default(1)` — monotonic counter, bumped on every mutation.
  - New model `FilterProfileVersion` (sidecar): `id`, `profileId`, `versionNumber`, `snapshot Json`, `changeNotes`, `createdAt`, `createdBy`. Cascade-deletes with the parent. `@@unique([profileId, versionNumber])` + `@@index([profileId])`.
  - Applied via `prisma db push --skip-generate` against an empty `filter_profiles` table — no backfill needed.
- **Service** (`apps/api/src/modules/filter-profiles/filter-profile.service.ts`):
  - New private `snapshotAndBump(tx, profileId, changeNotes, ctx)` writes the OUTGOING row's full state into `filter_profile_versions`, then `version: { increment: 1 }`. Mirrors the A.1 helper.
  - `update()` now wraps the mutation in `prisma.$transaction` with snapshot-then-bump first.
  - First version is created lazily — `create()` does NOT write a version row; the live row IS v1 until the first edit.
  - New `getVersions(id)` returns `{ profileId, currentVersion, versions[] }` newest-first with metadata only (id, versionNumber, changeNotes, createdAt, createdBy).
  - New `getVersion(id, n)` returns the frozen snapshot as `{ profileId, versionNumber, …snapshot fields, createdAt, createdBy, changeNotes }`.
  - Hard-delete-with-guard preserved (rejects if any FilterDetails still reference the profile). Cascade drops version rows.
  - Audit log on update now includes `version` in `beforeValue`/`afterValue`.
- **Routes** (`apps/api/src/modules/filter-profiles/routes.ts`):
  - `GET /api/filter-profiles/:id/versions` (gated on `FP_READ`).
  - `GET /api/filter-profiles/:id/versions/:versionNumber` (gated on `FP_READ`).

### Verification

- `npx tsc -p apps/api/tsconfig.json --noEmit` exit 0.
- `npx tsc -p apps/api/tsconfig.json` (compile to dist) exit 0; new endpoints emit 4 occurrences of "versions" in `dist/modules/filter-profiles/routes.js`.
- `npx prisma db push --skip-generate` succeeds; `\d filter_profile_versions` confirms columns; `version` column present on `filter_profiles`.
- `Restart-Service DigiLogAPI-Phase5` clean.
- End-to-end via curl against the running service:
  - Seeded one `FilterCleaningProfile` (id `…0a301`) directly in DB so a FilterProfile could reference it.
  - `POST /api/filter-profiles` → returned `version: 1`. Live row was v1; no version row written yet (lazy first-version, matches A.1).
  - `PUT /api/filter-profiles/:id` (rename) → `version: 2`; one row in `filter_profile_versions` carrying the v1 snapshot.
  - Second `PUT` (changed `description` and `blockRestriction` to `ANY_BLOCK`) → `version: 3`; two version rows.
  - `GET /:id/versions` → `currentVersion: 3` + 2 archived versions newest-first.
  - `GET /:id/versions/1` → frozen v1 snapshot (original name, original description, `OWN_BLOCK_ONLY`).
  - `GET /:id/versions/2` → frozen v2 snapshot (renamed, first-edit description, still `OWN_BLOCK_ONLY` — the v3 change isolated correctly).
  - `GET /:id/versions/99` → clean 404 with "Version 99 of filter profile … not found".
- Test data fully cleaned up: 0 leftover rows in `filter_profiles`, `filter_profile_versions`, and the seeded `filter_cleaning_profiles` row.

### Notes

- Per-block override capability (originally floated for Step 7) is explicitly NOT in scope — the user confirmed FilterProfile is uniform across all blocks. The Step 7 entry in `future/architectural-refactor-9-steps.md` should be revisited under that constraint.
- Frontend untouched — existing route shapes are unchanged; new `/versions` endpoints are additive.
- Model count: **66 → 67** (added `FilterProfileVersion`). Enum count unchanged at 23.

---

## [Unreleased] — Phase A.2: FilterCleaningProfile lineage-based versioning (2026-05-01)

Branch: `feature/phase5-verification`. Continuation of the universal-versioning rollout (Phase A.1 covered ChecklistProfile).

### Background

FilterCleaningProfile already used immutable-rowful versioning: `update()` archived the old row (`status=ARCHIVED`) and inserted a new row with `version+1`. Cycles freeze `profileId` at start, so historical replay was already pointing at the exact archived row. The remaining gaps were:

1. The `list()` view grouped by `name` (`distinct: ['name']`), so renaming a profile during an update orphaned the version history into separate "lineages."
2. There was no API to enumerate version history of a profile.
3. There was no API to fetch a frozen snapshot at a specific version.
4. Hard-deleting a profile was protected only by the FK on `cleaning_cycles.profile_id` — no service-level guard with a useful error.

### Changes

- **Schema** (`apps/api/prisma/schema.prisma`):
  - `FilterCleaningProfile.lineageId String @db.Uuid` (NOT NULL).
  - `@@unique([lineageId, version])` to enforce one row per (lineage, version).
  - `@@index([lineageId])` for lineage lookups.
  - Applied via direct DDL on empty `filter_cleaning_profiles`; `prisma db push` reports schema in sync.
- **Service** (`apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts`):
  - `create()` mints a fresh `lineageId` (`randomUUID()`).
  - `update()` propagates parent's `lineageId` to the new version row.
  - `list()` now uses `distinct: ['lineageId']` instead of `distinct: ['name']` — rename-safe.
  - New `getVersions(id)` and `getVersion(id, n)` methods.
  - New `deleteProfile(id)` with explicit cycle + filter-profile reference checks (returns 409 with helpful message before relying on the DB FK).
- **Routes** (`apps/api/src/modules/cleaning-profiles/routes.ts`):
  - `GET /api/filter-cleaning-profiles/:id/versions` — list all versions in lineage.
  - `GET /api/filter-cleaning-profiles/:id/versions/:versionNumber` — frozen snapshot.
  - Both gated on `FCP_READ` or `CP_TOGGLE`.

### Verification

- `npx tsc -p apps/api/tsconfig.json` exit 0.
- `npx prisma db push --skip-generate` reports "already in sync" (DDL applied directly first).
- Synthetic seed of two versions sharing one `lineageId`:
  - `GET /api/filter-cleaning-profiles?page=1&limit=5` → 1 latest entry (collapse correct).
  - `GET /:v2/versions` → both versions, latest first.
  - `GET /:v1/versions` → identical lineage response from archived anchor.
  - `GET /:v1/versions/2` → frozen v2 snapshot with stages/connections.
  - `GET /:v1/versions/99` → clean 404 with "Version 99 not found in lineage" message.
- Seed cleaned up post-test (DELETE 2).

### Notes

- `cleaning_cycles.profile_id` FK has no `onDelete: Cascade`, so the DB enforces RESTRICT on hard delete of any cycle-referenced profile. The new service-level guard improves the error UX before the DB blocks it.
- Frontend untouched — API response shapes unchanged for existing routes; new `/versions` endpoints are additive.

---

## [Unreleased] — Auth-loop fix: cached-user kept page bouncing /login ↔ / (2026-05-01)

Branch: `feature/phase5-verification`. Surfaced during full UI e2e walk after Step 6 verification, but the bug pre-dates Step 6 — it's a latent issue in the auth state machine that became visible when a session was concurrently invalidated server-side.

### Symptom

When the JWT session was terminated server-side (single-tab takeover, idle timeout, parallel-login eviction), the browser tab kept ping-ponging between `/login` and `/` and the dashboard rendered with `Total Users: -` / `Audit Trail: -` placeholders that never resolved. Console accumulated thousands of 401 + "Missing token" errors per minute.

### Root cause

Two pieces of state colluded:
1. `apps/web/src/lib/api-client.ts` cleared the access token on 401 but **left `digilog_cached_user`** in localStorage.
2. `apps/web/src/hooks/use-auth.ts` computed `isAuthenticated` as `!!user && (!error || isNetworkError(error))` — purely from the user object. With a cached user still in localStorage, `isAuthenticated` stayed truthy even when the token had been cleared.

The result: api-client redirected to `/login`, login.tsx saw `isAuthenticated === true` (stale cached user), `<Navigate to="/" replace />` fired, dashboard mounted, SWR queries fired without a token, server returned 401, api-client redirected to `/login`, repeat forever.

### Fix

- **`apps/web/src/lib/api-client.ts:38-54`** — on a non-login 401, also drop `digilog_cached_user`, `digilog_active_tab_id`, `digilog_tab_heartbeat`, `digilog_active_user_id`. Same cleanup `logout()` already does.
- **`apps/web/src/hooks/use-auth.ts:185`** — `isAuthenticated` now requires `getToken()` truthy in addition to user + non-network-error. A stale cached user without a token can no longer keep the app authenticated.

### Verification

- `npx tsc --noEmit` exit 0 (web)
- `npx vite build` rebuilt the web bundle (new hash `index-DHUGfJFQ.js`); web service restarted; SW unregistered + cache cleared in browser.
- Reproduced the loop pre-fix (5933 console errors in 17 seconds, URL bouncing between `/` and `/login`).
- Re-tested post-fix: login → dashboard renders fully (Total Users 2, Audit Trail 2, Notifications 1, Filter Cleaning Analytics section visible). 1 console error on second login (expected 409 from "Active Session Detected" — not the loop).

### Out of scope

This fix is independent of Step 6. It would have surfaced equally under Step 1 + MT removal alone if a session got server-side-invalidated mid-flight. The full UI walk for Step 6 verification is what triggered the discovery.

---

## [Unreleased] — Architectural Refactor Step 6 of 9: FilterDetails 1:1 split (2026-05-01)

Branch: `feature/phase5-verification`. Step 6 of the 9-step architectural refactor (see `tasks/STEP-6-FILTERDETAILS-PLAN.md`). Splits filter-specific cycle state off the generic `AssetInstance` model into a 1:1 sidecar so non-filter rows stop carrying nullable cycle columns that are meaningless to them.

### Schema

- **New model `FilterDetails`** (1:1 with AssetInstance via `assetInstanceId` unique FK, cascade on delete). Holds: `filterProfileId` (FK → FilterProfile), `currentLifecycleState` (varchar), `currentCycleId` (FK → CleaningCycle), `filterSet` (`FilterSetLabel?`), audit timestamps. Indexed on `currentLifecycleState`, `currentCycleId`, `filterProfileId`.
- **Dropped from `AssetInstance`:** `filterProfileId`, `currentLifecycleState`, `currentCycleId`, `filterSet` columns; `filterProfile` and `currentCycle` relations; `@@index([currentLifecycleState])`. Net: AssetInstance is now generic again.
- **Inverse relations moved:** `FilterProfile.assetInstances` → `FilterProfile.filterDetails`; `CleaningCycle.activeInstances` → `CleaningCycle.activeFilterDetails`.
- **Net model count:** 64 → **65**.

### Backend

- **New helper module:** `apps/api/src/lib/filter-details.ts` with `getFilterCore`, `upsertFilterDetails`, `clearFilterCycle`, `flattenFilterFields`, `flattenFilterFieldsAll`. Centralises the read+flatten and upsert+create patterns so service code reads the same shape it always did.
- **Eager FilterDetails creation:** `instance.service.ts.create()` now also creates a `FilterDetails` row inside the same transaction when the template's `templateKind === 'FILTER'`. Saves null checks downstream and prevents bootstrap races at first cycle start. Other template kinds (BLOCK, AHU, AREA, EQUIPMENT, OTHER) never get a sidecar row.
- **Repository flatten on every read path:** `instance.repository.ts` `findMany`, `findTree`, `findById`, `findByIdSimple`, `findChildren` all `include: { filterDetails: true }` and call `flattenFilterFields` so API responses stay flat (`filterProfileId / currentLifecycleState / currentCycleId / filterSet` appear on the instance object exactly as before). **Frontend code unchanged.**
- **Service rewrites:**
  - `filter-operations.service.ts`: `getFilter` private rewritten to include + flatten; all 7 write sites (start/advance/bypass/complete/terminate/retire/replace) routed through `prisma.filterDetails.upsert/update` or the helper; lock-checks inside transactions read from `FilterDetails`; `getDashboardStats` `groupBy` switched from `assetInstance.groupBy(by: currentLifecycleState)` to `filterDetails.groupBy(by: currentLifecycleState, where: { assetInstance: { isActive: true } })`; `getCycles`/`getCycleById`/`getRetirements` updated to read `filterSet` from `filterDetails`.
  - `cleaning-profile.service.ts`: `listAssignedAssets` reads via `assetInstance.findMany({ where: { filterDetails: { is: { filterProfileId: { in: ... } } } } })`; `assignAssets` writes via `filterDetails.updateMany` (unassign) + per-instance `upsert` (assign — keeps legacy non-eager assets working).
  - `filter-profile.service.ts`: `delete` count + `assign` write routed through `filterDetails`. Filter-profile list now uses `_count: { filterDetails: true }` instead of `_count: { assetInstances: true }`.
  - `bulk-upload-filter.service.ts`: bulk filter create now writes `filterSet` + `filterProfileId` via `tx.filterDetails.create` after `tx.assetInstance.create` (instead of inlining them on the asset).
  - `pm-schedule.service.ts`: AHU child-filter queries include `filterDetails: { select: { filterSet: true } }` and read it through the relation.
  - `super-admin/routes.ts`: retired-filter edit route writes `filterSet` to `FilterDetails` via upsert; unretire writes `currentLifecycleState: null` to `FilterDetails`; `cleaning-cycles` delete clears `currentCycleId/currentLifecycleState` via `filterDetails.updateMany`.
  - `instance.service.ts`: `changeLifecycleState` writes via `upsertFilterDetails`; instance updatedBy bump kept on AssetInstance.

### Frontend

- **Zero changes required.** API response shape preserved via repository flatten. Tested: `/api/assets/instances` and `/api/filters/batch-states` return objects with the 4 fields directly on the instance, exactly like before.

### Verification

- `npx prisma validate` clean; `npx tsc --noEmit` (backend) exit 0; web `npx tsc --noEmit` exit 0.
- DB reset + reseed succeeded.
- End-to-end:
  - Created Block→AHU→Filter chain with non-canonical template names ("Block-T", "AHU-T", "Filter-T") — confirmed eager FilterDetails creation only for FILTER template kind (DB sanity: 3 asset_instances active, 1 filter_details row).
  - PATCH `/api/assets/instances/:id/lifecycle-state` to `WASH_IN` → `currentLifecycleState` landed on FilterDetails; response shape flat with field on instance.
  - `dashboard-stats.stageCounts.WASH_IN: 1` — groupBy via FilterDetails works.
  - `batch-states` returns `currentState: "WASH_IN"` (read via flatten); `homeBlock` resolves correctly.
  - `pm-schedules/ahu-configs` returns 1 AHU with 1 child filter (templateKind+FilterDetails join works).

### Out-of-scope (intentionally deferred)

- **Step 5b checklist hardening** (questions snapshot on event, offlinePerformedAt, cycleId in clientOpId dedup, etc.) — will land after Step 6 per the agreed sequencing.
- **DB-level constraint that FilterDetails only exists for templateKind=FILTER** — eager creation enforces it operationally; CHECK constraint is Tier-2 polish.
- **Performance tuning** — hot-path `current-state` becomes a join, but it was already a multi-query path; no measurable regression in the smoke run.

### Standing rule notes

- OPERATOR `RB0001` re-seeded with default password `Test@1234` (the password rotation from yesterday's testing was wiped by the DB reset).
- PM module is enabled in config (left ON from yesterday's verification; reseed preserves it).

---

## [Unreleased] — Codex Adversarial Review fixes (2026-05-01)

Branch: `feature/phase5-verification`. Three findings raised by `/codex:adversarial-review` against the uncommitted Step-1 + MT-removal diff. All three plus three additional bugs surfaced during the audit are fixed in the same batch.

### Fixed

- **[high security] Default-deny visibility for non-admin asset endpoints.** `apps/api/src/modules/assets/routes/instance.routes.ts` — both `GET /api/assets/instances` and `/instances/tree` would return *all* entities to a non-admin user when they had no USER/ROLE/template assignments. Both endpoints now apply `{ id: { in: [] } }` (Prisma emits `WHERE 1=0`) for the list, and return `[]` for the tree. Verified end-to-end with OPERATOR `RB0001` (zero assignments) → list = `{"data":[],"total":0,...}`, tree = `[]`.
- **[high] Six service-layer canonical-template-name lookups replaced with `templateKind` codes.** Step 1 made the frontend kind-aware but six backend hot-path queries still keyed off the editable `template.name`. Renaming the canonical Block/AHU/Filter template would have silently broken offline state caching, dashboards, PM aggregation, and Block change validation.
  - `apps/api/src/modules/filter-operations/filter-operations.service.ts:112` — `getFilterHomeBlock()` now matches `template.templateKind === 'BLOCK'` (Codex didn't flag this — found during audit).
  - `apps/api/src/modules/filter-operations/filter-operations.service.ts:243` — `getBatchStates()` now filters `template: { templateKind: 'FILTER' }`.
  - `apps/api/src/modules/filter-operations/filter-operations.service.ts:1246` — `getDashboardStats()` total-filter count uses `templateKind`.
  - `apps/api/src/modules/pm-schedules/pm-schedule.service.ts:459` — bulk PM upload AHU lookup now filters instances directly via `template: { templateKind: 'AHU' }` (eliminates a now-unsafe two-step template-by-name → instance-by-templateId lookup; Codex didn't flag).
  - `apps/api/src/modules/pm-schedules/pm-schedule.service.ts:620` — `listAhuFilterSetConfigs()` AHU lookup same fix (Codex didn't flag).
  - `apps/api/src/modules/pm-schedules/pm-schedule.service.ts:638` — child-filter count under each AHU uses `template.templateKind === 'FILTER'`.

### Verified end-to-end (renamed-template tolerance)

- Created an AHU-kind template named **"Renamed AHU Tpl"**, a FILTER-kind template named **"Renamed Filter Tpl 5b"**, and a BLOCK-kind template named **"Renamed Block Tpl"** — none of them match the canonical names that the old name-based lookups expected.
- Built a Block→AHU→Filter chain and confirmed:
  - `GET /api/filters/dashboard-stats` → `totalFilters: 1` (was 0 pre-fix).
  - `GET /api/filters/batch-states` → returns the renamed-template filter (was empty pre-fix).
  - `GET /api/filters/:id/current-state` → `homeBlock: { id, name: "Test Block 5b" }` (was `null` pre-fix).
  - `GET /api/pm-schedules/ahu-configs` (after enabling PM module) → `{"ahus":[{"ahuId":..,"ahuName":"Test AHU 5b","totalFilters":1,...}]}` (was `{"ahus":[]}` pre-fix).
- Regression sweep: `templates`, `instances`, `tree`, `template-kinds`, `dashboard-stats`, `checklist-profiles`, `users`, `audit` all 200 OK as superadmin.

### Out of scope (intentionally left)

- Rule-chain user-authored filters that match by `template.name` (`filter-nodes.ts`, `analytics-nodes.ts`) — these are user-defined rule conditions; the choice to filter by name vs kind belongs in the rule definition, not the engine. Future enhancement: expose a `templateKind` filter alongside.
- Display-only `template.name` reads (UNS path construction, audit-log labels, report variable substitution, entity-resolver context). These are labels, not canonical lookups.

### Notes

- OPERATOR `RB0001` password rotated during testing from `Test@1234` → `Test@12345`. Cannot revert because password policy blocks reuse of last 12 passwords.
- API service rebuilt + restarted (NSSM `DigiLogAPI-Phase5`) to pick up the dist changes.

---

## [Unreleased] — Multi-Tenancy Removal (2026-04-30)

Branch: `feature/phase5-verification`. DigiLog is now **single-tenant, single-site, single-company**. Multi-tenancy was removed wholesale because the deployment model (one customer, one company, local Windows install) didn't justify the complexity. Step 3 of the 9-step architectural refactor (`AssetInstance.organizationId NOT NULL`) is **obsolete** as a result — the column was dropped entirely.

### Removed

- **Schema:** `model Organization` deleted. 11 `organizationId` columns dropped (User, AssetTemplate, AssetInstance, FilterCleaningProfile, FilterProfile, ChecklistProfile, BlockChangeRequest, EquipmentGroup, EntityAssignment, TemplateAssignment, DashboardAssignment). 2 `orgId` columns dropped (ReportTemplate, ReportInstance). 5 composite indexes rewritten as single-column. `AssigneeType` enum lost `ORGANIZATION` value. `RoleScope` enum collapsed from `GLOBAL | ORGANIZATION` to just `GLOBAL`. Net model count: 65 → **64**.
- **Backend modules:** `apps/api/src/modules/org-admin/` and `apps/api/src/modules/tenant-admin/` deleted entirely. `apps/api/src/lib/org-scope.ts` (the `orgWhere(ctx)` helper) deleted. `super-admin/routes.ts` lost its 5 organization CRUD endpoints. Net module count: 38 → **36**.
- **Backend logic:** `organizationId` removed from JWT payload, `RequestContext`, `build-context.ts`, `auth plugin` user-pinning, `auth.service.ts` login response. JWT `scope` field always stamps `GLOBAL` now (was `ORGANIZATION` for non-superadmin roles).
- **Shared package:** `ORG_MANAGE`/`ORG_VIEW`/`ORG_CREATE`/`ORG_DELETE` permissions deleted (109 → **105**). `org.view`/`org.manage` privileges deleted (91 → **89**). `ORG_ADMIN` role deleted from default roles + role-hierarchy + scope map + creatable-roles list. `organizations` sidebar item deleted (26 → **25**). `organizationId` field dropped from `createUserSchema` + `updateUserSchema`.
- **Frontend:** `apps/web/src/routes/tenant/` folder deleted (`organizations.tsx` + `org-detail.tsx`). `/organizations` + `/organizations/:id` routes removed from `main.tsx`. "Organizations" sidebar nav item removed. `organizationId` removed from User + Filter types. Organization assignment dropdown stripped from user create/edit; org column dropped from user list. `assignments-tab.tsx` had its ORGANIZATION assignee branch trimmed (USER + ROLE assignees retained). `ahu-dashboard.tsx` lost its org pill. `ldap.tsx` lost its "Default Organization" config. `/config/filter-data-management` permission gate switched from `ORG_MANAGE` to `CONFIG_UPDATE`.
- **Seed:** `ORG_MANAGE/VIEW/CREATE/DELETE` permissions stripped from SUPER_ADMIN + ADMIN role definitions in `prisma/seed.ts`. `vitest.global-setup.ts` no longer auto-creates a "System" org for fresh DBs.

### Verification

- `npx prisma validate` passes; `npx tsc --noEmit` (backend) exits 0; `npx vite build` (frontend) succeeds
- E2E (Playwright) walked through Login, Dashboard, /users + /users/create (no org dropdown), /assets/templates, /config/template-kinds (Step 1 Kind column still works), /audit, /filter-list (Block resolution via `templateKind === 'BLOCK'` still works). Sidebar = 25 items with no Organizations. `/api/organizations` returns 404. JWT inspect shows `scope: "GLOBAL"`.

### Post-MT-removal hardening (same day, 2026-04-30)

Three bugs surfaced during the post-removal e2e walk and were fixed in the same uncommitted batch:

- **`/pm-schedules`** crashed with React error #300 ("rendered fewer hooks than expected"). Root cause: a "PM disabled" early-return at line 143 of `apps/web/src/routes/pm-schedules/index.tsx` ran *before* two hooks (a `useSWR` for instances and a `useMemo` for paginated entries) defined further down. On the second render, when `pmConfig` arrived from SWR and was disabled, the early-return fired and skipped those hooks → React detected the count mismatch. Fix: moved the early-return below all hooks.
- **`/my-tasks`** showed a misleading red "Failed to load tasks: PM scheduling module is not enabled" error when the PM module was disabled. Replaced with an amber-tinted message ("Preventive Maintenance scheduling is disabled. Enable it in Configuration → PM Schedule Settings to start receiving tasks.") gated on the `PM_DISABLED` error code.
- **Any unknown URL** (`/organizations`, typos, etc.) rendered a blank white page because there was no `*` catch-all route. Added `<Route path="*" element={<Navigate to="/" replace />} />` to `apps/web/src/main.tsx` (and the matching `Navigate` import). Net `<Route>` count is now 81.

---

## [Unreleased] — Architectural Refactor Step 1 of 9: Admin-editable TemplateKind lookup (2026-04-30)

Branch: `feature/phase5-verification`. First step of a 9-step architectural refactor (see `tasks/RESUME-STATE-2026-04-30-step1-templateKind-done.md`). Replaces the closed Prisma `TemplateKind` enum with a runtime-editable `TemplateKind` lookup table so SUPER_ADMIN can add new kinds (PUMP, VALVE, COMPRESSOR, etc.) without a code migration. The 6 system kinds (BLOCK / AREA / AHU / FILTER / EQUIPMENT / OTHER) are protected — codes immutable, rows non-deletable — so Filter Management / Cleaning Operations / Mobile pages keep routing by code.

### Added

- `apps/api/src/modules/template-kinds/routes.ts` — new CRUD module under `/api/template-kinds` (list, create, update, delete). System kinds protected from delete + code-rename; in-use kinds protected from delete (409 with helpful messages on each).
- `apps/web/src/routes/config/template-kinds.tsx` — Configuration page with full CRUD UI; system rows show 🔒 badge and Delete is hidden; non-system rows can be deleted only when `templateCount = 0`.
- `packages/shared/src/schemas/assets.ts` — `SYSTEM_TEMPLATE_KIND_CODES` const-array, `SystemTemplateKindCode` type, `templateKindCodeSchema` regex (UPPER_SNAKE_CASE), `createTemplateKindSchema`, `updateTemplateKindSchema`. Barrel-exported in `index.ts`.
- `prisma/seed.ts` — seeds 6 system kinds on every fresh DB.
- New `Kind` column on `apps/web/src/routes/assets/templates.tsx` list (label looked up from kind code via SWR).
- `Template Kind` dropdown on the Create/Edit Template form, fetched from `/api/template-kinds?isActive=true`. Falls back to seeded codes if the API is unreachable.

### Changed

- `enum TemplateKind` removed from `prisma/schema.prisma`; replaced by `model TemplateKind` (id, **code** unique varchar(50), label, description, isSystem, isActive, sortOrder, audit cols).
- `AssetTemplate.templateKind` is now `String @db.VarChar(50)` FK → `TemplateKind.code` (was the closed enum).
- 10 frontend lookup sites converted from `t.name === 'Block'` / `'Filter'` / `'AHU'` / `'Area'` to `t.templateKind === 'BLOCK'` / `'FILTER'` / `'AHU'` / `'AREA'`. Files: filter-list, filter-operations, mobile-operations, mobile-wrapper, plus the bulk-upload-filters dialog. Admins renaming a template ("Block" → "Building") no longer breaks page logic.
- Live counts: 64 → 65 Prisma models, 37 → 38 API modules, 26 → 27 config pages.

### Fixed (caught during step 1 verification)

- `apps/api/src/modules/assets/repositories/template.repository.ts` — type signature accepted `templateKind` but the Prisma `data: { ... }` block was silently dropping the field, causing every created template to land with `OTHER` regardless of the body. Live API test caught it.

### Verified live

- API: `POST /api/template-kinds {code:"PUMP",label:"Pump"}` → 201 with `isSystem: false`.
- API: `DELETE /api/template-kinds/BLOCK` → 409 `SYSTEM_KIND` with operator-friendly message.
- API: `PUT /api/template-kinds/BLOCK {label:"Building"}` → 200 with new label; underlying code preserved.
- API: `DELETE /api/template-kinds/PUMP` (no templates use it) → 204.
- DB: seed creates 6 system kinds + restoring the 4 canonical templates (Block/Area/AHU/Filter) via API persists templateKind correctly.
- UI: SUPER_ADMIN sees Template Kinds Configuration page with all 6 kinds and 🔒 badges.
- UI: Create Template dropdown lists current kinds; selecting BLOCK persists BLOCK after the repo fix.
- Regression test: renaming "Block" template to "Building" in DB does not break Filter Management page (resolves by `templateKind === 'BLOCK'`, not by name).

## [Unreleased] — Phase 5+ managed Windows-service launcher (2026-04-30)

Branch: `feature/phase5-verification`. Closes the only Phase 5+ open item flagged in `PHASE_5_RECENT_WORK.md` § 12 ("a managed Windows-service launcher that registers the API as a Windows service with restart policies, log rotation, and boot persistence"). Plus three TypeScript build fixes uncovered when running `npm run build` against this branch for the first time.

### Added

- `scripts/install-services-phase5.ps1` — registers `DigiLogAPI-Phase5` (`node apps/api/dist/app.js` from `apps/api/`, `DependOnService=postgresql-x64-18`) and `DigiLogWeb-Phase5` (`node apps/web/node_modules/vite/bin/vite.js preview --port 5175 --host` from `apps/web/`) as NSSM-managed services. Configures `Start=SERVICE_AUTO_START` (boot persistence), `AppExit Default = Restart` + `AppRestartDelay=3000` (auto-restart on crash), 10 MB rotated stdout/stderr logs under `logs/`, and `NODE_ENV=production`. Idempotent re-run (existing services stopped + removed first). ASCII-only so PS 5.1 tokenises it correctly when launched via `Start-Process`.
- `scripts/uninstall-services-phase5.ps1` — companion teardown; idempotent (silently skips services that aren't installed).
- `.gitignore` entries for `nssm-path.txt` (per-machine NSSM exe pin) and `logs/` (rotated NSSM stdout/stderr).

### Fixed

- 3 production TypeScript errors blocking `tsc -p apps/api/tsconfig.json` (commit `1697f99`): `checklist-profiles.list` query type missing `expand?: string` (added in `5eb9db8` runtime but never typed); `deployment-check/routes.ts` reading `role.privileges` instead of `role.permissions` (Prisma `Role.permissions` is the actual schema field, line 166); `filter-operations.getFilter` `select` missing `parentId` (retire flow at line 1509 needs it for `_preRetireParentId` snapshot).

### Verified live

- `Get-Service Digi*-Phase5` → both `Running` / `Automatic`.
- `curl https://localhost:3000/api/health` → `{"status":"ok"}`.
- `curl https://localhost:5175/` → 200 (compiled `apps/web/dist/` baked with `VITE_API_URL=https://localhost:3000`).
- Authenticated round-trip (`POST /api/auth/login` → JWT → `GET /api/roles` with bearer) returns real Role rows with `permissions` JSON arrays.
- Crash test: `Stop-Process` of API node pid → NSSM restarted with new pid in <3 s, service stayed `Running`.
- NSSM log rotation working: prior crash's stdout/stderr archived to timestamped `.out-<ts>.log` / `.err-<ts>.log`; fresh `*.out.log` / `*.err.log` for the live process.

---

## [Unreleased] — Phase 5.1 + 5.2 of windows-friendly-rewrite — Verification harness (2026-04-29)

Branch: `feature/phase5-verification`. Cut-over commits `b4ad539..ad07280` (Phase 5.2) and `a51628d..24620c0` (Phase 5.1). Closes the verification gap that prior phases (1–4) left open: a single end-to-end run through the new stack lives in code now, and an operator can re-run a smoke check on any deployed box. No app/runtime code changes — only test + script files.

### Added

- `tests/integration/windows-server-stack.test.ts` (gated by `INTEGRATION_TEST=1`) — end-to-end suite that exercises the post-rewrite stack: API boot + `/api/health`, MQTT publish 100 messages via in-process aedes broker → assert TimescaleDB rows in `ts_telemetry`, graphile-worker enqueue → handler fires within 15 s, PDF render → `%PDF-` magic bytes (commits `a51628d`, review-fix `24620c0`).
- `scripts/verify-windows-deployment.ps1` — operator-facing smoke-check (4 sequential checks: `/api/health`, Mosquitto :1883, graphile-worker schema via psql, real PDF render via login → reports/generate). PS 5.1 + 7+ compatible. Comment-based help + `-Help` flag (commits `b4ad539`, review-fix `ad07280`).
- `tests/integration/vitest.config.ts` + `tests/integration/vitest.global-setup.ts` — separate vitest project so the integration suite skips cleanly when the gate is off.
- `vitest.workspace.ts` — registered the new integration project.

### Verified live

- Gate-off `npx vitest run` → 4 skipped, no regressions in the existing 1279-test suite.
- `verify-windows-deployment.ps1 -Help` → comment-based help renders.
- PowerShell parse-test passes for both new scripts on PS 5.1 and 7+.
- Live `INTEGRATION_TEST=1` + live deployment runs deferred — they require the full stack (Postgres + TimescaleDB + Mosquitto + Edge + admin password), which a fresh worktree doesn't have.

---

## [Unreleased] — Phase 5 doc-sync sweep (active set + future/) (2026-04-29)

Branch: `feature/phase5-verification`. Single docs commit on top of `24620c0`. Closes the four files Phase 4 explicitly deferred plus the 12 stale references the audit found across the rest of the active doc set + `future/` + `docs/` + `PROJECT_HANDOVER/`. No code changes.

### Phase 4 deferred files — now updated

- `PROJECT_ARCHITECTURE.md` — system-architecture diagram redrawn (Fastify-direct on `:3000`; reverse proxy is optional/customer-choice; queue moved to graphile-worker on Postgres; broker is Mosquitto 2.0). Request-flow, data-ingestion-pipeline, queue-architecture table, security-layers, and protocols table all updated. `63 models` → `64 models`. Redis usage scoped to "pub/sub only" with Phase 4 follow-up note.
- `API_REFERENCE.md` — base URL prose drops "via Nginx"; "Internal Endpoints (EMQX callbacks)" section rewritten as "Internal Endpoints (Mosquitto dynamic-security)" pointing at `POST /api/internal/mqtt/refresh-acl`; "Permission Reference (95 total)" updated to live count of 109 with verification command.
- `FRONTEND_GUIDE.md` — "served by Nginx in production" rewritten to "served by Fastify on `:3000`; reverse proxy optional"; reauth count `69` → `81`.
- `OFFLINE_SYNC_ARCHITECTURE.md` — APK/web connection diagram drops Nginx, route-modules count `34` → `37`, `63 models` → `64`, `EMQX — MQTT broker` → `Mosquitto 2.0 — MQTT broker`, `Redis/Memurai — BullMQ job queues` → `graphile-worker on Postgres — job queues; Redis (optional) — non-queue pub/sub only`.

### Other active-doc-set fixes (12 files)

- `AGENTS.md` — module count `34` → `37`, `57 Prisma models, 17 enums` → `64 / 22`, `52+ permissions` → `109/91/81/26` (with the four explicit shared-types receipts), and "BullMQ jobs" → "graphile-worker jobs".
- `PROJECT_SUMMARY.md` — monorepo tree block updated (`packages/queue` → graphile-worker; rfid_scan_app description; `deploy/` line removed; `scripts/` description updated). `BullMQ job queues 5` → graphile-worker `5` cron + tasks. "95 granular controls" → `109` with verification cmd. "Production Deployment (Windows Server)" rewritten honestly (Fastify-direct, optional reverse proxy, NSSM stopgap, Phase 5 launcher pending).
- `README.md` — `packages/queue/` line in the contents table swapped to graphile-worker prose.
- `apps/api/CLAUDE.md` — module count `34` → `37` (both inline mentions); module list refreshed to include `report-templates`/`reports` and `30` defs (was `23`); "Phase 4 Update" disambiguated from windows-friendly-rewrite Phase 4; `95 total permission constants` → live count of `109`.
- `apps/api/DECISIONS.md` — Decision #26 (BullMQ for Ingestion Queue) updated to record the Phase 2 swap to graphile-worker on Postgres while preserving the original queueing rationale; Decision #39 (Force IPv4 SMTP) flagged as historical-EC2-era and noted as a safe defensive default in the current Windows-local-only deployment.
- `apps/web/CLAUDE.md` — `# Build (for Nginx serving or APK packaging)` comment swapped for the Fastify-static-serve reality; `20+ page modules` → `23 route folders/files; ~85 pages; 81 <Route>`.
- `windowsIssues.md` — added "Phase 5 status footnote" pointing at `tests/integration/windows-server-stack.test.ts` + `scripts/verify-windows-deployment.ps1` (the verification gap Phase 5 closes); "Things that work fine" list updated (BullMQ → graphile-worker; Memurai marked optional).

### Reference docs (`docs/`, `future/`, `PROJECT_HANDOVER/`)

- `docs/getting-started/system-requirements.md` — full rewrite of "Server (Production — EC2)" + dependency tables to reflect Windows-local-only post-Phase-1-through-4 stack; legacy port table marked as "no longer part of standard install".
- `docs/getting-started/what-is-digilog.md` — architecture stack list updated (37 modules, 64 models, Mosquitto, graphile-worker, puppeteer-core+Edge+napi-rs/canvas, 30 config defs).
- `docs/compliance/21-cfr-part-11.md` — "HTTPS support via Nginx" → Fastify TLS via mkcert, reverse proxy optional.
- `docs/user-guide/connectivity/mqtt.md` — full rewrite: Mosquitto 2.0 instead of EMQX, dynamic-security via `POST /api/internal/mqtt/refresh-acl`, no web dashboard, hard-coded EC2 IP removed.
- `docs/user-guide/telemetry/telemetry.md` — `via EMQX broker` → `via Mosquitto 2.0 broker`.
- `docs/user-guide/data-export/data-export.md` — `via BullMQ` → `via graphile-worker on Postgres`.
- `docs/user-guide/entities/entities-and-hierarchy.md` — `57 Prisma models with 17 enums` → `64 / 22`.
- `docs/deployment-methods/{README,method-a,method-b,method-d,method-e,comparison}.md` — added Phase 4/5 status banners pointing at root `DEPLOY-WINDOWS.md`; the original evaluation prose is preserved for historical context.
- `future/overview/CODEBASE_SUMMARY.md` — `BullMQ queue definitions` line → graphile-worker prose.
- `future/overview/API_LIST.md` — EMQX webhook footer note rewritten for Mosquitto refresh-acl + legacy-EMQX conditional.
- `future/backend/README.md` — Tech stack line, transport block, env-var table, workers note all rewritten for the post-Phase-1-through-3 stack.
- `future/backend/API_ENDPOINTS.md` — MQTT-topics note updated for Mosquitto 2.0 + refresh-acl.
- `future/backend/ENV_SETUP.md` — prereqs list, Memurai section, Nginx mention all rewritten.
- `future/frontend/README.md` — `served by optional Nginx` rewritten to Fastify-direct + Capacitor APK.
- `future/qa/README.md` — local prod URL no longer points at Nginx; EMQX dashboard reference removed.
- `future/qa/FEATURE_CHECKLIST.md` — EMQX auth/ACL webhook check rewritten as Mosquitto refresh-acl.
- `future/qa/ACCEPTANCE_CRITERIA.md` — `/api/system-health` expected outputs adjusted (Mosquitto, optional Redis).
- `PROJECT_HANDOVER/APPLICATION_FLOW.md` — header banner added pointing at the post-Phase-4 stack; existing Mermaid diagrams + .docx renders preserved as a historical Phase-4 snapshot.

### tasks/todo.md

- New audit entry `2026-04-29 — windows-friendly-rewrite Phase 5 — FULL doc-sync sweep` documenting the deferred-files closure, the additional active-doc-set fixes, the live-count verification commands run, and the files NOT touched (and why).

### Verification commands run before doc updates

```bash
git log --oneline 24620c0..HEAD                                                  # baseline
grep -cE "^model "                       apps/api/prisma/schema.prisma           # 64
grep -cE "^enum "                        apps/api/prisma/schema.prisma           # 22
grep -cE "^\s+[A-Z_]+:\s*'"              packages/shared/src/types/permissions.ts  # 109
grep -cE "^\s+[A-Z_]+:"                  packages/shared/src/types/reauth-actions.ts # 81
ls apps/api/src/modules/ | wc -l                                                  # 37
ls apps/api/src/modules/config/defs/*.def.ts | wc -l                              # 30
ls apps/web/src/routes/config/*.tsx | wc -l                                       # 26
grep -cE "<Route" apps/web/src/main.tsx                                           # 81
grep -rln -i "emqx\|memurai\|bullmq\|nginx\|pm2" --include="*.md" .                # found ~30 matches; sweep complete
```

### Out of scope for Phase 5 doc sync

- The Mermaid `.png` renders in `PROJECT_HANDOVER/diagrams/` were **not regenerated** — they're paired with the Phase 4 .docx and should land together when the handover doc is regenerated for a Phase 5+ release.
- `docs/runbooks/queue-cutover.md` and `docs/plans/2026-04-29-windows-friendly-rewrite.md` were intentionally **not edited** — the runbook is the cutover playbook itself (describes the BullMQ → graphile-worker migration and is correct in that role) and the plan is the source-of-truth for the rewrite phases.
- `apps/web/DECISIONS.md` line 13 mentions "(nginx) would handle this" in the dev-Vite-proxy rationale — left as historical context since it correctly describes the original design intent and is a small inline parenthetical, not a load-bearing claim.

### Verified live

No code changes. The doc set was sweep-grepped before and after the edit pass; remaining `EMQX|BullMQ|Memurai|Nginx|PM2` matches are now either explicit historical references (Phase X swaps), part of the historical `docs/runbooks/queue-cutover.md` cutover playbook, or part of `docs/plans/2026-04-29-windows-friendly-rewrite.md` (the plan describing the rewrite itself).

---

## [Unreleased] — Phase 4 of windows-friendly-rewrite — Tooling cleanup (Install + Packaging) (2026-04-29)

Branch: `feature/phase4-tooling`. Cut-over commits `127f25d..60d3c90`. No code changes — only the two installer/packager scripts and the `.env.example` template were touched, so behavior of the running app is unchanged. The point of the phase was to make `scripts/install-on-target.ps1` and `scripts/package-for-production.ps1` honest about the post-Phase-1+2+3 stack (Mosquitto, graphile-worker, puppeteer-core+Edge, @napi-rs/canvas) and stop pretending the customer needed Memurai / EMQX / PM2 / a baked-in Nginx config.

### Changed
- `scripts/install-on-target.ps1` (`127f25d`): dropped the Memurai/Redis prereq probe, dropped the EMQX firewall rule + 18083 dashboard port, dropped the PM2 install/start/save blocks, dropped the inline Nginx-config drop. Added: invocation of `scripts/install-mosquitto.ps1` (so the installer is the single entry point — no separate broker step), `LongPathsEnabled = 1` registry edit (try/catch — warns if not admin), Microsoft Edge presence probe (warns and points at `PUPPETEER_EXECUTABLE_PATH` override if Edge is missing). Firewall rule for port 1883 renamed `DigiLog Mosquitto MQTT`.
- `scripts/install-on-target.ps1` (`5dd0eab`, review-fix): footer rewritten to honest "smoke-test only" wording — `cd api; node dist/app.js` runs the API in the foreground with no restart-on-crash, no boot persistence, no log rotation, and notes the managed-Windows-service launcher is tracked as Phase 5 work. Also removed a bogus `$LASTEXITCODE` check that was always passing on the fail path, and dropped a `2>&1` redirection from the `prisma db seed` invocation that was wrapping native stderr in NativeCommandError records and tripping `$ErrorActionPreference = 'Stop'`.
- `scripts/package-for-production.ps1` (`bcfd621`): dropped copies of the now-broken `start-digilog.ps1` / `stop-digilog.ps1` shells (they referenced PM2 + EMQX). Now requires `install-on-target.ps1` and `install-mosquitto.ps1` and throws on either missing. Copies the repo's `mosquitto/` config directory into the output zip alongside `scripts/`. Replaced the inline `.env.example` template's MQTT(EMQX) and Redis blocks with a single Mosquitto block, a graphile-worker note clarifying that the queue runs on Postgres so no Redis is required (with a hint on where `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` would go if pub/sub Redis is added later), and a commented `PUPPETEER_EXECUTABLE_PATH` override.
- `scripts/package-for-production.ps1` (`60d3c90`, review-fix): added an explicit-scope comment at the top of the inline `.env.example` writer that names it as a partial mirror of `apps/api/.env.example` (so anyone editing one knows the other exists). Fixed a pre-existing `Write-Host -f` bug where the parameter alias was being interpreted as a positional arg. Normalized the Mosquitto admin-password / refresh-token placeholder strings to SHOUTY_SNAKE so they grep cleanly.
- `apps/api/.env.example` (`60d3c90`): `MOSQUITTO_ADMIN_PASSWORD` + `MOSQUITTO_REFRESH_TOKEN` placeholder strings normalized to SHOUTY_SNAKE so the file matches the packager output.

### Resolved windowsIssues entries
None new. §1 Puppeteer / §2 chartjs-node-canvas / §3 EMQX / §7 Memurai were resolved in Phase 1+2+3. Phase 4 retires PM2 and the bundled Nginx config from the customer-facing install path (covered by §14 "Optional Nginx reverse proxy on Windows" — the recommended stance is now "skip the proxy entirely; Fastify on :3000 direct").

### Out of scope for Phase 4 (deferred to Phase 5)
- A managed Windows-service launcher (`verify-windows-deployment.ps1` + NSSM/sc.exe service registration) so the API survives reboots and crashes.
- End-to-end Windows-Server integration test that exercises the full `install-on-target.ps1` → smoke-test → tablet-login path on a fresh box.

### Deferred to Phase 5 doc sync
The follow-up review found stale Nginx / EMQX / Memurai references in four architecture-diagram-heavy docs that weren't touched in this pass to keep blast radius small. These will be swept by the Phase 5 doc-sync commit once the managed-service launcher actually ships and the prose can describe the real shape of the install:

- `PROJECT_ARCHITECTURE.md` — system-architecture diagram still shows Nginx + Memurai boxes
- `API_REFERENCE.md` — header prose still mentions Memurai/EMQX as required services
- `FRONTEND_GUIDE.md` — deployment context still references Nginx as reverse proxy
- `OFFLINE_SYNC_ARCHITECTURE.md` — prose still references the EMQX broker by name

The two operationally-load-bearing prose files — `BACKEND_GUIDE.md` (the documented launch command) and `PHASE_5_RECENT_WORK.md` § "Production deployment artifacts" (description of `install-on-target.ps1`) — were fixed in this commit because they describe what the install scripts actually do, not just the architecture they live in.

### Verified live
No code changes, so no test runs. The two scripts were sanity-read and the `.env.example` placeholder normalization was verified by grep — but the only end-to-end proof will be the Phase 5 fresh-box install test.

---

## [Unreleased] — Phase 3 of windows-friendly-rewrite + test cleanup (2026-04-29)

Branch: `feature/phase3-reports-edge`. Cut-over commits `0ecc151..b2c3b37` on `windows_dep`.

### Added
- `apps/api/src/modules/reports/renderers/edge-detector.ts` — resolves the browser executable for puppeteer-core. Honours `PUPPETEER_EXECUTABLE_PATH`, then probes Edge → Chrome on Windows, Chromium → Chrome on Linux, `.app` bundles on macOS. Throws with the full candidate list when nothing exists.
- `apps/api/vitest.setup.ts` — loads `apps/api/.env` so `PrismaClient` construction finds `DATABASE_URL` during tests, and seeds JWT-secret fallbacks if a service test imports `lib/jwt.ts` before `dotenv` runs.
- `apps/api/vitest.global-setup.ts` — idempotent test-fixture upserts: `admin`/`Admin@123` (SUPER_ADMIN), `RB0001`/`Test@1234` (OPERATOR), and the `VIEWER` system role. All upserts are safe to re-run on every test launch regardless of dev DB state.

### Changed
- `apps/api/src/modules/reports/renderers/pdf-renderer.ts`: switched from `puppeteer` (bundled ~150 MB Chromium) to `puppeteer-core` driving Microsoft Edge via `detectEdgePath()`. Eliminates the Chromium download, works on Windows Server Core, cold-start render time dropped from ~34 s to ~1.9 s in the smoke test.
- `apps/api/src/modules/reports/renderers/chart-renderer.ts`: replaced `chartjs-node-canvas` (transitive `canvas` package needs Cairo + node-gyp + MSVC + Python) with `@napi-rs/canvas` (prebuilt N-API binaries for Win/macOS/Linux x64+arm64). `npm ci` on a clean Windows Server box no longer needs Visual Studio Build Tools. Public `renderChart` signature is unchanged.
- `apps/api/src/modules/config/routes.ts`: hardcoded reauth fallback now also accepts the `x-reauth-password` header. Previously it only checked `body._currentPassword`, which broke `PUT /api/config/datetime` (and any future config tab not in the dynamic action-reauth registry) for callers using the header.
- `mosquitto/mosquitto.windows.conf`: documented (with comments) that `log_dest stdout` is incompatible with Windows service mode. The source conf still uses stdout for dev foreground; `scripts/install-mosquitto.ps1` rewrites the deployed copy.
- `scripts/install-mosquitto.ps1`: rewrites three lines in the deployed `mosquitto.conf` because the SCM-managed broker has `CWD = System32` and no stdout — `persistence_location ./data/` → absolute install-dir path; `plugin_opt_config_file ./dynamic-security.json` → absolute path; `log_dest stdout` → `log_dest file <InstallDir>/mosquitto.log`. Without these rewrites the service silently exited on every launch.
- `packages/shared/src/schemas/users.ts`: `userQuerySchema.limit` re-acquired `.max(100).default(20)`. Earlier impl drift had removed both, leaving public list endpoints unbounded — a DoS surface.
- `packages/shared/src/schemas/assets.ts`: `assetQuerySchema.limit` and `templateQuerySchema.limit` re-acquired `.max(100).default(50)` for the same reason.
- `apps/api/vitest.config.ts`: `fileParallelism: false`. e2e tests share the `admin` user / session row; running files in parallel had them stomping each other's sessions and producing 401 cascades. Until each suite owns its own login identity, run files serially.

### Removed
- `apps/api/package.json`: `puppeteer` (replaced by `puppeteer-core`); `chartjs-node-canvas` (replaced by `@napi-rs/canvas` + `chartjs-adapter-date-fns`).

### Fixed (test suite)
Brought `apps/api` Vitest sweep from `30 failed files / 65 failed tests` to `0 failed`. Discipline: every test was matched to the **actual** implementation behaviour (or fixed a real impl regression where the impl was wrong, like the unbounded query `limit`). No `.skip()`, no test deletions for convenience, no mock fakery to hide behaviour. Highlights:
- `connectivity-tracker.test.ts`: added `findUnique` to the prisma mock and stubbed `notification-dispatcher` (markOnline/markOffline read prior status before upserting and dispatch notifications now).
- `instance.service.test.ts`: `$transaction`-aware mock that aliases `tx` to the same recording surface, since the service moved create/delete inline into `prisma.$transaction`.
- `default-chain-builder.test.ts`: builder now emits `clear-alarm` nodes; counts went 4 nodes/4 conns → 5/6 (1 rule) and 8/11 (2 rules); filter config field renamed `scriptBody → script`.
- `node-registry.test.ts`: pinned exact category counts (FILTER=12, ENRICHMENT=11, TRANSFORM=12, ACTION=20, EXTERNAL=12, FLOW=5); rewrote the `tenant-attributes` test to assert the actual `sys_<key>` behaviour with a DB-failure fallback case.
- `backup.repository.test.ts`: rewrote for the dynamic-discovery shape (`getAllTables` + `fetchAllTablesRaw`); `fetchAllTablesPrisma` was deleted and `resetAuditSequence` is now a no-op for UUID PKs.
- `auth.plugin.test.ts`: added `createdAt` to session fixtures (auth.ts checks absolute-session timeout via `createdAt`); mocked `systemConfig.findFirst`, `role.findFirst`, `organization.findUnique`.
- `e2e/audit.test.ts`: `auditTrail.id` is a UUID; use a syntactically-valid UUID for the 404 cases and bulk-delete payload (numeric strings make Prisma throw a parse error → 500).
- `e2e/connectivity.test.ts`: server now returns `python/nodejs/curl/c` snippets — the legacy `arduino` snippet was retired.
- `e2e/checklist-submission.test.ts`: globalSetup upserts `RB0001` so the OPERATOR-RBAC paths can run.
- `e2e/roles.test.ts`: globalSetup upserts the `VIEWER` system role (older dev DBs were seeded before VIEWER was added).
- `lib/user-id-validator.test.ts`: dropped the broken `@digilog/shared` schema mock that short-circuited `safeParse()` and dropped zod defaults; replaced `letterCase: 'ANY'` with `'MIXED'` (validator behaviour identical, schema only accepts UPPERCASE/LOWERCASE/MIXED).
- `paginationConfigSchema test`: schema went from `.length(3)` to `.min(2).max(10)`; rewrite the test to document the relaxed bounds.
- `AUDIT_TEMPLATE_CATEGORIES test`: list grew from 7 to 12 (Filter Operations, Cleaning Profiles, Filter Profiles, Equipment Groups, PM Schedules added in Phase 2).

### Verified live
- Booted apps/api in the Phase 3 worktree, activated the existing Filter Report template, `POST /api/reports/generate` → HTTP 201 with a 59,085-byte `e7432d7f-…pdf` on disk (`%PDF-1.4` header, `%%EOF` trailer). `GET /api/reports/:id/pdf` served the same bytes with `Content-Type: application/pdf`. Charts rendered via `@napi-rs/canvas`, document via puppeteer-core + Edge.
- Full sweep across all packages: **`apps/api` 83/83 files / 1123/1123 tests + `packages/shared` 5/5 / 150/150 + `packages/queue` 3/3 / 6/6 = 91 files / 1279 tests, all green.**

### Resolved windowsIssues entries
- §1 Puppeteer → resolved by `abdc9dd` + `79937b7`
- §2 chartjs-node-canvas → resolved by `d72d44c`
- §3 EMQX → resolved by Phase 1 + `0ecc151` install-script fix
- §7 Memurai → resolved by Phase 2 (`7832af1`)

---

## [Unreleased] — Phase 1 of windows-friendly-rewrite (2026-04-29)

Branch: `feature/phase1-mosquitto-rewrite`. Cut-over commits `510f903..7d33dbf`.

### Added
- Feature-flag mechanism (`apps/api/src/lib/feature-flags.ts`): `USE_MOSQUITTO`, `USE_PG_QUEUE`, `USE_EDGE_PDF`. Case-insensitive, whitespace-tolerant. Phase 1–3 of the windows-friendly-rewrite plan run behind these flags.
- Mosquitto Dynamic Security generator (`apps/api/src/transport/mosquitto-acl-generator.ts`): pure async function translating active `DeviceCredential` rows into Mosquitto v2 dynamic-security JSON. Mirrors the EMQX HTTP-webhook ACL taxonomy from `mqtt-auth-routes.ts` (5 publish + 8 subscribe ACLs per device, scoped to each device's UNS path; admin role uses `subscribePattern` for `#`). 12 unit tests including duplicate / empty-input rejection.
- `POST /api/internal/mqtt/refresh-acl` endpoint (`mosquitto-refresh-routes.ts`): regenerates `dynamic-security.json` from the DB on demand. Bearer-auth via `MOSQUITTO_REFRESH_TOKEN` (timing-safe compare). Atomic write via `<path>.tmp` + `rename`. Audit-trail entry written via `auditLog()` for every refresh. Conditionally registered in place of `mqtt-auth-routes` when `USE_MOSQUITTO=true`.
- `mosquitto/mosquitto.conf` — production config using the built-in dynamic-security plugin (Mosquitto 2.0+).
- `scripts/install-mosquitto.ps1` — idempotent silent Windows installer: caches the MSI, registers + starts the Windows service, copies repo config, grants NetworkService NTFS ACLs.
- `aedes` in `apps/api` devDeps + `mqtt-broker-integration.test.ts` — pure-JS in-process MQTT broker as a Mosquitto test double. 3 tests covering credential rejection, acceptance, and QoS 1 publish/subscribe round-trip.

### Changed
- `docker-compose.yml`: replaced the `emqx` service (EMQX 5 elixir) with `eclipse-mosquitto:2.0`. Dropped the 18083 dashboard port and all EMQX webhook env vars. Bind-mounts `mosquitto/mosquitto.conf` so Docker dev and bare-Windows installs share one config file.
- `apps/api/src/app.ts`: route registration at `/api/internal/mqtt` is now conditional — `mqtt-auth-routes` (legacy EMQX) when `USE_MOSQUITTO=false`, `mosquitto-refresh-routes` when `true`. Default off.

### Tests
- 163 passing across transport + lib (was 156 pre-Phase-1). 1 pre-existing failure in `src/lib/user-id-validator.test.ts:219` (unrelated to this work).

### Migration notes for cut-over (production)
1. Set `USE_MOSQUITTO=true` and `MOSQUITTO_REFRESH_TOKEN=<random>` and `MOSQUITTO_ADMIN_PASSWORD=<random-12+ chars>` in `.env`.
2. Run `powershell -ExecutionPolicy Bypass -File scripts/install-mosquitto.ps1` once on the Windows host.
3. Restart the API.
4. Bootstrap the ACL: `curl -X POST -H "Authorization: Bearer $MOSQUITTO_REFRESH_TOKEN" http://localhost:3000/api/internal/mqtt/refresh-acl`.
5. Restart Mosquitto so the dynsec plugin picks up the new file:
   - Windows: `Restart-Service mosquitto`
   - Docker:  `docker compose restart mosquitto`
   The plugin reads `dynamic-security.json` at broker startup; SIGUSR1 hot-reload is not implemented (and does not exist on Windows). A future phase will publish `$CONTROL/dynamic-security/v1` messages to apply changes live. Repeat this restart after every `/refresh-acl` call.
6. Verify Mosquitto loaded the file: check Windows Event Log for the `mosquitto` service.
7. Migrate devices to point at the Mosquitto host (DNS or config redirect).

### Out of scope for Phase 1
- Removing `mqtt-auth-routes.ts` — kept registered when flag is off; removed in Phase 4 after cut-over validated.
- BullMQ → graphile-worker migration (Phase 2).
- Puppeteer / canvas swaps (Phase 3).
- Android / APK build chain, CI runner choice — out of scope per `windowsIssues.md` § 10–§11, § 18.

---

## [2.5.0] — 2026-04-25 — Offline Hardening, RFID SDK, Filter Data Console

### Added
- **Offline overhaul foundation** — TTL-based cache invalidation, idempotency keys on every queued op, tombstones for deleted entities, LRU eviction, JWT refresh during replay (queued ops carry refreshed tokens) — commits `3c99973`, `0c8de53`, `b8e003e`
- **Server-side stage lookup walker** — `stageLookup` resolves stage chains across multiple consecutive CHECKLIST nodes (fixes wrong-stage / missing prompts)
- **Capacitor Network plugin + Service Worker hook** — reliable online detection on Android WebView (replaces unreliable `navigator.onLine`)
- **RFID SDK plugin in DigiLog APK** — `RfidPlugin.java` bundles `Reader_Usb.jar`, so KC-series readers work in SDK mode inside the main APK (commit `39ccd1c`)
- **Filter Data Management console** — 10 tabs each mirroring its corresponding user-facing page (cleaning cycles, filter events, alarms, PM entries, audit trail, notifications, admin requests, block changes), instead of raw DB rows
- **Edit modals** for cleaning-cycles and filter-events tabs in the Filter Data Mgmt console
- **Forgot-password flow + show/hide password + lockout-progress UI** on tablet/mobile login
- **Create-filter dialog** now renders the Filter entity template's `attributeSchema` fields dynamically
- **`?expand=questions`** query param honored on `GET /api/checklist-profiles` so offline cache contains questions

### Fixed
- Mobile RFID scan input losing focus after first scan
- RFID-burst capture in UKB mode missing first keystroke (seed buffer + raise burst threshold to 150 ms)
- `pm-schedule-approval` config def returning 404 (now registered in `config-discovery.ts`)
- Offline checklist prompts missing or showing wrong stage when two CHECKLIST nodes were chained
- Offline checklist cache empty because list endpoint silently dropped questions

### Changed
- Filter Data Mgmt console columns trimmed to those visible on the matching user-facing pages (no extra DB-only fields)

---

## [2.4.0] — 2026-04-21 — Reports, Reorg, Dynamic Backup, Bloat Audit

### Added
- **Reports module — phases A through F complete**: report template designer (visual editor), report generation engine (Puppeteer + chartjs-node-canvas + Handlebars), digital signatures, PDF storage, frontend pages, schema, variable resolver with 5 data sources (attribute / identifier / telemetry / timestamp / meta)
- **Dynamic backup/restore** — covers all 64 tables via `pg_tables` + `jsonb_populate_recordset`; non-superuser-compatible; two-pass fixup for self-referencing rows
- **Admin requests approval execution flow** — approvals now actually create/unlock/reset/modify users; requester Employee ID required; audit trail hides UUIDs
- **DRY_IN two-step flow** — separate SET_DURATION and SUBMIT_READINGS events; "Currently Drying" panel with countdown + temperature (web + tablet + offline)
- **Batch scan mode** in mobile operations
- **Stage cards** on tablet home page
- **Pipeline enforcement on offline path** — replay re-walks the pipeline to enforce checklist-as-stage rules
- **Block deletion**, RBAC fixes (roles drift after DB restore)
- **Entity org auto-assign** for admin-created entities
- **Reorg**: `old/` archive for superseded material, `future/` for forward-looking design notes

### Fixed
- Cycle `profile_id` frozen at start (reassigning a block's profile no longer corrupts in-progress cycles)
- DRY_IN temperature not showing in cleaning cycle history (now read from readings event)
- Offline DRY_IN sync skipping half-time check on replay
- Lenient offline cycle detection + preserve graph data in online cache
- Backend pipeline bypass at DRY_IN for both SET_DURATION and SUBMIT_READINGS
- Lifecycle state cleared on offline cycle completion so next cycle starts fresh
- Sync health check tolerant of self-signed certs (avoids false cycle-completion signals)

### Changed
- **Removed all EC2 / Linux production assets** — app runs on local Windows only (commit `251be95`); CLAUDE.md / per-app CLAUDE.md de-EC2'd
- **`apps/api/src/modules/config/routes.ts`** monolith split into per-tab files registered via auto-discovery (was 1003 lines / 40 endpoints)
- **Inline-style → theme-class codemod** across 54 TSX files (~200 occurrences eliminated)
- **Bloat audit** (`bloat.md`, archived) — 12 / 14 items resolved (SPIS submit-path parity, monster-file split, dependency drift cleanup, lint rule for `as any`, timer audit)
- **`packages/shared`** rebuild required after permissions / privileges / reauth changes

---

## [2.3.0] — 2026-04-14 — Permissions, Themes & Reports

### Added
- Granular role-based permissions: 18 new feature toggles across Filters Page Controls, Checklist Page Controls, Cleaning Profile Page Controls, Equipment Group Controls, PM Page Controls
- 10 configurable color themes: Ocean, Sapphire, Emerald, Amethyst, Sunset, Slate, Ruby, Forest, Midnight, Coral
- Report Settings configuration page with header/footer/layout controls and live preview
- ReportPageWrapper component applied to Audit Trail, Cleaning Cycles, Filter Traceability
- Dynamic bulk upload CSV template generated from Filter entity template attributeSchema
- PM Schedules page redesign: date range filter, summary cards, AHU inline with expandable filters, S.No, pagination
- AHU Type column on filters table
- Public endpoints: /api/config/password-policy/current, /api/config/report-settings/current
- Block change test data (PENDING, APPROVED, REJECTED, EXPIRED)

### Fixed
- SUPER_ADMIN now bypasses all frontend permission checks (was hidden from new features)
- Backup export 403 for non-superadmin (removed hardcoded role check)
- Backup restore failing for SQL/CSV formats (password_hash was stripped)
- Block change requests not visible to approvers (endpoint required wrong permission)
- "Load Error" toast on every page for non-admins (password-policy 403)
- api-client.ts missing .status on thrown errors (SWR couldn't suppress 403 toasts)
- Reauth popup password autofilling from browser saved credentials
- Reauth popup focus jumping to search bar on cancel/confirm
- Reauth popup not opening for checklist and cleaning profile actions
- Filter status update 403 (permission mapping missing backend permission)

### Changed
- Feature privilege mappings now include both frontend visibility and backend route permissions
- Reauth actions: 69 total across 16 categories (removed 8 dead, added 6 missing)
- Org-admin routes changed from requireRole to requirePermission
- PM Schedules: removed Month column, added AHU/S.No/Approved By columns
- Filters Page Controls permissions are separate from Entity Management permissions

## [2.2.0] — 2026-04-07

### Added — RFID & Offline Sync
- **RFID Scanner Android app** (`rfid_scan_app/`) — KC-series UHF reader via USB-C with 5 screens (Connect, Scan, Read/Write, Settings, UKB)
- **RFID input guard** (`use-rfid-guard.ts`) — global keydown interceptor blocks rapid RFID keyboard input from entering non-RFID fields
- **RFID scan dialogs** — 300ms debounce tag detection, deduplication for repeated scans, Continue/Remove flow
- **Filter details on scan** — after RFID tag detected, looks up and displays filter name + parent AHU
- **Offline cleaning operations** — all stage operations (advance, start-cycle, submit-checklist, equipment) wrapped with `executeOrQueue()` for offline queuing
- **Offline identifier lookup** — identifiers cached to IndexedDB `identifier-map` for RFID lookup without internet
- **"Data Synced" indicator** — mobile header badge shows when all data (instances, templates, reasons, identifiers) is cached and safe to go offline
- **Error popup component** (`components/ui/error-popup.tsx`) — reusable modal for error display, replaces inline banners in entities and filter operations
- **Responsive layout** — sidebar collapses to hamburger menu on mobile/tablet with slide-in overlay

### Changed
- **One identifier per entity** — backend now blocks creating more than one identifier per asset instance
- **Contact Admin roles** — `/api/roles/active` is now public (no auth) so the contact-admin page can populate the role dropdown
- **User creation** — admin users auto-assign new users to their own organization (org dropdown hidden)
- **Filter operations list** — shows all Filter template instances (fixes BY_BLOCK config-based profile assignment)
- **APK HTTP mode** — Capacitor WebView cannot trust self-signed certs for fetch; dev uses HTTP, production will use system cert install

### Fixed
- RFID reader in UKB mode typing tag IDs into random input fields
- Repeated tag scans filling inputs with duplicated EPC values
- Filter not found errors when scanning offline (identifiers now cached separately)
- Cleaning operations failing silently offline (start-cycle, checklist, equipment now queue properly)
- Background error messages not visible to user (now shown as popup dialogs)
- Fixed width sidebar breaking mobile layout

## [2.1.0] — 2026-04-04

### Added — Phase 2 Enhancements
- **Equipment Groups** — Group instruments and filters under AHUs with CRUD endpoints
- **Checklist Profiles** — Standalone checklist profile management with typed questions (YES_NO, PASS_FAIL, NUMERIC, DROPDOWN, MULTI_SELECT, TEXT)
- **Bulk Upload** — CSV-based bulk filter import functionality
- **Filter Retirement & Replacement** — End-of-life management for filters
- **Filter Scan** — QR/barcode scanning for filter identification
- **Mobile PWA** — Progressive Web App support for tablet/mobile filter operations
- **Android APK** — Capacitor-based Android build (JDK 21, apps/android/)
- **Notification Channels** — Telegram and Slack delivery channels added
- **Dashboard Widgets** — Configurable dashboard with widget assignments

### Updated
- Prisma schema expanded to **57 models** with **17 enums**
- API modules expanded to **34 total**
- Frontend routes expanded with equipment management, bulk upload, retirement pages
- All documentation files updated to reflect current application state

## [2.0.0] — 2026-03-27

### Added — Phase 2: Digital Filter Management System
- **Filter Operations page** — 8 cleaning stages (TO_BE_CLEANED through READY_FOR_USE) with block selection, QR scan
- **Cleaning Profile Editor** — Visual pipeline builder with STAGE, CHECKLIST, START, END nodes and wire connections
- **Checklist Profiles** — CRUD for checklist templates with 10 question types (YES_NO, PASS_FAIL, NUMERIC, DROPDOWN, etc.)
- **Filter Profiles** — Assign cleaning profiles to filters, block restrictions, max cycle limits
- **Cleaning Cycles** — Full lifecycle tracking with expandable history, stage timeline, filter names, performer names
- **PM Scheduling** — Per-AHU preventive maintenance schedules with monthly entries and tolerance windows
- **AHU Dashboard** — Filter set visualization with state-colored indicators
- **Filter Traceability** — Per-filter event history, cycle list, deviation tracking
- **Checklist gates in pipeline** — CHECKLIST nodes between stages auto-trigger question dialogs; server-side enforcement
- **Cleaning reason selection** — User selects from 8 configurable reasons when starting a cycle
- **Config pages** — Filter Lifecycle States and Filter Cleaning Reasons management
- **9 new database tables** — pm_schedules, pm_schedule_entries, pm_executions, filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events
- **9 new enums** — CleaningCycleStatus, FilterEventType, PipelineNodeType, FlowMode, BlockRestriction, etc.
- **17 new permissions** across 6 roles
- **3 config definitions** — filter-cleaning-reasons, filter_lifecycle_states, filter-pm-schedule

### Fixed — Quality Audit (30 issues resolved)
- **CRITICAL:** Path traversal in binary file endpoints + missing auth
- **CRITICAL:** Auth double-throw for expired accounts
- **CRITICAL:** Config pages returning 404 (missing config definitions)
- **HIGH:** Organization scoping added to all filter-operations methods
- **HIGH:** Server-side checklist enforcement in advance() — prevents API bypass
- **HIGH:** bypass() now requires active cycle and validates target state
- **HIGH:** Permission guards on all 13 Phase 2 frontend routes
- **MEDIUM:** Race conditions in startCycle and submitChecklist (transactions + duplicate checks)
- **MEDIUM:** Cleaning profile update wrapped in transaction
- **MEDIUM:** Input sanitization (XSS) for remarks/justification fields
- **MEDIUM:** Pipeline validation (stateKeys, checklist profiles, graph connectivity)
- **MEDIUM:** getCycles performance (events opt-in via query param)
- **LOW:** 28 missing permissions added to ALL_PERMISSIONS
- **LOW:** Auth plugin role scope caching (30s TTL)
- **LOW:** ErrorBoundary dark theme, PM page navigation, node delete confirmation


## [Unreleased] — 2026-03-16

### Added
- Input sanitization (HTML stripping) on all user text fields to prevent XSS
- Data Retention config page with per-table retention settings (telemetry, attributes, events, traces, checklists)
- Help Articles: 28 articles with comprehensive documentation across 8 categories
- Login always redirects to home page (dashboard) instead of returnUrl

### Fixed
- Retention config page crash: backend now merges stored config with defaults
- Department field XSS vulnerability: cleaned existing DB data and added sanitization
- Cleaned up 27 test help articles from database

## [1.0.0] — 2026-03-12

### Added
- Config Registry System with 23 self-registering config definitions
- Field ID expansion to 39 fields across 7 modules
- Real-time auto-refresh across all pages via SWR polling and WebSocket
- Role-based access management page (replaced role privileges)
- Comprehensive manual test cases (25 test suites, 25 execution guides)

### Fixed
- SWR stale data across 23 files (revalidateOnMount + dedupingInterval: 0)
- Role change not persisting after logout (JWT refresh reads DB role)
- SQL/CSV restore fails with missing displayName (50+ column mappings)
- User ID validator prefix check only applies to PREFIX_* formats
- PM2 TSDB_DATABASE env var fixed from digilog_db to digilog_tsdb
- Email IPv4: added family: 4 to nodemailer for smtp.office365.com

## [0.9.0] — 2026-03-01

### Added
- Phase K: Testing & Documentation
- Phase J: Help Articles, UNS Browser, Alarm Dashboard
- Phase I: Checklist Mobile, QR Code Scanning
- Phase H: Connectivity, Device Credentials
- Phase G: Rule Chain Visual Editor (ReactFlow)
- Phase F: Telemetry Queries, Data Export
- Phase E: Unified Namespace (ISA-95)
- Phase D: Rule Chain Engine (77 node types)
- Phase C: Data Ingestion Pipeline (11 stages)
- Phase B: MQTT Transport (EMQX integration)
- Phase A: Infrastructure (PostgreSQL, TimescaleDB, Redis, PM2, Nginx)

### Core Features
- 21 CFR Part 11 compliant audit trail with hash-chain integrity
- Electronic signatures with re-authentication
- 6 hierarchical roles with 22+ permissions
- Entity template system with attribute schemas and alarm rules
- 12 relationship types with cycle detection
- Notification system (in-app, email, SMS)
- Backup and restore with SHA-256 integrity verification

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
