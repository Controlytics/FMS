# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

DigiLog is an IoT data logging platform designed for regulated industries requiring **21 CFR Part 11** compliance. It provides real-time data ingestion, visual rule chain processing, alarm management, digital checklists with electronic signatures, and a **Digital Filter Management System (FMS)** for pharmaceutical cleanroom filter lifecycle tracking.

## Features

### Phase 1 — Core Platform
- **Entity Management** — Hierarchical asset/equipment modeling with templates, relationships (12 types), and identifiers (QR/RFID/NFC)
- **Rule Chain Engine** — Visual DAG-based data processing with 77 built-in node types across 8 categories (Filter, Enrichment, Transform, Action, External, Flow, Analytics)
- **Data Ingestion** — MQTT (via EMQX) and HTTP ingestion with rate limiting, IP allowlists, and schema validation
- **Alarm System** — Threshold, rate-of-change, and absence alarms with lifecycle management and electronic signature acknowledgment
- **Unified Namespace (UNS)** — ISA-95 hierarchical topic structure with MQTT wildcard support
- **Digital Checklists** — Mobile-friendly inspection forms with 14 field types, photo capture, and 3-step approval workflow
- **Audit Trail** — Tamper-evident SHA-256 hash-chain audit log with before/after snapshots
- **Notifications** — Multi-channel alerts (in-app, email via SMTP/OAuth2, SMS via AWS SNS/Twilio, Telegram, Slack)
- **Data Retention** — Configurable per-table retention with TimescaleDB compression
- **Backup & Restore** — Full database export (JSON/SQL/CSV) with SHA-256 integrity verification
- **Role-Based Access Control** — 6 hierarchical roles with 52+ granular permissions
- **Help Articles** — Versioned in-app documentation with 40+ articles across 8 categories
- **LDAP Integration** — Active Directory / OpenLDAP authentication with group-to-role mapping

### Phase 2 — Digital Filter Management System (FMS)
- **Filter Operations** — 8-stage cleaning lifecycle (To Be Cleaned, Wash In/Out, Dry In/Out, Storage In/Out, Ready For Use) with QR/barcode scan
- **Cleaning Profiles** — Visual pipeline editor with drag-and-drop nodes, connections, CHECKLIST gates, BYPASS mode
- **Checklist Integration** — Configurable checklists (YES_NO, PASS_FAIL, NUMERIC, DROPDOWN, MULTI_SELECT, TEXT) triggered between pipeline stages
- **Filter Profiles** — Assign cleaning profiles to filters with block restrictions and max cycle limits
- **Cleaning Cycles** — Full audit trail with stage timestamps, remarks, performer names, checklist answers
- **PM Scheduling** — Preventive maintenance schedules per AHU with tolerance windows
- **AHU Dashboard** — Filter set management (Set A/B swap), lifecycle state visualization
- **Filter Traceability** — Complete event history, cycle timeline, deviation tracking per filter
- **Equipment Groups** — Instrument tracking for filters and AHUs
- **Bulk Upload** — CSV-based bulk filter import
- **Retirement & Replacement** — Filter lifecycle end management

### Phase 3 — RFID & Offline Operations
- **RFID Scanner App** — Native Android app (`rfid_scan_app/`) for KC-series UHF readers via USB-C
- **RFID Integration** — Global keyboard guard prevents UKB tag input leaking into random fields; scan dialogs detect tags with deduplication and show filter name + AHU
- **Offline Cleaning Operations** — Mobile APK caches templates, instances, cleaning reasons, and identifiers to IndexedDB; all operations (advance, start-cycle, checklist, equipment) queue when offline and auto-sync on reconnect
- **Offline RFID Lookup** — Cached identifier→filter map enables tag scanning without internet
- **Data Synced Indicator** — Visual badge in mobile header confirms when data is safe to go offline
- **Responsive Layout** — Sidebar collapses to hamburger menu on mobile/tablet screens
- **Error Popups** — Errors displayed as modal dialogs instead of background banners
- **One Identifier Per Entity** — Enforced at backend service layer

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Fastify (Node.js/TypeScript, port 3000) |
| Frontend | React + Vite SPA (TypeScript, Tailwind CSS, port 5175 dev) |
| Database | PostgreSQL 18 + Prisma ORM |
| Time-Series DB | TimescaleDB (extension on PG 18) |
| MQTT Broker | EMQX (ports 1883/18083) |
| Cache/Queue | Redis 5 + BullMQ |
| Process Manager | PM2 (production) |
| Reverse Proxy | Nginx (production) |

