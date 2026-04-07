# DigiLog — Complete Project Summary

**Project:** DigiLog (21cfrlogbook) — 21 CFR Part 11 Compliant IoT Data Logging Platform with Digital Filter Management System
**Repository:** github.com/pankajexa/21cfrlogbook.git
**Branch:** DigitalFMS (active development)
**Date:** 2026-04-04

---

## Platform Overview

DigiLog is an enterprise IoT data logging and filter management platform built for pharmaceutical and regulated manufacturing environments. It provides real-time data ingestion from sensors and devices, a visual rule engine for automated processing, and a complete Digital Filter Management System for HVAC filter lifecycle tracking — all compliant with 21 CFR Part 11.

---

## Scale At a Glance

| Metric | Count |
|--------|-------|
| **Backend Modules** | 34 |
| **API Endpoints** | ~169 |
| **Frontend Pages** | 69 |
| **React Router Routes** | 70 |
| **Prisma Models** | 59 |
| **Prisma Enums** | 18 |
| **Config Definitions** | 27 |
| **Rule Chain Node Types** | 79 (8 categories) |
| **Ingestion Pipeline Stages** | 11 |
| **Permissions** | 52+ |
| **Test Files** | 74 |
| **Notification Channels** | 4 (Email, SMS, Telegram, Slack) |
| **Help Articles** | 40+ (versioned) |

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Backend** | Fastify + TypeScript | 5.2 / 5.7 |
| **Frontend** | React + Vite + Tailwind CSS | 19 / 6.1 / 4.0 |
| **Database** | PostgreSQL + Prisma ORM | 18 / 6.3 |
| **Time-Series** | TimescaleDB (via pg pool) | — |
| **Queue** | BullMQ + Redis | 5.70 / 5 |
| **MQTT** | EMQX Broker | 5.x |
| **Router** | React Router | 7.1 |
| **Data Fetching** | SWR | 2.3 |
| **Visual Editor** | ReactFlow | 11.11 |
| **Forms** | React Hook Form + Zod | 7.54 / 3.24 |
| **Process Manager** | PM2 (production) | — |
| **Web Server** | Nginx (production) | — |

---

## Monorepo Structure

```
21cfrlogbook-DigitalFMS/
├── apps/
│   ├── api/                    Fastify backend (port 3000)
│   │   ├── src/
│   │   │   ├── modules/        34 API modules
│   │   │   ├── lib/            25 utility files
│   │   │   ├── plugins/        3 core plugins (auth, rbac, audit-logger)
│   │   │   └── app.ts          Entry point
│   │   └── prisma/
│   │       ├── schema.prisma   59 models, 18 enums
│   │       └── seed.ts         Default data seeder
│   └── web/                    React SPA (port 5175 dev, Nginx prod)
│       └── src/
│           ├── routes/         69 page files across 19 directories
│           ├── components/     20 UI components
│           ├── hooks/          12 custom hooks
│           ├── lib/            8 utility files
│           └── types/          1 type file
├── packages/
│   ├── shared/                 Shared types, permissions, schemas
│   ├── db/                     TimescaleDB connection + telemetry batcher
│   └── queue/                  BullMQ/Redis connection
├── PROJECT_SUMMARY/            This folder
├── PROJECT_HANDOVER/           17 handover documents
├── docs/                       50+ documentation files
├── documentation/              33 testing & validation documents
├── tests/                      51 manual test cases + execution guides
├── tasks/                      Code review reports
└── start-digilog.bat           Windows startup script
```

---

## Deployment

### EC2 Production
- **IP:** 34.232.224.0 (may change on restart)
- **SSH:** `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0`
- **Services:** Nginx (80/443), Fastify (3000), PostgreSQL (5432), EMQX (1883/18083), Redis (6379)
- **Build:** `npx tsc -p apps/api/tsconfig.json && pm2 restart digilog-api`
- **Frontend:** `cd apps/web && npx vite build` (output to dist/, served by Nginx)

### Windows Local Development
- **Redis 5:** `C:\Users\hello\redis5\redis-server.exe`
- **EMQX:** `C:\Users\hello\emqx\bin\emqx.cmd`
- **PostgreSQL 18:** Auto-starts as service
- **API:** `cd apps/api && npx tsx watch src/app.ts` (port 3000)
- **Frontend:** `cd apps/web && npx vite --host` (port 5175)
- **Start:** `start-digilog.bat` | Stop: `stop-digilog.bat`

### Default Login
- **Username:** superadmin
- **Password:** Admin@123

### Key URLs
| Service | Dev | Prod |
|---------|-----|------|
| Frontend | http://localhost:5175 | http://34.232.224.0 |
| API | http://localhost:3000 | http://34.232.224.0/api |
| Swagger | http://localhost:3000/docs | http://34.232.224.0/docs |
| EMQX | http://localhost:18083 | http://34.232.224.0:18083 |

