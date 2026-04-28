# Backend Environment Setup

For the full root-level setup (Windows dev box), the authoritative guide is **`LOCAL_SETUP_WINDOWS.md`** at the repo root. This document focuses specifically on the backend (`apps/api/`).

## Prerequisites

- Node 22 + npm 11 (root `package.json` pins `"packageManager": "npm@11.6.2"`)
- PostgreSQL 18 with two databases: `digilog_db` (app) and `digilog_tsdb` (telemetry, TimescaleDB extension)
- Redis ≥5 (Windows: Memurai ≥5 — do **not** use Redis 3 or earlier, BullMQ will crash)
- EMQX ≥5 (MQTT broker on 1883, admin dashboard on 18083)
- JDK 21 + Android SDK (only if you also build the APK) — installed at `C:\Users\hello\` on the reference dev box
- Puppeteer will download Chromium automatically on first install (PDF reports)

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

The optional Nginx reverse proxy fronts the API at port 80/443; the SPA is served from `apps/web/dist/`. Without Nginx, point clients directly at `https://localhost:3000` (with `API_HTTPS=true`).

## Swagger

- Local dev: `https://localhost:3000/docs` (public)
- `NODE_ENV=production` disables `/docs` (see `plugins/auth.ts` `PUBLIC_PATHS`)

## Database tips

- `digilog_tsdb` is the **telemetry** store (TimescaleDB hypertables created by `init-tsdb.sql`). Do not confuse it with `digilog_db` (the Prisma-managed app DB). Backups in `old/db-backups/` include both.
- Restores rewrite the `roles` table — reseed (or `UPDATE`) after a restore to recover lost permissions.
- Dynamic backup goes through `pg_tables` + `jsonb_populate_recordset` and handles all 64 tables without needing superuser.

## Connecting locally with Memurai on Windows

Memurai appears as the "Memurai" service in Windows services. Make sure it's running before `npm run dev`, otherwise the BullMQ producer/consumer will fail silently during worker startup.

## Android build (optional)

See `LOCAL_SETUP_WINDOWS.md` for the full flow. In brief:

```bash
cd apps/web && npm run build         # output to apps/web/dist
cd ../android && npx cap sync        # mirrors dist into Capacitor
# open in Android Studio or:
cd android && ./gradlew assembleDebug
```
