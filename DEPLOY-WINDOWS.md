# DigiLog — Windows Production Deployment Guide

This guide walks through installing DigiLog on a **fresh Windows machine**
(Server 2019/2022 or Windows 10/11 Pro) as a **single-server install**.
Total time: **60–90 minutes** for an experienced admin, 2–3 hours if you're
installing Node, PostgreSQL, etc. for the first time.

> ⚠️ **This manual-install method is superseded by the packaged `DigiLog-Setup-<ver>.exe` installer.**
> The current customer deploy path is a single Inno Setup installer that **bundles its own portable
> PostgreSQL** (no pre-installed database needed), writes its runtime config, provisions the DB, and
> registers Windows services automatically. See **`docs/PHARMA_DEPLOYMENT_21CFR.md`** and
> **`tasks/EXE-PACKAGING-PLAN.md`** for that path. The `install-on-target.ps1` / `install-mosquitto.ps1`
> / `package-for-production.ps1` scripts this guide used to reference were removed. This document is kept
> for the manual/reference deploy story and has been stripped of the removed subsystems (TimescaleDB,
> MQTT/Mosquitto, Redis, and the server-side PDF/reports engine — all torn out across Phases 4/7 and the
> 2026-07-04 reports removal).

> **Before you begin:** read `windowsIssues.md` at the repo root for the audit of dependency / runtime issues that affect Windows deployments, with severity ratings and mitigations. The single database is now `digilog_db` (Prisma); TimescaleDB / `digilog_tsdb` and the MQTT broker were removed 2026-06-11..17, and Redis 2026-05-01.

---

## 1. What's in the box

The customer should receive a ZIP named `digilog-production.zip` containing:

```
digilog-production/
├── api/                           ← compiled Fastify backend (dist + node_modules + prisma)
├── web/                           ← built React SPA (static files served by Fastify or any static server)
├── certs/                         ← HTTPS certs (mkcert-generated)
│   ├── server.crt
│   ├── server.key
│   └── rootCA.pem                 ← install this on every tablet
├── DigiLog-FilterOps.apk          ← Android APK for tablets
├── .env.example                   ← copy to .env and edit
└── DEPLOY-WINDOWS.md              ← this file
```

> **Note:** the packaged `DigiLog-Setup-<ver>.exe` installer (see the banner above) is the current path
> and needs none of this manual layout. There is no `mosquitto/` folder anymore (MQTT broker removed
> 2026-06-17), and the old `install-on-target.ps1` / `install-mosquitto.ps1` / `start-digilog.ps1` /
> `stop-digilog.ps1` scripts were removed. Smoke-test launch of a manually-placed bundle is
> `cd api; node dist/app.js` in the foreground.

Anything the customer shouldn't need to touch stays inside `api/` and `web/`.
Configuration is all in `.env` and `certs/`.

---

## 2. Architecture

```
┌─────────────── target Windows machine ───────────────┐
│                                                       │
│  ┌─────────┐   ┌────────────┐                         │
│  │ Node 20+│   │ PostgreSQL  │                         │
│  │ API+SPA │←──│ 18 + queue  │                         │
│  │ :3000   │   │ :5432       │                         │
│  │  HTTPS  │   │ digilog_db  │                         │
│  └────┬────┘   └────────────┘                         │
│       │   (graphile-worker job queue lives in Postgres;│
│       │    pub/sub is in-process — no Redis, no MQTT)  │
└───────┼───────────────────────────────────────────────┘
        │
        │ https://<server-ip>:3000
        ▼
    ┌───────────────────────────────┐
    │ Tablets with DigiLog APK      │
    │ (rootCA.pem installed in      │
    │  system cert store)           │
    └───────────────────────────────┘
```

