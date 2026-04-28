# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

DigiLog is an IoT data logging platform designed for regulated industries that need **21 CFR Part 11** compliance. It combines real-time data ingestion, a visual rule-chain engine, alarm management, electronic-signature checklists, and a full **Digital Filter Management System (FMS)** for pharmaceutical cleanroom HEPA filter lifecycle tracking.

The platform is monorepo-based (Turborepo) with a Fastify backend, a React/Vite SPA, a Capacitor Android wrapper for tablets, and a native Kotlin RFID scanner companion app.

---

## What's in this repo

| Path | Contents |
|---|---|
| `apps/api/` | Fastify 5 backend — 34 modules, 200+ endpoints |
| `apps/web/` | React 19 SPA — 22 route modules, ~85 pages, Tailwind CSS |
| `apps/android/` | Capacitor Android wrapper that ships the SPA as `DigiLog-FilterOps.apk` |
| `rfid_scan_app/` | Native Kotlin app for KC-series UHF RFID readers (USB) |
| `packages/shared/` | Permissions, privileges, reauth actions, Zod schemas |
| `packages/db/` | Prisma client + TimescaleDB pool + telemetry batcher |
| `packages/queue/` | BullMQ queue definitions |
| `docs/` | Active project documentation |
| `old/` | Archived superseded docs (kept for reference) |
| `future/` | Forward-looking design notes |
| `scripts/` | Windows PowerShell deployment scripts |
| `start-digilog.bat` / `stop-digilog.bat` | Local Windows service launchers |

For end-to-end details, start with `PROJECT_SUMMARY.md` (overview), `PROJECT_ARCHITECTURE.md` (system architecture), `BACKEND_GUIDE.md` (API), `FRONTEND_GUIDE.md` (web), and `OFFLINE_SYNC_ARCHITECTURE.md` (tablet/offline).

---

## Features

### Phase 1 — Core Platform
- **Entity management** — Hierarchical asset modeling, 12 relationship types, identifiers (QR / RFID / NFC / Barcode)
- **Rule chain engine** — Visual DAG editor with **77 node types** across 8 categories
- **Data ingestion** — MQTT (EMQX) + HTTP with rate limiting, IP allowlists, schema validation
- **Alarm system** — Threshold / rate-of-change / absence alarms with electronic-signature acknowledgment
- **Unified Namespace (UNS)** — ISA-95 hierarchical topic structure
- **Digital checklists** — 10+ field types, photo capture, 3-step approval workflow
- **Audit trail** — Tamper-evident SHA-256 hash-chain log with before/after snapshots
- **Notifications** — In-app + email (SMTP/OAuth2) + SMS (AWS SNS / Twilio) + Telegram + Slack
- **Backup/restore** — Full DB export covering all 64 tables (`pg_tables` + `jsonb_populate_recordset`), SHA-256 integrity verification
- **RBAC** — 6 hierarchical roles, **95 permissions**, **82 feature toggles**, **69 reauthentication actions**
- **Help articles** — 40+ versioned in-app docs across 8 categories
- **LDAP integration** — Active Directory / OpenLDAP with group→role mapping

### Phase 2 — Digital Filter Management System (FMS)
- **Filter operations** — Multi-stage cleaning lifecycle with QR/RFID scan
- **Cleaning profiles** — Visual pipeline editor (ReactFlow) with drag-and-drop nodes, CHECKLIST gates, BYPASS mode
- **Checklist profiles** — Reusable question templates wired into pipeline checklist nodes
- **Filter profiles** — Block restrictions, max-cycle limits, profile-to-filter assignment
- **Cleaning cycles** — Full audit trail with timestamps, performer, remarks, checklist answers
- **PM schedules** — Preventive maintenance per AHU with tolerance windows + QA approval
- **Equipment groups** — AHU dashboard, dual-set filter management (Set A / Set B)
- **Filter traceability** — Per-filter event log + cycle timeline + deviation tracking
- **Bulk upload** — Dynamic CSV columns generated from filter template `attributeSchema`
- **Retirement & replacement** — End-of-life tracking

### Phase 3 — RFID & Offline Operations
- **RFID Scanner Android app** for KC-series UHF readers via USB-C (`rfid_scan_app/`)
- **RFID SDK plugin** bundled into DigiLog APK (`Reader_Usb.jar` via `RfidPlugin.java`) — works in SDK and UKB modes
- **Web-side RFID guard** — global keyboard interceptor blocks tag bursts in non-`data-rfid` fields
- **Offline cleaning operations** — IndexedDB queue + sync engine, FIFO replay on reconnect
- **Cached master data** — filters, templates, cleaning reasons, identifier→filter map
- **"Data Synced" indicator** in mobile header
- **Responsive layout** — sidebar collapses to hamburger on `<lg` screens
- **Modal error popups** replacing inline banners

### Phase 4 — Permissions, Themes, Reports
- **18 granular feature toggles** — Filters (6), Checklists (4), Cleaning Profiles (4), Equipment (4), PM (4)
- **10 color themes** — CSS variables (`--theme-primary`, `--theme-gradient-from/to`)
- **Report template designer** — visual editor + PDF generation engine + digital signatures
- **Configurable report header/footer/layout** — `/config/report-settings`
- **Dynamic bulk upload** — CSV columns from template `attributeSchema`
- **69 reauthentication actions** across 16 categories
- **Block change request/approval** workflow with single-use consumption

