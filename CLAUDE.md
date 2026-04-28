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
18 granular feature toggles introduced (Filters / Checklists / Cleaning Profiles / Equipment / PM) — total privileges grew to 91 over Phases 4 + 5; 10 color themes; configurable report header/footer/layout; dynamic bulk upload from template attributeSchema; reauth actions grew to 81 across 16 categories.

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


## Documentation Sync Rule (MANDATORY — read before any code change)

**Whenever you change code, you MUST update every doc listed for that change-type below in the SAME commit.** This rule exists because we drifted across 9 audit passes — see `tasks/todo.md` for the receipts.

**Hard rule:** every numerical claim (model count, permission count, route count, etc.) in any doc must be backed by a `grep`/`ls` run against live code at the moment the doc is touched. Don't trust prior docs — verify.

### Active doc set (these 14 + their per-app/per-package companions are kept current)

Root: `README.md`, `CLAUDE.md`, `AGENTS.md`, `CHANGELOG.md`, `PROJECT_SUMMARY.md`, `PROJECT_ARCHITECTURE.md`, `API_REFERENCE.md`, `BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, `OFFLINE_SYNC_ARCHITECTURE.md`, `PHASE_5_RECENT_WORK.md`, `DEPLOY-WINDOWS.md`, `LOCAL_SETUP_WINDOWS.md`, `PROJECT_HANDOVER/APPLICATION_FLOW.md`

Per-app: `apps/api/CLAUDE.md`, `apps/api/DECISIONS.md`, `apps/web/CLAUDE.md`, `apps/web/DECISIONS.md`, `packages/shared/CLAUDE.md`

Site: `docs/index.md` (TOC), `docs/getting-started/`, `docs/compliance/`, `docs/deployment-methods/`, `docs/administration/`, `docs/user-guide/`

Onboarding pack: `future/README.md`, `future/overview/{CODEBASE_SUMMARY,CURRENT_STATUS,API_LIST}.md`, `future/backend/{README,MODULES,API_ENDPOINTS,ENV_SETUP}.md`, `future/frontend/{README,KEY_FILES,PATTERNS}.md`, `future/qa/{README,FEATURE_CHECKLIST,ACCEPTANCE_CRITERIA,KNOWN_ISSUES}.md`, `future/testing/{README,MANUAL_TEST_GUIDE,TEST_INVENTORY}.md`

Audit trail: `tasks/todo.md`

### Change → Docs map

| Code change | Docs to update |
|---|---|
| **New backend module** in `apps/api/src/modules/<name>/` | `BACKEND_GUIDE.md` (modules table + count), `PROJECT_ARCHITECTURE.md` (37-module list), `future/backend/MODULES.md`, `future/backend/API_ENDPOINTS.md`, `future/overview/API_LIST.md`, `future/overview/CODEBASE_SUMMARY.md`, `CLAUDE.md` System Stats |
| **New endpoint in existing module** | `BACKEND_GUIDE.md` endpoint count, `future/backend/MODULES.md`, `future/backend/API_ENDPOINTS.md`, `future/overview/API_LIST.md` |
| **New backend `lib/` helper** | `BACKEND_GUIDE.md` libs table, `future/backend/README.md` libs table, `PROJECT_ARCHITECTURE.md` apps/api map |
| **New plugin / transport / worker** | `BACKEND_GUIDE.md` corresponding table, `future/backend/README.md` corresponding section, `PROJECT_ARCHITECTURE.md` |
| **New `config/static-routes/<surface>.routes.ts`** | `BACKEND_GUIDE.md` static-routes list, `PHASE_5_RECENT_WORK.md` § 9 |
| **`PUBLIC_GET_PATHS` change** in `plugins/auth.ts` | `BACKEND_GUIDE.md`, `future/backend/README.md` "Public paths" |
| **New `requireAnyPermission` / `enforceReauth` usage** | `BACKEND_GUIDE.md` rbac plugin entry, `future/backend/README.md` rbac entry |
| **New Prisma model** | Update model count in: `README.md`, `PROJECT_SUMMARY.md` (2 places), `PROJECT_ARCHITECTURE.md` (3 places: tree + ASCII + security diagram), `BACKEND_GUIDE.md`, `apps/api/CLAUDE.md`, `CLAUDE.md` System Stats, `docs/index.md`, `future/overview/CODEBASE_SUMMARY.md` |
| **New Prisma enum** | Same set as model |
| **New migration in `apps/api/prisma/migrations/`** | `PROJECT_ARCHITECTURE.md` migrations table |
| **`apps/api/prisma/sql/extensions.sql` change** | `PROJECT_ARCHITECTURE.md` migrations table |
| **New `<Route>` in `main.tsx`** | `FRONTEND_GUIDE.md`, `PROJECT_SUMMARY.md` route count, `future/frontend/README.md` directory map (`81 <Route>` count), `future/frontend/KEY_FILES.md` if non-obvious |
| **New hook in `apps/web/src/hooks/`** | `FRONTEND_GUIDE.md` Hooks tables, `future/frontend/README.md`, `future/frontend/KEY_FILES.md`, `CLAUDE.md` System Stats |
| **New lib helper in `apps/web/src/lib/`** | `FRONTEND_GUIDE.md` libs table (15), `future/frontend/README.md`, `future/frontend/KEY_FILES.md` |
| **New component in `apps/web/src/components/`** | `FRONTEND_GUIDE.md` Components tables, `future/frontend/README.md` directory map |
| **New mobile route** in `routes/mobile/` | `FRONTEND_GUIDE.md` Mobile section, `future/frontend/README.md`, `future/frontend/KEY_FILES.md` |
| **Folder rename in `routes/`** | `FRONTEND_GUIDE.md`, `future/frontend/README.md`, `future/frontend/KEY_FILES.md`, `future/frontend/PATTERNS.md` |
| **New PWA asset in `apps/web/public/`** | `PROJECT_ARCHITECTURE.md` "Frontend public assets" |
| **New theme preset in `lib/themes.ts`** | `README.md` themes line, `CLAUDE.md` System Stats, `FRONTEND_GUIDE.md` theming, `future/frontend/README.md` Theme model |
| **New config def** in `apps/api/src/modules/config/defs/` | All count claims (30): `CLAUDE.md`, `README.md`, `PROJECT_SUMMARY.md`, `BACKEND_GUIDE.md` (multiple places), `apps/api/CLAUDE.md`, `docs/index.md`, `future/overview/CODEBASE_SUMMARY.md`. **PLUS** the **12-touchpoint rule** (memory `feedback_config_sync.md`): `config-discovery.ts` import, `config/index.tsx` card, both sidebar files, permissions, privileges, reauth, seed, auth plugin, shared rebuild |
| **New config page** in `routes/config/` | `FRONTEND_GUIDE.md` config-pages table (26), `future/frontend/README.md`, `apps/web/CLAUDE.md` count |
| **New permission** in `permissions.ts` | `README.md`, `CLAUDE.md` System Stats, `PROJECT_SUMMARY.md` (2 places), `PROJECT_ARCHITECTURE.md` (3 places), `docs/index.md`, `future/overview/CODEBASE_SUMMARY.md`, `future/overview/CURRENT_STATUS.md`, `future/qa/FEATURE_CHECKLIST.md`, `future/qa/ACCEPTANCE_CRITERIA.md`, `packages/shared/CLAUDE.md` |
| **New feature privilege** | Same set as permission. Plus: must include BOTH frontend visibility perm AND backend route perm in `FEATURE_TO_PERMISSION_MAP` |
| **New reauth action** | All files that mention `81 reauth actions` |
| **New sidebar item** | `packages/shared/CLAUDE.md` (26), `future/qa/FEATURE_CHECKLIST.md`, `FRONTEND_GUIDE.md` Sidebar component count |
| **New audit-template / audit-action / alarm-column** | `packages/shared/CLAUDE.md` types inventory |
| **New rule-chain node** in `nodes/<category>.ts` | `BACKEND_GUIDE.md` Rule Chain table (77 count), `future/overview/CODEBASE_SUMMARY.md`, `README.md`, `CLAUDE.md`, `PROJECT_ARCHITECTURE.md`, `PROJECT_SUMMARY.md` |
| **New data-ingestion file** | `BACKEND_GUIDE.md` Data Ingestion table |
| **New `queries/*.routes.ts`** sibling | `BACKEND_GUIDE.md` Queries table, `future/backend/MODULES.md` |
| **New `assets/{routes,services,repositories}/` file** | `BACKEND_GUIDE.md` Assets module structure, `future/backend/MODULES.md` |
| **New native Java plugin** in `apps/android/.../java/` | `PROJECT_ARCHITECTURE.md` Android tree, `OFFLINE_SYNC_ARCHITECTURE.md` if it touches sync, `PHASE_5_RECENT_WORK.md` § 3 |
| **`Reader_Usb.jar` SDK update** | `PROJECT_ARCHITECTURE.md`, `PHASE_5_RECENT_WORK.md`, `README.md` Phase 3/5 RFID line |
| **Capacitor plugin add** in `apps/android/package.json` | `future/overview/CODEBASE_SUMMARY.md` Android section, `OFFLINE_SYNC_ARCHITECTURE.md` if it changes connectivity |
| **Change to `offline-store`, `sync-engine`, `offline-sync-service`, `connectivity.ts`, `idempotency.ts`** | `OFFLINE_SYNC_ARCHITECTURE.md` (architecture doc), `future/frontend/README.md` Offline section, `FRONTEND_GUIDE.md` libs, `PHASE_5_RECENT_WORK.md` § 2 + § 9 |
| **New `x-*` header convention** | `OFFLINE_SYNC_ARCHITECTURE.md`, `future/backend/API_ENDPOINTS.md` "Header conventions" |
| **New e2e test** in `apps/api/src/e2e/` | `BACKEND_GUIDE.md` E2E table, `future/testing/README.md` (15-suite list), `future/testing/TEST_INVENTORY.md` |
| **New unit/schema test** | `future/testing/README.md`, `future/testing/TEST_INVENTORY.md` |
| **New manual golden path** | `future/testing/MANUAL_TEST_GUIDE.md` |
| **New PowerShell script in `scripts/`** | `PROJECT_ARCHITECTURE.md` Repo-level Infrastructure, `DEPLOY-WINDOWS.md`, `PHASE_5_RECENT_WORK.md` § 9 |
| **TLS/cert change in `certs/`** | `CLAUDE.md` TLS notes, `PROJECT_ARCHITECTURE.md`, memory `reference_apk_tls_setup` |
| **New env var in `.env.example`** | `BACKEND_GUIDE.md` Environment Variables, `LOCAL_SETUP_WINDOWS.md`, `future/backend/ENV_SETUP.md` |
| **`tsdb-migration/init-hypertables.sql`** change | `PROJECT_ARCHITECTURE.md`, `LOCAL_SETUP_WINDOWS.md` |
| **`turbo.json` / `vitest.workspace.ts` / per-workspace `vitest.config.ts`** change | `PROJECT_ARCHITECTURE.md` Build/test infra, `future/testing/README.md` |
| **`.github/workflows/ci.yml`** change | `PROJECT_ARCHITECTURE.md` CI section, `future/testing/README.md` |

### Always-update (any feature change)

- **`CHANGELOG.md`** — every user-visible feature / fix / breaking change. Append-only.
- **`tasks/todo.md`** — non-trivial doc changes get an audit-log entry per the existing 9-pass pattern.
- **`PHASE_5_RECENT_WORK.md` § 11** — if you close one of the listed gaps (monster-file split, Phase 2-5 tests, multi-batch checklist, decision tape).
- **Memory** under `~/.claude/projects/.../memory/` — per the self-improvement loop, capture lessons after corrections.

### Verification commands (run BEFORE committing any doc change)

```bash
# 1. Stale-stat sweep — should return ZERO matches
grep -nE "(95 perm|82 (privi|feat)|69 reauth|57 model|17 enum|63 model|34 modules|34 API mod|24 config)" \
  README.md CLAUDE.md PROJECT_SUMMARY.md PROJECT_ARCHITECTURE.md BACKEND_GUIDE.md \
  FRONTEND_GUIDE.md PHASE_5_RECENT_WORK.md docs/index.md future/*.md future/*/*.md \
  apps/api/CLAUDE.md apps/web/CLAUDE.md packages/shared/CLAUDE.md