Two components run on the server: **PostgreSQL 18** (single database `digilog_db`) and **the built API + SPA** (one Node process — the Fastify API serves the static SPA on `:3000` HTTPS). The graphile-worker job queue lives inside Postgres (Phase 2 moved it off BullMQ/Redis). **No Redis, no MQTT broker, no TimescaleDB, no server-side PDF/Chromium** — all removed across Phases 4 (Redis, 2026-05-01), 7 (data-ingestion + TimescaleDB + MQTT, 2026-06-11..17), and the reports generate/sign tear-out (2026-07-04). The packaged Setup.exe installer registers `DigiLogDB` (bundled Postgres) + `DigiLogAPI` (WinSW) as auto-starting Windows services.

---

## 3. Prerequisites to install on the target machine

Do these **once** on the target Windows machine before running the install script.
Each is a Next-Next-Finish installer.

> **The packaged Setup.exe bundles its own portable PostgreSQL**, so on the customer path you install
> nothing from this table. It only applies to a **manual** deploy against a self-managed PostgreSQL.

| Software | Version | Install URL | Notes |
|---|---|---|---|
| **Node.js LTS** | 20.x or 22.x | https://nodejs.org/ | Accept default options. Ensures `node` and `npm` are on PATH. |
| **PostgreSQL** | 18 | https://www.postgresql.org/download/windows/ | Remember the password for the `postgres` superuser — you'll need it. **No extensions to add** — vanilla PG 18 (the app uses only `ltree` + `pgcrypto` from `prisma/sql/extensions.sql`, which the schema step installs). **Do NOT install TimescaleDB** — it was dropped 2026-06-11. |
| **Git (optional)** | any | https://git-scm.com/ | Only needed if you'll pull source updates later. |

> **Do NOT install:** TimescaleDB, Mosquitto/any MQTT broker, EMQX, Memurai/Redis, or Microsoft Edge/Chromium. None are used anymore — the data-ingestion + TimescaleDB + MQTT layer was removed 2026-06-11..17, Redis 2026-05-01, and the server-side PDF/reports engine (which needed Edge) 2026-07-04.

> **Nginx / PM2 not used.** The Fastify API serves the SPA's static bundle directly on `:3000` (HTTPS). Under the Setup.exe installer the API runs as the `DigiLogAPI` Windows service (WinSW). For a manual deploy, launch it with `cd api; node dist/app.js` (foreground — no auto-restart) or register it yourself.

> **Windows Server SKU note:** the API, graphile-worker, and Postgres all run headless, so **Windows Server Core works**. The only "Desktop Experience" dependency would be a GUI PostgreSQL installer — use the headless installer or the bundled Postgres from the Setup.exe path.

---

## 4. Prepare the deployment package on your dev machine

> The old `package-for-production.ps1` script was removed. The current build path produces the
> `DigiLog-Setup-<ver>.exe` installer:
>
> ```powershell
> # On a build machine with Inno Setup 6 installed:
> powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1
> ```
>
> `build-installer.ps1` runs `build-bundle.ps1` (compiles the single-process backend+SPA bundle),
> does a clean-room `npm ci --omit=dev`, stages the runtime + portable Postgres + WinSW + the
> provision/register scripts, and compiles the Inno script to `Setup.exe`. See
> `tasks/EXE-PACKAGING-PLAN.md` §4/M5. For a **manual** bundle (no installer), run
> `scripts/build-bundle.ps1` and copy `apps/api/dist`, `apps/web/dist`, `certs/`, the APK, and
> `.env.example` to the target yourself.

---

## 5. Install on the target machine

### 5.1 Unzip and place the package

Unzip `digilog-production.zip` to a stable location, e.g.:

```
C:\DigiLog\
├── api\
├── web\
├── certs\
├── scripts\
├── DigiLog-FilterOps.apk
└── .env.example
```

### 5.2 Create the databases (manual, one-time)

Open **psql** (ships with Postgres) or **pgAdmin** as the `postgres` superuser
and run:

```sql
-- Create the app user
CREATE USER digilog WITH PASSWORD 'CHANGE_ME_STRONG_PASSWORD' CREATEDB;

-- Create the single application database
CREATE DATABASE digilog_db OWNER digilog;
```

