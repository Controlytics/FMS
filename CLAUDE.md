# DigiLog — CLAUDE.md

## Project
DigiLog (21cfrlogbook) — IoT data logging platform with 21 CFR Part 11 compliance and an integrated Digital Filter Management System for pharmaceutical cleanrooms.

## Repository
- **Remote:** github.com/pankajexa/21cfrlogbook.git
- **Active branch:** `RFID` (feature work) → merges to `DigitalFMS` → `main`

## Monorepo Structure
```
apps/api/         — Fastify backend (TypeScript, port 3000)
apps/web/         — React SPA (Vite, port 5175 dev)
apps/android/     — Capacitor Android wrapper (DigiLog-FilterOps.apk)
rfid_scan_app/    — Native Kotlin RFID scanner (KC-series UHF readers)
packages/shared/  — Permissions (95), privileges (82), reauth (69), zod schemas
packages/db/      — Prisma client + TimescaleDB pool + telemetry batcher
packages/queue/   — BullMQ queues (5) + Redis connection
docs/             — Project docs (current)
old/              — Archived superseded docs and tasks
future/           — Forward-looking design notes
```

## Local Dev Environment (Windows)
The app runs ONLY on local Windows for development. There is no live EC2 / Linux production environment to push to.

- Node.js 20+, PostgreSQL 18 + TimescaleDB, Memurai (Redis ≥5), EMQX 5.x
- Memurai required (old Redis 3 crashes BullMQ); start: `C:\Users\hello\redis5\redis-server.exe`
- EMQX optional unless testing MQTT ingest: `C:\Users\hello\emqx\bin\emqx.cmd`
- Convenience: `start-digilog.bat` / `stop-digilog.bat`
- API runs via `tsx watch` in dev (no PM2 locally), Vite serves frontend
- See `LOCAL_SETUP_WINDOWS.md` and `DEPLOY-WINDOWS.md` for full details

## Build Commands
```bash
# Backend (dev — auto-reload)
cd apps/api && npx tsx watch src/app.ts

# Backend (prod-style local build)
npx tsc -p apps/api/tsconfig.json && node apps/api/dist/app.js

# Frontend (dev)
cd apps/web && npx vite --host

# Frontend (build)
cd apps/web && npx vite build

# Shared packages
npx nx build shared && npx nx build db && npx nx build queue

# APK
cd apps/android && npx cap copy android && cd android && ./gradlew assembleDebug
```

## Default Login
- **Username:** `superadmin`
- **Password:** `Admin@123` (forced change on first login)

## Key Local URLs
- App: http://localhost:5175 (Vite dev)
- API: https://localhost:3000 — `API_HTTPS=true` in `apps/api/.env` (mkcert certs at `certs/server.{key,crt}` rooted by `certs/rootCA.pem`)
- Swagger: https://localhost:3000/docs
- EMQX dashboard: http://localhost:18083

