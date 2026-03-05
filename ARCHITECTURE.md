# DigiLog — System Architecture Document

> **Generated:** 2026-03-05 | **Branch:** DataIngestion | **Version:** Phase C (Data Ingestion)
> Based on actual codebase analysis, not theoretical assumptions.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [High-Level Architecture](#high-level-architecture)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [API Architecture](#api-architecture)
6. [Database Architecture](#database-architecture)
7. [Rule Chain Engine Architecture](#rule-chain-engine-architecture)
8. [Entity Management](#entity-management)
9. [Security Architecture](#security-architecture)
10. [Data Flow](#data-flow)
11. [Telemetry Flow](#telemetry-flow)
12. [Deployment Architecture](#deployment-architecture)
13. [Codebase Structure](#codebase-structure)
14. [Strengths of the Current Architecture](#strengths-of-the-current-architecture)
15. [Architecture Risks or Limitations](#architecture-risks-or-limitations)
16. [Improvement Recommendations](#improvement-recommendations)

---

## System Overview

DigiLog is a **21 CFR Part 11 compliant digital logbook** for pharmaceutical, biotech, and food manufacturing environments. It provides a template-based entity management system, real-time telemetry ingestion from industrial devices, a visual rule chain engine for data processing and alarm generation, and comprehensive audit trails with SHA-256 integrity verification.

**Core Purpose:** Replace paper-based logbooks with a regulatory-compliant digital system that ensures data integrity, user accountability, and full traceability of all operations — meeting FDA 21 CFR Part 11 requirements for electronic records and electronic signatures.

**Key Capabilities:**
- Template-driven entity management with hierarchical relationships and identifiers
- Multi-protocol data ingestion (MQTT, HTTP, WebSocket) with ISA-95 UNS topic structure
- Visual rule chain engine with 28 node types and sandboxed script execution
- Alarm lifecycle management (ACTIVE → ACKNOWLEDGED → CLEARED)
- Immutable, checksummed audit trail with electronic signature support
- Role-based access control with 40+ granular permissions and re-authentication enforcement
- Checklist submission with 3-step approval workflow (Performed → Checked → Verified)

**Architecture Pattern:** **Modular Monolith** with event-driven data ingestion pipeline. The system is a single deployable unit (Fastify API + React SPA) organized into 18 feature modules, with asynchronous processing via BullMQ job queues and Redis pub/sub for real-time events.

---

## High-Level Architecture

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                                  │
│  React 19 + Vite 6 + Tailwind CSS 4 + React Router 7 + SWR                │
│  34+ pages | 11 custom hooks | 12 UI components | Lazy-loaded routes      │
│  Served by nginx (port 80) from /apps/web/dist                            │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ REST API (JSON) + WebSocket
┌───────────────────────────────┴─────────────────────────────────────────────┐
│                              API LAYER                                      │
│  Fastify 5 | 145+ endpoints | JWT auth | RBAC | Reauth | Swagger/OpenAPI  │
│  Rate limiting | CORS | Helmet | Request validation (Zod + JSON Schema)   │
│  PM2 cluster mode (port 3000) behind nginx reverse proxy                  │
└───────┬───────────┬──────────────┬────────────┬─────────────┬──────────────┘
        │           │              │            │             │
┌───────┴───┐ ┌─────┴──────┐ ┌────┴─────┐ ┌───┴────┐ ┌──────┴──────┐
│ BUSINESS  │ │  RULE      │ │ DATA     │ │ QUEUE  │ │ TRANSPORT   │
│ LOGIC     │ │  ENGINE    │ │ LAYER    │ │ LAYER  │ │ LAYER       │
│           │ │            │ │          │ │        │ │             │
│ 18 modules│ │ 28 node    │ │ Prisma 6 │ │BullMQ │ │ MQTT Client │
│ Service → │ │ types      │ │ ORM +    │ │5 queues│ │ EMQX broker │
│ Repository│ │ Sandboxed  │ │ pg Pool  │ │Redis 7 │ │ WebSocket   │
│ → Prisma  │ │ VM (1s)    │ │ Batcher  │ │Workers │ │ HTTP ingest │
└───────────┘ └────────────┘ └──┬───┬───┘ └────────┘ └─────────────┘
                                │   │
                    ┌───────────┘   └───────────┐
                    │                           │
        ┌───────────┴──────────┐   ┌────────────┴──────────┐
        │   PostgreSQL 16      │   │   TimescaleDB          │
        │   (digilog_db)       │   │   (digilog_tsdb)       │
        │                      │   │                        │
        │   30 Prisma models   │   │   6 hypertables        │
        │   JSONB, pgcrypto    │   │   Continuous aggregates│
        │   Audit trail        │   │   Compression policies │
        │   Entity management  │   │   Retention policies   │
        └──────────────────────┘   └────────────────────────┘
```

### External Integration Points

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  EMQX 5      │     │  Redis 7     │     │  nginx       │
│  MQTT Broker │     │              │     │              │
│              │     │  Job queues  │     │  Reverse     │
│  1883 MQTT   │     │  Pub/Sub     │     │  proxy       │
│  8883 TLS    │     │  Debug bufs  │     │  Static files│
│  8083 WS     │     │  Chain cache │     │  EMQX proxy  │
│  18083 Dash  │     │  Session     │     │  Port 80     │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Frontend Architecture

### Framework & Tooling

| Aspect | Technology |
|--------|-----------|
| Framework | React 19.0.0 |
| Build Tool | Vite 6.1.0 |
| Styling | Tailwind CSS 4.0.0 (JIT via @tailwindcss/vite) |
| Routing | React Router 7.1.0 |
| Data Fetching | SWR 2.3.0 (stale-while-revalidate) |
| Forms | React Hook Form 7.54.0 + @hookform/resolvers (Zod) |
| Icons | Lucide React 0.474.0 |
| Charts | Recharts 2.15.4 |
| Visual Editor | React Flow 11.11.4 (rule chain editor) |
| Code Editor | Monaco Editor (@monaco-editor/react 4.7.0) |
| Validation | Zod 3.24.0 (shared with backend) |

### Component Structure

```
apps/web/src/
├── main.tsx                          # Entry point, router, providers (150 lines)
├── components/
│   ├── layout/
│   │   ├── app-layout.tsx            # Main container, session/tab mgmt (200 lines)
│   │   ├── sidebar.tsx               # Dynamic nav, role-filtered (230 lines)
│   │   └── header.tsx                # User menu, branding logo
│   ├── ui/                           # 12 primitive components (button, input, card,
│   │                                 #   dialog, table, badge, select, toast, etc.)
│   ├── error-boundary.tsx            # React error boundary (class component)
│   ├── require-role.tsx              # Permission gating wrapper (62 lines)
│   └── reauth-dialog.tsx             # Password re-verification modal (115 lines)
├── hooks/                            # 11 custom hooks (998 lines total)
│   ├── use-auth.ts                   # JWT login/logout, SWR /api/auth/me
│   ├── use-reauth.ts                 # Re-auth dialog orchestration
│   ├── use-session.ts                # Idle timeout + warning countdown
│   ├── use-single-tab.ts            # Single active tab enforcement (localStorage)
│   ├── use-toast.ts                  # Toast notifications via context
│   ├── use-branding.ts              # App branding config
│   ├── use-datetime-format.ts       # Timezone + date formatting
│   ├── use-field-labels.ts          # Dynamic field labels
│   ├── use-pagination-config.ts     # Pagination settings
│   ├── use-role-colors.ts           # Role → color mapping
│   └── use-entity-websocket.ts      # WebSocket real-time updates
├── lib/
│   ├── api-client.ts                 # Fetch wrapper + reauth variants (99 lines)
│   ├── swr-config.ts                 # Global SWR configuration
│   ├── cn.ts                         # clsx + tailwind-merge utility
│   └── password-utils.ts            # Password policy + generation
└── routes/                           # 50+ page components across 15 directories
    ├── auth/                         # login, forgot-password, change-password
    ├── dashboard.tsx                 # Main dashboard
    ├── users/                        # User CRUD (list, create, edit, reset-requests)
    ├── config/                       # 15+ config pages
    ├── assets/                       # Entity Explorer (386 lines) + templates (991 lines)
    │   ├── components/dialogs/       # 6 extracted dialog components
    │   ├── components/tabs/          # 6 extracted tab components (4,590 lines)
    │   └── hooks/                    # Asset-specific mutations + tree logic
    ├── rule-chains/                  # List + visual editor (2,133 lines)
    ├── alarms/                       # Alarm dashboard
    ├── audit/                        # Audit trail with filters
    ├── checklist/                    # 14 question types, submission form
    └── debug/                        # Pipeline debug traces
```

### Routing System

Routes are defined programmatically in `main.tsx` using React Router 7. 34+ routes with permission-based access control.

**Route Categories:**
- **Public:** `/login`, `/forgot-password`, `/change-password`
- **Protected (any authenticated):** `/`, `/profile`, `/notifications`, `/audit`, `/alarms`
- **Permission-based:** `/assets` (ASSET_VIEW), `/rule-chains` (RULE_CHAIN_VIEW), `/debug` (READ_DEBUG_TRACE)
- **Admin:** `/users`, `/config/*` (SUPER_ADMIN/ADMIN)

**Lazy-loaded pages** (React.lazy + Suspense): Entity Explorer, Entity Templates, Rule Chain Editor, Alarm Dashboard, UNS Config, Help Articles, Retention Config, System Health, Debug Traces, Checklist.

### State Management

**No global state library.** State management uses:
- **SWR** for all server data (stale-while-revalidate with 5s dedup interval)
- **React Context** for toast notifications and reauth dialog
- **sessionStorage** for JWT token
- **localStorage** for single-tab enforcement (heartbeat mechanism)
- **React useState/useRef** for local component state

**Critical SWR Pattern:**
```typescript
// API returns paginated: { data: T[], total, page, limit, totalPages }
const { data: res } = useSWR<{ data: Item[] }>('/api/items');
const items = res?.data ?? [];  // Extract .data array
```

### API Communication

The `ApiClient` class (`lib/api-client.ts`, 99 lines) wraps the Fetch API:
- Adds `Authorization: Bearer <token>` header automatically
- Handles 401 → redirect to `/login` with returnUrl
- Handles `FORCE_PASSWORD_CHANGE` / `PASSWORD_EXPIRED` → redirect to `/change-password`
- Handles `REAUTH_REQUIRED` → throws for dialog handling
- Provides reauth variants: `postWithReauth()`, `putWithReauth()`, etc. (dual-method: body `_currentPassword` + header `x-reauth-password`)

### Authentication Handling

The `useAuth` hook manages the auth lifecycle:
1. **Login:** POST `/api/auth/login` → store token in sessionStorage → check `forcePasswordChange` → redirect
2. **Session Persistence:** SWR fetches `/api/auth/me` on mount (conditional on token existence)
3. **Idle Timeout:** `useSession` tracks mouse/keyboard activity, shows warning countdown, auto-logout
4. **Single Tab:** `useSingleTab` uses localStorage heartbeat to detect duplicate tabs of same user
5. **Logout:** POST `/api/auth/logout` (fire-and-forget) → clear sessionStorage → redirect to `/login`

---

## Backend Architecture

### Framework & Runtime

| Aspect | Technology |
|--------|-----------|
| Framework | Fastify 5.2.0 |
| Runtime | Node.js 20 (ES modules) |
| Language | TypeScript 5.7 (compiled via tsc, dev via tsx watch) |
| ORM | Prisma 6 (PostgreSQL) |
| TSDB Driver | pg 8.18 (raw SQL for TimescaleDB) |
| Queue | BullMQ 5.70 (Redis-backed) |
| Auth | jose 6.0 (JWT HS256) + bcrypt 5.1 |
| Validation | Zod 3.24 |
| Logging | Pino 9.6 |
| MQTT | mqtt 5.15 |

### Module Structure (18 Modules)

```
apps/api/src/
├── app.ts                            # Entry point (262 lines): bootstrap, middleware, shutdown
├── plugins/
│   ├── auth.ts                       # JWT verification, session validation (139 lines)
│   ├── rbac.ts                       # Permission + role checking (87 lines)
│   └── audit-logger.ts              # SHA-256 checksummed audit logging (67 lines)
├── lib/
│   ├── jwt.ts                        # Token signing/verification (jose HS256)
│   ├── password.ts                   # bcrypt 12-round hashing
│   ├── hash-chain.ts                # SHA-256 checksum computation
│   ├── reauth-check.ts             # Re-authentication enforcement (87 lines)
│   ├── errors.ts                    # AppError, ValidationError, NotFoundError, etc.
│   ├── error-schemas.ts            # Fastify error response schemas
│   ├── build-context.ts            # RequestContext builder (userId, role, IP, etc.)
│   └── swagger.ts                   # Swagger/OpenAPI registration
├── modules/
│   ├── auth/                         # 8 endpoints (login, logout, password, verify)
│   ├── users/                        # 14 endpoints (CRUD, enable/disable, reset)
│   ├── roles/                        # 8 endpoints (CRUD, permissions)
│   ├── config/                       # 36+ endpoints (system config CRUD)
│   ├── assets/                       # 21 endpoints (templates, instances, relationships, identifiers)
│   │   ├── routes/                   # 4 route files
│   │   ├── services/                # 4 service files
│   │   └── repositories/           # 4 repository files
│   ├── audit/                        # 4 endpoints (query, delete)
│   ├── notifications/               # 9 endpoints
│   ├── uploads/                     # 2 endpoints (photo upload, file serve)
│   ├── backup/                      # 3 endpoints (export, restore, validate)
│   ├── data-ingestion/              # 8 endpoints + 11 internal files
│   ├── rule-chain/                  # 14 endpoints + 28 node types
│   ├── queries/                     # 21 endpoints (telemetry, alarms, export, retention)
│   ├── connectivity/               # 6 endpoints
│   ├── qr-code/                    # 4 endpoints
│   ├── help/                       # 6 endpoints
│   ├── uns/                        # 6 endpoints
│   └── system-health/             # 5 endpoints
├── transport/
│   ├── mqtt-auth-routes.ts          # EMQX auth/ACL callbacks (3 endpoints)
│   ├── mqtt-client.ts               # MQTT client connection management
│   ├── mqtt-handler.ts              # MQTT message handling + UNS topic parsing
│   └── ws-handler.ts                # WebSocket real-time subscriptions
└── workers/
    ├── ingestion.worker.ts          # BullMQ ingestion queue processor
    └── maintenance.worker.ts        # Periodic cleanup + connectivity checks
```

### Service-Repository-Route Pattern

Each module follows a consistent 3-tier architecture:

```
Route (preHandler: auth + RBAC) → Service (business logic) → Repository (Prisma queries)
```

**Route Pattern:**
```typescript
app.post('/instances', {
  preHandler: [app.requirePermission('ASSET_CREATE')],
  schema: { body: {...}, response: { 201: {...}, ...errorResponses } }
}, async (req, reply) => {
  const { ok } = await enforceReauth('CREATE_ASSET', req, reply);
  if (!ok) return;
  const parsed = createAssetSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'VALIDATION_ERROR', ... });
  const result = await instanceService.create(parsed.data, buildContext(req));
  return reply.code(201).send(result);
});
```

### Middleware / Plugin Chain

**Initialization Order (app.ts):**
1. Swagger UI registration (OpenAPI 3.0.3)
2. CORS, Helmet (HSTS 1 year), Rate Limiting (500 req/min global), Multipart (5MB), WebSocket
3. Static file serving for `/uploads/*`
4. Plugins: `audit-logger` → `auth` → `rbac` (dependency order)
5. Global error handler (AppError → HTTP response mapping)
6. Module route registration (18 modules with `/api/*` prefixes)
7. Rule chain node registry initialization
8. MQTT client, telemetry batcher, ingestion worker, maintenance worker startup
9. Graceful shutdown handlers (SIGTERM, SIGINT)

### Validation Layer

**Two-layer validation:**
1. **Fastify JSON Schema** (route `schema.body`/`querystring`/`params`) — validates before handler
2. **Zod Schema Parsing** (in handler) — type-safe parsing with error flattening

Shared schemas in `@digilog/shared` ensure identical validation on frontend and backend.

---

## API Architecture

### Major API Groups (145+ Endpoints)

| Group | Prefix | Endpoints | Auth | Purpose |
|-------|--------|-----------|------|---------|
| Auth | `/api/auth` | 8 | Mixed | Login, logout, password, verify |
| Users | `/api/users` | 14 | Permission | User CRUD, enable/disable, reset |
| Roles | `/api/roles` | 8 | Permission | Role CRUD, permissions |
| Config | `/api/config` | 36+ | Role/Permission | System configuration |
| Entities | `/api/assets` | 21 | Permission | Templates, instances, relationships, identifiers |
| Audit | `/api/audit` | 4 | Permission | Audit trail query, delete |
| Notifications | `/api/notifications` | 9 | Auth | Read/manage notifications |
| Data Ingestion | `/api/data` | 8 | Device Token | HTTP telemetry, attributes, batch |
| Rule Chains | `/api/rule-chains` | 14 | Permission | Chain CRUD, nodes, connections, debug |
| Telemetry Queries | `/api/queries/telemetry` | 7 | Permission | Latest, history, aggregated, compare |
| Alarms | `/api/queries/alarms` | 5 | Permission | List, stats, acknowledge, clear |
| Export | `/api/queries/export` | 5 | Permission | Telemetry, alarms, audit export |
| Retention | `/api/queries/retention` | 4 | Permission | Data retention policies |
| Connectivity | `/api/connectivity` | 6 | Auth | Device status, history |
| QR Codes | `/api/qr` | 4 | Permission | Generate, scan, delete |
| Help | `/api/help` | 6 | Mixed | Help article CRUD |
| UNS | `/api/uns` | 6 | Permission | Namespace mappings |
| Debug Traces | `/api/debug/traces` | 4 | Permission | Pipeline debug traces |
| MQTT Internal | `/api/internal/mqtt` | 3 | None (internal) | EMQX auth/ACL callbacks |
| Health | `/api/health` | 1 | None | Health check |
| Uploads | `/api/uploads` | 2 | Mixed | File upload/serve |
| Backup | `/api/backup` | 3 | Permission | Export/restore |

### Authentication Mechanisms

1. **JWT Bearer Token** — Primary mechanism for all user-facing endpoints. Token in `Authorization: Bearer <token>` header. Payload: `{ sub, username, role, sessionId }`.
2. **Device Access Token** — For data ingestion endpoints. Token in `Authorization: Bearer <token>` maps to `DeviceCredential.accessToken`.
3. **No Auth** — Health check, login, forgot-password, beacon-logout, branding config, MQTT internal callbacks, static file serving.

### Request Validation

- **Layer 1:** Fastify JSON Schema — auto-validates `body`, `querystring`, `params` before handler
- **Layer 2:** Zod schema `.safeParse()` — type-safe parsing in handler with error flattening
- **Shared schemas** from `@digilog/shared` ensure frontend/backend consistency

### Error Handling

**Error Classes (`lib/errors.ts`):**
```
AppError (base) → statusCode, code, message, details
  ├── ValidationError (400)
  ├── NotFoundError (404)
  ├── ConflictError (409)
  └── ForbiddenError (403)
```

**Global Error Handler (app.ts):**
- `AppError` → `{ error: code, message, details? }` with appropriate HTTP status
- Rate limit errors → 429
- Body too large → 413
- Fastify validation errors → 400
- Unhandled errors → 500 (generic message in production)

**Every route schema includes `...errorResponses`** (400, 401, 403, 404, 409, 500) — required by Fastify 5 TypeScript.

### Response Format Standards

**Paginated Lists:**
```json
{ "data": [...], "total": 100, "page": 1, "limit": 20, "totalPages": 5 }
```

**Single Resource:**
```json
{ "id": "uuid", "name": "...", ... }
```

**Error:**
```json
{ "error": "ERROR_CODE", "message": "Human-readable message", "details": {} }
```

**Tree Endpoints:** Return plain arrays (not paginated).

---

## Database Architecture

### Technology

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Primary DB | PostgreSQL 16 | Transactional/relational data (entities, config, audit, auth) |
| Time-Series DB | TimescaleDB (PostgreSQL 16 extension) | Append-only telemetry, events, checklists |
| ORM | Prisma 6 | Type-safe queries for primary DB |
| TSDB Driver | pg.Pool (raw SQL) | Direct connection for time-series writes |
| Extensions | pgcrypto, ltree | UUID generation, hierarchical paths |

### Primary Database Models (30 Prisma Models)

#### Domain 1: Authentication & Sessions (5 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **User** | id (UUID), username, email, passwordHash, role, status (ENABLED/DISABLED/LOCKED/EXPIRED), failedLoginAttempts, lockoutUntil, forcePasswordChange, passwordExpiresAt | User accounts with 21 CFR Part 11 password policies |
| **Role** | name (unique), hierarchyLevel (1-10), permissions (JSONB array), isSystem, isActive | Dynamic role definitions with granular permissions |
| **PasswordHistory** | userId (FK), passwordHash, createdAt | Last N passwords for reuse prevention |
| **Session** | userId (FK), tokenHash (SHA-256), isActive, expiresAt, terminationReason | Active sessions with sliding window + 24h absolute timeout |
| **PasswordResetRequest** | userId, status (PENDING/...), processedBy, notes | Password reset workflow |

#### Domain 2: Configuration (4 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **SystemConfig** | configKey (unique), configValue (JSONB), requiresReauth | Central config store (password-policy, session, branding, alarm-columns, etc.) |
| **FieldIdConfig** | fieldId (unique), defaultName, displayName, module | Dynamic UI field labels |
| **UserConfig** | userId (unique), sidebarItems (JSONB), homeWidgets (JSONB) | Per-user preferences |
| **RoleConfig** | role (unique), sidebarItems (JSONB), homeWidgets (JSONB) | Per-role default config |

#### Domain 3: Audit & Notifications (2 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **AuditTrail** | id (autoincrement), timestamp, userId, action, targetType, targetId, beforeValue/afterValue (JSONB), checksum (SHA-256, 64 chars), signatureMeaning | Immutable audit log with integrity verification. DB trigger prevents deletion. |
| **Notification** | type (enum), forUserId, forRole, isRead, metadata (JSONB) | Role-filtered user notifications |

#### Domain 4: Entity Management (5 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **AssetTemplate** | name (unique), attributeSchema (JSONB), telemetrySchema (JSONB), alarmRules (JSONB), statusLifecycle (JSONB), maxParentConnections, maxConnections, defaultRuleChainId (FK) | Entity blueprints with schemas and alarm rules |
| **AssetTemplateVersion** | templateId (FK), versionNumber, snapshot (JSONB) | Append-only template version snapshots |
| **AssetInstance** | templateId (FK), parentId (FK self-ref), attributes (JSONB), status, isActive | Entity instances in parent-child hierarchy |
| **AssetRelationship** | sourceAssetId (FK), targetAssetId (FK), relationshipType (12 types), UNIQUE constraint | Bidirectional entity connections with auto-inverse |
| **AssetIdentifier** | assetId (FK), identifierType (QR/BARCODE/RFID/NFC/MANUAL), identifierValue (globally unique) | Physical identifiers for entities |

#### Domain 5: Data Ingestion & Rule Chains (9 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **DeviceCredential** | entityId (unique FK), accessToken (unique), allowedIps, maxDataRatePerMin, status | Per-entity credentials for MQTT/HTTP ingestion |
| **RuleChain** | name, isRoot, firstRuleNodeId, currentVersion, isActive | DAG-based rule engine definitions |
| **RuleChainVersion** | ruleChainId (FK), version, snapshot (JSONB), status (ACTIVE/SUPERSEDED) | Immutable chain version snapshots |
| **RuleNode** | ruleChainId (FK), type (28 types), name, configuration (JSONB), debugEnabled, positionX/Y | Individual nodes in rule chain graph |
| **RuleNodeConnection** | ruleChainId (FK), fromNodeId (FK), toNodeId (FK), label | Directed edges between nodes |
| **Alarm** | entityId, alarmType, severity, status (ACTIVE/ACKNOWLEDGED/CLEARED/MANUALLY_CLEARED), triggerDetails/clearDetails (JSONB), ack/clear signature FKs | Alarm lifecycle management |
| **ChecklistReview** | checklistId, entityId, currentStep, performer/checker/verifier with signature FKs | 3-step checklist approval workflow |
| **ElectronicSignature** | recordType, signerUserId, signedAt, meaning, recordHash, signatureHash (SHA-256), reAuthVerified | 21 CFR Part 11 electronic signatures |
| **DataStream** | entityId + key (unique), dataType, unit, unsPath, source | Telemetry key registry per entity |

#### Domain 6: Telemetry & System (4 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **LatestTelemetry** | entityId + key (unique), valueNum/valueStr/valueBool/valueJson, lastUpdated | Cache of latest values; atomic upsert |
| **UnsMapping** | entityId (unique), unsPath (unique), pathSegments (JSONB) | ISA-95 UNS path mappings |
| **ConnectivityStatus** | entityId (unique), status (ONLINE/OFFLINE), lastActivityAt, protocol | Real-time device connectivity |
| **QrCode** | entityId (unique), qrData, svgData, imagePath | Generated QR codes per entity |

#### Domain 7: Help & DLQ (4 models)

| Model | Key Fields | Purpose |
|-------|-----------|---------|
| **HelpArticle** | key (unique), content, currentVersion, isActive | Versioned help documentation |
| **HelpArticleVersion** | helpArticleId (FK), version, content, changeNotes | Help article version snapshots |
| **DeadLetterQueue** | messageId, entityId, errorMessage, failedStage, retryCount, status | Failed ingestion messages for retry |
| **IngestionSystemConfig** | key (unique), value, dataType, category | Hot-reload pipeline config settings |

### TimescaleDB Hypertables (6 Tables)

| Hypertable | Batched | Compression | Purpose |
|------------|---------|-------------|---------|
| **ts_telemetry** | Yes (100 rows/1s) | After 7 days | Sensor readings (entity_id, key, value_*, uns_path, source, trace_id) |
| **ts_attributes** | No (immediate) | After 30 days | Entity attribute change history |
| **ts_checklist_responses** | No (immediate) | After 30 days | Immutable checklist submissions (SHA-256 binding) |
| **ts_device_events** | Yes (batched) | After 7 days | Connection events (CONNECTED, DISCONNECTED, ACTIVITY, ERROR) |
| **ts_binary_data** | No (immediate) | After 30 days | File metadata and checksums |
| **ts_pipeline_traces** | No (immediate) | N/A (48h retention) | Debug traces (auto-purged, NOT compliance data) |

**Continuous Aggregates:**
- `telemetry_hourly` — 1h buckets (auto-refresh every 30 min)
- `telemetry_daily` — 1d buckets (auto-refresh every 1h)

**Security:** `REVOKE UPDATE, DELETE` on compliance tables (except debug traces).

### Indexing Strategy

**High-traffic queries:**
- `AuditTrail(timestamp DESC)` — Latest audit entries
- `AuditTrail(targetType, targetId)` — Entity audit history
- `AssetInstance(parentId)` — Tree hierarchy traversal
- `AssetInstance(templateId, status)` — Template-filtered queries
- `Alarm(entityId, status)` — Active alarms per entity
- `LatestTelemetry(entityId, key)` — UNIQUE constraint enables atomic upsert
- `Session(userId, isActive)` — Active session lookup
- `DeviceCredential(accessToken)` — UNIQUE, device auth

**Total:** 40+ indexes across all models.

---

## Rule Chain Engine Architecture

### Overview

The rule chain engine is a **graph-based message processing system** (1,959 lines) that executes data transformation and automation pipelines. It processes telemetry data through configurable node graphs to generate alarms, notifications, and data transformations.

### Node Structure

**28 Node Types in 7 Categories:**

| Category | Count | Node Types | Outputs |
|----------|-------|-----------|---------|
| **INPUT** | 1 | input | Success |
| **FILTER** | 5 | msg-type-filter, script-filter, check-relation, originator-type-filter, check-alarm-status | True/False/Failure |
| **ENRICHMENT** | 4 | entity-attributes, entity-details, related-attributes, tenant-attributes | Success/Failure |
| **TRANSFORM** | 5 | script-transform, rename-keys, change-originator, to-email, unit-conversion | Success/Failure |
| **ACTION** | 8 | save-timeseries, save-attributes, create-alarm, clear-alarm, send-notification, assign-to-user, log, rpc-call-reply | Success/Failure |
| **EXTERNAL** | 4 | rest-api-call, mqtt-publish, push-to-uns, send-email | Success/Failure |
| **FLOW** | 4 | rule-chain-input (sub-chain), checkpoint, delay, acknowledge | Success/Failure or terminal |

### Execution Flow

```
1. LOAD CHAIN
   ├── Check 30s cache → hit: use cached
   └── Cache miss: fetch from DB (nodes + connections), cache result

2. TRAVERSE GRAPH (Breadth-First Queue)
   ├── Start at firstRuleNodeId with initial message
   ├── For each node in queue:
   │   ├── Look up node implementation from registry
   │   ├── Execute node with (message, config, context)
   │   ├── Record debug trace if debugEnabled
   │   ├── Check for sub-chain delegation (_delegateChain marker)
   │   ├── Route to next nodes by matching output label to connection labels
   │   └── On error: route to Failure connections or stop branch
   └── Accumulate: alarms[], notifications[], metadata{}, errors[]

3. RETURN RuleEngineResult
   { success, message, metadata, alarms, notifications, errors, nodesExecuted, durationMs }
```

### Message Routing

Nodes return an output label (e.g., "True", "Success", "Failure"). The engine follows all connections from the current node where `connection.label === result.output`. Multiple matching connections are all enqueued (fan-out).

**Special Message Fields (underscored):**
- `_messageType` — Set by ingestion pipeline
- `_delegateChain` + `_chainDepth` — Sub-chain delegation markers
- `_saveAs` — Persistence directive ('telemetry', 'attributes')
- `_mqttPublish` / `_unsPublish` — Publish directives
- `_rpcReply` — RPC response marker

### Sandboxed Script Execution

User-provided JavaScript runs in isolated Node.js VM contexts:
```typescript
function safeExecuteScript(code, sandbox, timeout = 1000) {
  const ctx = vm.createContext(sandbox);  // No process/require/global
  const script = new vm.Script(`(function(){ ${code} })()`);
  return script.runInContext(ctx, { timeout });
}
```

**Available variables:** `msg`, `metadata`, `msgType` (for filters/transforms), `x` (for unit conversion formulas).

### Sub-Chain Delegation

Rule chains can call other chains via the `rule-chain-input` node:
1. Node sets `_delegateChain: targetChainId` + `_chainDepth: depth + 1`
2. Engine detects marker, cleans it from message, calls `executeRuleChain()` recursively
3. Sub-chain results (alarms, notifications, metadata) merge back into parent chain
4. Max depth: 10 (configurable via `rule_engine.max_chain_depth`) — prevents infinite loops

### Default Chain Builder

When an entity template defines alarm rules, a default rule chain is auto-generated:
```
Input → [Filter per rule] → Create Alarm (True path) → Save Timeseries
                          → Clear Alarm (False path) → Save Timeseries
```

Created/updated atomically in a Prisma transaction with full version snapshots.

### Debug System

- Per-node `debugEnabled` flag triggers trace recording
- In-memory ring buffers (100 records/chain, 1000 chains max with LRU eviction)
- Real-time streaming via Redis pub/sub (`debug:rulechain:<chainId>`)
- API endpoints for retrieval and buffer clearing

---

## Entity Management

### Entity Templates

Templates define reusable blueprints for entity types:

- **Attribute Schemas** — 9 data types: TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE. Each with validation rules (required, min/max, pattern).
- **Telemetry Schemas** — 5 data types: INTEGER, FLOAT, BOOLEAN, STRING, ENUM. Defines expected telemetry keys and units.
- **Expected Identifiers** — QR, BARCODE, RFID, NFC, MANUAL types.
- **Expected Relationships** — Configurable relationship types with connection limits.
- **Status Lifecycle** — Custom statuses with transitions and colors (e.g., Active → UnderMaintenance → Decommissioned).
- **Alarm Rules** — 7 rule types: HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM. 3 severities: WARNING, ALARM, CRITICAL.
- **Checklist Schema** — 14 question types for operational checklists.
- **Connection Limits** — `maxParentConnections` (CONTAINS parent limit), `maxConnections` (total limit).
- **Data Ingestion Config** — Transport type (MQTT/HTTP/WebSocket), credential type (TOKEN/BASIC/X509), inactivity timeout.
- **Default Rule Chain** — Auto-linked rule chain for alarm processing.

Template versioning auto-creates a full JSON snapshot (`AssetTemplateVersion`) on each update.

### Entity Instances

Instances are created from templates and organized in a parent-child tree hierarchy via `parentId` self-reference:

- **Attributes** validated against template schema on creation/update
- **Status** transitions constrained by template's status lifecycle
- **Soft delete** cascades to all descendants (atomic transaction cleaning 6 dependent tables)
- **Tree endpoints** return flat arrays for frontend tree rendering

### Entity Relationships

Bidirectional relationships with 12 types:

| Type | Inverse | Direction |
|------|---------|-----------|
| CONTAINS | CONTAINED_IN | Parent → Child |
| FEEDS | FED_BY | Source → Target |
| DEPENDS_ON | DEPENDED_ON_BY | Dependent → Dependency |
| BACKS_UP | BACKED_UP_BY | Backup → Primary |
| MONITORS | MONITORED_BY | Monitor → Monitored |
| CONNECTED_TO | CONNECTED_TO | Symmetric |
| CUSTOM | CUSTOM | User-defined |

**Enforcement:** Auto-inverse creation, `maxConnections` enforcement, CONTAINS cycle detection via iterative ancestor walk. Relationships are hard-deleted (both sides).

### Entity Identifiers

Physical identifiers (QR, BARCODE, RFID, NFC, MANUAL) with globally unique `identifierValue` enforcement. Support `isPrimary` flag. Used for device credential resolution during data ingestion.

### Telemetry Data Connection

Entities connect to telemetry through:
1. **DeviceCredential** — Per-entity access token for MQTT/HTTP ingestion
2. **DataStream** — Auto-registered telemetry key registry per entity
3. **LatestTelemetry** — Latest values cache with atomic upsert
4. **ts_telemetry** — Full time-series history in TimescaleDB
5. **ConnectivityStatus** — Real-time online/offline tracking
6. **UnsMapping** — ISA-95 path for MQTT topic resolution

---

## Security Architecture

### Authentication Flow

```
1. POST /api/auth/login (rate limited: 10/min)
   ├── User enumeration prevention (bcrypt dummy hash on non-existent user)
   ├── Account status check (ENABLED/DISABLED/LOCKED/EXPIRED)
   ├── Password verification (bcrypt 12 rounds)
   ├── Password expiry check (auto-set forcePasswordChange)
   ├── Session conflict detection (SESSION_CONFLICT unless force=true)
   ├── Create Session record in DB
   ├── Sign JWT (HS256, 8h default expiration)
   ├── Audit: LOGIN_SUCCESS logged
   └── Return: { token, user }

2. Each Authenticated Request (auth.ts onRequest hook)
   ├── Verify JWT signature + expiration
   ├── Validate session in DB (isActive, expiresAt)
   ├── Check absolute timeout (24h hard cap)
   ├── Check user.status === ENABLED
   ├── Enforce forcePasswordChange redirect
   └── Extend session (sliding window: expiresAt = now + duration)

3. Logout
   ├── POST /api/auth/logout → terminate session
   ├── POST /api/auth/beacon-logout → same (for tab close)
   └── Password change → terminateOtherSessions()
```

### JWT Structure

```typescript
{
  sub: string;        // User UUID
  username: string;   // Username
  role: string;       // Role name
  sessionId: string;  // Session UUID (must exist in DB)
  iat: number;        // Issued at
  exp: number;        // Expiration (8h default)
}
```

### Role-Based Access Control

**Two authorization mechanisms:**

1. **`requirePermission(permission)`** — Checks role's `permissions` JSONB array in DB. Supports permission hierarchy: `*_MANAGE` grants `*_CREATE`, `*_UPDATE`, `*_DELETE`, `*_VIEW`. SUPER_ADMIN bypasses all checks. Used by entity, rule chain, alarm, and data routes.

2. **`requireRole(...roles)`** — Simple role name string comparison. No DB lookup. Used for legacy admin routes.

**40+ Permissions in 10 Categories:**
- User Management (7): USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, etc.
- Configuration (4): CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE
- Audit & Approvals (4): AUDIT_READ, AUDIT_EXPORT, APPROVAL_REVIEW, APPROVAL_REQUEST
- Asset Management (7): ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, etc.
- Data Ingestion (4): DATA_INGEST, DATA_VIEW, DATA_MANAGE, DATA_EXPORT
- Rule Chains (2): RULE_CHAIN_VIEW, RULE_CHAIN_MANAGE
- Alarms (2): ALARM_VIEW, ALARM_MANAGE
- UNS (2): UNS_VIEW, UNS_MANAGE
- Checklists (3): CHECKLIST_SUBMIT, CHECKLIST_REVIEW, CHECKLIST_APPROVE
- Advanced (6): NOTIFICATION_MANAGE, QR_CODE_GENERATE, HELP_MANAGE, etc.

### Re-Authentication (Electronic Signatures)

For 21 CFR Part 11 compliance (SS11.10(g) — electronic signatures):

```typescript
enforceReauth(action, req, reply):
  1. Check config: is reauth required for this action + user role?
  2. Extract password from body._currentPassword or x-reauth-password header
  3. Verify password against user.passwordHash (bcrypt)
  4. Success → { ok: true }; Failure → 401 REAUTH_FAILED
```

Configured per-action per-role in `SystemConfig.configKey='action-reauth'`. 42+ actions across 13 categories.

### Audit Trail Integrity

**Checksum Computation:**
```
SHA-256(sorted JSON of { timestamp, userId, action, targetType, targetId, afterValue })
```

**Features:**
- Database trigger prevents DELETE on audit_trail table (immutability)
- Admin deletion temporarily disables trigger in atomic transaction
- Read-time verification returns `integrityValid: boolean` per record
- SUPER_ADMIN actions are NOT logged (21 CFR Part 11 SS11.10(f) exemption)
- Audit record deletions ARE always logged (even SUPER_ADMIN)

### Password Security

- bcrypt 12-round hashing
- Configurable complexity rules (min/max length, uppercase, lowercase, numbers, special chars)
- Reuse prevention (last N passwords, default 12)
- Cannot match username or temporary password
- Password expiry (default 90 days)
- Account lockout after N failed attempts (default 5, configurable TEMPORARY/PERMANENT)

---

## Data Flow

### User Action → Response (Complete Flow)

```
┌─────────────┐
│   BROWSER   │  User clicks "Create Entity"
└──────┬──────┘
       │ POST /api/assets/instances
       │ Authorization: Bearer <jwt>
       │ Body: { name, templateId, ... , _currentPassword }
       ▼
┌─────────────────────────────────────────────────────┐
│  NGINX (port 80)                                     │
│  Reverse proxy → localhost:3000                      │
└──────┬──────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────┐
│  FASTIFY (port 3000)                                 │
│                                                      │
│  1. onRequest hook (auth.ts)                        │
│     ├── Verify JWT signature (jose HS256)            │
│     ├── Validate session in DB (isActive, expiresAt) │
│     ├── Extend session (sliding window)              │
│     └── Set req.user = { sub, username, role, ... }  │
│                                                      │
│  2. preHandler (rbac.ts)                            │
│     └── requirePermission('ASSET_CREATE')            │
│         ├── Fetch role from DB                       │
│         └── Check permissions JSONB array            │
│                                                      │
│  3. Route Handler                                    │
│     ├── enforceReauth('CREATE_ASSET', req, reply)    │
│     │   ├── Check reauth config (10s cache)          │
│     │   └── Verify _currentPassword via bcrypt       │
│     │                                                │
│     ├── Zod schema validation (safeParse)            │
│     │                                                │
│     ├── instanceService.create(data, context)        │
│     │   ├── Validate template exists + active        │
│     │   ├── Validate attributes against schema       │
│     │   ├── Check maxParentConnections               │
│     │   ├── prisma.assetInstance.create(...)          │
│     │   ├── Create CONTAINS relationship if parent   │
│     │   └── Audit log: CREATE_ASSET                  │
│     │                                                │
│     └── reply.code(201).send(result)                 │
└──────┬──────────────────────────────────────────────┘
       │ JSON Response
       ▼
┌─────────────┐
│   BROWSER   │  SWR cache invalidated → re-fetch entity list
└─────────────┘
```

---

## Telemetry Flow

### Device → Storage → Alarms (Complete Pipeline)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MQTT Device │     │  HTTP Device  │     │  WebSocket   │
│  (Sensor)    │     │  (Gateway)    │     │  Client      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ MQTT Publish       │ POST /api/data     │ WS Message
       │ topic: digilog/v1/ │ /telemetry         │
       │   enterprise/site/ │ Bearer: <token>    │
       │   area/entity/     │ Body: { temp: 105 }│
       │   telemetry        │                    │
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  EMQX Broker │     │  Fastify     │     │  WS Handler  │
│              │     │  Route       │     │              │
│  Auth via:   │     │              │     │              │
│  POST /mqtt/ │     │  Resolve     │     │  Resolve     │
│    auth      │     │  device by   │     │  device by   │
│  POST /mqtt/ │     │  access      │     │  access      │
│    acl       │     │  token       │     │  token       │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ Parse UNS topic    │                    │
       │ Resolve entity     │                    │
       ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│  MESSAGE NORMALIZER                                      │
│  (message-normalizer.ts)                                 │
│                                                          │
│  Normalize 3 payload formats:                            │
│  1. Simple:     { key: value }                          │
│  2. Timestamped: { ts: 1234, values: { key: value } }  │
│  3. Batch:      [ { ts, values }, ... ]                 │
│                                                          │
│  Output: IngestionMessage {                              │
│    messageId, timestamp, protocol, entityId, entityName, │
│    templateId, unsPath, credentialId, sourceIp,          │
│    messageType, data, metadata, ruleChainId, traceId    │
│  }                                                       │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  BULLMQ INGESTION QUEUE                                  │
│  Priority: CHECKLIST(1) > ALARM(2) > ATTRIBUTE(3)       │
│          > TELEMETRY(5) > EVENT(7) > BINARY(8)          │
│  3 retries, exponential backoff (500ms initial)          │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  INGESTION WORKER (concurrency: 5)                       │
│                                                          │
│  Stage 3: DEVICE VALIDATION                              │
│  ├── IP allowlist check (if enabled)                     │
│  └── Rate limiting (per-credential, 600/min default)     │
│                                                          │
│  Stage 6: MESSAGE VALIDATION                             │
│  ├── Schema validation against template telemetrySchema  │
│  ├── Type checking (INTEGER/FLOAT/BOOLEAN/STRING)        │
│  ├── Range validation (min/max bounds)                   │
│  └── Timestamp drift correction (24h max)                │
│                                                          │
│  Stages 7-8: RULE CHAIN EXECUTION                        │
│  ├── Load chain from cache (30s TTL) or DB               │
│  ├── BFS traverse from firstNodeId                       │
│  ├── Execute each node (sandboxed VM, 1s timeout)        │
│  ├── Route by output labels (True/False/Success/Failure) │
│  ├── Collect AlarmActions (create/clear)                  │
│  └── Collect NotificationActions                         │
│                                                          │
│  Stage 9: DATA PERSISTENCE                               │
│  ├── Telemetry → batch to ts_telemetry (TSDB)           │
│  ├── Telemetry → atomic upsert LatestTelemetry (PG)     │
│  ├── Telemetry → auto-register DataStream if new key     │
│  ├── Alarms → INSERT Alarm (deduplicate on ACTIVE)       │
│  └── Alarm clear → UPDATE status=CLEARED                 │
│                                                          │
│  Stage 10: AUDIT TRAIL                                   │
│  └── Compliance-critical only: attributes, checklists    │
│                                                          │
│  Stage 11: EVENT EMISSION                                │
│  ├── Redis pub/sub: ws:events (for WebSocket broadcast)  │
│  ├── Alarm notifications → notification queue            │
│  └── Connectivity: markOnline(entityId, protocol, IP)    │
└─────────────────────────────────────────────────────────┘
                           │
                    On Failure:
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  DEAD LETTER QUEUE (DLQ)                                 │
│  ├── Stores failed messages for retry                    │
│  ├── Exponential backoff retries (max 5)                 │
│  └── Maintenance worker checks every 60s                 │
└─────────────────────────────────────────────────────────┘
```

---

## Deployment Architecture

### Server Structure

```
┌─────────────────────────────────────────────────────────┐
│  AWS EC2 Instance (i-0df88b77a8ac636df)                  │
│  Type: t3.large (2 vCPU, 8GB RAM, 29GB disk)           │
│  OS: Ubuntu 24.04.3 LTS                                 │
│  IP: 3.108.185.106                                       │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  nginx (port 80)                                   │  │
│  │  ├── / → /home/ubuntu/21cfrlogbook/apps/web/dist  │  │
│  │  ├── /api → proxy to localhost:3000                │  │
│  │  ├── /docs → proxy to localhost:3000               │  │
│  │  ├── /emqx/ → proxy to localhost:18083             │  │
│  │  └── /uploads → proxy to localhost:3000            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  PM2 — digilog-api (cluster mode)                  │  │
│  │  ├── Entry: apps/api/dist/app.js                   │  │
│  │  ├── Port: 3000                                    │  │
│  │  ├── Instances: max (all CPU cores)                │  │
│  │  └── Auto-restart on crash                         │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  PostgreSQL 16 (localhost:5432)                     │  │
│  │  ├── digilog_db — 30 Prisma models                 │  │
│  │  └── digilog_tsdb — 6 TimescaleDB hypertables      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Redis 7 (localhost:6379)                           │  │
│  │  ├── BullMQ queues (ingestion, notification, etc.) │  │
│  │  ├── Pub/Sub (WebSocket events, debug traces)      │  │
│  │  └── AOF persistence, 256MB max, LRU eviction      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │  EMQX 5 MQTT Broker                                │  │
│  │  ├── 1883 — MQTT                                   │  │
│  │  ├── 8883 — MQTT/TLS                               │  │
│  │  ├── 8083 — WebSocket                              │  │
│  │  ├── 8084 — WebSocket/TLS                          │  │
│  │  ├── 18083 — Dashboard (proxied via nginx /emqx/)  │  │
│  │  └── Auth: delegated to API (/api/internal/mqtt/*) │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Runtime Environment

- **Node.js:** v20.20.0 (ES modules)
- **npm:** 10.8.2
- **TypeScript:** Compiled to ES2022 JavaScript
- **PM2:** Process manager with cluster mode, auto-restart, log management
- **nginx:** Reverse proxy + static file serving

### Development Environment (Docker Compose)

```yaml
services:
  db:        PostgreSQL 16 (port 5432, extensions: pgcrypto, ltree)
  tsdb:      TimescaleDB (port 5433, 6 hypertables, aggregates, compression)
  redis:     Redis 7 (port 6379, AOF persistence)
  emqx:      EMQX 5 (ports 1883/8883/8083/8084/18083)
```

Applications run locally via `npm run dev` (tsx watch mode for API, Vite dev server for web).

### Build Pipeline (Turborepo)

```
npm run build
  └── turbo run build (^build dependency ordering)
      1. packages/shared    (tsc → dist/)
      2. packages/db        (tsc → dist/)
      3. packages/queue     (tsc → dist/)
      4. apps/api           (tsc → dist/)
      5. apps/web           (vite build → dist/)
```

### CI/CD (GitHub Actions)

- **Triggers:** Push to `main`/`DataIngestion`, PRs against `main`
- **Services:** PostgreSQL 15, Redis 7
- **Steps:** `npm ci` → Prisma generate → Prisma migrate → Build shared/db → Run all tests
- **Test Suite:** 1,344 tests, 0 failures

### Scaling Considerations

- **Current:** Single EC2 instance, PM2 cluster mode
- **Horizontal:** PM2 handles multi-core; would need load balancer for multi-instance
- **Database:** Single PostgreSQL instance with connection pooling (Prisma auto + pg.Pool max 20)
- **MQTT:** Single EMQX instance; supports clustering for scale-out
- **Redis:** Single instance; BullMQ supports Redis Cluster

---

## Codebase Structure

```
21cfrlogbook/
├── apps/
│   ├── api/                          # Fastify backend (TypeScript)
│   │   ├── prisma/
│   │   │   ├── schema.prisma         # 30 models, 718 lines
│   │   │   ├── migrations/           # SQL migration files
│   │   │   └── seed.ts               # Default admin, roles, config, help articles
│   │   └── src/
│   │       ├── app.ts                # Entry point (262 lines)
│   │       ├── plugins/              # auth, rbac, audit-logger (3 plugins)
│   │       ├── lib/                  # jwt, password, hash-chain, errors, reauth, swagger
│   │       ├── modules/              # 18 feature modules (service → repository → routes)
│   │       ├── transport/            # MQTT auth, client, handler; WebSocket handler
│   │       └── workers/              # Ingestion + maintenance workers
│   │
│   └── web/                          # React frontend (TypeScript)
│       └── src/
│           ├── main.tsx              # Entry point, router, providers
│           ├── components/           # layout (3), ui (12), shared (4)
│           ├── hooks/                # 11 custom hooks
│           ├── lib/                  # api-client, swr-config, cn, password-utils
│           └── routes/               # 50+ page components across 15 directories
│
├── packages/
│   ├── shared/                       # @digilog/shared — Zod schemas + TypeScript types
│   │   └── src/
│   │       ├── index.ts              # Re-exports all schemas, types, constants
│   │       ├── schemas/              # auth, users, config, assets, audit
│   │       └── types/                # roles, permissions, audit-actions, reauth-actions,
│   │                                 #   alarm-columns, permission-categories, etc.
│   ├── db/                           # @digilog/db — Database connections
│   │   └── src/
│   │       ├── prisma.ts             # Prisma singleton (global pattern)
│   │       ├── tsdb.ts               # TimescaleDB pg.Pool
│   │       └── telemetry-batcher.ts  # Batch writes (100 rows/1s flush/10K backpressure)
│   └── queue/                        # @digilog/queue — Job queue definitions
│       └── src/
│           ├── queues.ts             # 5 queues: ingestion, notification, export, reports, maintenance
│           ├── connection.ts         # Redis connection singleton
│           └── schemas.ts            # Job payload Zod schemas
│
├── docker-compose.yml                # Dev: PostgreSQL, TimescaleDB, Redis, EMQX
├── init-tsdb.sql                     # TimescaleDB hypertables, aggregates, compression
├── turbo.json                        # Turborepo build pipeline
├── package.json                      # Workspace root (npm workspaces)
├── .env                              # Environment variables (gitignored)
├── .github/workflows/ci.yml          # CI pipeline
└── ARCHITECTURE.md                   # This document
```

---

## Strengths of the Current Architecture

### 1. Regulatory Compliance by Design
- SHA-256 checksummed audit trail with read-time integrity verification
- Electronic signatures with re-authentication enforcement (21 CFR Part 11 SS11.10(g))
- Immutable audit trail (database trigger prevents deletion)
- Password policy enforcement with history, expiry, and lockout
- Single active session per user with absolute 24h timeout

### 2. Type Safety Across Stack
- Zod schemas shared between frontend and backend via `@digilog/shared`
- TypeScript strict mode throughout all packages
- Prisma generates type-safe DB queries
- Two-layer validation (Fastify JSON Schema + Zod) catches errors early

### 3. Well-Organized Modular Monolith
- 18 feature modules with consistent service → repository → routes pattern
- Clear separation of concerns without microservice overhead
- Turborepo manages build dependencies across 5 packages

### 4. Robust Data Ingestion Pipeline
- Multi-protocol support (MQTT, HTTP, WebSocket)
- ISA-95 compliant UNS topic structure
- Fail-safe rule chain execution (errors are warnings, data still persists)
- Atomic telemetry upsert prevents race conditions
- Batched TimescaleDB writes with backpressure handling
- Dead letter queue for failed message retry

### 5. Flexible Rule Chain Engine
- 28 node types covering filters, transforms, actions, and external integrations
- Sandboxed user script execution (VM context, 1s timeout)
- Sub-chain delegation with depth tracking
- Auto-generated default chains from template alarm rules
- Real-time debug tracing via Redis pub/sub

### 6. Granular Access Control
- 40+ permissions with permission hierarchy (`*_MANAGE` grants `*_CREATE/UPDATE/DELETE/VIEW`)
- Dynamic roles stored in DB (not hardcoded)
- Per-action per-role re-authentication configuration
- Role hierarchy enforcement (cannot create roles above your own level)

### 7. Dual Database Architecture
- PostgreSQL for transactional integrity (entities, config, auth)
- TimescaleDB for high-throughput time-series (telemetry, events)
- Continuous aggregates for efficient trending queries
- Compression policies reduce storage costs

### 8. Frontend Architecture
- Lazy-loaded heavy pages minimize initial bundle
- SWR provides efficient data caching without Redux complexity
- Custom hooks encapsulate complex logic (session, single-tab, reauth)
- Manual chunk splitting for optimal code splitting

---

## Architecture Risks or Limitations

### 1. Single Point of Failure
- **Risk:** All services run on one EC2 instance. Database, Redis, EMQX, and API share the same host.
- **Impact:** Any service failure or instance crash takes down the entire system.
- **Mitigation needed:** Separate database instances, Redis cluster, load balancer.

### 2. No Horizontal Scaling Strategy
- **Risk:** PM2 cluster mode only scales vertically within one machine. No load balancer or multi-instance deployment.
- **Impact:** Cannot handle traffic beyond a single t3.large (2 vCPU, 8GB RAM).
- **Mitigation needed:** Container orchestration (ECS/K8s), external load balancer, sticky sessions for WebSocket.

### 3. In-Memory Caches Without Coordination
- **Risk:** Rule chain cache (30s TTL), reauth config cache (10s TTL), session config cache (1m TTL) are per-process. PM2 cluster mode means each worker has its own cache.
- **Impact:** Cache inconsistency between cluster workers after config updates.
- **Mitigation needed:** Redis-backed caching or cache invalidation via Redis pub/sub.

### 4. Database Connection Limits
- **Risk:** Prisma auto-manages connections + pg.Pool max 20 for TSDB. With PM2 cluster mode, each worker opens its own pool.
- **Impact:** Under load, could exhaust PostgreSQL connection limits (default 100).
- **Mitigation needed:** Connection pooler (PgBouncer), explicit pool sizing per worker.

### 5. No Automated Backups
- **Risk:** No automated database backup strategy documented. Manual backup/restore exists via API but no scheduled backups.
- **Impact:** Data loss risk from hardware failure or corruption.
- **Mitigation needed:** Automated pg_dump cron jobs, WAL archiving, point-in-time recovery.

### 6. Telemetry Batcher Data Loss Risk
- **Risk:** In-memory telemetry batcher buffers up to 10,000 rows. Process crash before flush = data loss.
- **Impact:** Could lose up to 10,000 telemetry readings on unexpected shutdown.
- **Mitigation needed:** WAL-based buffering, pre-flush on SIGTERM (partially implemented), Redis-backed buffer.

### 7. Rule Chain Performance at Scale
- **Risk:** Rule chains execute synchronously within the ingestion pipeline. Complex chains (many nodes, DB queries) block the worker.
- **Impact:** High-latency rule chains slow down overall ingestion throughput.
- **Mitigation needed:** Async node execution, parallel branch processing, dedicated rule engine workers.

### 8. No Rate Limiting on Internal Endpoints
- **Risk:** MQTT internal auth endpoints (`/api/internal/mqtt/*`) have no rate limiting or IP restriction.
- **Impact:** Could be abused to probe credentials if exposed.
- **Mitigation needed:** IP whitelist (EMQX only), dedicated internal listener.

### 9. Large Route Files
- **Risk:** Some route files are very large (e.g., rule-chain routes.ts at 990 lines, config routes.ts at 555 lines).
- **Impact:** Harder to maintain, test, and review.
- **Mitigation needed:** Split into sub-route files per resource type.

### 10. SUPER_ADMIN Audit Exemption
- **Risk:** SUPER_ADMIN actions are not logged in the audit trail by design (21 CFR Part 11 SS11.10(f) exemption).
- **Impact:** No traceability for system-level changes made by super admins.
- **Note:** This is a deliberate design decision for regulatory compliance, but could be reconsidered with a separate system log.

---

## Improvement Recommendations

### Tier 1: Critical (For Production Stability)

1. **Database High Availability**
   - Deploy PostgreSQL with streaming replication (primary + read replica)
   - Enable WAL archiving for point-in-time recovery
   - Automate daily pg_dump backups to S3
   - Deploy PgBouncer for connection pooling

2. **Multi-Instance Deployment**
   - Containerize API with Docker
   - Deploy behind Application Load Balancer (ALB)
   - Use ECS Fargate or EKS for orchestration
   - Externalize Redis and PostgreSQL to managed services (ElastiCache, RDS)

3. **Centralized Caching**
   - Move rule chain cache, config caches to Redis
   - Implement cache invalidation via Redis pub/sub on config updates
   - Eliminates per-worker cache inconsistency

### Tier 2: Important (For Scale)

4. **Dedicated Rule Engine Workers**
   - Separate rule chain execution from ingestion pipeline
   - Process rule chains asynchronously via dedicated BullMQ queue
   - Enables independent scaling of ingestion vs. processing

5. **Telemetry Write Reliability**
   - Replace in-memory batcher with Redis Streams as write-ahead log
   - Ensures zero data loss on process crash
   - Enables replay on failure

6. **API Gateway**
   - Deploy AWS API Gateway or Kong in front of the API
   - Centralized rate limiting, authentication, and monitoring
   - SSL termination at edge, not at nginx

7. **Observability Stack**
   - Structured logging aggregation (CloudWatch Logs or ELK)
   - APM tracing (OpenTelemetry or Datadog)
   - Metric dashboards (Grafana with TimescaleDB as data source)
   - Health check alerting (PagerDuty/OpsGenie)

### Tier 3: Nice-to-Have (For Enterprise Scale)

8. **Event-Driven Architecture**
   - Introduce event bus (Redis Streams or Apache Kafka) for cross-module communication
   - Decouple alarm creation from ingestion pipeline
   - Enable event sourcing for audit trail reconstruction

9. **Multi-Tenancy**
   - Add `tenantId` column to all tables
   - Row-level security in PostgreSQL
   - Tenant-isolated data and configurations

10. **GraphQL API Layer**
    - Add GraphQL gateway for frontend (reduces over-fetching)
    - Keep REST for device ingestion (simpler, lower overhead)
    - Schema stitching across modules

11. **Automated Testing Pipeline**
    - Integration tests with Docker Compose test environment
    - Load testing with k6 or Artillery (target ingestion throughput)
    - Security scanning (SAST/DAST) in CI pipeline

12. **Data Archival**
    - Implement tiered storage (hot → warm → cold) for historical telemetry
    - S3-backed cold storage for telemetry older than retention period
    - Configurable per-template retention policies (partially implemented)

---

*This document reflects the actual implementation as of March 2026 on the DataIngestion branch. Architecture patterns and file paths are derived from direct codebase analysis.*
