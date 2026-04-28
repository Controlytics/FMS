# Current Status — 2026-04-20

## Active branch

- **`RFID`** (derived from `main`, not yet merged)
- Latest commit: `17b420b` — *"feat: offline pipeline enforcement, checklist-as-stage, APK rebuild + handover docs"*

## What's shipped and stable (verified in code)

### Identity, access, and audit
- JWT auth with refresh tokens, beacon logout, reauth verification for sensitive actions (`apps/api/src/modules/auth/routes.ts`)
- 95 permission constants, 82 feature privileges, 69 reauth actions (see `packages/shared/src/types/*`)
- Feature-privilege → permission mapping drives both frontend visibility and backend route protection (`FEATURE_TO_PERMISSION_MAP`)
- Role CRUD with hierarchy + creatable-role matrix
- LDAP integration (test/connect/config)
- Audit trail with hash-chain integrity (`apps/api/src/lib/hash-chain.ts`)
- Session singleton enforcement on the frontend (`use-single-tab.ts`)

### Multi-tenant + super-admin
- Organizations CRUD + per-org detail endpoints (users, entities, templates, assignments, visible-entities)
- Super-admin data management console editable on: cleaning cycles, filter events, audit trail, alarms, notifications, admin requests, block change requests, PM entries
- Dynamic backup/restore covering **all 64 tables** via `pg_tables` + `jsonb_populate_recordset` (non-superuser compatible, two-pass self-ref fixup)

### IoT platform
- **Ingestion:** HTTP, MQTT, binary, RPC, checklist, event endpoints under `/api/data`
- **Rule chain engine:** 77 node types across 8 categories, visual editor with `reactflow`, save/debug/replay
- **Queries:** telemetry (latest, timeseries, keys), attributes (scoped + history), alarms (list, summary, acknowledge, clear), checklist (responses, history), exports (async jobs), retention (execute, execute-range, delete-keys, delete-records)
- **UNS:** tree view, search, entity CRUD + move with confirm step
- **Connectivity panel:** per-entity token mgmt + snippets + history
- **Dashboards:** widgets + layouts + assignments + data adapters

### Digital Filter Management System
- Asset templates with dynamic attribute schemas (validated via `ATTRIBUTE_DATA_TYPES` in shared)
- Filter instances with bulk upload, lifecycle states, status toggles
- Block → Area → AHU → Filter hierarchy builder (visual tree)
- Cleaning profiles: pipeline editor with stages, checklist nodes, bypass rules; profile validation
- Filter operations: start/advance/bypass/retire/replace/terminate cycle with server-enforced state machine
- PM schedules: CSV template, upload, approvals (approve/reject/resubmit/edit), due list, AHU configs, entry history
- Equipment groups with per-block scoping
- Reports module (complete): template designer → PDF engine → signatures → rejections

### RFID + mobile
- Native RFID scanner app for KC-series readers (`rfid_scan_app/` + `RFID/` folders)
- RFID keyboard guard (`apps/web/src/hooks/use-rfid-guard.ts`) — global keydown interceptor blocks UKB tag bursts from leaking into non-`data-rfid="true"` fields
- 300 ms debounce + dedup for repeated scans in dialogs
- One-identifier-per-entity enforcement in `identifier.service.ts`
- Filter + parent-AHU lookup at scan time

### Offline operations (v3 architecture)
- IndexedDB store (`apps/web/src/lib/offline-store.ts`) holds operations queue, cache, filters
- Sync engine (`apps/web/src/lib/sync-engine.ts`): auto-sync on reconnect, FIFO, skip conflicts
- `useOffline` hook exposes `executeOrQueue()` for offline-safe calls
- `offline-sync-service.ts` centralises batching, state, replay
- Cached: filter instances, templates, cleaning reasons, identifier map (for offline RFID lookup), auth for tablet reload
- `x-offline-replay` header + `offlinePerformedAt` timestamps
- "Data Synced" indicator in mobile header when cache + queue both clear
- **Offline pipeline enforcement** (2026-04-20): cycle state transitions, bypass, checklist validation all run against cached pipeline graph before queuing
- **Checklist-as-stage** (2026-04-20): checklist nodes now participate in the stage machine rather than sitting in a side-channel dialog
- Capacitor online detection uses a `/api/health` poll every 15 s + `visibilitychange` (because `navigator.onLine` is unreliable on Android WebViews)

### Governance / approval flows
- Admin requests: create-user / unlock / reset-password / modify-user approvals that actually execute the action server-side; requester Employee ID required and audited
- Block change requests: cross-block approvals with remarks mandatory, single-use consumption, desktop + mobile popups
- Remarks mandatory on every approval/decision UI except filter cleaning stages

### Configuration surface
- Sidebar, permissions, reauth are deliberately independent — no auto-sync between config tabs
- 24+ config definitions auto-discovered from `config-discovery.ts`
- Config partial updates: each tab sends only its own fields; backend preserves the rest
- 10 preset color themes with CSS variable swap (`applyTheme()` on `:root`)
- Report settings: configurable header/footer/records-per-page/compact mode driving `ReportPageWrapper`

## What's likely still in motion

Derived from the uncommitted state on the `RFID` branch and from the pattern of recent commits:

- `.playwright-mcp` traces and screenshots from 2026-04-20 sessions suggest active UI regression checking (now archived to `old/playwright-artifacts/` and `old/screenshots/`)
- Modified `package-lock.json` + `package.json` on the branch — dependency bump in flight
- Modified `.claude/settings.local.json` — local AI-tool settings drift

## Known constraints / gotchas (verified in memory + code)

- **HTTPS + APK:** Capacitor WebView ignores `network_security_config` for `fetch`. Production tablets must run with proper mkcert-trusted certs, or the app uses `CapacitorHttp` plugin. Dev mode uses plain HTTP.
- **Redis version:** BullMQ requires Redis ≥5 (or Memurai ≥5). Old Redis 3 crashes the API on boot.
- **TimescaleDB name:** the telemetry DB is `digilog_tsdb`, **not** `digilog_db`.
- **Fastify schema stripping:** Fastify strips response fields that aren't declared in the schema. If a property "disappears" on the wire, the schema is the suspect.
- **Role permissions after restore:** a DB restore rewrites the `roles` table. If roles lose access after a restore, reseed from `seed.ts` or `UPDATE` directly.
- **PM2 runs compiled JS:** always `npx tsc -p apps/api/tsconfig.json` before `pm2 restart digilog-api`.

## Open questions for product / ops

*(Not in-code — these come from project memory of recent sessions, listed here so the next reader doesn't rediscover them):*

- Which Windows deployment path (A–H, including IIS) is the target for on-prem production? Nginx-artifacts (Option A) is drafted but uncommitted.
- RFID UKB mode vs SDK mode: which will ship first to customers?
- Merge strategy for the `RFID` branch back to `main`.

## Where to look next

- `future/backend/README.md` — backend module-by-module walkthrough
- `future/frontend/README.md` — frontend patterns (offline, permissions, themes)
- `future/qa/FEATURE_CHECKLIST.md` — what to verify, with how-to-verify steps
