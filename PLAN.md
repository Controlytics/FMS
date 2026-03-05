# DigiLog — Master Development Plan

**Last updated:** 2026-03-05
**Status:** Phase 1 complete, Phases A–K (Data Ingestion + Testing & Documentation) complete, v3.0 (Security + Refactoring + CI/CD) complete

---

## Timeline

| Date | Milestone | Status |
|------|-----------|--------|
| 2026-02-17 | **v1.0.0** — Initial release (User Mgmt, Entity Mgmt, Config, Audit) | Done |
| 2026-02-17 | Action reauth, audit templates, pagination config | Done |
| 2026-02-19 | Dynamic tree diagram, telemetry schema, attach existing, multi-select linking | Done |
| 2026-02-19 | Template linking rules (added then removed) | Done (removed) |
| 2026-02-20 | Connection limits, toast system, Asset→Entity rename, bug fixes | Done |
| 2026-02-20 | API refactoring Phase 0-1 (infrastructure + entity management module) | Done |
| 2026-02-20 | API refactoring Phase 2-4 (auth, config, users modules) | Done |
| 2026-02-21 | Checklist feature, audit descriptions, privileges, reauth, tests | Done |
| 2026-02-25 | **v2.1.1** — Documentation governance, testing centralization, bug log, project summary | Done |
| 2026-02-25 | **v2.1.2** — Git issue lifecycle: 12 bug issues created (#2–#13), 11 closed | Done |
| 2026-02-25 | **Phase A** — Data Ingestion Infrastructure (Docker, TimescaleDB, Prisma models, packages, shared types, seed data) | Done |
| 2026-02-25 | **Phase B** — Transport Layer (MQTT auth, MQTT client, WS handler, HTTP data ingestion, entity resolver, normalizer, RPC handler) | Done |
| 2026-02-25 | **Phase C** — Ingestion Pipeline (BullMQ worker, 11 pipeline stages, telemetry batcher, DLQ, tracer, connectivity tracker, maintenance worker) | Done |
| 2026-02-25 | **Phase D** — Rule Chain Engine (26 node types, BFS execution, debug recorder, 14 API endpoints) | Done |
| 2026-02-25 | **Phase E** — Unified Namespace (ISA-95 paths, wildcard search, cascade moves, 6 API endpoints) | Done |
| 2026-02-25 | **Phase F** — Queries & Export (telemetry/alarm/export/retention routes, 20 API endpoints) | Done |
| 2026-02-25 | **Phase G-J Backend** — Connectivity, QR codes, Help articles (16 API endpoints) | Done |
| 2026-02-25 | **Phase G-J Frontend** — Rule Chains page, Alarm Dashboard, UNS Config page (3 new pages) | Done |
| TBD | API refactoring Phase 5-7 (backup, roles, notifications) | Pending |
| TBD | Frontend refactoring Phase 8-13 | Pending |
| 2026-02-26 | **Phase K** — Testing & Documentation — ~425 unit tests (18 files, 3 packages) | Done |
| 2026-03-01 | **v3.0 Security** — 8 production security fixes (trustProxy, session sliding, orphan cleanup, RBAC guards, nginx hardening) | Done |
| 2026-03-01 | **v3.0 CI/CD** — GitHub Actions workflow (PostgreSQL 15 + Redis 7), fix 26 failing tests, Vitest workspace | Done |
| 2026-03-01 | **v3.0 Documentation** — 36-page ThingsBoard-style documentation suite (API reference, user guides, admin, compliance) | Done |
| 2026-03-01 | **v3.0 Refactoring** — Entity Explorer (2081→386 lines), detail panel (2187→763 lines), extracted 6 dialogs + 6 tabs + 2 hooks | Done |
| 2026-03-01 | **v3.0 TimescaleDB** — 5 PostgreSQL tables converted to hypertables with chunk intervals, composite indexes, compliance protections | Done |
| 2026-03-02 | **v3.0 Checklist Fix** (FIX-024) — MCQ/MULTI_SELECT click handlers + 1262 lines of new tests | Done |

---

## Completed Work

### Phase 1 — Core Application (v1.0.0)

Full-stack 21 CFR Part 11 compliant digital logbook with:

- **~138 API endpoints** total (82 original + 56 from Phases B–J) across 20+ modules (auth, users, roles, config, entity templates, entity instances, entity relationships, entity identifiers, audit, notifications, uploads, backup, data ingestion, rule chains, UNS, telemetry queries, alarms, export, retention, connectivity, QR codes, help articles)
- **28 frontend pages** with role-based access control
- **30 Prisma models** (15 original + 15 new in Phase A) — Original: User, Role, PasswordHistory, Session, PasswordResetRequest, SystemConfig, UserConfig, RoleConfig, FieldIdConfig, AuditTrail, Notification, AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier — Phase A: DeviceCredential, RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection, Alarm, ChecklistReview, ElectronicSignature, LatestTelemetry, UnsMapping, ConnectivityStatus, QrCode, HelpArticle, HelpArticleVersion, DataStream, IngestionSystemConfig
- **9 custom hooks** (useAuth, useReauth, useSession, useSingleTab, useToast, useBranding, useDatetimeFormat, useFieldLabels, usePaginationConfig)
- **Shared package** with Zod schemas, TypeScript types, and constants

### Phase 2 — Entity Management Enhancements

- Connection limits (`maxParentConnections`, `maxConnections`) on templates
- Toast notification system (success/error/warning/info)
- Dynamic tree diagram with create child, attach existing, remove from tree
- Multi-select target linking
- Telemetry schema on templates
- Entity Template view dialog
- Global rename: Asset → Entity (UI only, code identifiers retained)
- Checklist schema (14 question types) on entity templates
- Audit log descriptions for entity operations
- Entity feature privileges and reauth actions

### API Refactoring — Routes → Services → Repositories

| Module | Lines Before | Files After | Status |
|--------|-------------|-------------|--------|
| Phase 0: Infrastructure | — | 5 files (context, errors, build-context, error-schemas, app error handler) | Done |
| Phase 1: Entity Management | 2,088 | 16 files (4 routes, 4 services, 4 repos, 3 helpers, 1 barrel) | Done |
| Phase 2: Users | 1,063 | 3 files (routes, service, repository) | Done |
| Phase 3: Config | 1,048 | 3 files (routes, service, repository) | Done |
| Phase 4: Auth | 834 | 3 files (routes, service, repository) | Done |

### Tests

| Location | Suite | Tests |
|----------|-------|-------|
| `packages/shared` | `schemas/assets.test.ts` | 20 (checklist schema) |
| `packages/shared` | `schemas/auth.test.ts` | Auth schemas |
| `packages/shared` | `schemas/config.test.ts` | Config schemas |
| `packages/shared` | `schemas/users.test.ts` | User schemas |
| `packages/shared` | `types/audit-templates.test.ts` | 17 (audit templates) |
| `packages/db` | `__tests__/telemetry-batcher.test.ts` | 21 (telemetry batcher) |
| `apps/api` | `e2e/checklist-templates.test.ts` | 14 (checklist CRUD) |
| `apps/api` | `e2e/entities.test.ts` | Entity E2E |
| `apps/api` | `lib/hash-chain.test.ts` | Hash chain |
| `apps/api` | `lib/jwt.test.ts` | JWT |
| `apps/api` | `lib/password.test.ts` | Password hashing |
| `apps/api` | `data-ingestion/__tests__/message-normalizer.test.ts` | 16 (message normalizer) |
| `apps/api` | `data-ingestion/__tests__/entity-resolver.test.ts` | 12 (entity resolver) |
| `apps/api` | `data-ingestion/__tests__/pipeline-tracer.test.ts` | 31 (pipeline tracer) |
| `apps/api` | `data-ingestion/__tests__/ingestion-config.service.test.ts` | 19 (ingestion config) |
| `apps/api` | `data-ingestion/__tests__/connectivity-tracker.test.ts` | 15 (connectivity tracker) |
| `apps/api` | `data-ingestion/__tests__/dlq-manager.test.ts` | 17 (DLQ manager) |
| `apps/api` | `data-ingestion/__tests__/ingestion.service.test.ts` | 22 (ingestion service) |
| `apps/api` | `rule-chain/__tests__/node-registry.test.ts` | 44 (node registry) |
| `apps/api` | `rule-chain/__tests__/debug-recorder.test.ts` | 20 (debug recorder) |
| `apps/api` | `rule-chain/__tests__/default-chain-builder.test.ts` | 19 (default chain builder) |
| `apps/api` | `rule-chain/__tests__/rule-engine.test.ts` | 21 (rule engine) |
| `apps/api` | `uns/__tests__/uns-path-builder.test.ts` | 17 (UNS path builder) |
| `apps/api` | `e2e/checklist-submission.test.ts` | Checklist E2E submission |
| `packages/shared` | `__tests__/checklist-answers.test.ts` | 14 question types |
| `packages/shared` | `__tests__/checklist-normalizer.test.ts` | Schema normalization |
| **Total** | **83+ test files** | **1344 tests, 0 failures** |

### Phase A — Data Ingestion Infrastructure (2026-02-25)

Infrastructure foundation for the Data Ingestion & Integration Layer:

**Docker Compose (4 services):**
- PostgreSQL 16 (lifecycle data), TimescaleDB (time-series), EMQX MQTT Broker, Redis 7 (BullMQ)

**TimescaleDB Init (init-tsdb.sql):**
- 6 hypertables: ts_telemetry, ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data, ts_pipeline_traces
- 2 continuous aggregates: telemetry_hourly, telemetry_daily
- Compression policies, retention (48h for traces), REVOKE UPDATE/DELETE on compliance tables

**Prisma Schema (15 new models):**
- DeviceCredential, RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection
- Alarm, ChecklistReview, ElectronicSignature, LatestTelemetry
- UnsMapping, ConnectivityStatus, QrCode, HelpArticle, HelpArticleVersion
- DataStream, IngestionSystemConfig
- AssetTemplate enhanced: dataIngestionEnabled, transportType, credentialType, inactivityTimeout, defaultMaxDataRate, autoProvision, defaultRuleChainId

**New Packages:**
- `packages/queue` — BullMQ queue definitions, priorities, schemas, Redis connection
- `packages/db` — Prisma singleton, TimescaleDB pg Pool

**Shared Package Extensions:**
- 18 new permissions (DATA_INGEST, DATA_VIEW, DATA_MANAGE, DATA_EXPORT, RULE_CHAIN_VIEW, RULE_CHAIN_MANAGE, ALARM_VIEW, ALARM_MANAGE, UNS_VIEW, UNS_MANAGE, QR_CODE_GENERATE, HELP_MANAGE, CHECKLIST_SUBMIT, CHECKLIST_REVIEW, CHECKLIST_APPROVE, RETENTION_MANAGE, SYSTEM_CONFIG_MANAGE, READ_DEBUG_TRACE, MANAGE_DEBUG_TRACE)
- 21 new reauth actions + 8 new categories
- 30+ new audit actions

**Seed Data:**
- 33 IngestionSystemConfig settings (rule_engine, device, pipeline, rpc, export, websocket, retention, mqtt, binary, ingestion categories)
- 28 help articles from Appendix B

**Frontend Fix:**
- action-reauth.tsx: Added CATEGORY_ICONS and CATEGORY_COLORS for 8 new reauth action categories

**Dependencies Installed:**
- Backend: mqtt, @fastify/websocket, bullmq, ioredis, qrcode, pg
- Frontend: reactflow, @monaco-editor/react, qrcode.react, signature_pad, recharts
- packages/queue: bullmq, ioredis, zod
- packages/db: @prisma/client, pg

### Phase B — Transport Layer (2026-02-25)

MQTT/HTTP/WebSocket transport for data ingestion:

- **MQTT Auth & Client**: Device credential authentication, MQTT client with auto-reconnect, topic routing
- **WebSocket Handler**: Real-time bidirectional data streaming via `@fastify/websocket`
- **HTTP Data Ingestion**: REST endpoints for telemetry, attribute, and event data submission
- **Entity Resolver**: Maps incoming device/data-stream IDs to entity instances
- **Normalizer**: Converts heterogeneous payloads into canonical internal format
- **RPC Handler**: Server-to-device remote procedure calls with timeout and response tracking

**Key files:** `apps/api/src/modules/data-ingestion/` (transport services, MQTT client, WS handler, HTTP routes, entity resolver, normalizer, RPC handler)

### Phase C — Ingestion Pipeline (2026-02-25)

BullMQ-based processing pipeline for ingested data:

- **BullMQ Worker**: `apps/api/src/workers/ingestion.worker.ts` — consumes ingestion queue jobs
- **Pipeline Stages (11)**: Validation, enrichment, transformation, persistence, rule evaluation, alarm check, notification dispatch, aggregation, forwarding, DLQ routing, trace recording
- **Telemetry Batcher**: `packages/db/src/telemetry-batcher.ts` — multi-row INSERT batcher for TimescaleDB
- **DLQ Manager**: `apps/api/src/modules/data-ingestion/dlq-manager.ts` — dead letter queue for failed messages
- **Pipeline Tracer**: `apps/api/src/modules/data-ingestion/pipeline-tracer.ts` — debug trace recorder
- **Connectivity Tracker**: `apps/api/src/modules/data-ingestion/connectivity-tracker.ts` — online/offline tracking
- **Maintenance Worker**: `apps/api/src/workers/maintenance.worker.ts` — periodic DLQ + connectivity cleanup
- **Ingestion Config Service**: `apps/api/src/modules/data-ingestion/ingestion-config.service.ts` — cached config reader (10s TTL)

### Phase D — Rule Chain Engine (2026-02-25)

Visual rule chain engine with 26 node types and BFS execution:

- **26 Node Types**: Filter, transform, switch, delay, aggregate, enrichment, action, external integration, etc.
- **BFS Execution**: Breadth-first traversal of rule chain graph with connection-based routing
- **Debug Recorder**: Step-by-step execution trace for rule chain debugging
- **14 API Endpoints**: CRUD for rule chains, rule nodes, connections, versions, and execution

**Key files:** `apps/api/src/modules/rule-chains/` (routes, services, repositories, engine, node types)

### Phase E — Unified Namespace (2026-02-25)

ISA-95 compliant hierarchical namespace:

- **ISA-95 Paths**: Enterprise/Site/Area/Line/Cell path structure for entity organization
- **Wildcard Search**: Path-based wildcard queries for namespace traversal
- **Cascade Moves**: Moving a namespace node cascades to all descendants
- **6 API Endpoints**: CRUD for UNS mappings, path lookup, tree retrieval

**Key files:** `apps/api/src/modules/uns/` (routes, services, repositories)

### Phase F — Queries & Export (2026-02-25)

Telemetry queries, alarm management, data export, and retention:

- **Telemetry Query Routes**: Time-range queries, aggregation (avg/min/max/sum/count), downsampling
- **Alarm Routes**: Alarm CRUD, acknowledgment, escalation, history
- **Export Routes**: CSV/JSON export for telemetry, alarms, audit data
- **Retention Routes**: Configurable data retention policies per data type
- **20 API Endpoints** across 4 sub-modules

**Key files:** `apps/api/src/modules/telemetry/`, `apps/api/src/modules/alarms/`, `apps/api/src/modules/export/`, `apps/api/src/modules/retention/`

### Phase G-J — Integration (2026-02-25)

Backend services and frontend pages for connectivity, QR codes, help, and dashboards:

**Backend (16 API endpoints):**
- Connectivity status tracking and history
- QR code generation and scanning for entity identification
- Help article management with versioning

**Frontend (3 new pages):**
- **Rule Chains page**: Visual rule chain editor with ReactFlow canvas, node palette, connection management
- **Alarm Dashboard**: Real-time alarm list with filtering, acknowledgment, severity indicators (recharts)
- **UNS Config page**: Namespace tree editor with drag-and-drop reorganization

**Key files:** `apps/api/src/modules/connectivity/`, `apps/api/src/modules/qr-codes/`, `apps/api/src/modules/help/`, `apps/web/src/routes/rule-chains/`, `apps/web/src/routes/alarms/`, `apps/web/src/routes/config/uns.tsx`

### Phase K — Testing & Documentation (2026-02-26, expanded 2026-03-01)

~425 initial unit tests, expanded to 1344 tests (0 failures) across 83+ test files:

**packages/shared (151 tests, 5 files):** Existing schema and type tests for auth, config, users, assets (checklist), audit templates.

**packages/db (21 tests, 1 file):**
- `packages/db/src/__tests__/telemetry-batcher.test.ts` — 21 tests (multi-row INSERT batcher)

**apps/api modules (253 tests, 12 files):**

Data Ingestion (132 tests, 7 files):
- `apps/api/src/modules/data-ingestion/__tests__/message-normalizer.test.ts` — 16 tests
- `apps/api/src/modules/data-ingestion/__tests__/entity-resolver.test.ts` — 12 tests
- `apps/api/src/modules/data-ingestion/__tests__/pipeline-tracer.test.ts` — 31 tests
- `apps/api/src/modules/data-ingestion/__tests__/ingestion-config.service.test.ts` — 19 tests
- `apps/api/src/modules/data-ingestion/__tests__/connectivity-tracker.test.ts` — 15 tests
- `apps/api/src/modules/data-ingestion/__tests__/dlq-manager.test.ts` — 17 tests
- `apps/api/src/modules/data-ingestion/__tests__/ingestion.service.test.ts` — 22 tests

Rule Chain Engine (104 tests, 4 files):
- `apps/api/src/modules/rule-chain/__tests__/node-registry.test.ts` — 44 tests
- `apps/api/src/modules/rule-chain/__tests__/debug-recorder.test.ts` — 20 tests
- `apps/api/src/modules/rule-chain/__tests__/default-chain-builder.test.ts` — 19 tests
- `apps/api/src/modules/rule-chain/__tests__/rule-engine.test.ts` — 21 tests

UNS (17 tests, 1 file):
- `apps/api/src/modules/uns/__tests__/uns-path-builder.test.ts` — 17 tests

---

## In Progress — Uncommitted Changes (DataIngestion Branch)

### Security & Auth Enhancements
- **Absolute session timeout** — 24h hard limit regardless of activity
- **Reauth enforcement expanded** — Alarm acknowledge/clear, help article CRUD, UNS config, rule chain CRUD, debug trace toggle
- **Sandboxed VM execution** — Rule chain scripts run in isolated Node.js VM contexts (1s timeout)
- **Audit logging expanded** — Audit record deletion, alarm actions, help CRUD, UNS config, rule chain CRUD, debug trace toggle

### Alarm Column Visibility Configuration
- New SUPER_ADMIN config page (`/config/alarm-columns`) with per-role column visibility
- 3 new API endpoints: `GET/PUT /api/config/alarm-columns`, `GET /api/config/alarm-columns/current`
- 11 configurable columns with toggle checkboxes per role

### Permission Migration (Role → Permission-Based)
- Rule chain routes, debug trace routes, alarm routes migrated from `requireRole()` to `requirePermission()`
- Frontend routes migrated from string literals to `PERMISSIONS.*` constants
- 7 new permission categories: Audit & Approvals, Notifications, Data & Ingestion, Rule Chains, Alarms, Checklists, Advanced

### Rule Chain Engine Improvements
- Sub-chain delegation with depth tracking to prevent infinite loops
- Dual create-alarm/clear-alarm paths per alarm rule
- Config schema support for dynamic UI field generation
- Rule chain select field in editor and template form

### Data Ingestion Optimizations
- Atomic SQL telemetry upsert (no race conditions)
- Alarm deduplication (prevents duplicates from rapid telemetry)
- Device credential tracking (firstConnectedAt, lastConnectedAt, lastSourceIp)
- Entity instance CRUD wrapped in Prisma transactions

### Database Schema Changes
- Alarm model: `clearDetails` (Json?) field, `MANUALLY_CLEARED` status
- New shared types: `alarm-columns.ts` (11 column definitions)

---

## Pending — API Refactoring (Phases 5-7)

### Phase 5: Backup Module (600 lines → 4 files)

```
modules/backup/
  routes.ts                  -- 3 endpoints
  backup.service.ts          -- orchestrate export/restore/validate
  backup.repository.ts       -- raw SQL queries + Prisma queries
  backup.helpers.ts          -- escapeSqlValue, escapeCsvValue, generateSqlInserts, computeBackupChecksum
```

### Phase 6: Roles Module (541 lines → 3 files)

```
modules/roles/
  routes.ts                  -- 8 endpoints
  role.service.ts            -- CRUD + hierarchy + permissions logic
  role.repository.ts         -- Role Prisma queries
```

### Phase 7: Notifications Module (469 lines → 3 files)

```
modules/notifications/
  routes.ts                  -- 9 endpoints
  notification.service.ts    -- list, mark read/unread, bulk ops + createNotification()
  notification.repository.ts -- Notification Prisma queries
```

Key decision: `createNotification()` moves to `notification.service.ts`. Auth and users services import from notification service.

---

## Pending — Frontend Refactoring (Phases 8-13)

### Phase 8: Frontend Shared Utilities

| Utility | Target File | Currently Duplicated In |
|---------|-------------|------------------------|
| `DEFAULT_PASSWORD_POLICY` + `generatePassword()` | `apps/web/src/lib/password-utils.ts` | users/list, users/create, users/edit, users/reset-requests |
| `useRoleColors()` hook | `apps/web/src/hooks/use-role-colors.ts` | users/list, audit/index, profile, header |
| `getPhotoUrl()` | `apps/web/src/lib/url-utils.ts` | profile, header |

### Phase 9: Entity Explorer (3,227 lines → ~22 files)

```
routes/assets/
  index.tsx                    -- page shell (~180 lines)
  types.ts                     -- TreeNode, AssetTemplate, etc.
  constants.ts                 -- ICON_MAP, RELATIONSHIP_LABELS
  hooks/
    use-entity-mutations.ts    -- all mutation handlers
    use-entity-tree.ts         -- tree filtering, expansion
  components/
    entity-tree-panel.tsx      -- left sidebar tree
    entity-tree-node.tsx       -- recursive tree node
    entity-list-view.tsx       -- table list view
    entity-detail-panel.tsx    -- detail panel with tabs
    attribute-form.tsx         -- dynamic attribute renderer
    float-input.tsx            -- FloatInput component
    hierarchy-diagram.tsx      -- recursive tree diagram
    detail-tabs/
      overview-tab.tsx, attributes-tab.tsx, relationships-tab.tsx,
      identifiers-tab.tsx, audit-history-tab.tsx
    dialogs/
      add-entity-wizard.tsx, edit-entity-dialog.tsx, delete-entity-dialog.tsx,
      link-entities-dialog.tsx, add-identifier-dialog.tsx, attach-existing-dialog.tsx
```

### Phase 10: Entity Template Manager (1,949 lines → ~16 files)

```
routes/assets/
  templates.tsx                -- page shell (~200 lines)
  template-types.ts, template-constants.ts, template-helpers.ts
  hooks/
    use-template-form.ts       -- form state + helpers
  components/
    template-table.tsx, template-form-dialog.tsx, template-view-dialog.tsx,
    template-delete-dialog.tsx, collapsible-section.tsx, numeric-constraints-panel.tsx
    template-form-sections/
      basic-info-section.tsx, attributes-section.tsx, telemetry-section.tsx,
      identifiers-section.tsx, alarm-rules-section.tsx, connection-limits-section.tsx
```

### Phase 11: User List (1,124 lines → ~8 files)

```
routes/users/
  list.tsx                     -- page shell (~200 lines)
  components/
    user-stats-bar.tsx, user-filters.tsx, user-table.tsx,
    user-action-dialog.tsx, user-bulk-delete-dialog.tsx,
    user-unlock-dialog.tsx, user-pagination.tsx
```

### Phase 12: Audit Trail (928 lines → ~7 files)

```
routes/audit/
  index.tsx                    -- page shell (~180 lines)
  audit-helpers.ts             -- ACTION_COLORS, getAuditSummary
  components/
    audit-filters.tsx, audit-table.tsx, audit-detail-modal.tsx,
    audit-pagination.tsx, audit-delete-dialog.tsx
```

### Phase 13: Config Pages (roles 719 lines, branding 644 lines)

```
routes/config/
  roles.tsx + roles-components/ (role-table, role-form-dialog, role-permissions-grid, role-delete-dialog, role-color-picker)
  branding.tsx + branding-components/ (logo-upload-section, color-settings-section, text-settings-section, branding-preview)
```

---

## Future Features

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| Electronic Signatures | E-sign with re-authentication for approvals | High | Pending |
| Logbook Entries / Digital Forms | Structured data entry forms tied to entities | High | Pending |
| Data Point Ingestion | MQTT/HTTP/WS integration for real-time telemetry | Medium | **Done** (Phases B-C) |
| Reports & Exports | CSV/JSON export for telemetry, alarms, audit data | Medium | **Done** (Phase F) |
| HTTPS/TLS Certificates | SSL for production deployment | Medium | Pending |
| CI/CD Pipeline | Automated build/test/deploy | Medium | **Done** (GitHub Actions) |
| Frontend Component Tests | Vitest + React Testing Library for UI components | Low | Pending |
| Per-page Pagination Selector | Config page done, page-level integration pending | Low | Pending |

---

## Verification Checklist

Run after every change:

```bash
# 1. TypeScript compilation
cd apps/api && npm run build
cd apps/web && npm run build

# 2. Tests (1344 total, 0 failures)
npx turbo run test                       # Run all tests via Turborepo

# 3. Full Turborepo build (5 packages: shared, db, queue, api, web)
npm run build

# 4. Production deploy
pm2 restart digilog-api
```

### Critical Endpoints Per Module
- **Entity Management**: All 21 `/api/assets/*` endpoints
- **Auth**: Login flow, logout, password change
- **Users**: CRUD, enable/disable/unlock, bulk delete
- **Config**: GET/PUT pairs, branding (public), user-id validation
- **Data Ingestion**: HTTP/MQTT/WS transport, pipeline processing
- **Rule Chains**: 14 `/api/rule-chains/*` endpoints
- **UNS**: 6 `/api/uns/*` endpoints
- **Telemetry/Alarms/Export/Retention**: 20 query & export endpoints
- **Connectivity/QR/Help**: 16 integration endpoints

---

## Architecture Principles

1. **Routes → Services → Repositories** — Thin route handlers, business logic in services, DB queries in repositories
2. **RequestContext** — Services receive `{ userId, userSub, userRole, ipAddress, userAgent, sessionId }` instead of Fastify request
3. **AppError hierarchy** — `NotFoundError`, `ValidationError`, `ConflictError`, `ForbiddenError` caught by global error handler
4. **Reauth in routes** — `enforceReauth()` needs `req`/`reply`, called before service layer
5. **Swagger schemas in routes** — Define the HTTP contract at the route level
6. **Audit logging in services** — Services call standalone `auditLog()` with `RequestContext`
7. **No functionality changes** — Refactoring preserves all API contracts, URLs, request/response formats, HTTP status codes
8. **Shared package as source of truth** — All Zod schemas, types, constants live in `@digilog/shared`

---

## Documentation Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` (root) | Full codebase overview, endpoints, architecture |
| `apps/api/CLAUDE.md` | API-specific patterns and module details |
| `apps/web/CLAUDE.md` | Frontend-specific patterns and component details |
| `packages/shared/CLAUDE.md` | Shared package structure and usage |
| `PLAN.md` | This file — master development plan |
| `BUSINESS_CONTEXT.md` | Business context, regulatory compliance, target industries |
| `CODEBASE_CONTEXT.md` | Codebase context and architecture overview |
| `CHANGELOG.md` | Version history and change details |
| `API_GUIDE.md` | Complete API endpoint reference with examples |
| `task_status.md` | Current development status and progress tracking |
| `apps/api/DECISIONS.md` | API architectural decisions |
| `apps/web/DECISIONS.md` | Frontend architectural decisions |
| `documentation/Bug_Resolution_Log.md` | Structured bug tracking with root cause analysis |
| `documentation/Project_Summary.md` | Comprehensive project summary with metrics |

### Testing Documentation (centralized at `/documentation/testing/`)

| File | Subfolder | Purpose |
|------|-----------|---------|
| `TEST.md` | `manual/` | Comprehensive test summary (334 tests) |
| `TEST_CASES.md` | `manual/` | Test case definitions |
| `TEST_SUMMARY.md` | `manual/` | Test coverage summary |
| `TEST_REPORT.md` | `reports/` | Test execution reports |
| `TREE_DIAGRAM_TEST_REPORT.md` | `reports/` | Tree diagram feature tests (70 tests) |
| `RBAC_TEST_RESULTS.md` | `reports/` | RBAC permission tests (73 tests) |
| `rbac-test.sh` | `automation/` | Automated RBAC test script |
| `21CFR_PART11_VERIFICATION.md` | `validation/` | 21 CFR Part 11 compliance verification |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-05 | Documentation sync: updated all .md files to reflect v3.0 changes (security, CI/CD, refactoring, TimescaleDB, tests) | Engineering Team |
| 2026-03-02 | FIX-024: Checklist MCQ/MULTI_SELECT click handlers + 1262 lines of new tests | Engineering Team |
| 2026-03-01 | v3.0: 8 security fixes, CI/CD pipeline, 36-page docs, component refactoring (Entity Explorer 82% reduction, detail panel 65% reduction), TimescaleDB hypertables, RBAC fixes, 26 test fixes (1344 tests, 0 failures) | Engineering Team |
| 2026-02-26 | Phase K complete: ~425 unit tests across 18 files in 3 packages (shared 151, db 21, api 253). Covers data ingestion (7 files, 132 tests), rule chain engine (4 files, 104 tests), UNS (1 file, 17 tests), telemetry batcher (1 file, 21 tests). | Engineering Team |
| 2026-02-26 | Phases B-J complete: Transport Layer (MQTT/HTTP/WS), Ingestion Pipeline (BullMQ, 11 stages, DLQ, tracer), Rule Chain Engine (26 node types, 14 endpoints), UNS (ISA-95 paths, 6 endpoints), Queries & Export (20 endpoints), Integration backend (16 endpoints) + frontend (3 pages). Total ~138 endpoints. | Engineering Team |
| 2026-02-25 | Phase A Infrastructure: Docker Compose (4 services), TimescaleDB init, 15 new Prisma models, packages/queue + packages/db, shared type extensions, seed data (33 configs + 28 help articles), frontend fix | Engineering Team |
| 2026-02-25 | Documentation governance: centralized testing docs to `/documentation/testing/`, created Bug_Resolution_Log.md, Project_Summary.md, Git issue template, updated all references | Engineering Team |
| 2026-02-21 | Added checklist feature, audit descriptions, entity privileges, reauth actions, 51 new tests | Engineering Team |
| 2026-02-20 | Phase 2 enhancements, API refactoring phases 0-4, connection limits, toast system | Engineering Team |
| 2026-02-19 | Dynamic tree diagram, telemetry schema, multi-select linking | Engineering Team |
| 2026-02-17 | v1.0.0 initial release, action reauth, audit templates, pagination config | Engineering Team |