> **One database only.** `digilog_tsdb` + the TimescaleDB extension were dropped 2026-06-11 with the
> data-ingestion tear-out. The app uses only `ltree` + `pgcrypto`, installed from
> `prisma/sql/extensions.sql` by the schema-apply step — no manual `CREATE EXTENSION` here.

Verify:

```sql
\c digilog_db
SELECT current_database();   -- should print digilog_db
```

### 5.3 Create the `.env` file

Copy the example and edit the values:

```powershell
cd C:\DigiLog
copy .env.example .env
notepad .env
```

**Critical fields to change before starting:**

```env
# ─── PostgreSQL (single database — no TSDB_*/MQTT_*/EMQX_*/UNS_* keys anymore) ───
DATABASE_URL=postgresql://digilog:CHANGE_ME_STRONG_PASSWORD@localhost:5432/digilog_db?schema=public

# ─── JWT ──────────────────────────────────────────────
# MUST be replaced with a random 64+ char string — do NOT ship with the default.
JWT_SECRET=GENERATE_A_NEW_RANDOM_64_CHAR_SECRET_HERE
VERIFICATION_TOKEN_SECRET=ANOTHER_DIFFERENT_64_CHAR_RANDOM_SECRET

# ─── HTTPS (required for APK tablet clients) ──────────
API_HTTPS=true

# ─── CORS — put the server's LAN IP here ─────────────
CORS_ORIGIN=https://192.168.1.100
ALLOWED_ORIGINS=https://192.168.1.100,capacitor://localhost
```

Generate random secrets with:

```powershell
# PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

### 5.4 Apply the schema and seed

> **The old `install-on-target.ps1` script was removed.** Under the packaged `DigiLog-Setup-<ver>.exe`,
> the Inno installer runs `scripts/install.ps1` (→ `provision-db.ps1` + `register-services.ps1`)
> automatically against the bundled Postgres — nothing to run by hand. The steps below are the
> **manual** equivalent against a self-managed PostgreSQL.

For a manual bundle, from the placed `api/` folder:

```powershell
cd C:\DigiLog\api
npm ci --omit=dev                 # production dependencies from the lockfile
npx prisma generate               # Prisma client against the deployed schema
# extensions (ltree + pgcrypto) then migrations then seed:
psql -U digilog -d digilog_db -f prisma/sql/extensions.sql
npx prisma migrate deploy         # applies every migration to digilog_db
npx prisma db seed                # SUPER_ADMIN role + default superadmin (best-effort; auto-seeds on first start too)
```

Also enable Windows long-paths once (`HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`)
and open the firewall for the API port only — **80, 443, 3000** (port **1883** is no longer used; the
MQTT broker was removed).

Then **launch the API manually for smoke-test:**

```powershell
cd C:\DigiLog\api
node dist/app.js
```

> **Manual-launch disclaimer:** in the foreground there is no auto-restart, boot persistence, or log
> rotation — smoke-test only. The packaged Setup.exe registers the `DigiLogAPI` WinSW service (with the
> `DigiLogDB` Postgres service) for boot persistence + restart-on-crash; see `register-services.ps1`.

### 5.5 Install the HTTPS cert on client tablets

The APK connects to `https://<server-ip>:3000`. Android requires the signing CA to be trusted. On every tablet:

1. Copy `certs/rootCA.pem` to the tablet via USB or email.
2. Android → **Settings → Security → Install from storage → CA certificate**.
3. Accept the warning and install.
4. After installation, verify at **Settings → Security → Trusted credentials → User** — you should see the DigiLog root CA.

Without this step the APK will fail to connect with an SSL error.

### 5.6 Install the APK on every tablet

```powershell
# On the tablet (USB connected, USB debugging enabled):
adb install -r DigiLog-FilterOps.apk
```

Or sideload: copy the APK to the tablet's Downloads folder, tap it in the
file browser, accept "Install from unknown sources".

---

## 6. First-run verification

