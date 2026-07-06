# Backend Environment Setup

For the full root-level setup (Windows dev box), the authoritative guide is **`LOCAL_SETUP_WINDOWS.md`** at the repo root. This document focuses specifically on the backend (`apps/api/`).

## Prerequisites

- Node 20+ / 22 + npm 11 (root `package.json` pins `"packageManager": "npm@11.6.2"`)
- PostgreSQL 18 with two databases: `digilog_db` (app + graphile-worker schema) and `digilog_tsdb` (telemetry, TimescaleDB extension)
- Mosquitto 2.0 — optional unless testing MQTT ingest. Install via `scripts/install-mosquitto.ps1` from elevated PowerShell. (Phase 1 of windows-friendly-rewrite swapped from EMQX.)
- Redis / Memurai ≥5 — **optional**. Phase 2 of windows-friendly-rewrite moved the job queue onto Postgres via graphile-worker. Redis is still used for non-queue pub/sub (WebSocket events, RPC routing, pipeline tracer, debug recorder); if you skip it those features degrade silently. Don't use Redis 3 or earlier; BullMQ-era code paths will crash.
- ~~Microsoft Edge for PDF reports~~ — **no longer needed.** The server-side `puppeteer-core` + Edge reports PDF engine was removed 2026-07-04; PDF export is now client-side (`apps/web` `lib/pdf-report.ts`, jsPDF). No Edge/Chromium dependency.
- JDK 21 + Android SDK (only if you also build the APK) — installed at `C:\Users\hello\` on the reference dev box.

## First-time setup

```bash
# from repo root
npm install

# copy and edit env
cp .env.example .env
# - fill in DATABASE_URL for digilog_db
# - fill in TSDB_* for digilog_tsdb
# - generate JWT_SECRET + VERIFICATION_TOKEN_SECRET (see .env.example for node -e helper)

# bootstrap TimescaleDB
psql -U digilog -d digilog_tsdb -f init-tsdb.sql

# run migrations against the app DB
npm run db:migrate     # → cd apps/api && npx prisma migrate dev
npm run db:seed        # → cd apps/api && npx prisma db seed

# start dev
cd apps/api && npm run dev     # tsx watch → port 3000 (or API_PORT)
```

The default super-admin after seeding is `superadmin` / `Admin@123`.

## Running on HTTPS locally

If you're testing the APK against your local dev box, set `API_HTTPS=true`. The server will load `certs/server.key` + `certs/server.crt` (mkcert is the easiest way to generate these).

The APK bakes in `https://192.168.1.22:3000` as its API base, so if you change your dev host address you must rebuild the APK.

## Production-style local build

DigiLog is now Windows-local-only. EC2 / PM2 / Linux are no longer in scope (removed in commit `251be95`).

```bash
# compile TypeScript
npx tsc -p apps/api/tsconfig.json

# run the compiled JS
node apps/api/dist/app.js

# or package for transport to a target Windows machine
powershell -ExecutionPolicy Bypass -File scripts/package-for-production.ps1
# then on the target box (after unzipping):
powershell -ExecutionPolicy Bypass -File scripts/install-on-target.ps1
```

After Phase 4 of the windows-friendly-rewrite the Fastify API serves both the SPA (from `apps/web/dist/`) and `/api/*` directly on port 3000 over HTTPS (`API_HTTPS=true` + mkcert certs). A reverse proxy (Nginx / IIS) is optional / customer-choice; nothing in the standard install path depends on it.

## Swagger

- Local dev: `https://localhost:3000/docs` (public)
- `NODE_ENV=production` disables `/docs` (see `plugins/auth.ts` `PUBLIC_PATHS`)

## Database tips

- `digilog_tsdb` is the **telemetry** store (TimescaleDB hypertables created by `init-tsdb.sql`). Do not confuse it with `digilog_db` (the Prisma-managed app DB). Backups in `old/db-backups/` include both.
- Restores rewrite the `roles` table — reseed (or `UPDATE`) after a restore to recover lost permissions.
- Dynamic backup goes through `pg_tables` + `jsonb_populate_recordset` and handles all 64 tables without needing superuser.

## Connecting locally with Memurai on Windows (optional)

Memurai appears as the "Memurai" service in Windows services. After Phase 2 of the windows-friendly-rewrite the **job queue lives on Postgres via graphile-worker**, so Memurai is no longer required for queue work. If you do install it, make sure the service is running before `npm run dev` so the non-queue pub/sub features (WebSocket events, RPC routing, pipeline tracer, debug recorder) wire up correctly.

## Android build (optional)

See `LOCAL_SETUP_WINDOWS.md` for the full flow. In brief:

```bash
cd apps/web && npm run build         # output to apps/web/dist
cd ../android && npx cap sync        # mirrors dist into Capacitor
# open in Android Studio or:
cd android && ./gradlew assembleDebug
```
