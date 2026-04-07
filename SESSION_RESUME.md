# DigiLog — Session Resume Point

**Last Updated:** 2026-04-04
**Branch:** `DigitalFMS`
**Status:** ALL PHASES COMPLETE (A through K) + Phase 2: Digital Filter Management System + Phase 3 enhancements. 34 API modules, 57 Prisma models, 17 enums, 52+ permissions. All pushed to GitHub.

### Current Application State (2026-04-04)
- **Backend:** Fastify + TypeScript, 34 API modules, port 3000 (PM2 in production)
- **Frontend:** React + Vite SPA + Tailwind CSS, port 5175 (dev), Nginx (prod)
- **Database:** PostgreSQL 18 + Prisma ORM (57 models, 17 enums) + TimescaleDB (7 hypertables)
- **Queue:** BullMQ + Redis 5
- **MQTT:** EMQX broker (port 1883/18083)
- **Monorepo:** apps/api, apps/web, apps/android, packages/shared, packages/db, packages/queue

### Phase 2: Digital FMS (2026-03-26 to 2026-03-27)
- 11+ new database tables, 17 enums, 52+ permissions
- 6 backend modules: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles, equipment-groups
- 14+ frontend pages: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, equipment, bulk-upload, retirement, replacement, scan, config
- Checklist gates in pipeline with auto-trigger dialogs
- Cleaning reason selection (8 configurable reasons)
- Visual pipeline editor with validation
- Equipment groups for instrument tracking
- Bulk filter upload via CSV
- Filter retirement and replacement

### Phase 3 Enhancements
- Bulk upload, filters page improvements, retirement/replacement
- Mobile PWA and Android APK (Capacitor)
- Offline sync capability
- Unified light theme across all pages
- 3 full quality audits completed

### EC2 Instance
- **Instance:** i-072fc466f5de8a10a (t3.large, us-east-1)
- **IP:** 34.232.224.0
- **SSH:** `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0`
- **Login:** superadmin / Admin@123
- **Services:** Nginx (80/443), Fastify (3000), PostgreSQL 18 (5432), Redis 5 (6379), EMQX (1883/18083)

### Windows Local Development
- Redis 5: `C:\Users\hello\redis5\redis-server.exe`
- EMQX: `C:\Users\hello\emqx\bin\emqx.cmd`
- PostgreSQL 18: auto-starts as service
- API: `cd apps/api && npx tsx watch src/app.ts`
- Frontend: `cd apps/web && npx vite --host`
- Start script: `start-digilog.bat` / Stop: `stop-digilog.bat`

### Key API Modules (34 total)
admin-requests, assets (templates, instances, identifiers, relationships), audit, auth, backup, checklist-profiles, cleaning-profiles, config (23 config definitions), connectivity, dashboards, data-ingestion (10-stage pipeline), deployment-check, entity-assignments, equipment-groups, filter-operations, filter-profiles, help, ldap, notification-delivery (email/SMS/Telegram/Slack), notification-rules, notifications, org-admin, pm-schedules, qr-code, queries (telemetry/alarm/retention/export), roles, rule-chain (77 node types, 8 categories), super-admin, system-health, tenant-admin, uns, uploads, user-groups, users

### Frontend Route Groups
admin-requests, alarms, assets (with dialogs/tabs/hooks), audit, auth, checklist, checklists, cleaning-cycles (history/timeline), config (branding/notification-rules/notification-settings/roles), debug, filter-management (operations/profiles/status/scan/traceability/AHU dashboard/cleaning-profile-editor/retirement/replacement/bulk-upload/equipment), mobile, notifications, pm-schedules, profile, rule-chains, system-health, tenant, users

### Key Files Changed in Quality Audit (2026-03-27)
- `apps/api/src/modules/filter-operations/filter-operations.service.ts` — org scoping, checklist enforcement, transactions, sanitization
- `apps/api/src/modules/data-ingestion/routes.ts` — path traversal fix, auth preHandlers
- `apps/api/src/modules/cleaning-profiles/cleaning-profile.service.ts` — pipeline validation, transaction
- `apps/web/src/routes/filter-management/filter-operations.tsx` — cleaning reason dialog, missing stages, double-submit guard
- `apps/web/src/main.tsx` — permission guards on all Phase 2 routes

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
