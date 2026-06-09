# DigiLog API — CLAUDE.md

## Overview
Fastify backend serving the DigiLog REST API on port 3000. Runs locally on Windows via `tsx watch` in dev, or as a compiled Node service in production-style local builds. The repo currently has no live remote deployment.

## Build & Deploy
```bash
# Windows Local Development (auto-reload)
cd apps/api && npx tsx watch src/app.ts

# Production-style local build
npx tsc -p apps/api/tsconfig.json   # Compile to apps/api/dist/
node apps/api/dist/app.js
```

## Key Paths
- Source: `apps/api/src/`
- Compiled: `apps/api/dist/`
- Entry: `apps/api/src/app.ts`
- Prisma schema: `apps/api/prisma/schema.prisma` (68 models, 21 enums) — Step 1 added the `TemplateKind` lookup model; MT removal (2026-04-30) dropped `Organization` + 11 `organizationId` columns + 2 `orgId` columns; **Step 6 (2026-05-01)** split filter-specific cycle state (`filterProfileId`, `currentLifecycleState`, `currentCycleId`, `filterSet`) off `AssetInstance` into a 1:1 `FilterDetails` sidecar; **Phase A.3 (2026-05-01)** added the `FilterProfileVersion` sidecar (snapshot-then-bump); **Phase A.4 (2026-05-02)** added the `EquipmentGroupVersion` sidecar (composite snapshot of group + 3 instruments together); **Step 4 (2026-05-02)** dropped `FilterProfile.applicableTemplates Json` and replaced it with the `FilterProfileApplicableTemplate` join table (cascade FKs both directions; AssetTemplate delete blocked with 409 IN_USE if any FilterProfile binds it); **2026-05-17 dropped 5 models** (`RuleChain`, `RuleChainVersion`, `RuleNode`, `RuleNodeConnection`, `Alarm`) plus `asset_templates.{default_rule_chain_id, alarm_rules}` + `notification_logs.{rule_chain_id, alarm_id}` columns — see `tasks/REMOVE-RULECHAIN-ALARM-PLAN.md`.
- Config definitions: `apps/api/src/modules/config/defs/` (30 files)
- Route modules: `apps/api/src/modules/` (**35 modules**, verified `ls` 2026-06-06 — `org-admin`/`tenant-admin` deleted in MT removal; `rule-chain` deleted 2026-05-17; **`qr-code` deleted 2026-06-06** — was a non-functional placeholder, no UI consumer. NOTE: the prose list below has pre-existing drift — it names `entity-assignments`/`template-kinds` which are no longer standalone dirs and omits `hierarchy`/`replacement-schedule`/`sync`/`block-change-requests`; reconcile in a dedicated doc pass.)
- Config routes: monolith split into `apps/api/src/modules/config/static-routes/<surface>.routes.ts` per tab; top-level `routes.ts` is just a registration loop (~170 LOC, was 1003)

## Architecture
- 34 route modules registered via `apps/api/src/modules/*/routes.ts`
- Config auto-discovery at startup via `lib/config-discovery.ts`
- Config registry pattern via `lib/config-registry.ts` (self-registering config modules)
- Input sanitization: `lib/sanitize.ts` (HTML stripping on all text inputs)
- JWT auth with 30-min refresh, session management, re-auth for sensitive ops
- Permission-based RBAC via `requirePermission()` on all protected routes

