# DigiLog — Backend Guide

## Overview

Fastify 5 backend with TypeScript, 34 API modules, 200+ endpoints. Managed by PM2 in production, tsx in development.

**Entry point:** `apps/api/src/app.ts`
**Dev:** `cd apps/api && npx tsx watch src/app.ts` (port 3000)
**Build:** `npx tsc -p apps/api/tsconfig.json` → `apps/api/dist/`
**Production:** `pm2 start dist/app.js --name digilog-api`

## App Setup (app.ts)

The main application file registers everything in this order:

1. **Fastify instance** — body limit 10MB, logger (pino)
2. **Helmet** — security headers (HSTS, no CSP)
3. **CORS** — configured origins from .env
4. **Rate limiter** — 500 requests/minute global
5. **Swagger** — OpenAPI docs at `/docs`
6. **Auth plugin** — JWT verification, user lookup, session validation
7. **RBAC plugin** — `requirePermission()` decorator
8. **Audit logger plugin** — SHA-256 hash-chain logging
9. **34 route modules** — registered under `/api/` prefix
10. **MQTT client** — connects to EMQX broker
11. **WebSocket handler** — real-time data at `/ws`
12. **Ingestion worker** — BullMQ consumer (concurrency: 10)
13. **Maintenance worker** — DLQ check, connectivity check, retention cleanup
14. **Config discovery** — auto-registers 24 config definitions
15. **Static uploads** — serves `/uploads/` directory
16. **Health check** — `GET /api/health`
17. **Error handler** — unified error responses (AppError → HTTP codes)

## 34 API Modules

### Auth & User Management

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `auth` | `/api/auth` | 9 | Login, logout, refresh, verify, change-password, forgot-password |
| `users` | `/api/users` | 14 | CRUD, enable/disable, unlock, reset-password, bulk-delete |
| `roles` | `/api/roles` | 8 | Role CRUD, permissions, hierarchy, creatable roles |
| `user-groups` | `/api/user-groups` | 7 | Group CRUD, member management |

### Organization & Admin

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `super-admin` | `/api/super-admin` | 35+ | Platform-wide admin, org management |
| `org-admin` | `/api/org-admin` | 3 | Organization settings, usage stats |
| `tenant-admin` | `/api/organizations` | 21+ | Multi-tenant org CRUD, user/entity assignment |
| `admin-requests` | `/api/admin-requests` | 4 | Admin action request workflow |

### Asset Management

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `assets` | `/api/assets` | 30+ | Templates, instances, relationships, identifiers (sub-routes) |
| `entity-assignments` | `/api/entity-assignments` | 6 | Entity-to-group/user/org assignments |
| `equipment-groups` | `/api/equipment-groups` | 6 | AHU equipment group CRUD |

### Filter Operations

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `filter-operations` | `/api/filters` | 15 | Cycle start/advance/bypass, checklist submit, events |
| `filter-profiles` | `/api/filter-profiles` | 6 | Filter-to-profile assignments |
| `cleaning-profiles` | `/api/filter-cleaning-profiles` | 9 | Pipeline profile CRUD, versioning, validation |
| `checklist-profiles` | `/api/checklist-profiles` | 9 | Checklist template + question management |
| `pm-schedules` | `/api/pm-schedules` | 18 | PM scheduling, entries, executions, approvals |
| `block-change-requests` | `/api/block-change-requests` | 5 | Block reassignment approval workflow |

### Reports

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `report-templates` | `/api/report-templates` | 9 | Template CRUD, versioning, preview |
| `reports` | `/api/reports` | 8 | Report generation, PDF export, signatures |

### Data Pipeline

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `data-ingestion` | `/api/data` | 11 | Telemetry, attributes, events, RPC, binary upload |
| `queries` | `/api/telemetry`, `/api/alarms`, `/api/retention`, `/api/export` | 15+ | Time-series queries, alarm management, data retention, bulk export |

### Rule Engine

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `rule-chain` | `/api/rule-chains` | 14+ | Rule chain CRUD, 77 node types, graph execution, debug |

### Notifications

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `notifications` | `/api/notifications` | 9 | User notifications, unread count, bulk actions |
| `notification-rules` | `/api/notification-rules` | 8 | Event-based notification triggers |
| `notification-delivery` | `/api/notification-settings` | 18 | Email/SMS/Telegram/Slack channel config |

