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
- Prisma schema: `apps/api/prisma/schema.prisma` (64 models, 22 enums)
- Config definitions: `apps/api/src/modules/config/defs/` (30 files)
- Route modules: `apps/api/src/modules/` (37 modules)
- Config routes: monolith split into `apps/api/src/modules/config/static-routes/<surface>.routes.ts` per tab; top-level `routes.ts` is just a registration loop (~170 LOC, was 1003)

## Architecture
- 34 route modules registered via `apps/api/src/modules/*/routes.ts`
- Config auto-discovery at startup via `lib/config-discovery.ts`
- Config registry pattern via `lib/config-registry.ts` (self-registering config modules)
- Rule chain node registry: `modules/rule-chain/nodes/index.ts` (77 node types, 8 categories)
- Input sanitization: `lib/sanitize.ts` (HTML stripping on all text inputs)
- JWT auth with 30-min refresh, session management, re-auth for sensitive ops
- Permission-based RBAC via `requirePermission()` on all protected routes

## 34 API Modules
admin-requests, assets (templates/instances/relationships/identifiers), audit, auth, backup, checklist-profiles, cleaning-profiles, config (23 definitions), connectivity, dashboards, data-ingestion (10-stage pipeline), deployment-check, entity-assignments, equipment-groups, filter-operations, filter-profiles, help, ldap, notification-delivery (email/SMS/Telegram/Slack), notification-rules, notifications, org-admin, pm-schedules, qr-code, queries (telemetry/alarm/retention/export), roles, rule-chain (77 node types), super-admin, system-health, tenant-admin, uns, uploads, user-groups, users

## Databases
- **digilog_db** (PostgreSQL 18 via Prisma) — application data (64 models, 22 enums)
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
cd apps/api && npx vitest run   # Run unit tests
```

## Environment
- API_PORT=3000, TSDB_DATABASE=digilog_tsdb
- EMQX: localhost:1883 (MQTT), 18083 (dashboard)
- PostgreSQL: localhost:5432 (also hosts the graphile-worker job queue)

## Phase 2: Digital Filter Management System

### Phase 2 Modules
- `modules/cleaning-profiles/` — Pipeline profile CRUD with versioning, visual editor support, graph validation
- `modules/filter-profiles/` — Filter-to-cleaning-profile assignment with org scoping
- `modules/filter-operations/` — Core operations: cycle start/advance/bypass/checklist/events
- `modules/pm-schedules/` — Preventive maintenance scheduling with monthly entries and tolerance windows
- `modules/checklist-profiles/` — Checklist template and question management with usage checks
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
GET  /api/filter/cycles              — List cleaning cycles
GET  /api/filter/events              — List filter events
GET  /api/filter-cleaning-profiles   — List cleaning profiles
GET  /api/filter-profiles            — List filter profiles
GET  /api/pm-schedules               — List PM schedules
GET  /api/checklist-profiles         — List checklist profiles
GET  /api/equipment-groups           — List equipment groups
```

### Phase 2 Patterns
- Organization scoping via `orgWhere(ctx)` on all filter queries
- Pipeline graph validation (connectivity, stateKeys, checklist profiles)
- Transaction wrapping for cycle start and profile versioning
- Server-side checklist enforcement in `advance()`
- Input sanitization on user-provided text fields
- Events as immutable log with SHA-256 checksums for 21 CFR Part 11 compliance
- Versioning via create-new + archive-old for cleaning profiles
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

## Phase 4 Update (2026-04-14)

**New Config Definitions:**
- `report-settings.def.ts` — Report header/footer/layout configuration
- Public endpoint: `GET /api/config/report-settings/current`
- Public endpoint: `GET /api/config/password-policy/current`

**Permissions Updates:**
- 95 total permission constants (was ~60)
- 81 reauth actions across 16 categories
- FEATURE_TO_PERMISSION_MAP entries include both frontend + backend permissions
- Block change requests GET endpoint accepts BLOCK_CHANGE_REQUEST OR BLOCK_CHANGE_APPROVE
- Backup export uses CONFIG_UPDATE (removed hardcoded SUPER_ADMIN check)
- Org-admin routes changed from requireRole to requirePermission(ORG_VIEW)

**Backend Fixes:**
- Backup restore: SQL/CSV formats now include password_hash
- enforceReauth added to: retention PUT, retention execute POST, submit-checklist POST