---

## Feature Summary

### Phase 1 — Core Platform
- **Authentication:** JWT with 30-min refresh, session management, single-tab enforcement, LDAP
- **Users & Roles:** RBAC with 52+ permissions, hierarchical roles, org-scoped access
- **Asset Management:** Templates (versioned), instances (hierarchy), relationships, identifiers (QR/barcode/RFID/NFC)
- **Data Ingestion:** 11-stage pipeline, MQTT/HTTP/WS transport, rate limiting, DLQ
- **Rule Engine:** 79 node types, 8 categories, visual editor (ReactFlow)
- **Telemetry:** TimescaleDB hypertables, real-time display, CSV/Excel export
- **Alarms:** Rule-based triggers, acknowledge/clear workflow, role-based column visibility
- **Notifications:** 4 channels (email, SMS, Telegram, Slack), rule-based dispatch
- **Audit Trail:** SHA-256 hash-chained, immutable, 21 CFR Part 11 compliant
- **Configuration:** 27 auto-discovered config definitions
- **UNS:** Unified Namespace tree with MQTT topic mapping
- **Connectivity:** Device status tracking, code snippets, QR codes
- **Help:** 40+ versioned articles
- **Backup/Restore:** Full database export/import

### Phase 2 — Digital Filter Management System
- **Cleaning Profiles:** Visual pipeline editor with stages (WASH_IN/OUT, DRY_IN/OUT, STORAGE_IN/OUT), checklist nodes, graph validation
- **Filter Profiles:** Link filters to cleaning profiles with org scoping
- **Filter Operations:** Cycle start/advance/bypass/checklist submission with server-side enforcement
- **PM Schedules:** Preventive maintenance with monthly entries, tolerance windows, execution tracking
- **Checklist Profiles:** Typed questions (TEXT, BOOLEAN, NUMBER, SELECT, MULTI_SELECT), mandatory completion gates
- **Equipment Groups:** AHU instrument tracking, equipment-to-filter mapping
- **Filter Events:** Immutable event log with SHA-256 checksums
- **Cleaning Cycle History:** Full cycle tracking with stage timestamps, operator IDs, instrument readings
- **Filter Traceability:** Per-filter event timeline with all state transitions
- **Retirement/Replacement:** Lifecycle end workflow with automatic replacement creation
- **Bulk Upload:** CSV import for filter creation
- **AHU Dashboard:** Equipment group overview with filter status

### Phase 3 — Enhancements
- **Unified Light Theme:** Consistent across all pages
- **Mobile PWA:** Installable app for tablet/phone operations
- **Android APK:** Capacitor build for Android tablets
- **Bulk Operations:** CSV filter upload, bulk user management
- **Code Quality Audit:** 114 issues found, all fixed (10/10 score)

---

## Security & Compliance

### 21 CFR Part 11 Controls
| Control | Implementation |
|---------|---------------|
| Electronic signatures | Electronic signature model with meaning |
| Audit trail | SHA-256 hash-chained, immutable records |
| Access control | RBAC with 52+ permissions, org isolation |
| Session management | JWT + session table, idle timeout, single-tab |
| Password policy | Configurable complexity, history, expiry, lockout |
| Re-authentication | Password required for sensitive operations |
| Data integrity | Checksums on filter events, deterministic JSON |
| Input validation | Zod schemas + recursive HTML sanitization |

### Security Features
- bcrypt password hashing (12 rounds)
- Account lockout after configurable failed attempts
- Rate limiting on login + data ingestion
- Path traversal protection on file serving
- Mass assignment prevention (explicit field destructuring)
- Multi-tenant org isolation via shared `orgScope()` utility
- LDAP integration for enterprise authentication
- Production credential guards (env var required)
- Error response stripping in production (no permission leaks)

---

## Code Quality

### Code Review (2026-04-04)
- **114 issues found** across security, logic, frontend, infrastructure
- **All 114 fixed** in 3 rounds
- **0 TypeScript errors** (backend + frontend)
- **Quality score: 6.2 → 10/10**

### Test Coverage
- 74 test files (unit + e2e)
- Manual test cases: 25 scenarios + 25 execution guides
- Testing validation: 21 CFR Part 11 verification document

---

## Documentation

| Folder | Files | Content |
|--------|-------|---------|
| PROJECT_SUMMARY/ | 4 | Backend, frontend, API, project summaries |
| PROJECT_HANDOVER/ | 17 | Complete handover documentation |
| docs/ | 50+ | API reference, user guides, admin guides, phases |
| documentation/ | 33 | Testing reports, validation, compliance |
| tests/ | 51 | Manual test cases + execution guides |
| tasks/ | 4 | Code review + resolution reports |

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
