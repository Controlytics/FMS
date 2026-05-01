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
packages/shared/  — Permissions (109), privileges (91), reauth (81), sidebar items (26), zod schemas
packages/db/      — Prisma client + TimescaleDB pool + telemetry batcher
packages/queue/   — graphile-worker job queue (Postgres-backed)
docs/             — Project docs (current)
old/              — Archived superseded docs and tasks
future/           — Forward-looking design notes
```

## Local Dev Environment (Windows)
The app runs ONLY on local Windows for development. There is no live EC2 / Linux production environment to push to.

- Node.js 20+, PostgreSQL 18 + TimescaleDB, Mosquitto 2.0
- **No Redis dependency.** Phase 2 of windows-friendly-rewrite moved the job
  queue to graphile-worker on Postgres. Phase 4 (2026-05-01) retired Redis
  for pub/sub too — WebSocket events, RPC correlation, pipeline tracing, and
  debug recorder all run through an in-process EventEmitter bus
  (`apps/api/src/lib/internal-bus.ts`) and a Map-based TTL cache
  (`apps/api/src/lib/rpc-cache.ts`). `ioredis` is no longer in package.json.
- Mosquitto optional unless testing MQTT ingest. Install via `scripts/install-mosquitto.ps1`
  from an elevated PowerShell — registers a Windows service and rewrites the deployed
  conf with absolute paths + file logging (the SCM-managed broker has CWD=System32 and
  no stdout, so the dev-mode source conf would silently exit).
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
- Mosquitto: tcp://localhost:1883 (no web dashboard; dynsec configured via `POST /api/internal/mqtt/refresh-acl`)

### TLS notes
- **APK requires HTTPS** — `apps/web/.env.production` pins `VITE_API_URL=https://192.168.1.22:3000`; plain HTTP causes Capacitor TLS parse error on login. Tablet must trust `rootCA.pem` (Settings → Security → Install certificate).
- **Browser dev** — `http://localhost:5175 → https://localhost:3000` is fine (browser allows it; no mixed-content issue for fetch).
- **Verify TLS up** — `curl -sk -o /dev/null -w "%{http_code}" https://localhost:3000/health` should return a code (even 401 means TLS is up).
- **Don't use HTTPS with self-signed in Capacitor *dev* mode** — WebView's `fetch()` rejects self-signed certs (Capacitor's `BridgeActivity` overrides the WebViewClient after `onCreate`). Keep dev cleartext if testing in-WebView, or install root CA on the device.

## System Stats (current — 2026-04-30, verified against live code post-Step-1 + MT removal)
- **Backend:** 36 API modules under `apps/api/src/modules/`, 200+ endpoints
- **Database:** **67 Prisma models, 23 enums**; TimescaleDB with 7 hypertables. TemplateKind is a lookup table (admin-editable since Step 1); not an enum. `FilterProfileVersion` sidecar added Phase A.3.
- **Permissions:** **105** constants, **89** feature privileges, **81** reauth actions, **25** sidebar items
- **Rule chain:** 77 node types across 8 categories
- **Config:** **30 definitions** (`apps/api/src/modules/config/defs/*.def.ts`) + auto-discovery, **27** corresponding pages (template-kinds added in Step 1)
- **Themes:** 10 preset color themes (Ocean / Sapphire / Emerald / Amethyst / Sunset / Slate / Ruby / Forest / Midnight / Coral)
- **Frontend:** 22 route folders/files, ~83 pages, **14** custom hooks, **15** lib modules
- **Queue backend:** graphile-worker (Postgres-backed); 3 queues (ingestion, notification, maintenance)
- **Tenancy:** **single-tenant, single-site, single-company.** Multi-tenancy was removed 2026-04-30 (`Organization` model + `organizationId` columns + `org-admin`/`tenant-admin` modules dropped). JWT `scope` always stamps `GLOBAL`. The `RoleScope` enum and `AssigneeType` enum are retained but trimmed to one/two values respectively.

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
18 granular feature toggles introduced (Filters / Checklists / Cleaning Profiles / Equipment / PM) — total privileges grew to 91 over Phases 4 + 5; 10 color themes; configurable report header/footer/layout; dynamic bulk upload from template attributeSchema; reauth actions grew to 81 across 16 categories.

### Phase 5 — Reports, Offline Hardening, RFID SDK, Filter Data Console (Apr 15–29, 2026)
Reports module A–F complete (visual template designer + puppeteer-core/Edge / @napi-rs/canvas / Handlebars PDF engine + digital signatures — Phase 3 of windows-friendly-rewrite swapped from `puppeteer` + `chartjs-node-canvas` to eliminate the bundled Chromium download and the node-gyp/MSVC dependency), offline overhaul (TTL cache, idempotency keys, tombstones, LRU, JWT refresh, server-side `stageLookup`, Capacitor Network plugin + SW hook), RFID SDK plugin in DigiLog APK (`Reader_Usb.jar` via `RfidPlugin.java`), Filter Data Management console mirroring 10 user-facing pages, DRY_IN two-step flow with persisted countdown panel, dynamic backup/restore covering all 64 tables, bloat audit 12/14 resolved, EC2/PM2 production assets removed (local-Windows-only), decision-tape proposal for future client/server pipeline drift elimination. Full architectural detail in `PHASE_5_RECENT_WORK.md`.

**Phase 5 verification harness** (Apr 29–30, 2026) — closes the verification gap left by Phases 1–4:
- **5.1** — `tests/integration/windows-server-stack.test.ts` (gated by `INTEGRATION_TEST=1`): in-process aedes MQTT broker + Fastify boot + 100 telemetry publishes → `ts_telemetry`, graphile-worker enqueue → handler fires, puppeteer-core PDF render → `%PDF-` magic bytes (commits `a51628d` + reviewer-fix `24620c0`).
- **5.2** — `scripts/verify-windows-deployment.ps1`: operator-facing 4-check smoke (health endpoint, Mosquitto :1883, graphile-worker schema via psql, real PDF render via login → reports/generate). PS 5.1 + 7+ compatible (commits `b4ad539` + reviewer-fix `ad07280`).

## Key API Endpoints (filter operations)
```
POST /api/filters/:id/start-cycle       — Start cleaning cycle
POST /api/filters/:id/advance           — Advance to next stage
POST /api/filters/:id/submit-checklist  — Submit checklist answers
POST /api/filters/:id/bypass            — Bypass stage (deviation)
POST /api/filters/:id/terminate         — Terminate cycle (with reason)
GET  /api/filters/:id/current-state     — Filter state + next actions (full server snapshot)
GET  /api/filters/cycles                — List cleaning cycles (mounted by filter-operations/events-routes.ts under the /api/filters prefix)
GET  /api/filters/events                — List filter events
GET  /api/filter-cleaning-profiles                       — List cleaning profiles (latest version per lineage)
GET  /api/filter-cleaning-profiles/:id/versions          — Phase A.2: list lineage version history
GET  /api/filter-cleaning-profiles/:id/versions/:n       — Phase A.2: frozen snapshot at version n
GET  /api/filter-profiles/:id/versions                   — Phase A.3: list archived FilterProfile versions
GET  /api/filter-profiles/:id/versions/:n                — Phase A.3: frozen FilterProfile snapshot at version n
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


## Documentation Sync Rule

**Hard rule:** every numerical claim in any doc must be backed by a `grep`/`ls` against live code at the moment the doc is touched. Don't trust prior docs — verify.

**Active doc set** (kept current together):
- Root: `README`, `CLAUDE`, `AGENTS`, `CHANGELOG`, `PROJECT_SUMMARY`, `PROJECT_ARCHITECTURE`, `API_REFERENCE`, `BACKEND_GUIDE`, `FRONTEND_GUIDE`, `OFFLINE_SYNC_ARCHITECTURE`, `PHASE_5_RECENT_WORK`, `DEPLOY-WINDOWS`, `LOCAL_SETUP_WINDOWS`, `windowsIssues`
- Per-package: `apps/{api,web}/{CLAUDE,DECISIONS}.md`, `packages/shared/CLAUDE.md`
- Reference: `docs/`, `future/`, `tasks/todo.md`, `PROJECT_HANDOVER/`

**Per-change mapping:** see [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) "Change → Docs map" — read it before touching code that affects counts, modules, shared types, or any public surface. Same file holds the **12-touchpoint rule** for new config defs and the **pre-deletion rule** with receipts.

**Live-count verification (run before quoting any count):**

```bash
grep -cE "^model "                              apps/api/prisma/schema.prisma
grep -cE "^enum "                               apps/api/prisma/schema.prisma
grep -cE "^\s+[A-Z_]+:\s*'"                     packages/shared/src/types/permissions.ts
grep -cE "^\s+[A-Z_]+:"                         packages/shared/src/types/reauth-actions.ts
ls apps/api/src/modules/                        | wc -l
ls apps/api/src/modules/config/defs/*.def.ts    | wc -l
ls apps/web/src/routes/config/*.tsx             | wc -l
ls apps/web/src/hooks/ apps/web/src/lib/        | wc -l
grep -cE "<Route"                               apps/web/src/main.tsx
```

**Stale-stat sweep:** when changing any count, generate a regex from the *previous* numbers and grep across the active doc set; every match needs an update. Don't bake hardcoded numbers into the regex — derive them on the spot from the System Stats above.

**Always-update on any feature change:** `CHANGELOG.md`, `PHASE_5_RECENT_WORK.md` § 11 if closing an open gap, memory after corrections, `tasks/todo.md` audit-log entry for non-trivial doc work.

**Pre-deletion:** read each file's actual content for unique knowledge before deleting; when in doubt, restore. Receipts in `docs/CONTRIBUTING.md`.


## Defaults, not absolutes
If a rule below would produce a worse outcome in a specific case, say so 
and explain — don't silently comply with a rule that's misfiring.

## Never
- Don't swallow exceptions to silence errors.
- Don't hardcode values or comment out assertions to make tests pass.
- Don't invent APIs, function signatures, or config keys. If unsure, check or ask.
- Say "I don't know" when you don't know. Don't guess at fixes.
- Confirm before destructive actions (deleting files, dropping data, 
  rewriting git history).
- State assumptions explicitly in your response so I can correct them.
-while testing front end check for unlined Ui elements and consle logs that return unexpceted responses

## Correctness
- Find root causes. No temporary fixes, no swallowing symptoms.
- Before claiming a task is done: run tests if they exist, otherwise at 
  minimum execute the changed code. If you couldn't verify it, say so 
  explicitly — don't say "this should work."

## Multi-session work
- For tasks spanning multiple sessions or 5+ steps, maintain `tasks/todo.md` 
  with checkable items. Skip this for smaller tasks.