### Phase 5 — April 15–29, 2026 (live on `RFID` branch)
Detailed in `PHASE_5_RECENT_WORK.md`:

- **Reports module — phases A–F complete** — visual template designer + PDF generation engine (Puppeteer + chartjs-node-canvas + Handlebars) + 5-source variable resolver + digital signatures
- **Offline hardening (14-issue overhaul)** — TTL cache, idempotency keys, tombstones, LRU eviction, JWT refresh on replay, server-side `stageLookup` walker for chained CHECKLIST nodes, Capacitor Network plugin + Service Worker hook
- **RFID SDK plugin baked into DigiLog APK** — `Reader_Usb.jar` via `RfidPlugin.java` — KC-series readers work in SDK and UKB modes
- **Filter Data Management console** — 10 tabs each mirroring its user-facing page (cycles, events, alarms, PM, audit, notifications, admin requests, block changes, etc.) with Edit modals
- **DRY_IN two-step flow** — SET_DURATION → SUBMIT_READINGS, "Currently Drying" countdown panel persisted across navigation/offline
- **Dynamic backup/restore** — covers all 64 tables via `pg_tables` + `jsonb_populate_recordset`, non-superuser compatible
- **Admin requests approval execution** — approvals now actually create/unlock/reset/modify users
- **Bloat audit follow-up** — 12/14 items resolved (SPIS submit-path parity, dependency cleanup, config monolith split, inline-style codemod, EC2 assets removed, lint rule for `as any`)
- **Decision-tape proposal** — future architecture to eliminate client/server pipeline drift (proposed, not yet implemented)

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Fastify 5 (Node.js / TypeScript, port 3000) |
| Frontend | React 19 + Vite 6 (TypeScript, Tailwind CSS 4, port 5175 dev) |
| Database | PostgreSQL 18 + Prisma ORM |
| Time-series DB | TimescaleDB extension on PG 18 |
| MQTT broker | EMQX (1883 / 18083) |
| Cache / queue | Memurai (Redis 7) + BullMQ |
| Mobile | Capacitor Android APK + native Kotlin RFID app |
| Reverse proxy | Nginx (production deployment) |

---

## Quick Start (Windows local dev)

**Prerequisites:** Node.js 20+, PostgreSQL 18 with TimescaleDB, Memurai (Redis ≥5), EMQX 5.x (optional unless testing MQTT).

```bash
# Clone
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
git checkout DigitalFMS
npm install

# Build shared packages
npx nx build shared && npx nx build db && npx nx build queue

# Initialize databases
createdb digilog_db
createdb digilog_tsdb
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npx prisma db seed --schema=apps/api/prisma/schema.prisma

# Start services (or use start-digilog.bat)
C:\Users\hello\redis5\redis-server.exe        # Memurai / Redis
C:\Users\hello\emqx\bin\emqx.cmd              # EMQX (optional)

# Run API and web in two terminals
cd apps/api && npx tsx watch src/app.ts       # API on :3000
cd apps/web && npx vite --host                # Web on :5175
```

See `LOCAL_SETUP_WINDOWS.md` for the full step-by-step setup, and `DEPLOY-WINDOWS.md` for production-style deployment paths.

---

## Default Login
- **Username:** `superadmin`
- **Password:** `Admin@123` (forced change on first login)

## Local URLs
| Service | URL |
|---|---|
| Web (Vite dev) | http://localhost:5175 |
| API | https://localhost:3000 |
| Swagger docs | https://localhost:3000/docs |
| EMQX dashboard | http://localhost:18083 |

---

## Database

### PostgreSQL (`digilog_db` — Prisma)
**63 models, 23 enums** covering users, roles, sessions, entities, templates, relationships, identifiers, rule chains, alarms, audit, notifications, configs, help articles, electronic signatures, filter cleaning profiles, filter profiles, cleaning cycles, filter events, PM schedules, checklist profiles, equipment groups, report templates, block-change requests, admin requests.

### TimescaleDB (`digilog_tsdb`)
**7 hypertables**: `ts_telemetry`, `ts_attributes`, `ts_checklist_responses`, `ts_device_events`, `ts_binary_data`, `ts_pipeline_traces`, `ts_alarm_history`.

---

## Documentation Map

| File | Purpose |
|---|---|
| `PROJECT_SUMMARY.md` | 30-second project overview |
| `PROJECT_ARCHITECTURE.md` | System architecture, request flow, data layers |
| `API_REFERENCE.md` | Full API surface (200+ endpoints) |
| `BACKEND_GUIDE.md` | Backend dev guide — module patterns, plugins, auth |
| `FRONTEND_GUIDE.md` | Frontend dev guide — routes, hooks, state |
| `OFFLINE_SYNC_ARCHITECTURE.md` | Tablet APK + offline IndexedDB queue + sync engine |
| `PHASE_5_RECENT_WORK.md` | Post-Phase-4 architecture changes (Apr 15–29) — reports, offline hardening, RFID SDK, decision tape |
| `CHANGELOG.md` | Full chronological history |
| `CLAUDE.md` | Instructions for AI coding assistants |
| `AGENTS.md` | Agent-mode instructions |
| `DEPLOY-WINDOWS.md` | Windows deployment options |
| `LOCAL_SETUP_WINDOWS.md` | Windows local dev setup |
| `docs/` | User guides, admin guides, compliance, deployment methods |
| `old/` | Archived superseded docs (read-only history) |

---

## License
Proprietary — Pankaj Exa Technologies
