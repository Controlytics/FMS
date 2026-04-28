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
         │  HTTPS :443   │  HTTPS :443   │  HTTPS :443   │ MQTT :1883
         ▼               ▼               ▼               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SERVER (Windows)                            │
│                                                                  │
│  ┌────────────────────────────────────────┐                      │
│  │          Nginx (:80 / :443)            │                      │
│  │  ┌──────────────────┐ ┌─────────────┐ │                      │
│  │  │  Static SPA      │ │  /api/*     │ │                      │
│  │  │  React build     │ │  proxy →    │ │                      │
│  │  │  (apps/web/dist) │ │  :3000      │ │                      │
│  │  └──────────────────┘ └──────┬──────┘ │                      │
│  └──────────────────────────────┼────────┘                      │
│                                 │                                │
│  ┌──────────────────────────────▼────────┐                      │
│  │       Fastify API (:3000)             │                      │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐│                      │
│  │  │ 34 Route │ │  Auth    │ │ RBAC   ││                      │
│  │  │ Modules  │ │  Plugin  │ │ Plugin ││                      │
│  │  └────┬─────┘ └──────────┘ └────────┘│                      │
│  │       │  ┌──────────┐ ┌────────────┐ │                      │
│  │       │  │ Workers  │ │ WebSocket  │ │                      │
│  │       │  │ Ingestion│ │ Handler    │ │                      │
│  │       │  │ Maint.   │ │ (real-time)│ │                      │
│  │       │  └──────────┘ └────────────┘ │                      │
│  └───────┼──────────────────────────────┘                      │
│          │                                                      │
│  ┌───────┼──────────────────────────────────────────────┐       │
│  │       ▼          DATA LAYER                          │       │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐  │       │
│  │  │PostgreSQL│ │TimescaleDB│ │ Redis  │ │  EMQX    │  │       │
│  │  │  :5432   │ │  :5432   │ │ :6379  │ │  :1883   │  │       │
│  │  │ 63 models│ │ 7 hyper- │ │BullMQ  │ │  MQTT    │  │       │
│  │  │ Prisma   │ │ tables   │ │Pub/Sub │ │  Broker  │  │       │
│  │  │digilog_db│ │digilog_  │ │Memurai │ │  IoT     │  │       │
│  │  │          │ │tsdb      │ │        │ │  devices │  │       │
│  │  └──────────┘ └──────────┘ └────────┘ └──────────┘  │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

## Monorepo Package Architecture

```
21cfrlogbook-DigitalFMS/          (Turborepo root)
│
├── apps/api/                      (Fastify backend)
│   ├── src/
│   │   ├── app.ts                 Entry point — registers all plugins, routes, handlers
│   │   ├── modules/               34 feature modules (routes.ts + *.service.ts)
│   │   ├── plugins/               auth.ts, rbac.ts, audit-logger.ts
│   │   ├── transport/             mqtt-client.ts, mqtt-handler.ts, ws-handler.ts
│   │   ├── workers/               ingestion.worker.ts, maintenance.worker.ts
│   │   ├── lib/                   Shared utilities (audit, jwt, sanitize, prisma, etc.)
│   │   └── types/                 TypeScript type definitions
│   └── prisma/
│       ├── schema.prisma          63 models, 23 enums
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
│   └── android/                   Native Android project
│
├── packages/shared/               (Shared types & schemas)
│   └── src/
│       ├── schemas/               8 Zod validation schemas
│       └── types/                 Permissions (95), privileges (82), reauth (69), sidebar
│
├── packages/db/                   (Database utilities)
│   └── src/
│       ├── prisma.ts              Prisma client singleton
│       ├── tsdb.ts                TimescaleDB connection pool
│       └── telemetry-batcher.ts   Batch telemetry writes
│
└── packages/queue/                (Job queue)
    └── src/
        ├── connection.ts          Redis/Memurai connection
        ├── queues.ts              5 BullMQ queue definitions
        ├── schemas.ts             Zod schemas for job payloads
        └── priorities.ts          Job priority levels (1-8)
```

## Backend Architecture (apps/api/)

### Request Flow

```
HTTP Request
  → Nginx (SSL termination, static files)
    → Fastify (:3000)
      → Helmet (security headers)
      → CORS (origin validation)
      → Rate Limiter (500 req/min)
      → Auth Plugin (JWT verification, user lookup)
      → RBAC Plugin (permission check)
      → Route Handler (business logic)
        → Service Layer (data processing)
          → Prisma (PostgreSQL)
          → TimescaleDB Pool (time-series)
          → BullMQ (async jobs)
        → Audit Logger (SHA-256 hash chain)
      → Response (JSON)
```

### Module Structure

Each of the 34 modules follows this pattern:

```
modules/
└── <module-name>/
    ├── routes.ts              HTTP route definitions + Fastify schema validation
    ├── <module>.service.ts    Business logic, data processing
    ├── <module>.repository.ts Data access layer (Prisma queries)
    └── __tests__/             Vitest unit tests
```

### 34 API Modules

| Category | Modules |
|---|---|
| **Auth & Users** | auth, users, roles, user-groups |
| **Organization** | org-admin, tenant-admin, super-admin |
| **Assets** | assets (templates/instances/relationships/identifiers) |
| **Filter Operations** | filter-operations, filter-profiles, cleaning-profiles, checklist-profiles |
| **Scheduling** | pm-schedules, equipment-groups, entity-assignments |
| **Approvals** | block-change-requests, admin-requests |
| **Reports** | report-templates, reports |
| **Data Pipeline** | data-ingestion, queries (telemetry/alarms/retention/export) |
| **Rule Engine** | rule-chain (77 node types, 8 categories) |
| **Notifications** | notifications, notification-rules, notification-delivery |
| **Config** | config (24 definitions with auto-discovery) |
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
  (required for 69 sensitive operations)

Session Management:
  - Single active session per user (force login terminates existing)
  - Session stored in DB with IP, user agent, last active time
  - Auto-expired by configurable idle timeout
```

### Data Ingestion Pipeline

```
IoT Device
  → MQTT (EMQX :1883) or HTTP (POST /api/data/telemetry)
    → EMQX Auth Webhook (/api/internal/mqtt/auth)
    → Message Normalization
    → BullMQ Ingestion Queue (Redis)
      → Ingestion Worker (10 concurrent)
        → Entity Resolution (device token → asset instance)
        → UNS Path Mapping
        → Rule Chain Execution (77 node types)
        → TimescaleDB Write (telemetry, attributes)
        → Alarm Processing
        → Notification Dispatch
        → Dead Letter Queue (failed messages)
```

### Job Queue Architecture (BullMQ)

| Queue | Purpose | Priority | Concurrency | Retry |
|---|---|---|---|---|
| `ingestion` | Telemetry, attributes, events | 1-8 | 10 | 3x exponential |
| `notification` | Email, SMS, in-app delivery | — | 5 | 3x exponential |
| `export` | CSV/Excel/PDF data export | — | 2 | 2x |
| `reports` | Report PDF generation | — | 2 | 2x |
| `maintenance` | DLQ check, connectivity, cleanup | — | 1 | 1x |

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

### PostgreSQL (digilog_db) — 63 Models

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

### Redis (Memurai) — Usage

| Feature | Redis Data Structure |
|---|---|
| BullMQ job queues | Sorted sets, lists, hashes |
| Pub/sub (WebSocket events) | Channels (ws:events) |
| Re-auth token cache | Key-value with 10s TTL |
| Rule chain graph cache | Key-value with hash |
| Session validation cache | Key-value |

## Security Architecture

```
┌─────────────────────────────────────────────────────┐
│                 SECURITY LAYERS                      │
│                                                     │
│  Layer 1: HTTPS (TLS)                               │
│    └── All traffic encrypted (Nginx SSL termination) │
│                                                     │
│  Layer 2: Authentication                            │
│    └── JWT (8h expiry, 30-min refresh)              │
│    └── Device tokens (64-char hex, per entity)      │
│    └── EMQX webhook auth (for MQTT devices)         │
│                                                     │
│  Layer 3: Authorization                             │
│    └── RBAC (95 permissions, role-based)             │
│    └── Organization scoping (multi-tenant isolation) │
│    └── Re-authentication (69 sensitive actions)      │
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
| HTTPS | 443 | Web UI + API (via Nginx) | JWT token |
| HTTPS | 3000 | Direct API access | JWT token |
| MQTT | 1883 | IoT device telemetry | Device access token |
| WSS | 443 | Real-time updates (via Nginx /ws) | JWT token |
| PostgreSQL | 5432 | Database connections | Username/password |
| Redis | 6379 | Cache + job queue | No auth (local only) |
| EMQX Dashboard | 18083 | MQTT broker management | Admin credentials |
