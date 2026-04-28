# Codebase Summary

## What this product is

**DigiLog** (package name: `digilog`, also referred to as `21cfrlogbook`) is a multi-tenant IoT data-logging and digital-filter-management platform built to be **21 CFR Part 11 compliant**. It was originally a generic IoT logger (Phases 1–2) and has since grown a pharma-focused digital Filter Management System (FMS) with RFID, offline tablet operations, and PM (preventive maintenance) scheduling (Phases 3–4).

**Primary users:** pharmaceutical-plant engineers, QA, supervisors, and super-admins managing HVAC filters and AHUs with regulatory audit requirements.

## Monorepo layout

```
/ (repo root)
├── apps/
│   ├── api/              Fastify 5 + TypeScript backend (PM2 on EC2)
│   ├── web/              React 19 + Vite 6 SPA (Nginx on EC2)
│   └── android/          Capacitor 8 wrapper that packages the web app into an APK
├── packages/
│   ├── shared/           Zod schemas, role/permission/privilege constants, enums
│   ├── db/               Prisma client wrapper + TimescaleDB pg Pool + telemetry batcher
│   └── queue/            BullMQ queue definitions
├── rfid_scan_app/        Separate native Android app for KC-series UHF RFID readers
├── RFID/                 Alternate native RFID reader project (Gradle Kotlin DSL)
├── tests/                25 manual test cases + 25 execution guides + e2e shell scripts
├── tsdb-migration/       One-off SQL migration helpers for TimescaleDB
├── docs/                 In-repo documentation tree (administration, compliance, user-guide, etc.)
├── agents/               AI agent role definitions used during development
├── scripts/              Utility shell scripts
├── certs/                TLS cert pair used when `API_HTTPS=true`
├── deploy/               Nginx config + deployment shell scripts
├── init-tsdb.sql         Bootstraps TimescaleDB hypertables
├── docker-compose.yml    Postgres + Redis + EMQX + TimescaleDB for local dev
├── turbo.json            Turborepo pipeline
└── vitest.workspace.ts   Vitest workspace spanning apps/api and packages/shared
```

## Tech stack (verified against package.json files)

### Backend (`apps/api`, Node 22, `type: module`)
- **Framework:** Fastify 5 (`@fastify/cors`, `helmet`, `rate-limit`, `multipart`, `static`, `websocket`, `swagger`, `swagger-ui`)
- **Auth:** JWT via `jose`, bcrypt for passwords
- **DB:** Prisma 6 (PostgreSQL) + raw `pg` pool for TimescaleDB telemetry
- **Queue:** BullMQ on ioredis
- **Transport:** `mqtt` (EMQX), native WebSocket via `@fastify/websocket`
- **LDAP:** `ldapts`
- **Mail:** `nodemailer`
- **Docs / reports:** `handlebars`, `puppeteer`, `chart.js` + `chartjs-node-canvas`, `qrcode`, `xlsx`, `csv-parse`, `adm-zip`
- **Validation:** `zod` (shared with frontend via `@digilog/shared`)
- **Dev:** `tsx watch` for hot reload; `tsc -p` to compile before PM2 restart

### Frontend (`apps/web`, `type: module`)
- **Framework:** React 19 + Vite 6
- **Routing:** React Router 7 (70+ routes defined in `main.tsx`)
- **State/data:** SWR 2
- **Forms:** react-hook-form + `@hookform/resolvers` + zod
- **UI primitives:** hand-rolled under `components/ui/` — no off-the-shelf component library
- **Styling:** TailwindCSS 4 (`@tailwindcss/vite`)
- **Drag-and-drop:** `@dnd-kit/*` (used in rule-chain builder and dashboard layouts)
- **Graph editor:** `reactflow` 11 (rule-chain + cleaning-profile pipeline editor)
- **Charts:** `recharts`
- **Monaco code editor:** `@monaco-editor/react` (rule-chain script nodes)
- **Signatures:** `signature_pad` (21 CFR Part 11 e-sig)
- **QR:** `qrcode.react`
- **PWA:** `vite-plugin-pwa`