### TLS notes
- **APK requires HTTPS** — `apps/web/.env.production` pins `VITE_API_URL=https://192.168.1.22:3000`; plain HTTP causes Capacitor TLS parse error on login. Tablet must trust `rootCA.pem` (Settings → Security → Install certificate).
- **Browser dev** — `http://localhost:5175 → https://localhost:3000` is fine (browser allows it; no mixed-content issue for fetch).
- **Verify TLS up** — `curl -sk -o /dev/null -w "%{http_code}" https://localhost:3000/health` should return a code (even 401 means TLS is up).
- **Don't use HTTPS with self-signed in Capacitor *dev* mode** — WebView's `fetch()` rejects self-signed certs (Capacitor's `BridgeActivity` overrides the WebViewClient after `onCreate`). Keep dev cleartext if testing in-WebView, or install root CA on the device.

## System Stats (current — 2026-04-29, verified against live code)
- **Backend:** 37 API modules under `apps/api/src/modules/`, 200+ endpoints
- **Database:** **64 Prisma models, 22 enums**; TimescaleDB with 7 hypertables
- **Permissions:** **109** constants, **91** feature privileges, **81** reauth actions, **26** sidebar items
- **Rule chain:** 77 node types across 8 categories
- **Config:** **30 definitions** (`apps/api/src/modules/config/defs/*.def.ts`) + auto-discovery, **26** corresponding pages
- **Themes:** 10 preset color themes (Ocean / Sapphire / Emerald / Amethyst / Sunset / Slate / Ruby / Forest / Midnight / Coral)
- **Frontend:** 23 route folders/files, ~85 pages, **14** custom hooks, **15** lib modules
- **BullMQ queues:** 5 (ingestion, notification, export, reports, maintenance)

## Important Notes
- TimescaleDB is `digilog_tsdb`, NOT `digilog_db` (PG models live in `digilog_db`)
- Input sanitization strips HTML on all text fields (`apps/api/src/lib/sanitize.ts`)
- Capacitor APK uses **HTTPS** baked at build via `VITE_API_URL` (cert install required on tablet)
- Light theme only — `bg-white`, `bg-slate-50`, `border-slate-200`, gradient dialog headers OK
- SUPER_ADMIN bypasses frontend permission checks (`isSuperAdmin || perms.includes(...)`)
- Feature toggles need BOTH frontend visibility perm AND backend route perm in `FEATURE_TO_PERMISSION_MAP`
- New config defs must be imported in `config-discovery.ts` AND registered as a card in `config/index.tsx`
- Approval/decision flows require remarks; filter cleaning stage remarks stay optional
- Cycle `profile_id` is locked at start — reassigning a block's profile does NOT migrate in-progress cycles

## Phase Snapshots (history is in `CHANGELOG.md`)

### Phase 2 — Digital Filter Management
Cleaning profiles, filter operations (cycle start/advance/bypass/checklist), PM scheduling, equipment groups, checklist profiles, filter traceability.

### Phase 3 — RFID & Offline
RFID Scanner Android app (Reader_Usb.jar SDK), web RFID keyboard guard, offline IndexedDB queue + sync engine, cached identifier→filter map, "Data Synced" indicator, responsive collapsible sidebar.

### Phase 4 — Permissions, Themes, Reports
18 granular feature toggles (Filters / Checklists / Cleaning Profiles / Equipment / PM), 10 color themes, configurable report header/footer/layout, dynamic bulk upload from template attributeSchema, 69 reauth actions.

### Phase 5 — Reports, Offline Hardening, RFID SDK, Filter Data Console (Apr 15–29, 2026)
Reports module A–F complete (visual template designer + Puppeteer/chartjs/Handlebars PDF engine + digital signatures), offline overhaul (TTL cache, idempotency keys, tombstones, LRU, JWT refresh, server-side `stageLookup`, Capacitor Network plugin + SW hook), RFID SDK plugin in DigiLog APK (`Reader_Usb.jar` via `RfidPlugin.java`), Filter Data Management console mirroring 10 user-facing pages, DRY_IN two-step flow with persisted countdown panel, dynamic backup/restore covering all 64 tables, bloat audit 12/14 resolved, EC2/PM2 production assets removed (local-Windows-only), decision-tape proposal for future client/server pipeline drift elimination. Full architectural detail in `PHASE_5_RECENT_WORK.md`.

## Key API Endpoints (filter operations)
```
POST /api/filters/:id/start-cycle       — Start cleaning cycle
POST /api/filters/:id/advance           — Advance to next stage
POST /api/filters/:id/submit-checklist  — Submit checklist answers
POST /api/filters/:id/bypass            — Bypass stage (deviation)
POST /api/filters/:id/terminate         — Terminate cycle (with reason)
GET  /api/filters/:id/current-state     — Filter state + next actions (full server snapshot)
GET  /api/filter/cycles                 — List cleaning cycles
GET  /api/filter/events                 — List filter events
GET  /api/cleaning-profiles             — List cleaning profiles
GET  /api/checklist-profiles?expand=questions — Used for offline cache
GET  /api/config/report-settings/current — Report layout config
GET  /api/config/password-policy/current — Password policy (public endpoint)
```

## Pipeline Flow
- CHECKLIST nodes between STAGE nodes trigger automatic question dialogs
- Server-side enforcement: `advance()` blocks if pending checklist not completed
- Cycle auto-completes when last STAGE leads to END node
- Stage chain may include multiple consecutive CHECKLIST nodes — server uses `stageLookup` to resolve

---

## Workflow Orchestration

### 1. Plan Mode Default
Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately. Use plan mode for verification steps too. Write detailed specs upfront.

### 2. Subagent Strategy
Use subagents liberally to keep main context clean. Offload research, exploration, and parallel analysis. One task per subagent.

### 3. Self-Improvement Loop
After ANY correction from the user: update memory or `tasks/lessons.md` with the pattern. Ruthlessly iterate on these lessons.

### 4. Verification Before Done
Never mark a task complete without proving it works. Run tests, check logs, demonstrate correctness.

### 5. Demand Elegance (Balanced)
For non-trivial changes: pause and ask "is there a more elegant way?" If a fix feels hacky, refactor it. Skip for simple, obvious fixes.

### 6. Autonomous Bug Fixing
Just fix bugs when given. Point at logs, errors, failing tests — then resolve them.

## Task Management
- **Plan First** — Write plan to `tasks/todo.md` with checkable items
- **Verify Plan** — Check in before starting implementation
- **Track Progress** — Mark items complete as you go
- **Document Results** — Add review section when done
- **Capture Lessons** — Update memory after corrections

## Core Principles
- **Simplicity First** — Every change as simple as possible
- **No Laziness** — Find root causes; no temp fixes; senior-developer standards
- **Minimal Impact** — Touch only what's necessary; don't introduce regressions