## Quick Start

```bash
# Clone and install
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DigitalFMS
npm install

# Build shared packages
npx nx build shared
npx nx build db
npx nx build queue

# Setup databases
createdb digilog_db
createdb digilog_tsdb
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npx prisma db seed --schema=apps/api/prisma/schema.prisma

# Development mode
cd apps/api && npx tsx watch src/app.ts   # Terminal 1: API on port 3000
cd apps/web && npx vite --host            # Terminal 2: Frontend on port 5175
```

### Windows Local Development

```bash
# Prerequisites: PostgreSQL 18, Redis 5, EMQX (optional)
# Start services:
C:\Users\hello\redis5\redis-server.exe
C:\Users\hello\emqx\bin\emqx.cmd

# Or use the batch scripts:
start-digilog.bat    # Start all services
stop-digilog.bat     # Stop all services
```

## Default Login

- **Username:** `superadmin`
- **Password:** `Admin@123`

## Key URLs

| Environment | App | API Docs (Swagger) | EMQX Dashboard |
|-------------|-----|-------------------|----------------|
| Production | http://34.232.224.0 | http://34.232.224.0/docs | http://34.232.224.0:18083 |
| Development | http://localhost:5175 | http://localhost:3000/docs | http://localhost:18083 |

## Project Structure

```
21cfrlogbook/
├── apps/
│   ├── api/          # Fastify backend (34 API modules)
│   │   ├── prisma/   # Schema (57 models), migrations, seed
│   │   └── src/      # Modules, plugins, lib, transport, workers
│   ├── web/          # React frontend (Vite SPA, 20+ route groups)
│   └── android/      # Capacitor Android app
├── packages/
│   ├── shared/       # Shared types, Zod schemas, constants
│   ├── db/           # Prisma singleton + TimescaleDB pg Pool
│   └── queue/        # BullMQ job queue definitions
├── docs/             # Project documentation
└── tests/            # Manual test cases & execution guides
```

## Database

### PostgreSQL (digilog_db — Prisma ORM)
57 Prisma models covering users, roles, sessions, entities, templates, relationships, identifiers, rule chains, alarms, audit trail, notifications, config, help articles, electronic signatures, filter cleaning profiles, filter profiles, cleaning cycles, filter events, PM schedules, checklist profiles, equipment groups, and more.

### TimescaleDB (digilog_tsdb)
7 hypertables: ts_telemetry, ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data, ts_pipeline_traces, ts_alarm_history.

### Key Enums (17)
RoleScope, DashboardScope, AssigneeType, UserStatus, NotificationType, NotificationChannel, NotificationDeliveryStatus, NotificationEventType, PmScheduleStatus, PmExecutionStatus, FilterSetLabel, PipelineFlowMode, PipelineNodeType, CleaningCycleStatus, FilterEventType, BlockRestriction, ChecklistQuestionType.

## Phase 2 Database (11 new tables)
`filter_cleaning_profiles`, `filter_pipeline_stages`, `filter_pipeline_connections`, `filter_profiles`, `cleaning_cycles`, `filter_events`, `pm_schedules`, `pm_schedule_entries`, `pm_executions`, `equipment_groups`, `equipment_group_instruments`, `checklist_profiles`, `checklist_questions`

## Phase 2 Key API Endpoints
```
POST /api/filters/:id/start-cycle    — Start cleaning cycle
POST /api/filters/:id/advance        — Advance to next stage
POST /api/filters/:id/submit-checklist — Submit checklist answers
POST /api/filters/:id/bypass         — Bypass stage (deviation)
GET  /api/filters/:id/current-state  — Get filter state + next actions
GET  /api/filter/cycles              — List cleaning cycles
GET  /api/filter/events              — List filter events
GET  /api/cleaning-profiles          — List cleaning profiles
GET  /api/filter-profiles            — List filter profiles
GET  /api/pm-schedules               — List PM schedules
GET  /api/checklist-profiles         — List checklist profiles
GET  /api/equipment-groups           — List equipment groups
```

## License

Proprietary — Pankaj Exa Technologies

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