## 35 API Modules
admin-requests, assets (templates/instances/relationships/identifiers), audit, auth, backup, checklist-profiles, cleaning-profiles, config (27 auto-discovered definitions), connectivity, dashboards, data-ingestion (11-file pipeline), deployment-check, equipment-groups, filter-operations, filter-profiles, help, ldap, notification-delivery (email/SMS/Telegram/Slack), notification-rules, notifications, pm-schedules, queries (telemetry/retention/export), report-templates, reports, roles, super-admin, system-health, uns, uploads, user-groups, users — plus block-change-requests / admin-requests under their own modules. (`org-admin` and `tenant-admin` removed 2026-04-30 with MT removal; `rule-chain` removed 2026-05-17 with alarm tear-out; **`qr-code` removed 2026-06-06** — non-functional placeholder, no UI consumer.) NOTE: list still drifts from `ls` (omits `hierarchy`/`replacement-schedule`/`sync`; names `template-kinds`/`entity-assignments` which aren't standalone dirs) — pending a dedicated reconciliation pass.

## Databases
- **digilog_db** (PostgreSQL 18 via Prisma) — application data (68 models, 21 enums)
- **digilog_tsdb** (TimescaleDB via pg pool) — time-series data (7 hypertables)

## Key Libs (`apps/api/src/lib/`)
- `audit.ts` — SHA-256 hash-chained audit logger
- `sanitize.ts` — HTML stripping on all text inputs
- `config-discovery.ts` — Auto-discover config definitions at startup
- `config-registry.ts` — Self-registering config module pattern
- `jwt.ts` — JWT token management
- `reauth-check.ts` — Re-authentication enforcement with 10s in-memory cache

## Testing

```bash
cd apps/api && npm test    # Stable single-fork run (see below for why)
```

### Single-fork requirement (read before running the suite)

The full `apps/api` test suite **must run in a single fork** to produce a
stable pass/fail count. The verified stable invocation is:

```bash
cd apps/api && npx vitest run --pool=forks --poolOptions.forks.singleFork=true
```

`npm test` is wired to this exact command so operators don't have to
remember the flags. If you invoke `npx vitest run` directly with the
default pool, you will see flaky failures that are NOT real bugs.

**Why** — two contention sources, neither introduced by any single test:

1. **Shared `admin` test user race.** `vitest.global-setup.ts` provisions
   one `admin` / `Admin@123` user (SUPER_ADMIN) and one `RB0001` /
   `Test@1234` user (OPERATOR) in `digilog_db`. Most e2e/integration
   suites log in as `admin`. When vitest runs multiple worker forks in
   parallel, two files can hold concurrent sessions for the same user;
   one calling `POST /api/auth/logout` invalidates the session row the
   other is mid-request against, and the second worker sees a 401 it
   doesn't expect. `vitest.config.ts` already sets
   `fileParallelism: false`, but with the default `forks` pool that
   only serialises files *within* a worker — multiple worker processes
   can still be spawned. `singleFork: true` collapses everything into
   one process, which removes the race.

2. **Local dev server contention.** If `tsx watch src/app.ts` is running
   on `:3000` against the same `digilog_db` (the normal dev loop), it
   holds its own `admin` session in the same `user_sessions` table. A
   test logout invalidates that session too, and any subsequent
   browser/dev request gets 401'd until the dev server re-logs in. This
   is benign for tests but disruptive for the human running both at
   once. Stop the dev server (or run tests against a separate DB) for
   the cleanest run.

The flakiness was *surfaced*, not introduced, by the new e2e files in
commit `859492e3` (Phase 8.7 / Wave 8a verification). Those files just
added more concurrent admin logins, exposing a pre-existing infra
limitation.

**Verified baseline** (Wave 8a, single-fork mode):
**1231 passing, 2 failed, 9 skipped.** The 2 failures are pre-existing
and tracked separately. If your single-fork run shows materially
different numbers, investigate before assuming your change broke
something.

**Per-file authoring tip.** If you're adding a new e2e/integration test
file, follow the pattern from agent AD's recent commits: provision a
*unique* SUPER_ADMIN user inside the file's `beforeAll` (e.g. username
based on the test file name) instead of logging in as the shared
`admin`. That keeps your file safe under both single-fork and
multi-fork runs and makes it cheaper to debug in isolation. The
shared-`admin` pattern is grandfathered-in for older files but should
not be repeated.

**Trade-off accepted.** Single-fork is slower (no cross-file
parallelism) but reliable. Until each test file owns its own login
fixture, this is the right default.

