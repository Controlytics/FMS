# DigiLog API — CLAUDE.md

## Overview
Fastify backend serving the DigiLog REST API on port 3000. Managed by PM2 as `digilog-api` on EC2, or via `tsx` locally on Windows.

## Build & Deploy
```bash
# EC2 Production
cd /home/ubuntu/21cfrlogbook
npx tsc -p apps/api/tsconfig.json   # Compile TypeScript
pm2 restart digilog-api              # Restart server

# Windows Local Development
cd apps/api && npx tsx src/server.ts  # Run with tsx (no compile needed)
```

## Key Paths
- Source: `apps/api/src/`
- Compiled: `apps/api/dist/`
- Entry: `apps/api/src/server.ts`
- App setup: `apps/api/src/app.ts`
- Prisma schema: `apps/api/prisma/schema.prisma` (57 models, 17 enums)
- Config definitions: `apps/api/src/modules/config/defs/` (23 files)
- Route modules: `apps/api/src/modules/` (34 modules)

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
- **digilog_db** (PostgreSQL 18 via Prisma) — application data (57 models)
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
- PM2 env vars: TSDB_DATABASE=digilog_tsdb, PORT=3000
- Redis: localhost:6379 (BullMQ job queue)
- EMQX: localhost:1883 (MQTT), 18083 (dashboard)
- PostgreSQL: localhost:5432

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