Launch the API in one console (`cd C:\DigiLog\api; node dist/app.js`) and run these in another. **All commands are PowerShell:**

```powershell
# 1. PostgreSQL is responding
psql -U digilog -d digilog_db -c "SELECT now();"

# 2. graphile-worker schema bootstrapped on first API connect
psql -U digilog -d digilog_db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='graphile_worker';"
# → should print a non-zero count (jobs, job_queues, known_crontabs, migrations, etc.). Schema auto-creates on first API start; if zero, the API hasn't connected yet.

# 3. API is responding (run AFTER you start the API console with `cd api; node dist/app.js`)
curl -k https://localhost:3000/health
# → returns {"error":"UNAUTHORIZED","message":"Missing token"}  (expected — TLS handshake succeeded, route requires auth)

# 4. SPA is being served by the API directly (no Nginx)
curl -k https://localhost:3000/
# → returns HTML containing <title>DigiLog</title>

# 5. Can log in
# Open a desktop browser on the server itself:  https://localhost:3000
# Default credentials: superadmin / Admin@123
# CHANGE the superadmin password immediately after first login.
```

> No Redis/Memurai (removed 2026-05-01), no Mosquitto/MQTT (removed 2026-06-17), no TimescaleDB
> (removed 2026-06-11) — there are no broker/time-series/PING checks to run.