### Configuration

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `config` | `/api/config` | 40+ | 30 config definitions (`config/defs/`), `dynamic-routes.ts` for registry-discovered surfaces + `static-routes/` per-tab files (split done in bloat audit P2.3) |

**Static-routes split** (`apps/api/src/modules/config/static-routes/`, 11 files): `access-matrix.routes.ts`, `action-reauth.routes.ts`, `alarm-columns.routes.ts`, `audit-templates.routes.ts`, `branding.routes.ts`, `cleaning-profile-assignment.routes.ts`, `dashboard-cards.routes.ts`, `field-ids.routes.ts`, `roles.routes.ts`, `tablet-access.routes.ts`, `user-id.routes.ts`. Top-level `routes.ts` is now a registration loop (~170 LOC, was 1003).

### Infrastructure

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `connectivity` | `/api/connectivity` | 7 | Device token management, connection status, code snippets |
| `qr-code` | `/api/qr` | 4 | QR code generation for entities |
| `uns` | `/api/uns` | 7 | ISA-95 UNS path management |
| `uploads` | `/api/uploads` | 1 | Profile photo upload |
| `help` | `/api/help` | 6 | Help article CRUD |
| `ldap` | `/api/ldap` | 4 | LDAP integration config, sync |

### System

| Module | Prefix | Endpoints | Key Features |
|---|---|---|---|
| `audit` | `/api/audit` | 4 | Audit trail query, hash-chain verification |
| `backup` | `/api/backup` | 3 | Database export/restore (JSON, SQL, CSV, BAK) |
| `system-health` | `/api/system-health` | 1 | System metrics |
| `deployment-check` | `/api/deployment-check` | 1 | Deployment validation |
| `dashboards` | `/api/dashboards` | 13 | Dashboard CRUD, widget management |

## Shared Libraries (apps/api/src/lib/)

| File | Purpose |
|---|---|
| `prisma.ts` | Prisma client singleton |
| `audit.ts` | SHA-256 hash-chain audit logger |
| `jwt.ts` | JWT token creation, verification, refresh |
| `build-context.ts` | Extract RequestContext from Fastify request |
| `org-scope.ts` | Organization-scoped Prisma where clauses |
| `reauth-check.ts` | Re-authentication enforcement (10s in-memory cache) |
| `sanitize.ts` | HTML stripping on all text inputs |
| `password.ts` | bcrypt hashing, password validation |
| `password-validator.ts` | Policy-based password strength rules |
| `errors.ts` | AppError class (statusCode, code, message) |
| `error-schemas.ts` | Fastify error response schemas |
| `config-discovery.ts` | Auto-discover config definitions at startup |
| `config-registry.ts` | Self-registering config module pattern |
| `hash-chain.ts` | SHA-256 chain verification for audit integrity |
| `swagger.ts` | OpenAPI/Swagger configuration |
| `uns-path.ts` | ISA-95 UNS path utilities |
| `user-id-validator.ts` | Custom user ID format validation |
| `idempotency.ts` | **Offline replay dedup** — checks `x-client-op-id` header against `FilterEvent.attributes.clientOpId`; returns cached state for duplicate replays so retries never produce duplicate cycles, double advances, or repeat checklist submissions. |

## Plugins (apps/api/src/plugins/)

| Plugin | Purpose |
|---|---|
| `auth.ts` | JWT verification, user lookup from DB, attach `req.user`; maintains `PUBLIC_GET_PATHS` allowlist for unauthenticated endpoints (`/api/health`, `/api/auth/login`, `/api/admin-requests/user-lookup`, `/api/config/password-policy/current`, `/api/config/report-settings/current`, `/api/roles/active`, etc.) |
| `rbac.ts` | `requirePermission(perm)` — single perm check; `requireAnyPermission(...perms)` — accepts any of the listed perms (used for granular toggle fallbacks like `FCP_* OR CHECKLIST_*`); `enforceReauth(action, req, reply)` accepts `string \| string[]` and reauths if any configured for role. |
| `audit-logger.ts` | Auto-log mutations with before/after values; SHA-256 hash-chained per-org. |

## Transport Layer

