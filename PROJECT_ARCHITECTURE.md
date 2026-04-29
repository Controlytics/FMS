# DigiLog — Project Architecture

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENT DEVICES                            │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────┐  │
│  │  Desktop   │  │  Tablet   │  │  Mobile   │  │  IoT Device  │  │
│  │  Browser   │  │  APK      │  │  PWA      │  │  (MQTT/HTTP) │  │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘  │
└────────┼───────────────┼───────────────┼───────────────┼─────────┘
         │               │               │               │
         │  HTTPS :3000  │  HTTPS :3000  │  HTTPS :3000  │ MQTT :1883
         ▼               ▼               ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SERVER (Windows)                            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐        │
│  │       Fastify API (:3000)                             │        │
│  │  Serves the static SPA (apps/web/dist) AND /api/*     │        │
│  │  routes directly over HTTPS (mkcert). A reverse       │        │
│  │  proxy (Nginx / IIS) is optional / customer-choice;   │        │
│  │  not bundled after Phase 4 of the                     │        │
│  │  windows-friendly-rewrite.                            │        │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐                 │        │
│  │  │ 37 Route │ │  Auth    │ │ RBAC   │                 │        │
│  │  │ Modules  │ │  Plugin  │ │ Plugin │                 │        │
│  │  └────┬─────┘ └──────────┘ └────────┘                 │        │
│  │       │  ┌──────────┐ ┌────────────┐                  │        │
│  │       │  │ Workers  │ │ WebSocket  │                  │        │
│  │       │  │ Ingestion│ │ Handler    │                  │        │
│  │       │  │ Maint.   │ │ (real-time)│                  │        │
│  │       │  └──────────┘ └────────────┘                  │        │
│  └───────┼──────────────────────────────────────────────┘        │
│          │                                                       │
│  ┌───────┼──────────────────────────────────────────────┐        │
│  │       ▼          DATA LAYER                          │        │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐   │        │
│  │  │PostgreSQL│ │TimescaleDB│ │ Redis  │ │Mosquitto │   │        │
│  │  │  :5432   │ │  :5432   │ │ :6379  │ │  :1883   │   │        │
│  │  │ 64 models│ │ 7 hyper- │ │ pub/sub│ │  MQTT    │   │        │
│  │  │ Prisma   │ │ tables   │ │only-now│ │  Broker  │   │        │
│  │  │digilog_db│ │digilog_  │ │optional│ │  IoT     │   │        │
│  │  │ +queue   │ │tsdb      │ │ Memurai│ │  devices │   │        │
│  │  │(graphile)│ │          │ │        │ │          │   │        │
│  │  └──────────┘ └──────────┘ └────────┘ └──────────┘   │        │
│  └──────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

> **Tech-stack swap (windows-friendly-rewrite Phases 1+2+3, 2026-04-29):**
> EMQX → Mosquitto 2.0 (Phase 1); BullMQ on Redis/Memurai → graphile-worker
> on PostgreSQL (Phase 2); Puppeteer (bundled Chromium) + chartjs-node-canvas
> → puppeteer-core + Edge + @napi-rs/canvas (Phase 3). Redis/Memurai is now
> only used for non-queue pub/sub (WebSocket events, RPC routing, pipeline
> tracer, debug recorder); Phase 4 will move those to PG `LISTEN/NOTIFY`.

## Monorepo Package Architecture

```
21cfrlogbook-DigitalFMS/          (Turborepo root)
│
├── apps/api/                      (Fastify backend)
│   ├── src/
│   │   ├── app.ts                 Entry point — registers all plugins, routes, handlers
│   │   ├── modules/               37 feature modules (routes.ts + *.service.ts)
│   │   ├── plugins/               auth.ts, rbac.ts, audit-logger.ts
│   │   ├── transport/             mqtt-client.ts, mqtt-handler.ts, ws-handler.ts
│   │   ├── workers/               ingestion.worker.ts, maintenance.worker.ts
│   │   ├── lib/                   Shared utilities (audit, jwt, sanitize, prisma, etc.)
│   │   └── types/                 TypeScript type definitions
│   └── prisma/
│       ├── schema.prisma          64 models, 22 enums
│       └── seed.ts                Default roles, superadmin, configs
│
├── apps/web/                      (React SPA)
│   └── src/
│       ├── main.tsx               Route definitions, lazy loading, error boundaries
│       ├── routes/                22 route modules (~85 pages)
│       ├── components/            Layout (sidebar, header), UI primitives, dialogs
│       ├── hooks/                 14 custom hooks (auth, session, branding, offline, etc.)
│       └── lib/                   API client, SWR config, themes, offline store, sync engine
│
├── apps/android/                  (Capacitor Android wrapper)
│   ├── capacitor.config.ts        Server URL, plugins config
│   └── android/
│       └── app/src/main/java/com/digilog/filtermanagement/
│           ├── MainActivity.java   Capacitor BridgeActivity entry
│           └── RfidPlugin.java     Native Capacitor plugin wrapping Reader_Usb.jar — opens USB device, emits "tag" events to JS via plugin bridge (paired with apps/web/src/lib/rfid-bridge.ts)
│
├── packages/shared/               (Shared types & schemas)
│   └── src/
│       ├── schemas/               8 Zod validation schemas
│       └── types/                 Permissions (109), privileges (91), reauth (81), sidebar items (26)
│
├── packages/db/                   (Database utilities)
│   └── src/
│       ├── prisma.ts              Prisma client singleton
│       ├── tsdb.ts                TimescaleDB connection pool
│       └── telemetry-batcher.ts   Batch telemetry writes
│
└── packages/queue/                (Job queue)
    └── src/
        ├── index.ts               getProducer() + getRunner() over graphile-worker on Postgres (Phase 2 of windows-friendly-rewrite swapped from BullMQ + ioredis; commit `7832af1`)
        ├── crontab.txt            graphile-worker cron file (dlq_check, connectivity_check, retention_cleanup)
        ├── schemas.ts             Zod schemas for job payloads
        └── priorities.ts          Job priority levels (1-8)
```

## Build / test infrastructure

| File | Purpose |
|---|---|
| `turbo.json` | Turborepo task graph — build/test pipelines for all workspaces |
| `vitest.workspace.ts` | Vitest workspace config — discovers tests across `apps/*` and `packages/*` |
| `test-engine.mjs` (root) | Standalone rule-chain VM-sandbox tester (`node:vm` runner) — used to debug a single chain in isolation |
| `package.json` (root) | Workspace root, holds turbo + dev tools (NOT app deps — those live in workspaces; bloat audit P3.1 cleanup done) |
| Per-workspace `vitest.config.ts` | Each of `apps/api`, `apps/web` (no), `packages/db`, `packages/shared` carries its own Vitest config; `packages/queue` is the exception (no test config). |
| `apps/web/vite.config.ts` | Vite + PWA plugin + Tailwind + path aliases |
| `apps/web/eslint.config.js` | ESLint flat config — `typescript-eslint` + `no-explicit-any: warn`; max-warnings cap 10000 (bloat audit P0.3) |
| `apps/web/index.html` | Vite SPA entry HTML — root `<div id="root">`, theme `<meta>` |
| `apps/web/tsconfig.json` + `tsconfig.tsbuildinfo` | TS project + incremental cache |
| `apps/web/generate-apk.md` | APK build walkthrough (web build → `cap copy` → `gradlew assembleDebug`) |

## CI / GitHub

| Path | Purpose |
|---|---|
| `.github/workflows/ci.yml` | GitHub Actions CI — runs on push/PR; build + lint + tests |
| `.github/ISSUE_TEMPLATE/bug_report.md` | Bug report template |

## Database migrations + uploads

| Path | Purpose |
|---|---|
| `apps/api/prisma/schema.prisma` | 64 models, 22 enums |
| `apps/api/prisma/seed.ts` | Default roles, super-admin user, system configs, default rule chain |
| `apps/api/prisma/migrations/` | Versioned Prisma migrations (8+ migrations: phase_a_data_ingestion, sync_schema, audit_fixes, equipment_groups, admin_requests, sync_drift_phase3, block_change_nullable_org, …) plus `migration_lock.toml` |
| `apps/api/prisma/sql/extensions.sql` | Hand-written SQL — installs PostgreSQL extensions (e.g. `pg_trgm`, `uuid-ossp`) used by Prisma |
| `apps/api/prisma/schema.prisma.bak` | **Stray backup file** — clean up |
| `apps/api/uploads/photos/` | User-uploaded profile photos + checklist photos (served at `/uploads/`) |
| `apps/api/uploads/reports/` | Generated report PDFs (created at runtime by reports module) |

## Frontend public assets (`apps/web/public/`)

| File | Purpose |
|---|---|
| `favicon.svg` | Site favicon |
| `logo.jpg` | Default org logo (overridable via Branding config) |
| `apple-touch-icon.png` | iOS home-screen icon |
| `pwa-192x192.{png,svg}`, `pwa-512x512.{png,svg}`, `pwa-icon.svg` | PWA manifest icons (used by `vite-plugin-pwa`) |
| `sw.js` (built into `dist/`) | Service worker — offline queue background sync hook |

## Repo-level Infrastructure

```
21cfrlogbook-DigitalFMS/
├── certs/                         (mkcert-generated TLS — for HTTPS API)
│   ├── rootCA.pem                 Install on tablet system cert store for APK trust
│   ├── rootCA.key                 mkcert root key
│   ├── server.crt / server.key    Localhost cert pair used by API_HTTPS=true
│   └── ssl.conf                   OpenSSL config for cert generation
│
├── tsdb-migration/                (TimescaleDB hypertable bootstrap)
│   └── init-hypertables.sql       Converts 5 PG tables to hypertables (ts_telemetry 7-day chunks, ts_attributes, ts_device_events, ts_checklist_responses, ts_pipeline_traces). Run once after creating digilog_tsdb.
│
├── scripts/                       (Windows deployment automation)
│   ├── package-for-production.ps1  Builds API + Web + shared, zips into digilog-production.zip
│   ├── install-on-target.ps1       Run-once on target Windows: installs deps, runs migrations, registers NSSM Windows service
│   └── reset-cwh-cycles.sql        Emergency SQL to terminate IN_PROGRESS cycles bound to obsolete profile (used 04-25 for 7 stuck CWH cycles)
│
├── rfid_scan_app/                 (Standalone Kotlin app — predates RFID SDK plugin in DigiLog APK)
│   ├── app/                        Kotlin sources, AndroidManifest, layout XMLs
│   ├── build.gradle.kts            Root Gradle config
│   ├── gradle.properties / settings.gradle.kts / gradlew[.bat]  Gradle wrapper
│   ├── rfid-key.jks                **SENSITIVE** signing keystore (should not be committed — see Working-tree noise)
│   └── RFID_Scanner_User_Manual.html  End-user manual for the standalone scanner
├── start-digilog.bat / stop-digilog.bat  Local Windows service launchers
├── docker-compose.yml             (Optional Docker dev stack — see docs/deployment-methods/method-b)
├── init-tsdb.sql                  (Convenience init for digilog_tsdb)
└── DigiLog-FilterOps.apk          Built APK at repo root after gradlew assembleDebug
```

## Working-tree noise (cleanup candidates)

Items present in the working tree that are NOT canonical — these should be `.gitignored` or removed:

| Path | Status | Action |
|---|---|---|
| `RFID/` (top-level dir) | Stray Gradle build cache for an older standalone Kotlin project, separate from `rfid_scan_app/` | Add `RFID/` to `.gitignore` or delete |
| `rootCA.pem` (top-level file) | Duplicate of `certs/rootCA.pem` | Use only the `certs/` copy |
| `apps/android/apps/web/public/sw.js` | Stray nested service-worker file (misplaced relative path during a build) | Compare with `apps/web/public/sw.js`; remove the nested duplicate |
| `rfid_scan_app/rfid-key.jks` | Android signing keystore — **sensitive, should NOT be committed** | Move to operator-only secrets store; add `*.jks` to `.gitignore`; rotate key if already pushed |
| `rfid_scan_app/local.properties` | Per-machine SDK paths | Already gitignored normally; verify |
| `packages/shared/src/schemas/config.ts.patch` | Stray patch file in source tree | Apply or delete |
| `.playwright-mcp/*.yml` (when present) | Per-session Playwright MCP traces | Add `.playwright-mcp/` to `.gitignore` (bloat audit P3.2 still open) |
| `apps/api/prisma/schema.prisma.bak` | Backup of an older schema | Delete — git history is authoritative |
| `apps/api/dist/`, `apps/web/dist/`, `packages/*/dist/` | Compiled outputs | Should be gitignored; verify |
| `apps/api/tsconfig.tsbuildinfo`, `apps/web/tsconfig.tsbuildinfo`, `packages/shared/tsconfig.tsbuildinfo` | TS incremental cache | Should be gitignored |

## Backend Architecture (apps/api/)

### Request Flow

```
HTTPS Request → Fastify (:3000, mkcert TLS, serves SPA + /api/*)
      → Helmet (security headers)
      → CORS (origin validation)
      → Rate Limiter (500 req/min)
      → Auth Plugin (JWT verification, user lookup)
      → RBAC Plugin (permission check)
      → Route Handler (business logic)
        → Service Layer (data processing)
          → Prisma (PostgreSQL)
          → TimescaleDB Pool (time-series)
          → graphile-worker (async jobs on Postgres)
        → Audit Logger (SHA-256 hash chain)
      → Response (JSON)
```

> Reverse proxy (Nginx / IIS) is optional and customer-choice, not bundled after Phase 4 of the windows-friendly-rewrite. Direct Fastify-on-3000 is the default install path.

### Module Structure

Each of the 37 modules follows this pattern:

```
modules/
└── <module-name>/
    ├── routes.ts              HTTP route definitions + Fastify schema validation
    ├── <module>.service.ts    Business logic, data processing
    ├── <module>.repository.ts Data access layer (Prisma queries)
    └── __tests__/             Vitest unit tests
```

### 37 API Modules

| Category | Modules |
|---|---|
| **Auth & Users** | auth, users, roles, user-groups |
| **Organization** | org-admin, tenant-admin, super-admin |
| **Assets** | assets (templates/instances/relationships/identifiers) |
| **Filter Operations** | filter-operations, filter-profiles, cleaning-profiles, checklist-profiles |
| **Scheduling** | pm-schedules, equipment-groups, entity-assignments |
| **Approvals** | block-change-requests, admin-requests |
| **Reports** | report-templates (CRUD + versioning), reports (generation engine + PDF + signatures) |
| **Data Pipeline** | data-ingestion, queries (telemetry/alarms/retention/export) |
| **Rule Engine** | rule-chain (77 node types, 8 categories) |
| **Notifications** | notifications, notification-rules, notification-delivery |
| **Config** | config (30 definitions with auto-discovery; monolith split into `static-routes/` per surface) |
| **Infrastructure** | connectivity, qr-code, uns, uploads, help, ldap |
| **System** | audit, backup, system-health, deployment-check, dashboards |

### Authentication Architecture

```
Login Flow:
  POST /api/auth/login → validate credentials → create Session → return JWT (8h)

JWT Payload:
  { sub: userId, username, role, sessionId, scope, organizationId }

Token Refresh:
  POST /api/auth/refresh → extend JWT (every 30 min)

Re-authentication:
  POST /api/auth/verify → password check → 5-min verification token
  (required for 81 sensitive operations)

Session Management:
  - Single active session per user (force login terminates existing)
  - Session stored in DB with IP, user agent, last active time
  - Auto-expired by configurable idle timeout
```

### Data Ingestion Pipeline

```
IoT Device
  → MQTT (Mosquitto :1883) or HTTP (POST /api/data/telemetry)
    → Mosquitto dynsec lookup (configured via /api/internal/mqtt/refresh-acl)
    → Message Normalization
    → graphile-worker `ingestion` task (Postgres-backed; LISTEN/NOTIFY + SKIP LOCKED)
      → Ingestion Worker (10 concurrent)
        → Entity Resolution (device token → asset instance)
        → UNS Path Mapping
        → Rule Chain Execution (77 node types)
        → TimescaleDB Write (telemetry, attributes)
        → Alarm Processing
        → Notification Dispatch
        → Dead Letter Queue (failed messages)
```

### Job Queue Architecture (graphile-worker on Postgres)

Phase 2 of the windows-friendly-rewrite swapped from BullMQ + Redis/Memurai to graphile-worker against `digilog_db` (uses `LISTEN/NOTIFY` for instant dispatch, `SELECT … FOR UPDATE SKIP LOCKED` for concurrency, `pg_advisory_lock` for cron leader election). No separate queue service.

| Task | Purpose | Trigger | Concurrency |
|---|---|---|---|
| `ingestion` | Telemetry, attributes, events | enqueued by HTTP/MQTT handler | 10 (`addJob` + worker pool) |
| `notification` | Email, SMS, in-app delivery | enqueued by alarm/event hooks | shared pool |
| `dlq_check` | Dead letter queue scan | cron 60 s (`packages/queue/crontab.txt`) | 1 leader |
| `connectivity_check` | Device online/offline staleness | cron 60 s | 1 leader |
| `retention_cleanup` | TimescaleDB retention policy | cron 24 h | 1 leader |

## Frontend Architecture (apps/web/)

### Component Hierarchy

```
<BrowserRouter>
  <SWRConfig>
    <ToastProvider>
      <RootErrorBoundary>
        ├── Public Routes (no auth)
        │   ├── /login → LoginPage
        │   ├── /forgot-password → ForgotPasswordPage
        │   ├── /change-password → ChangePasswordPage
        │   └── /contact-admin → ContactAdminPage
        │
        ├── Mobile Routes (standalone layout)
        │   ├── /m/login → MobileLoginPage
        │   └── /m → MobileOperationsPage
        │
        ├── Standalone Routes
        │   └── /checklist/:entityId → ChecklistPage (no sidebar)
        │
        └── Protected Routes
            └── <AppLayout> (sidebar + header + session management)
                ├── useAuth() → fetch /api/auth/me, check login
                ├── useSingleTab() → duplicate tab detection
                ├── useSession() → idle timeout
                ├── useBranding() → theme application
                ├── useRfidGuard() → RFID keyboard blocking
                └── <RequireRole> (permission gate)
                    └── <Page /> (route content)
```

### State Management

| Concern | Solution |
|---|---|
| Server state | SWR (auto-revalidation, dedup, cache) |
| Auth state | React Context via `useAuth()` hook |
| UI state | React `useState` / `useReducer` (local) |
| Offline queue | IndexedDB via `offline-store.ts` |
| Theme | CSS custom properties via `applyTheme()` |
| Session | sessionStorage (token) + localStorage (backup, single-tab) |

### Styling Architecture

- **Tailwind CSS 4.0** — utility-first, no component library
- **Light theme only** — bg-white cards, bg-slate-50 sections, border-slate-200
- **10 color presets** — CSS custom properties (--theme-primary, --theme-gradient-from/to)
- **Responsive** — sidebar collapses to hamburger on `<lg` screens
- **No dark theme** — unified light appearance across all pages

### Code Splitting

Heavy pages are lazy-loaded for performance:
- Assets, Rule Chains, Alarms (large editors with ReactFlow)
- Filter Management (all 10+ pages)
- Config pages (20+ pages)
- Reports (template editor, generator, detail)
- Mobile routes

## Database Architecture

### PostgreSQL (digilog_db) — 64 Models

```
Core:
  Organization → User → Role → Session → PasswordHistory

Assets:
  AssetTemplate → AssetTemplateVersion
  AssetInstance → AssetRelationship, AssetIdentifier
  TemplateAssignment, EntityAssignment

Filter Operations:
  FilterCleaningProfile → FilterPipelineStage → FilterPipelineConnection
  FilterProfile → AssetInstance (assignment)
  CleaningCycle → FilterEvent (immutable, checksummed)

Scheduling:
  PmSchedule → PmScheduleEntry → PmExecution
  EquipmentGroup → EquipmentGroupInstrument
  ChecklistProfile → ChecklistQuestion
  ChecklistReview → ElectronicSignature

Reports:
  ReportTemplate → ReportTemplateVersion
  ReportInstance → ReportSignature

Rules & Notifications:
  RuleChain → RuleNode → RuleNodeConnection
  Notification, NotificationLog, NotificationTemplate
  NotificationRule → NotificationRuleRecipient

System:
  SystemConfig, FieldIdConfig, RoleConfig, UserConfig
  AuditTrail (SHA-256 hash chain)
  DeadLetterQueue, IngestionSystemConfig
  Dashboard → DashboardWidget → DashboardAssignment
  HelpArticle → HelpArticleVersion
  ConnectivityStatus, DeviceCredential, DataStream
  QrCode, UnsMapping, BlockChangeRequest, AdminRequest
```

### TimescaleDB (digilog_tsdb) — 7 Hypertables

| Table | Purpose | Partition |
|---|---|---|
| ts_telemetry | Sensor readings (temperature, humidity, pressure) | Time (hourly) |
| ts_attributes | Device attributes (firmware, config) | Time (daily) |
| ts_alarms | Alarm history with severity levels | Time (daily) |
| ts_checklist_responses | Checklist answer submissions | Time (daily) |
| ts_device_events | Device connect/disconnect events | Time (daily) |
| ts_events | General system events | Time (daily) |
| ts_exports | Export request tracking | Time (daily) |

### Redis (Memurai) — Usage (post-Phase-2: pub/sub only, optional)

| Feature | Redis Data Structure |
|---|---|
| Pub/sub (WebSocket events) | Channels (ws:events) |
| RPC routing (device commands) | Channels |
| Pipeline tracer / debug recorder | Channels |
| Re-auth token cache | Key-value with 10s TTL |
| Rule chain graph cache | Key-value with hash |
| Session validation cache | Key-value |

> Job queues moved off Redis to graphile-worker on Postgres in Phase 2 of the windows-friendly-rewrite (commit `7832af1`). Phase 4 will move the remaining pub/sub channels above to PG `LISTEN/NOTIFY` to drop the dependency entirely.

## Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                 SECURITY LAYERS                      │
│                                                     │
│  Layer 1: HTTPS (TLS)                               │
│    └── All traffic encrypted (Fastify TLS via mkcert; reverse proxy optional) │
│                                                     │
│  Layer 2: Authentication                            │
│    └── JWT (8h expiry, 30-min refresh)              │
│    └── Device tokens (64-char hex, per entity)      │
│    └── Mosquitto dynsec auth (DeviceCredential → dynamic-security.json via /refresh-acl)         │
│                                                     │
│  Layer 3: Authorization                             │
│    └── RBAC (109 permissions, role-based)            │
│    └── Organization scoping (multi-tenant isolation) │
│    └── Re-authentication (81 sensitive actions)      │
│                                                     │
│  Layer 4: Input Validation                          │
│    └── HTML sanitization (all text inputs)           │
│    └── Zod schema validation (request bodies)        │
│    └── Rate limiting (500 req/min)                   │
│                                                     │
│  Layer 5: Audit & Compliance                        │
│    └── SHA-256 hash-chain audit trail                │
│    └── Immutable filter events with checksums        │
│    └── Electronic signatures for critical operations │
│    └── Session tracking (IP, user agent, timestamps) │
└─────────────────────────────────────────────────────┘
```

## Communication Protocols

| Protocol | Port | Purpose | Authentication |
|---|---|---|---|
| HTTPS | 3000 | Web UI + API (Fastify direct; reverse proxy optional) | JWT token |
| WSS | 3000 | Real-time updates on `/ws` | JWT token |
| MQTT | 1883 | IoT device telemetry (Mosquitto 2.0) | Device access token (Mosquitto dynsec) |
| PostgreSQL | 5432 | Database connections (also hosts the graphile-worker queue schema) | Username/password |
| Redis | 6379 | Pub/sub only (WebSocket events, RPC routing, pipeline tracer, debug recorder); job queue moved to Postgres in Phase 2 | No auth (local only) |
| Mosquitto control | n/a | Dynsec is configured via the API's `POST /api/internal/mqtt/refresh-acl`, not a standalone dashboard | `MOSQUITTO_REFRESH_TOKEN` (timing-safe compare) |