### Android wrapper (`apps/android`)
- Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli`)
- `appId: com.digilog.filtermanagement`
- `CapacitorHttp` plugin enabled (bypasses WebView fetch TLS issues on self-signed certs)
- Final build lives in root as `DigiLog-FilterOps.apk` (archived to `old/apks/`)

### Infrastructure (as documented in `DEPLOYMENT.md`, `DEPLOY-WINDOWS.md`, `docker-compose.yml`)
- **Platform targets:** EC2 (Ubuntu, PM2) production; Windows local dev using `start-digilog.bat`
- **Databases:** PostgreSQL 18 (app DB `digilog_db`), TimescaleDB (telemetry DB `digilog_tsdb`)
- **Broker:** EMQX 5 (MQTT 1883, dashboard 18083)
- **Cache/queue:** Redis/Memurai ≥5
- **Web server:** Nginx (serves built `apps/web/dist`, reverse-proxies `/api` to Fastify:3000)

## Major feature areas (verified by directory inspection)

### Core platform (Phases 1–2)
- Auth, users, roles, permissions (95 permission constants in `packages/shared/src/types/permissions.ts`)
- Feature privileges (18 granular toggles → `FEATURE_PRIVILEGES` + `FEATURE_TO_PERMISSION_MAP`)
- Audit trail with hash-chain integrity (`apps/api/src/lib/hash-chain.ts`)
- 21 CFR Part 11 e-signatures + reauth checks (`apps/api/src/lib/reauth-check.ts`)
- Config system: 24+ config definitions auto-discovered via `config-discovery.ts`
- Branding + theme system (10 preset themes, CSS variables)
- Multi-tenant super-admin
- LDAP integration

### IoT data platform (Phase 2)
- **Data ingestion:** HTTP + MQTT + binary + RPC (`apps/api/src/modules/data-ingestion/`)
- **Rule chain engine:** 77 node types across 8 categories — filters, transforms, alarms, delays, scripts (`apps/api/src/modules/rule-chain/`)
- **Queries:** telemetry, attributes, checklist responses, alarms, retention, export (`apps/api/src/modules/queries/`)
- **UNS tree:** Unified namespace with entity hierarchy and move/rename
- **Alarms:** severity, acknowledge, clear, configurable columns
- **Dashboards:** widget-based layouts with data adapters

### Digital Filter Management System (Phase 3/4)
- **Asset templates + instances:** dynamic attribute schemas with validation
- **Filter hierarchy:** Block → Area → AHU → Filter visual builder
- **Cleaning profiles:** pipeline-based workflow with stages, checklists, bypass logic
- **Filter operations:** start/advance/bypass/retire/replace cycle; state machine on server
- **PM schedules:** CSV upload template, approve/reject/resubmit, due tasks
- **Equipment groups, checklist profiles, filter profiles**
- **Reports module (complete as of 2026-04-15):** template designer, PDF engine with Puppeteer, signatures, rejections

### RFID + offline operations (Phase 3, in progress on current `RFID` branch)
- **Separate native Android scanner app** (`rfid_scan_app/`) for KC-series UHF readers
- **Keyboard-burst RFID guard** (`apps/web/src/hooks/use-rfid-guard.ts`) blocks UKB tag input leaking into non-RFID fields
- **Offline store** (IndexedDB) with operations queue + cached filters/templates/reasons/identifiers
- **Offline sync engine** with `executeOrQueue()` pattern and `x-offline-replay` header
- **"Data Synced" indicator** in mobile header
- **Pipeline enforcement offline** — cycles, bypass, checklist validation all replay server-side on reconnect

### Admin / governance
- **Admin requests flow:** create user / unlock / reset / modify requests with approver execution and audit
- **Block change requests:** cross-block approval with remarks mandatory
- **Dynamic backup/restore:** all 64 tables via `pg_tables` + `jsonb_populate_recordset`
- **Data management console** for super-admin to edit/delete records across tables
- **Hierarchy builder UI:** tree view with create/connect/edit/delete
- **Tablet access controls:** per-feature toggles

## Active branch & latest commit

- Current branch: `RFID`
- Main branch: `main`
- Last committed work (2026-04-20): offline pipeline enforcement, checklist-as-stage, APK rebuild, handover docs (commit `17b420b`)

See `overview/CURRENT_STATUS.md` for the running punch list.

## How to run it locally (short version)

1. Install prerequisites: Node 22, npm 11, PostgreSQL 18, TimescaleDB, Memurai (Redis 5+), EMQX, JDK 21 + Android SDK (only if building APK).
2. `npm install` at the repo root.
3. Copy `.env.example` → `.env`, adjust DB URLs and secrets.
4. `psql -f init-tsdb.sql` on the TimescaleDB DB.
5. `npm run db:migrate` then `npm run db:seed` (runs Prisma against `apps/api`).
6. Use `start-digilog.bat` (Windows) or run services individually:
   - API: `cd apps/api && npm run dev`
   - Web: `cd apps/web && npm run dev`
7. Login with `superadmin` / `Admin@123`.

Full detail: `LOCAL_SETUP_WINDOWS.md` at root.

## How to find things

- Looking for an HTTP endpoint → `future/overview/API_LIST.md` or `future/backend/API_ENDPOINTS.md`
- Looking for a frontend route → `apps/web/src/main.tsx`
- Looking for a permission → `packages/shared/src/types/permissions.ts`
- Looking for a sidebar item → `packages/shared/src/types/sidebar-items.ts`
- Looking for audit action names → `packages/shared/src/types/audit-actions.ts`
- Looking for DB schema → `apps/api/prisma/schema.prisma`