## Environment
- API_PORT=3000, TSDB_DATABASE=digilog_tsdb
- Mosquitto: localhost:1883 (MQTT). No dashboard port — dynsec is regenerated by `POST /api/internal/mqtt/refresh-acl` and reloaded via `Restart-Service mosquitto`. Install via `scripts/install-mosquitto.ps1` (elevated). Phase 1 of windows-friendly-rewrite swapped from EMQX.
- PostgreSQL: localhost:5432 (also hosts the graphile-worker job queue)

## Phase 2: Digital Filter Management System

### Phase 2 Modules
- `modules/cleaning-profiles/` — Pipeline profile CRUD with versioning, visual editor support, graph validation
- `modules/filter-profiles/` — Filter-to-cleaning-profile assignment with org scoping
- `modules/filter-operations/` — Core operations: cycle start/advance/bypass/checklist/events
- `modules/pm-schedules/` — Preventive maintenance scheduling with monthly entries and tolerance windows
- `modules/checklist-profiles/` — Checklist template and question management with usage checks. Phase A.1 (2026-05-01): every mutation is snapshot-then-bump into `ChecklistProfileVersion`; cycles pin the version at start so submissions resolve against the exact schema the operator saw. New endpoints: `GET /:id/versions` and `GET /:id/versions/:versionNumber`.
- `modules/equipment-groups/` — Equipment group management (AHU dashboard)
- `modules/entity-assignments/` — Entity-to-group assignments
- `modules/config/defs/filter-*.def.ts` — Config definitions for filter lifecycle, cleaning reasons

### Key Phase 2 API Endpoints
```
POST /api/filters/:id/start-cycle    — Start cleaning cycle
POST /api/filters/:id/advance        — Advance to next stage
POST /api/filters/:id/submit-checklist — Submit checklist answers
POST /api/filters/:id/bypass         — Bypass stage (deviation)
GET  /api/filters/:id/current-state  — Get filter state + next actions
GET  /api/filters/cycles             — List cleaning cycles (events-routes.ts mounts /cycles + /events under the shared /api/filters prefix)
GET  /api/filters/events             — List filter events
GET  /api/filter-cleaning-profiles                       — List cleaning profiles (latest version per lineage)
GET  /api/filter-cleaning-profiles/:id/versions          — Phase A.2: list all versions in lineage
GET  /api/filter-cleaning-profiles/:id/versions/:n       — Phase A.2: fetch frozen snapshot at version n
GET  /api/filter-profiles            — List filter profiles
GET  /api/filter-profiles/:id/versions             — Phase A.3: list archived FilterProfile versions
GET  /api/filter-profiles/:id/versions/:n          — Phase A.3: frozen FilterProfile snapshot at version n
GET  /api/equipment-groups            — List equipment groups
GET  /api/equipment-groups/:id/versions            — Phase A.4: list archived EquipmentGroup versions (composite)
GET  /api/equipment-groups/:id/versions/:n         — Phase A.4: frozen EquipmentGroup composite snapshot at version n
GET  /api/pm-schedules               — List PM schedules
GET  /api/checklist-profiles                       — List checklist profiles
GET  /api/checklist-profiles/:id/versions          — Phase A.1: list archived versions
GET  /api/checklist-profiles/:id/versions/:n       — Phase A.1: fetch frozen snapshot at version n
GET  /api/equipment-groups           — List equipment groups
```

