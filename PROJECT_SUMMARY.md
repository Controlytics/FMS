# DigiLog — Project Summary

## What is DigiLog?

DigiLog is an IoT data logging platform with **21 CFR Part 11 compliance** designed for industrial filter management in pharmaceutical and manufacturing facilities. It tracks filter cleaning cycles, preventive maintenance, equipment status, and provides complete audit trails with electronic signatures.

## Business Purpose

Pharmaceutical factories use air handling units (AHUs) with filters that must be cleaned on a strict schedule. Every cleaning cycle, stage transition, and checklist completion must be recorded with tamper-proof audit trails to comply with FDA regulations (21 CFR Part 11). DigiLog digitizes this entire process — replacing paper logbooks with a validated electronic system.

## Technology Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | React 19 + TypeScript | Vite SPA, Tailwind CSS, SWR, ReactFlow |
| **Backend** | Node.js + Fastify 5 | TypeScript, 37 API modules, 200+ endpoints |
| **Primary DB** | PostgreSQL 18 | 64 Prisma models, 22 enums |
| **Time-Series DB** | TimescaleDB | 7 hypertables for telemetry data |
| **Job Queue** | graphile-worker on PostgreSQL | LISTEN/NOTIFY + SKIP LOCKED + advisory locks; no separate Redis service |
| **Pub/sub (optional)** | Redis 7 / Memurai | WebSocket events, RPC routing, pipeline tracer, debug recorder |
| **MQTT Broker** | Mosquitto 2.0 | Windows-native service via `scripts/install-mosquitto.ps1` (Phase 1 of windows-friendly-rewrite swapped from EMQX) |
| **PDF + charts** | puppeteer-core + Edge + @napi-rs/canvas | No bundled Chromium, no node-gyp / MSVC (Phase 3 of windows-friendly-rewrite) |
| **Mobile** | Capacitor (Android APK) | Wraps web app for tablet use |
| **RFID** | Kotlin Android app | KC-series UHF reader integration |

## Monorepo Structure

```
21cfrlogbook-DigitalFMS/
├── apps/
│   ├── api/            — Fastify backend (37 modules, TypeScript)
│   ├── web/            — React SPA (22 route modules, Vite + Tailwind)
│   └── android/        — Capacitor wrapper for Android APK
├── packages/
│   ├── shared/         — Zod schemas, permissions, types (109 permissions, 91 privileges, 81 reauth actions, 26 sidebar items)
│   ├── db/             — Prisma client, TimescaleDB pool, telemetry batcher
│   └── queue/          — BullMQ job queues (5 queues) + Redis connection
├── rfid_scan_app/      — Native Kotlin Android RFID scanner
├── deploy/             — Nginx config, Linux setup scripts
├── scripts/            — Windows PowerShell deployment scripts
├── certs/              — SSL certificates (server.crt, server.key, rootCA.pem)
└── docs/               — Full documentation site
```

## Key Features

### Phase 1: Core Platform
- Multi-tenant organization management
- Role-based access control (RBAC) with 109 permissions
- JWT authentication with session management
- Asset template and instance management (hierarchical)
- Rule chain engine (77 node types across 8 categories)
- Data ingestion pipeline (MQTT + HTTP)
- Real-time alarms and notifications (email, SMS, Telegram, Slack)
- Audit trail with SHA-256 hash-chain integrity
- QR code generation for entities
- Help article system with versioning
- Backup/restore with integrity verification
- System health monitoring

### Phase 2: Digital Filter Management
- Visual cleaning profile pipeline editor (ReactFlow)
- Filter cleaning cycle management (start, advance, bypass, complete)
- Server-side checklist enforcement between pipeline stages
- Preventive maintenance (PM) scheduling with monthly entries
- Equipment group management (AHU dashboard)
- Cleaning cycle history and timeline views
- Filter traceability with full event log
- Immutable events with SHA-256 checksums (21 CFR Part 11)

### Phase 3: RFID & Offline Operations
- Native Kotlin RFID scanner app for KC-series UHF readers
- Web-side RFID keyboard guard (blocks tag input in non-RFID fields)
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier-to-filter map for offline RFID lookup
- Responsive layout with collapsible sidebar
- Mobile-optimized operations page
- Capacitor Android APK for tablets

### Phase 4: Permissions, Themes & Reports
- 18 granular feature toggles (Filters, Checklists, Cleaning Profiles, Equipment, PM pages)
- 10 configurable color themes (Ocean, Sapphire, Emerald, etc.)
- Report template designer with visual editor
- PDF report generation with digital signatures
- Report settings configuration (header, footer, layout)
- Dynamic bulk upload (CSV columns from template attributeSchema)
- 69 re-authentication actions across 16 categories
- Block change request/approval workflow

## Database Statistics

| Metric | Count |
|---|---|
| Prisma models | 64 |
| Database enums | 22 |
| Permission constants | 109 |
| Feature privileges | 91 |
| Re-auth actions | 81 |
| Sidebar items | 26 |
| API modules | 37 |
| API endpoints | 200+ |
| Rule chain node types | 77 |
| Config definitions | 30 |
| Config pages | 26 |
| Frontend routes | 85+ |
| Custom React hooks | 14 |
| Frontend lib modules | 15 |
| BullMQ job queues | 5 |

## Security & Compliance

### 21 CFR Part 11 Compliance
- **Electronic signatures**: Password re-authentication for sensitive operations
- **Audit trail**: Every mutation logged with SHA-256 hash-chain verification
- **Immutable records**: Filter events stored with checksums, cannot be modified
- **Access control**: Role-based permissions with 95 granular controls
- **Session management**: Auto-logout on inactivity, single-tab enforcement
- **Password policies**: Configurable complexity, expiry, and history requirements

### Security Features
- JWT tokens with 8-hour expiry and 30-minute refresh
- Input sanitization (HTML stripping on all text fields)
- CORS configuration with explicit allowed origins
- Rate limiting (500 requests/minute global)
- Device token authentication for IoT endpoints
- HTTPS everywhere (API, web, tablet connections)

## Deployment

### Production Deployment (Windows Server)
- Self-contained ZIP package via `scripts/package-for-production.ps1`
- PowerShell-based automated installation via `scripts/install-on-target.ps1`
- NSSM for Windows Service registration (the API runs as a Windows service)
- Optional Nginx reverse proxy for SPA + API
- Firewall rules auto-configured

### Prerequisites
- Node.js 20+, PostgreSQL 18 + TimescaleDB, Mosquitto 2.0, Nginx (Memurai/Redis optional — non-queue pub/sub only)

### Default Login
- Username: `superadmin`
- Password: `Admin@123` (must change on first login)

## Team & Development

- **Repository**: github.com/pankajexa/21cfrlogbook.git
- **Active Branch**: RFID (development), main (stable)
- **Build System**: Turborepo monorepo with Vite (frontend) + tsc (backend)
- **Testing**: Vitest unit tests, manual E2E test cases (25 test suites)
- **Code Reviews**: 3 full audits completed, 114 issues resolved
