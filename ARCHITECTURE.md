# DigiLog Architecture

## System Overview

```
                    ┌─────────────┐
                    │   Nginx     │ (HTTP/HTTPS reverse proxy)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴───┐ ┌─────┴─────┐
        │  Vite SPA  │ │Fastify│ │   EMQX    │
        │ (React)    │ │ API   │ │ (MQTT)    │
        │ Port: 80   │ │:3000  │ │:1883/8883 │
        └────────────┘ └───┬───┘ └─────┬─────┘
                           │           │
              ┌────────────┼───────────┤
              │            │           │
        ┌─────┴─────┐ ┌───┴───┐ ┌────┴────┐
        │PostgreSQL  │ │TimescaleDB│ │ Redis │
        │digilog_db  │ │digilog_tsdb│ │:6379  │
        │:5432       │ │:5432      │ └───────┘
        └────────────┘ └───────────┘
```

## Backend Architecture (Fastify)

### Module Structure
27 route modules organized by domain:

| Module | Routes | Description |
|--------|--------|-------------|
| auth | `/api/auth/*` | Login, logout, profile, password, sessions |
| users | `/api/users/*` | User CRUD, stats, enable/disable, unlock |
| roles | `/api/roles/*` | Role CRUD with hierarchy and permissions |
| config | `/api/config/*` | 23 config definitions with auto-discovery |
| audit | `/api/audit/*` | Immutable audit trail with hash-chain |
| notifications | `/api/notifications/*` | In-app notifications and badges |
| notification-delivery | `/api/notification-settings/*` | Email/SMS delivery config |
| notification-rules | `/api/notification-rules/*` | Event-based routing rules |
| assets (templates) | `/api/templates/*` | Entity template CRUD with versioning |
| assets (instances) | `/api/instances/*` | Entity CRUD, tree, hierarchy |
| assets (relationships) | `/api/relationships/*` | 12 relationship types with cycle detection |
| assets (identifiers) | `/api/identifiers/*` | QR/RFID/NFC/Barcode identifiers |
| data-ingestion | `/api/v1/*` | HTTP telemetry, attributes, events, binary |
| rule-chain | `/api/rule-chains/*` | Visual rule chain editor with 77 node types |
| uns | `/api/uns/*` | ISA-95 namespace management |
| queries (telemetry) | `/api/queries/telemetry/*` | Latest, history, aggregation, delta |
| queries (alarms) | `/api/alarms/*` | Alarm lifecycle with e-signatures |
| queries (export) | `/api/export/*` | CSV/JSON export with background jobs |
| queries (retention) | `/api/retention/*` | Per-table data retention policies |
| connectivity | `/api/connectivity/*` | Device status, credentials, snippets |
| qr-code | `/api/qr-codes/*` | QR code generation and management |
| help | `/api/help/*` | Versioned help articles |
| backup | `/api/backup/*` | Database backup and restore |
| uploads | `/api/uploads/*` | File upload handling |
| system-health | `/api/system-health/*` | Request tracking and metrics |
| debug-traces | `/api/debug/*` | Pipeline execution traces |
| user-groups | `/api/user-groups/*` | User group management |

### Data Flow (Telemetry Ingestion)

```
Device → MQTT/HTTP → Entity Resolver (token→entity) → Validation
  → Rule Chain Execution (77 node types) → Alarm Processing
  → Data Persistence (TSDB + Latest Cache) → Event Emission (Redis pub/sub + WebSocket)
```

### Key Libraries
- **Prisma** — ORM for PostgreSQL (digilog_db)
- **pg** — Direct connection to TimescaleDB (digilog_tsdb)
- **BullMQ** — Background job queue (ingestion workers)
- **node:vm** — Sandboxed JS execution for rule chain scripts
- **EMQX** — MQTT broker with custom auth/ACL hooks

## Frontend Architecture (React + Vite)

### Tech Stack
- React 18 with TypeScript
- React Router v6 (SPA routing)
- SWR for data fetching with real-time revalidation
- ReactFlow for rule chain visual editor
- Tailwind CSS for styling

### Key Pages
- Dashboard (home), Assets (entity tree + detail), Rule Chains (list + editor)
- Alarms, Audit Trail, Notifications, System Health
- Config (23 setting pages), Users, Profile
- Checklist (mobile-optimized, standalone auth)

## Database Schema

### PostgreSQL (digilog_db)
Core application data: users, roles, sessions, entities, templates, relationships, identifiers, rule chains, alarms, audit trail, notifications, config, help articles, electronic signatures, checklist reviews.

### TimescaleDB (digilog_tsdb)
Time-series hypertables: ts_telemetry, ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data, ts_pipeline_traces.

## Security

- JWT authentication with 30-minute auto-refresh
- Session management with idle timeout and single-tab enforcement
- Re-authentication for sensitive operations
- SHA-256 hash-chain audit trail
- Input sanitization (HTML stripping) on all text fields
- Rate limiting on device data ingestion
- IP allowlists for device credentials