# 2. EC2/PM2 lingering-reference sweep — should return ZERO matches
#    (CHANGELOG.md historical entries are the only allowed exception)
grep -nE "(PM2 (in production|process|on EC2)|/home/ubuntu|34\.232\.224|EC2 (production|instance))" \
  README.md CLAUDE.md PROJECT_SUMMARY.md PROJECT_ARCHITECTURE.md BACKEND_GUIDE.md \
  FRONTEND_GUIDE.md PHASE_5_RECENT_WORK.md docs/index.md future/*.md future/*/*.md \
  apps/api/CLAUDE.md apps/web/CLAUDE.md packages/shared/CLAUDE.md

# 3. Live count verification (run when adding any of these)
grep -cE "^model "    apps/api/prisma/schema.prisma           # Prisma models
grep -cE "^enum "     apps/api/prisma/schema.prisma           # Prisma enums
grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/permissions.ts  # permissions
grep -cE "^\s+[A-Z_]+:"     packages/shared/src/types/reauth-actions.ts  # reauth
ls apps/api/src/modules/                | wc -l               # API modules
ls apps/api/src/modules/config/defs/*.def.ts | wc -l          # config defs
ls apps/web/src/routes/config/*.tsx     | wc -l               # config pages
ls apps/web/src/hooks/                  | wc -l               # hooks
ls apps/web/src/lib/                    | wc -l               # lib modules
grep -cE "<Route"   apps/web/src/main.tsx                     # routes
```

### Pre-deletion rule (anti-`future/`-deletion lesson)

Before deleting **any** doc or doc-folder:
1. Read every file's actual content
2. Compare line-by-line against the active doc set for unique knowledge (problem statements, design rationale, version pins, gotchas, file annotations, persona breakdowns)
3. Only delete if the knowledge is *thoroughly* duplicated, not just "covered at a higher level"
4. **When in doubt, restore** — git is cheap, lost institutional knowledge isn't

This rule exists because deleting `future/` was reverted twice during the 04-29 cleanup (commits `02f8108` → restore via `8677bf7` → restore again via `2c1fa50`). Do not repeat.

### Reading order for a fresh contributor

1. `future/README.md` (entry point with reading order)
2. `future/overview/CODEBASE_SUMMARY.md` (tech stack with version pins, "How to find things" cookbook)
3. `future/overview/CURRENT_STATUS.md` (KNOWN GOTCHAS taxonomy)
4. Role-specific subfolder of `future/`
5. Root deep-dives (`BACKEND_GUIDE.md`, `FRONTEND_GUIDE.md`, etc.)
6. `PHASE_5_RECENT_WORK.md` for the most recent architecture decisions

The pack under `future/` is one abstraction level higher than the root `*_GUIDE.md` files — it tells you where to look, not how every detail works.


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