If step 3 fails, check the API console output directly (it's running in the foreground). Most likely causes: `DATABASE_URL` wrong or Postgres down.

---

## 7. Auto-start on boot — Phase 5 work

**Under the packaged Setup.exe**, `register-services.ps1` registers two auto-starting Windows services: `DigiLogDB` (the bundled Postgres cluster via `pg_ctl register`) and `DigiLogAPI` (`node dist/app.js` wrapped by WinSW, depending on `DigiLogDB`). Both survive reboots with no console window. (There is no Mosquitto/MQTT service and no Redis — both removed.)

For a **manual** deploy against self-managed Postgres, the older `scripts/install-services-phase5.ps1` (NSSM-based `DigiLogAPI-Phase5` + `DigiLogWeb-Phase5`) is still present, or use the NSSM stopgap below.

If you need auto-restart today, the simplest stopgap is **NSSM**:

```powershell
# Download nssm from https://nssm.cc/download
nssm install digilog-api "C:\Program Files\nodejs\node.exe" "C:\DigiLog\api\dist\app.js"
nssm set digilog-api AppDirectory C:\DigiLog\api
nssm set digilog-api AppStdout C:\DigiLog\logs\api.out.log
nssm set digilog-api AppStderr C:\DigiLog\logs\api.err.log
nssm start digilog-api
```

`scripts/verify-windows-deployment.ps1` provides an operator smoke-check: API `/api/health` and graphile-worker schema. (Its old Mosquitto :1883 and PDF-report-generation checks were removed with those subsystems.)

---

## 8. Backups

**Daily, automated via Windows Task Scheduler:**

```powershell
# Dump the application database to C:\DigiLog\backups\
pg_dump -U digilog -F c -f C:\DigiLog\backups\digilog_db-$(Get-Date -Format yyyy-MM-dd).dump digilog_db
```

> One database only — `digilog_tsdb` was dropped 2026-06-11. (The Setup.exe path stores data under
> `C:\ProgramData\DigiLog`; `upgrade.ps1` auto-dumps to `ProgramData\backups\pre-upgrade-*` before migrating.)

Keep at least **7 daily + 4 weekly** backups off-server (external drive,
cloud, or file share).

---

## 9. Updating to a new version

When you ship a new build:

1. On your build machine, run `scripts/build-installer.ps1` to produce the new `DigiLog-Setup-<ver>.exe` (or `scripts/build-bundle.ps1` for a manual bundle). Under the Setup.exe path, running the new installer performs the upgrade for you (`upgrade.ps1`: data-safe, backs up, forward-only `migrate deploy`).
2. On the target machine (manual deploy), **stop the API first** — Ctrl-C in the API console, or `nssm stop digilog-api` if you registered it as a service.
3. Replace `C:\DigiLog\api\` and `C:\DigiLog\web\` with the new folders from the ZIP. **Do NOT overwrite `.env` or `certs/`.**
4. Apply any new migrations:
   ```powershell
   cd C:\DigiLog\api
   npx prisma migrate deploy
   ```
   > **Upgrading to Phase 8.7 (2026-05-03) on a populated DB:** read section 10.1 first — you must run `prisma migrate resolve --applied 20260503162127_capture_schema_vs_db_drift` **before** `migrate deploy`, or the deploy will fail.
5. Restart the API:
   ```powershell
   # Foreground smoke-test:
   cd C:\DigiLog\api
   node dist/app.js
   # OR if you registered it via NSSM:
   nssm restart digilog-api
   ```
6. Install the new APK on tablets (same `adb install -r` command — `-r` keeps user data).

---

## 10. Phase 8.7 release notes — drift migration + offline replay

This section covers two operational caveats introduced in the Phase 8.7 cutover (2026-05-03). Read it **before** running `prisma migrate deploy` on any environment that's been running pre-8.7, and **before** rolling the new APK out to tablets that have unsynced offline queues.

### 10.1 Drift catch-up migration — `migrate resolve` required on populated DBs

A new migration shipped in this release:

```
apps/api/prisma/migrations/20260503162127_capture_schema_vs_db_drift/migration.sql
```

It captures schema-vs-DB drift accumulated via `prisma db push` between roughly 2026-04-XX and 2026-05-02 (enums, tables, columns, drops). The migration's own header records the constraint — this section restates it for operators.

**Greenfield install (fresh, empty `digilog_db`):** no special action. `npx prisma migrate deploy` (the schema-apply step — `provision-db.ps1`/`apply-schema.ps1` under the installer, or the manual §5.4 sequence) applies every migration including this one in order, against an empty schema. Done.

**Populated DB (any environment that's been running pre-8.7 and already has the post-`db push` schema):** you MUST mark this migration as applied **before** running `prisma migrate deploy`, otherwise the deploy will try to re-create tables/columns that already exist and fail on at least:

- `filter_cleaning_profiles.lineage_id NOT NULL` (no default backfill in the migration)
- `asset_instances` column drops (no migration of data into the `filter_details` sidecar)

Run **once**, on the target machine, before any future `prisma migrate deploy`:

```powershell
cd C:\DigiLog\api
npx prisma migrate resolve --applied 20260503162127_capture_schema_vs_db_drift
```

Then `prisma migrate deploy` is safe to run on every subsequent upgrade.

**How to tell which case you're in:** if the database was created from scratch by the schema-apply step for this release, it's greenfield. If you're upgrading an existing install that has been live, it's populated — run `migrate resolve` first.

If you're unsure, the safest path is: take a `pg_dump` backup (section 8), run `migrate resolve`, then `migrate deploy`. The resolve is a metadata-only update to the `_prisma_migrations` table — it doesn't touch user data.

### 10.2 Offline-queue replay failures after upgrade — `tapeVersion` now required

Phase 8.7 (commit `f8fae1d`) made `tapeVersion` a required field on the four cycle-bound write routes:

- `POST /api/filters/:id/advance`
- `POST /api/filters/:id/submit-checklist`
- `POST /api/filters/:id/bypass`
- `POST /api/filters/:id/terminate-cycle`

A separate fix (commit `11b4b82`) extended this to the cycle-tombstone replay path in the offline `sync-engine.ts` (it now sends `justification` + `tapeVersion`).

**The documented migration cost:** any tablet that was offline before the new APK was installed and has queued operations in IndexedDB with `tapeVersion: null` will see those operations **400** on first sync against the upgraded API. The sync-engine marks them failed, the operator sees a toast, and **the original action was not executed on the server**.

**What operators should expect and do:**

- On the first sync after rolling out the new APK, tablets with stale pre-8.7 offline queues will surface failures (toast + sync log entries).
- Each failed action must be **re-performed** on the tablet after the sync completes — the cycle state on the server is whatever it was before the offline op was attempted.
- A clean rollout has every tablet sync (drain its queue) under the **old** APK first, then install the new APK. If that's not feasible, accept the migration cost and brief the operators in advance.
- Pre-fix cycle tombstones (queued before commit `11b4b82`) with `tapeVersion: null` will still 400 on replay even after the rest of the queue drains — same remediation: re-perform the action.

There is no server-side workaround — the API rejects `tapeVersion: null` on these routes by design (it's the optimistic-concurrency token that prevents stale-tape submissions).

### 10.3 Audit-trail compliance hardening (2026-05-04 review fixes — branch `fix/p0-compliance-2026-05-04`)

This branch closes 8 of 9 P0 findings from the 2026-05-04 adversarial review. Operator-relevant changes:

**New environment variable — REQUIRED in production:**
- `OFFLINE_REPLAY_SECRET` — 32+ character random string in `apps/api/.env`. The server refuses to boot in `production`/`staging` without it. Dev mode auto-derives from `JWT_SECRET` with a warning. Generate via:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

**Two new migrations to apply (in addition to § 10.1's drift migration):**
- `20260504180000_audit_hash_chain` — adds `previous_checksum` + `chain_position` columns to `audit_trail`. Idempotent (uses `IF NOT EXISTS`); safe on populated DBs.
- `20260504190000_compliance_invariants` — installs the 1-IN_PROGRESS-per-filter unique index + `filter_event` consistency trigger + `asset_relationship` bidirectional-pair trigger + `audit_trail_no_delete` trigger. These were previously installed only by `seed.ts`; a `migrate deploy`-only cutover would have shipped without them. Idempotent.

Apply with:
```powershell
cd C:\DigiLog\api
npx prisma migrate deploy
```

**Tablet upgrade — operators MUST log in once after the APK update:**
- Bare `x-offline-replay: true` header is now rejected with HTTP 401 `OFFLINE_REPLAY_HEADER_DEPRECATED`. The new flow uses an HMAC-signed grant token issued by `POST /api/auth/offline-grant` (gated behind a password challenge).
- The web client + APK fetch the grant automatically at successful login. Existing field tablets with queued offline ops MUST log in once after the upgrade so the new token is fetched; the queue then drains normally. Pre-upgrade queued ops will fail on first replay with `OFFLINE_REPLAY_HEADER_DEPRECATED` — the operator re-performs the action under the new flow.

**Operator-facing chain integrity verification:**
- New endpoint `GET /api/audit/verify-chain` (SUPER_ADMIN only). Walks the audit chain in `chain_position` order and reports any per-row checksum mismatch, chain link mismatch, or chain-position gap.
- Run after the upgrade to confirm `intact: true` on rows written post-migration.
- Recommended schedule: nightly cron (out of scope for this branch — document in operator runbook).
- The endpoint cannot detect **deletion of the latest row** by itself (no successor exists to detect the gap). Mitigate by recording the daily `highestPosition` value out-of-band (e.g., a daily snapshot to a separate disk).

**`offlinePerformedAt` policy — server-validated tablet wall clock:**
- Tablets continue to send their wall-clock time when an offline action was performed (this is correct — the audit trail records when the operator physically did the work, not when the server received the replay).
- The server now rejects values that are: > 5 min ahead of server clock, > 30 days old, or before the cycle's `startedAt`. Returns HTTP 400 with stable error codes (`OFFLINE_TIME_FUTURE`, `OFFLINE_TIME_TOO_STALE`, `OFFLINE_TIME_BEFORE_CYCLE`, `OFFLINE_TIME_INVALID`). Online (non-replay) requests have the field silently ignored — server uses its own clock.

**Privilege rename:**
- `'admin_requests.view'` privilege now maps to a new `ADMIN_REQUEST_REVIEW` permission (was `USER_CREATE` — privilege escalation). Seeded SUPER_ADMIN + ADMIN roles automatically receive it. Other roles that should review admin requests must be granted `ADMIN_REQUEST_REVIEW` via the role-config UI after upgrade.

---

## 11. Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tablet login fails with "unable to parse tls packet header" | API is running plain HTTP | Check `.env` has `API_HTTPS=true` and restart the API console (Ctrl-C, `node dist/app.js` again) |
| Tablet login fails with "certificate not trusted" | `rootCA.pem` not installed on the tablet | Re-do section 5.5 for that tablet |
| API 500, log says "Cannot connect to Postgres on queue connection" | DATABASE_URL/DATABASE_URL_QUEUE wrong, or Postgres down | Verify `psql -U digilog -d digilog_db -c "SELECT 1;"` works; check the API console output |
| Login works but no data loads | CORS rejecting the origin | Add the LAN IP/hostname to `ALLOWED_ORIGINS` in `.env` and restart the API console |
| Can't find superadmin login after install | Seed didn't run | `cd C:\DigiLog\api; npx prisma db seed` (or restart the API — config registry auto-seeds on first start) |
| API doesn't survive reboots (manual deploy) | No managed-service launcher | Use the Setup.exe path (registers `DigiLogAPI`), NSSM (see section 7), or relaunch manually after reboot |
| `prisma migrate deploy` fails on `filter_cleaning_profiles.lineage_id NOT NULL` or `asset_instances` column drops after a Phase 8.7 upgrade | Drift catch-up migration `20260503162127_capture_schema_vs_db_drift` is being applied to a populated DB | Run `npx prisma migrate resolve --applied 20260503162127_capture_schema_vs_db_drift` from `C:\DigiLog\api`, then re-run `migrate deploy`. See section 10.1 for full context. |
| Tablets show toast "advance failed" / "submit failed" / "bypass failed" / "terminate failed" with HTTP 400 immediately after upgrading to the Phase 8.7 APK | Pre-8.7 offline queue items in IndexedDB have `tapeVersion: null`; the new API rejects them | Expected migration cost. Operators must re-perform each failed action on the tablet after the sync settles. See section 10.2. |

---

## 12. Handover checklist (print this for the customer)

Give the customer a printed copy of this list:

- [ ] Windows machine meets the prerequisites (section 3) — **or** used the `DigiLog-Setup-<ver>.exe` installer (bundles Postgres; skip the manual DB/prereq steps)
- [ ] (Manual path) Installed Node.js + PostgreSQL 18. **Do NOT install TimescaleDB, Mosquitto/MQTT, or Redis/Memurai — none are used.**
- [ ] (Manual path) Created the single `digilog_db` database (section 5.2)
- [ ] Filled in `.env` — **database password + JWT secrets changed from defaults** (no TSDB_*/MQTT_*/Mosquitto keys)
- [ ] Applied schema + seed (section 5.4) — installer does this automatically
- [ ] Launched the API for smoke-test (`cd api; node dist/app.js`) — or confirmed the `DigiLogAPI` service is running
- [ ] Verified the smoke tests (section 6) pass
- [ ] Changed superadmin password from `Admin@123`
- [ ] Installed `rootCA.pem` on each tablet (section 5.5)
- [ ] Installed `DigiLog-FilterOps.apk` on each tablet (section 5.6)
- [ ] Logged in from each tablet successfully
- [ ] (Optional, until Phase 5 lands) Registered the API as an NSSM service for auto-restart (section 7)
- [ ] Configured daily backups (section 8)
- [ ] Saved the admin password and DB password in a password manager

---

## 13. Support contact

For technical questions during or after installation, contact the
development team with:

- The exact step number from this guide where the issue occurred
- The last 100 lines of the API console output (or, if running under NSSM, the contents of `C:\DigiLog\logs\api.err.log`)
- Screenshots of any error messages
- The target OS version (run `systeminfo | findstr /B /C:"OS Name" /C:"OS Version"`)
