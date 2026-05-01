# Changelog

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
