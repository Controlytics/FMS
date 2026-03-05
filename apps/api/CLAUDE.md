# DigiLog API — Backend

## Stack
Fastify 5, TypeScript, Prisma ORM, PostgreSQL 16, TimescaleDB, bcrypt, jose (JWT), Zod validation, BullMQ, Redis, MQTT (EMQX)

## Directory Structure
- `src/app.ts` — Entry point, registers plugins and routes (trustProxy: 1, bodyLimit: 10MB)
- `src/plugins/` — Fastify plugins (auth with absolute 24h timeout + session sliding window, audit-logger, rbac)
- `src/modules/` — Feature modules:
  - `auth/` — Login, logout, password management, re-verification
  - `users/` — User CRUD, stats, enable/disable, unlock, password reset
  - `config/` — System configuration (password policy, datetime, branding, alarm-columns, etc., 36+ endpoints)
  - `roles/` — Role management, permissions, hierarchy
  - `assets/` — Entity templates, instances, relationships, identifiers (21 endpoints, atomic transactions)
  - `audit/` — Audit trail with SHA-256 checksums (deletion now audit logged)
  - `backup/` — Database backup & restore
  - `notifications/` — Role-based user alerts
  - `uploads/` — File uploads (profile photos)
  - `data-ingestion/` — HTTP ingestion, entity resolver, normalizer, pipeline, DLQ, connectivity tracker (atomic SQL upsert, alarm deduplication)
  - `rule-chain/` — Rule chain engine, 28 node types (sandboxed VM execution), sub-chain delegation, debug recorder (14 endpoints, permission-based access, reauth on CRUD)
  - `uns/` — Unified Namespace ISA-95 (6 endpoints, reauth on config changes)
  - `queries/` — Telemetry (7), alarms (5 with MANUALLY_CLEARED status), export (5), retention (4)
  - `connectivity/` — Entity connectivity status (6 endpoints)
  - `qr-code/` — QR code generation (4 endpoints)
  - `help/` — Help articles with versioning (6 endpoints, reauth on CRUD)
- `src/lib/` — Shared utilities (prisma client, JWT, password hashing, hash chain, error schemas, reauth, user-id validator, swagger, uns-path.ts)
- `src/transport/` — MQTT auth (3 endpoints), MQTT client, WebSocket handler
- `src/workers/` — BullMQ ingestion worker, maintenance worker
- `prisma/schema.prisma` — Database schema (30 models). AssetTemplate includes `checklistSchema`, `defaultRuleChainId`, data ingestion fields. Alarm model includes `clearDetails` (Json?) and `MANUALLY_CLEARED` status.
- `prisma/seed.ts` — Seed script for default data (33 ingestion configs, 28 help articles)

## Running
```bash
npm run dev          # tsx watch src/app.ts
npm run build        # tsc
```

## API Prefix
All routes under `/api/`. Auth on all routes except `/api/auth/login`, `/api/auth/forgot-password`, `/api/config/branding`, `/api/health`, and `/docs`.

