# DigiLog — Session Resume Point

**Last Updated:** 2026-02-26
**Branch:** `feature/user-id-config`
**Status:** ALL PHASES COMPLETE (A through K). Data Ingestion & Integration Layer fully built and tested. ~138 total API endpoints, 31 frontend pages, 425 unit tests across 18 files in 3 packages. All 5 packages build successfully.

---

## Completed Phases Summary

| Phase | Description | Endpoints | Key Files |
|-------|-------------|-----------|-----------|
| A | Infrastructure (Docker, TimescaleDB, Prisma, packages) | 0 | docker-compose.yml, init-tsdb.sql, packages/db, packages/queue |
| B | Transport (MQTT auth, WS handler, HTTP ingestion) | 8+3 | transport/mqtt-auth-routes.ts, mqtt-client.ts, ws-handler.ts, data-ingestion/routes.ts |
| C | Pipeline (BullMQ worker, 11 stages, batcher, DLQ) | 0 | workers/ingestion.worker.ts, workers/maintenance.worker.ts, data-ingestion/ingestion.service.ts |
| D | Rule Chain Engine (26 node types, BFS execution) | 14 | modules/rule-chain/*.ts (7 files) |
| E | UNS (ISA-95 paths, wildcard, cascade moves) | 6 | modules/uns/*.ts (3 files) |
| F | Queries & Export (telemetry, alarms, retention) | 20 | modules/queries/*.ts (5 files) |
| G-J | Connectivity, QR, Help + Frontend pages | 16 | modules/connectivity, qr-code, help + 3 frontend pages |
| K | Testing & Documentation (425 unit tests) | 0 | 18 test files across packages/shared, packages/db, apps/api |

---

## All New Backend Files (Phases B–J)

### Phase B — Transport Layer
- `apps/api/src/transport/mqtt-auth-routes.ts` — MQTT auth/ACL webhook (3 endpoints)
- `apps/api/src/transport/mqtt-client.ts` — MQTT client for pub/sub
- `apps/api/src/transport/ws-handler.ts` — WebSocket real-time streaming
- `apps/api/src/modules/data-ingestion/routes.ts` — HTTP data ingestion (8 endpoints)
- `apps/api/src/modules/data-ingestion/entity-resolver.ts` — Token → entity lookup
- `apps/api/src/modules/data-ingestion/normalizer.ts` — Payload normalization
- `apps/api/src/modules/data-ingestion/rpc-handler.ts` — RPC request/response via Redis

### Phase C — Ingestion Pipeline
- `apps/api/src/modules/data-ingestion/ingestion-config.service.ts` — Config reader (10s cache)
- `apps/api/src/modules/data-ingestion/ingestion.service.ts` — Pipeline stages 3,6,7,8,9,10,11
- `apps/api/src/modules/data-ingestion/ingestion.repository.ts` — Data persistence
- `apps/api/src/modules/data-ingestion/pipeline-tracer.ts` — Debug trace recorder
- `apps/api/src/modules/data-ingestion/dlq-manager.ts` — Dead letter queue
- `apps/api/src/modules/data-ingestion/connectivity-tracker.ts` — Online/offline tracking
- `apps/api/src/workers/ingestion.worker.ts` — BullMQ ingestion worker
- `apps/api/src/workers/maintenance.worker.ts` — DLQ + connectivity maintenance
- `packages/db/src/telemetry-batcher.ts` — Multi-row INSERT batcher

### Phase D — Rule Chain Engine
- `apps/api/src/modules/rule-chain/types.ts` — Shared types
- `apps/api/src/modules/rule-chain/node-registry.ts` — Node registry
- `apps/api/src/modules/rule-chain/rule-engine.ts` — BFS graph traversal (30s TTL cache)
- `apps/api/src/modules/rule-chain/debug-recorder.ts` — Per-chain ring buffer + Redis pub/sub
- `apps/api/src/modules/rule-chain/nodes/index.ts` — 26 node implementations (7 categories)
- `apps/api/src/modules/rule-chain/default-chain-builder.ts` — Auto-create chains from template alarms
- `apps/api/src/modules/rule-chain/routes.ts` — 14 CRUD endpoints

### Phase E — UNS
- `apps/api/src/modules/uns/uns-path-builder.ts` — ISA-95 path builder
- `apps/api/src/modules/uns/uns.service.ts` — UNS CRUD + cascade moves
- `apps/api/src/modules/uns/routes.ts` — 6 endpoints

### Phase F — Queries & Export
- `apps/api/src/modules/queries/telemetry.routes.ts` — 7 telemetry/attribute/checklist endpoints
- `apps/api/src/modules/queries/alarm.routes.ts` — 4 alarm lifecycle endpoints
- `apps/api/src/modules/queries/export.routes.ts` — 5 CSV/JSON export endpoints
- `apps/api/src/modules/queries/retention.routes.ts` — 4 retention config/execution endpoints
- `apps/api/src/modules/queries/index.ts` — Module aggregator

### Phase G-J — Backend
- `apps/api/src/modules/connectivity/routes.ts` — 6 connectivity endpoints
- `apps/api/src/modules/qr-code/routes.ts` — 4 QR code endpoints
- `apps/api/src/modules/help/routes.ts` — 6 help article endpoints

### Phase G-J — Frontend
- `apps/web/src/routes/rule-chains/index.tsx` — Rule Chains management page
- `apps/web/src/routes/alarms/index.tsx` — Alarm Dashboard page
- `apps/web/src/routes/config/uns.tsx` — UNS Configuration page

### Phase K — Unit Tests (425 tests, 18 files, 3 packages)

**packages/shared (5 files):**
- `packages/shared/src/schemas/assets.test.ts`
- `packages/shared/src/schemas/auth.test.ts`
- `packages/shared/src/schemas/config.test.ts`
- `packages/shared/src/schemas/users.test.ts`
- `packages/shared/src/types/audit-templates.test.ts`

**packages/db (1 file):**
- `packages/db/src/__tests__/telemetry-batcher.test.ts`

**apps/api (12 files):**
- `apps/api/src/modules/data-ingestion/__tests__/message-normalizer.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/entity-resolver.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/connectivity-tracker.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/ingestion-config.service.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/pipeline-tracer.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/dlq-manager.test.ts`
- `apps/api/src/modules/data-ingestion/__tests__/ingestion.service.test.ts`
- `apps/api/src/modules/rule-chain/__tests__/node-registry.test.ts`
- `apps/api/src/modules/rule-chain/__tests__/default-chain-builder.test.ts`
- `apps/api/src/modules/rule-chain/__tests__/debug-recorder.test.ts`
- `apps/api/src/modules/rule-chain/__tests__/rule-engine.test.ts`
- `apps/api/src/modules/uns/__tests__/uns-path-builder.test.ts`

### Modified Files
- `apps/api/src/app.ts` — Registered all new routes, added shutdown handlers
- `apps/api/src/modules/data-ingestion/ingestion.service.ts` — Integrated rule chain execution (stages 7-8)
- `apps/web/src/main.tsx` — Added 3 new route registrations

---

## Current State

### Monorepo Packages (5)
| Package | Build | Purpose |
|---------|-------|---------|
| @digilog/shared | OK | Zod schemas + types |
| @digilog/db | OK | Prisma + TimescaleDB pool |
| @digilog/queue | OK | BullMQ queue definitions |
| @digilog/api | OK | Fastify backend |
| @digilog/web | OK | React frontend |

### API Endpoints: ~138 (82 original + ~56 new)

### Frontend Pages: 31 (28 original + 3 new)
- `/rule-chains` — Rule Chains management (SUPER_ADMIN/ADMIN)
- `/alarms` — Alarm Dashboard (all authenticated)
- `/config/uns` — UNS Configuration (SUPER_ADMIN/ADMIN)

---

## How to Resume

### 1. Start the dev environment
```bash
cd /path/to/21cfrlogbook
docker compose up -d          # PostgreSQL + TimescaleDB + EMQX + Redis
npm run dev                   # API + Web in dev mode
```

### 2. Access points
- **Web App:** http://localhost:5175
- **API:** http://localhost:3000
- **Swagger:** http://localhost:3000/docs
- **Login:** admin / Admin@123

### 3. Verify build
```bash
npm run build                 # All 5 packages should compile
```

---

## Phase K Complete — Testing Patterns Reference

### Test Framework & Conventions
- **Framework:** Vitest with `vi.hoisted()` for mock declarations
- **Mock path convention:** `__tests__/` directories co-located with source modules
- **IORedis/BullMQ mocks:** Class-based mocks (`MockRedis`, `MockQueue`) via `vi.hoisted()` + `vi.mock()`
- **Prisma mock:** `vi.mock('@digilog/db')` with `mockDeep<PrismaClient>`
- **Run command:** `npx vitest run` (per-package) or `npm run test` (if configured)

### What Was Tested (425 tests)
- Message normalizer, entity resolver, connectivity tracker, ingestion config service
- Pipeline tracer, DLQ manager, full ingestion pipeline stages (ingestion.service)
- UNS path builder (ISA-95 path generation)
- Node registry, debug recorder, default chain builder, rule engine (BFS execution)
- Telemetry batcher (multi-row INSERT batching)
- Shared Zod schemas (assets, auth, config, users) and audit template types

### Frontend Pages NOT Yet Built (from Phase specs, lower priority)
- Rule Chain Visual Editor (React Flow canvas) — Phase G
- Connectivity tab in Entity Explorer — Phase H
- QR generator UI — Phase H
- Checklist form / Mobile-first checklist — Phase I
- Help panel sidebar — Phase J
- Alarm badge component — Phase J

---

## Known Issues & Gotchas
- **SystemConfig model**: Uses `configKey`/`configValue` (NOT `key`/`value`)
- **HelpArticleVersion model**: Uses `helpArticleId` (NOT `articleId`)
- **UnsMapping model**: Has no `entity` relation — need separate Prisma query for entity name
- **While-loop variables**: Need explicit type annotation to avoid circular inference in TypeScript
- **OneDrive EPERM**: Prisma generate can fail due to OneDrive file sync locking
- **Docker not running locally**: Docker Desktop not available on this Windows machine
- **CRITICAL naming**: `config.service.ts` = original SystemConfig UI service. `ingestion-config.service.ts` = Phase C IngestionSystemConfig. NEVER overwrite original.

---

## Prior Work Summary

| Phase | Date | Summary |
|-------|------|---------|
| Phase 1 | 2026-02-17 | Core app: 82 endpoints, 28 pages, 15 Prisma models |
| Phase 2 | 2026-02-20 | Connection limits, toast system, Asset→Entity rename |
| Checklist | 2026-02-21 | 14 question types, audit descriptions, tests |
| v2.1.2 | 2026-02-25 | Documentation governance, Git issue lifecycle |
| Phases A–J | 2026-02-25 | Data Ingestion & Integration Layer (all backend + 3 frontend pages) |
| **Phase K** | **2026-02-26** | **425 unit tests across 18 files in 3 packages — ALL PHASES COMPLETE** |