### Phase 2 Patterns
- Organization scoping via `orgWhere(ctx)` on all filter queries
- Pipeline graph validation (connectivity, stateKeys, checklist profiles)
- Transaction wrapping for cycle start and profile versioning
- Server-side checklist enforcement in `advance()`
- Input sanitization on user-provided text fields
- Events as immutable log with SHA-256 checksums for 21 CFR Part 11 compliance
- **FilterCleaningProfile versioning** — immutable-rowful via `lineageId` UUID set at first create; updates archive the old row and insert a new row with `version+1` carrying the same lineageId. Cycles freeze `profileId` at start, so audit replay reads the exact archived row that was active at cycle start. Phase A.2 (2026-05-01) introduced `lineageId` (replacing `name`-based grouping) and exposed version history endpoints.
- **FilterProfile versioning** — Phase A.3 (2026-05-01). Sidecar pattern (mirrors A.1 ChecklistProfile): `FilterProfile.version` is a monotonic counter on the live row; `FilterProfileVersion` is a snapshot-then-bump sidecar capturing the OUTGOING state on every `update()`. First version is created lazily — live row IS v1 until first edit. No cycle pinning needed because cycles already pin `cleaning_cycles.profileId` to a FilterCleaningProfile row at start; FilterProfile drift cannot reach a running cycle. Per-block override is explicitly out of scope (FilterProfile uniform across all blocks).
- **EquipmentGroup composite versioning** — Phase A.4 (2026-05-02). Composite sidecar pattern (mirrors A.1 ChecklistProfile + questions): `EquipmentGroup.version` is the live counter, `EquipmentGroupVersion` snapshots the WHOLE composite (group + 3 instruments ordered by sortOrder) inside the same transaction as the live mutation. **P1 (2026-05-02)** added cycle-side pinning via `cleaning_cycles.equipmentGroupVersionPin Int?`. Reading validation reads `operatingMin/Max` from the pinned `EquipmentGroupVersion.snapshot.instruments[]`, with fallback to the live row when pin is NULL (legacy cycles). `FilterEvent.attributes.instrumentReadings` continues to immutably snapshot the submitted values — that's the audit-trail layer, P1 is the validation-rule layer. **Cleaning reasons are NOT versioned** — already drift-resistant via `CleaningCycle.cleaningReasonKey` + `cleaningReasonLabel` columns set at cycle start.
- Auto-complete on last stage (STAGE leads to END node)

### Pipeline Flow
CHECKLIST nodes between STAGE nodes trigger automatic question dialogs.
Server-side enforcement: advance() blocks if pending checklist not completed.
Cycle auto-completes when last STAGE leads to END node.
Stage types: WASH_IN, WASH_OUT, DRY_IN, DRY_OUT, STORAGE_IN, STORAGE_OUT

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

---

## Phase 4 Update (2026-04-14) — in-app permissions/themes/reports phase

> Note: a separate "Phase 4" appears in the windows-friendly-rewrite plan (tooling cleanup of `install-on-target.ps1` + `package-for-production.ps1`). The two are unrelated.

**New Config Definitions:**
- `report-settings.def.ts` — Report header/footer/layout configuration
- Public endpoint: `GET /api/config/report-settings/current`
- Public endpoint: `GET /api/config/password-policy/current`

**Permissions Updates (snapshot at release; current totals are higher — see live counts in root `CLAUDE.md`):**
- ~95 permission constants at release (now 109 — verify with `grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/permissions.ts`)
- 87 reauth actions across 16 categories (gained `UPDATE_PROFILE` (H1) + `RETIRE_FILTER` / `REPLACE_FILTER` / `BULK_UPLOAD_FILTERS` (C2) on 2026-05-04, plus `APPROVE_ADMIN_REQUEST` (M1) + `UPDATE_FILTER_LIFECYCLE` (M2) on 2026-05-04 — both audit-trail correctness fixes from `tasks/AUDIT-2026-05-04-linkage-review.md`)
- FEATURE_TO_PERMISSION_MAP entries include both frontend + backend permissions
- Block change requests GET endpoint accepts BLOCK_CHANGE_REQUEST OR BLOCK_CHANGE_APPROVE
- Backup export uses CONFIG_UPDATE (removed hardcoded SUPER_ADMIN check)
- ~~Org-admin routes changed from requireRole to requirePermission(ORG_VIEW)~~ (org-admin module deleted in MT removal 2026-04-30)

**Backend Fixes:**
- Backup restore: SQL/CSV formats now include password_hash
- enforceReauth added to: retention PUT, retention execute POST, submit-checklist POST