## Swagger (`src/lib/swagger.ts`)
Swagger UI available at `/docs`. Auto-generated from route schemas. Tags: Health, Auth, Users, Roles, Config, Audit, Notifications, Uploads, Backup, Entity Templates, Entities, Entity Relationships, Entity Identifiers, Data Ingestion, Rule Chains, UNS, Telemetry, Alarms, Export, Retention, Connectivity, QR Codes, Help, Debug Traces. Config: `docExpansion: 'list'`, `persistAuthorization: true`, `tryItOutEnabled: true`. Two servers: Production (http://3.108.185.106) and Local Development.

## Auth Flow
JWT token in `Authorization: Bearer <token>` header. Sessions stored in DB for invalidation support.

## Roles
Dynamic roles stored in DB. Default: SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER.

## Audit Trail
SHA-256 checksummed entries. SUPER_ADMIN actions are NOT logged (21 CFR Part 11 exemption). Audit record deletion (single and bulk) is now audit logged before execution. Alarm acknowledge/clear, help CRUD, UNS config, rule chain CRUD, and debug trace toggle all generate audit entries.

## Route Schema Pattern
All routes with error responses MUST include `...errorResponses` in their schema `response` object (imported from `src/lib/error-schemas.ts`). Without this, Fastify 5's TypeScript types reject `reply.code(400)` etc.

## Entity Module (`src/modules/assets/routes.ts`)
21 endpoints across 14 paths for entity template management, entity instance management, entity relationships, and entity identifiers. All using `requirePermission` (checks role.permissions array in DB):

- **Templates** (6): GET/POST `/templates`, GET/PUT/DELETE `/templates/:id`, GET `/templates/:id/versions`
  - Permissions: ASSET_VIEW (GET), ASSET_TEMPLATE_MANAGE (POST/PUT/DELETE)
  - Reauth: CREATE_ASSET_TEMPLATE, UPDATE_ASSET_TEMPLATE, DELETE_ASSET_TEMPLATE
  - Update auto-creates AssetTemplateVersion snapshot, increments version number
  - Template includes `category`, `expectedRelationships`, `statusLifecycle`, `maxParentConnections`, and `maxConnections` fields.
  - All JSONB fields (`attributeSchema`, `telemetrySchema`, `expectedIdentifiers`, `expectedRelationships`, `statusLifecycle`, `alarmRules`, `checklistSchema`) declared in both body and response schemas
- **Instances** (8): GET `/instances`, GET `/instances/tree`, GET/POST/PUT/DELETE `/instances/:id`, PATCH `/instances/:id/status`, GET `/instances/:id/children`
  - Permissions: ASSET_VIEW (GET), ASSET_CREATE (POST), ASSET_UPDATE (PUT/PATCH), ASSET_DELETE (DELETE)
  - POST /instances: Template existence check only (no isActive filter — assets can be created from any template)
  - Reauth: CREATE_ASSET, UPDATE_ASSET, DELETE_ASSET
  - Delete uses cascade soft-delete via `collectDescendantIds()` helper
- **Relationships** (3): GET/POST `/relationships`, DELETE `/relationships/:id`
  - Auto-creates bidirectional inverses using INVERSE_RELATIONSHIP_MAP (CONTAINS<->CONTAINED_IN, FEEDS<->FED_BY, DEPENDS_ON<->DEPENDED_ON_BY, BACKS_UP<->BACKED_UP_BY, MONITORS<->MONITORED_BY, CONNECTED_TO symmetric, CUSTOM)
  - POST /relationships enforces `maxConnections` limit on both source and target entities. Returns `connectionInfo` in success/error responses.
  - `hasContainsCycle()` helper: iterative ancestor walk to prevent circular CONTAINS
  - Reauth: CREATE_ASSET_RELATIONSHIP, DELETE_ASSET_RELATIONSHIP
- **Identifiers** (4): GET `/identifiers`, GET `/identifiers/lookup/:value`, POST/DELETE `/identifiers/:id`
  - Globally unique `identifierValue` enforced at DB level
  - Types: QR, BARCODE, RFID, NFC, MANUAL
  - Permissions: ASSET_VIEW (GET), ASSET_IDENTIFIER_MANAGE (POST/DELETE)
  - Reauth: CREATE_ASSET_IDENTIFIER, DELETE_ASSET_IDENTIFIER

API response format for paginated endpoints: `{ data: [], total, page, limit, totalPages }`. Tree endpoint returns a flat array.

## RBAC Plugin (`src/plugins/rbac.ts`)
Two decorators:
- **`requirePermission(permission)`**: Fetches role from DB, checks if `permissions` JSON array includes the required permission. Logs UNAUTHORIZED_ACTION_ATTEMPT on failure.
- **`requireRole(...roles)`**: Checks if user's role name is in the allowed list. Simpler check, used for non-asset routes.

Asset routes exclusively use `requirePermission`. Non-asset routes may use `requireRole`.

## Performance Notes
- Use SQL queries for aggregate operations (MAX, COUNT) instead of fetching all rows
- Batch-fetch related records with `findMany` + `IN (...)` instead of N+1 loops
- All major tables have indexes (see `prisma/schema.prisma` for `@@index` declarations)

## Rule Chain Engine (`src/modules/rule-chain/`)
28 node types with sandboxed VM execution (1s timeout, no process/require/global access). Sub-chain delegation with depth tracking prevents infinite loops. Default chain builder creates dual create-alarm/clear-alarm paths per alarm rule. Config field `scriptBody` renamed to `script`. Node types include `configSchema` for dynamic UI field generation. All routes use `requirePermission('RULE_CHAIN_MANAGE')` with reauth on CREATE/UPDATE.

## Data Ingestion (`src/modules/data-ingestion/`)
- **Telemetry upsert**: Atomic SQL `INSERT ... ON CONFLICT ... DO UPDATE WHERE` (no race conditions)
- **Alarm deduplication**: Only creates alarm if no ACTIVE alarm of same type exists
- **Connectivity tracker**: Updates DeviceCredential timestamps (firstConnectedAt, lastConnectedAt, lastSourceIp)
- **Instance service**: All CRUD operations wrapped in Prisma transactions for atomicity

## Security Patterns
- **trustProxy: 1** — Trust exactly 1 proxy hop (prevents X-Forwarded-For spoofing)
- **Absolute session timeout**: 24h hard limit regardless of activity
- **Session sliding window**: Extends expiresAt on each authenticated request
- **terminateOtherSessions()**: Called on password change
- **Orphan cleanup**: Entity delete cascades to 6 dependent tables
- **User enumeration prevention**: Login returns attemptsRemaining for non-existent users

## CI/CD
GitHub Actions (`.github/workflows/ci.yml`): PostgreSQL 15, Redis 7, Node 20. Triggers on push to main/DataIngestion and PRs. 1344 tests, 0 failures.

## Build Note
Always clean `dist/` before rebuilding if old modules were removed to avoid stale compiled files:
```bash
rm -rf dist && npm run build
```