| File | Purpose |
|---|---|
| `transport/mqtt-client.ts` | EMQX MQTT client wrapper |
| `transport/mqtt-handler.ts` | MQTT message processing (subscribe to `digilog/v1/#`) |
| `transport/mqtt-auth-routes.ts` | EMQX webhook endpoints (`/api/internal/mqtt/auth`, `/acl`) |
| `transport/ws-handler.ts` | WebSocket handler for real-time data push |

## Workers

| Worker | File | Concurrency | Schedule |
|---|---|---|---|
| Ingestion | `workers/ingestion.worker.ts` | 10 | Continuous (BullMQ consumer) |
| Maintenance | `workers/maintenance.worker.ts` | 1 | DLQ: 60s, Connectivity: 60s, Retention: 24h |

## Database Schema (64 models, 22 enums)

### Core Models
`Organization`, `User`, `Role`, `Session`, `PasswordHistory`, `PasswordResetRequest`, `SystemConfig`, `FieldIdConfig`, `RoleConfig`, `UserConfig`

### Asset Models
`AssetTemplate`, `AssetTemplateVersion`, `AssetInstance`, `AssetRelationship`, `AssetIdentifier`, `TemplateAssignment`, `EntityAssignment`, `DeviceCredential`

### Filter Operation Models
`FilterCleaningProfile`, `FilterPipelineStage`, `FilterPipelineConnection`, `FilterProfile`, `CleaningCycle`, `FilterEvent`, `ChecklistProfile`, `ChecklistQuestion`, `ChecklistReview`, `ElectronicSignature`

### Scheduling Models
`PmSchedule`, `PmScheduleEntry`, `PmExecution`, `EquipmentGroup`, `EquipmentGroupInstrument`, `BlockChangeRequest`

### Report Models
`ReportTemplate`, `ReportTemplateVersion`, `ReportInstance`, `ReportSignature`

### Rule & Notification Models
`RuleChain`, `RuleChainVersion`, `RuleNode`, `RuleNodeConnection`, `Notification`, `NotificationLog`, `NotificationTemplate`, `NotificationRule`, `NotificationRuleRecipient`, `UserGroup`, `UserGroupMember`

### System Models
`AuditTrail`, `Alarm`, `Dashboard`, `DashboardWidget`, `DashboardAssignment`, `ConnectivityStatus`, `DataStream`, `LatestTelemetry`, `DeadLetterQueue`, `IngestionSystemConfig`, `QrCode`, `HelpArticle`, `HelpArticleVersion`, `UnsMapping`, `AdminRequest`

## Environment Variables

```env
# PostgreSQL
DATABASE_URL=postgresql://digilog:password@localhost:5432/digilog_db?schema=public

# TimescaleDB
TSDB_HOST=localhost
TSDB_PORT=5432
TSDB_DATABASE=digilog_tsdb
TSDB_USER=digilog
TSDB_PASSWORD=password

# MQTT (EMQX)
MQTT_ENABLED=true
MQTT_BROKER_HOST=localhost
MQTT_BROKER_PORT=1883
EMQX_ADMIN_PASSWORD=password

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=random-64-char-string
VERIFICATION_TOKEN_SECRET=different-random-64-char-string
JWT_EXPIRES_IN=8h

# Server
NODE_ENV=production
API_PORT=3000
API_HTTPS=true

# CORS
CORS_ORIGIN=https://192.168.1.100
ALLOWED_ORIGINS=https://192.168.1.100,capacitor://localhost

# Uploads
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880
```

## Key Architectural Patterns

1. **Module pattern** — Each feature is a self-contained module with routes + service + repository
2. **Organization scoping** — `orgScope(ctx)` adds `organizationId` filter to all queries
3. **Permission-based RBAC** — `requirePermission('PERM')` on every protected route
4. **Re-authentication** — `enforceReauth('ACTION', req, reply)` for 69 sensitive operations
5. **Audit logging** — Every mutation auto-logged with SHA-256 hash chain
6. **Input sanitization** — All text fields stripped of HTML via `sanitize.ts`
7. **Config registry** — 24 config definitions auto-discovered at startup
8. **Versioning** — Cleaning profiles, rule chains, help articles use version-on-update pattern
9. **Immutable events** — Filter events stored with checksums, never modified (21 CFR Part 11)
10. **Error handling** — `AppError(statusCode, code, message)` → unified JSON error response
