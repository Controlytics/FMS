# DigiLog — Windows Production Deployment Guide

This guide walks through installing DigiLog on a **fresh Windows machine**
(Server 2019/2022 or Windows 10/11 Pro) as a **single-server install**.
Total time: **60–90 minutes** for an experienced admin, 2–3 hours if you're
installing Node, PostgreSQL, etc. for the first time.

> **Before you begin:** read `windowsIssues.md` at the repo root for the full audit of 18 dependency / runtime issues that affect Windows deployments, with severity ratings and concrete mitigations. Each mitigation in this guide cross-references its `windowsIssues.md` § number for the rationale. The Phase-1 plan in `docs/plans/2026-04-29-windows-friendly-rewrite.md` (when present) tracks long-term remediation.

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
├── mosquitto/                     ← Mosquitto config + dynamic-security.json regen target
├── scripts/
│   ├── install-on-target.ps1      ← run once on the target machine (also runs install-mosquitto.ps1)
│   └── install-mosquitto.ps1      ← invoked by install-on-target.ps1
├── .env.example                   ← copy to .env and edit
└── DEPLOY-WINDOWS.md              ← this file
```

> **Phase 4 (windows-friendly-rewrite) note:** the bundled `start-digilog.ps1` / `stop-digilog.ps1` shells were dropped because they referenced PM2 + EMQX. Smoke-test launch is now `cd api; node dist/app.js` in the foreground; a managed Windows-service launcher is tracked as Phase 5 work.

Anything the customer shouldn't need to touch stays inside `api/` and `web/`.
Configuration is all in `.env` and `certs/`.

---

## 2. Architecture

```
┌─────────────── target Windows machine ───────────────┐
│                                                       │
│  ┌─────────┐   ┌────────┐   ┌──────────┐  ┌──────────┐│
│  │ Node 20+│   │Postgres│   │Memurai   │  │Mosquitto ││
│  │ API     │←──│ +Timsc │   │(optional │  │ MQTT     ││
│  │ :3000   │   │ +queue │   │ pub/sub) │  │ :1883    ││
│  │  HTTPS  │   │:5432   │   │ :6379    │  │ (service)││
│  └────┬────┘   └────────┘   └──────────┘  └──────────┘│
│       │                                               │
│       │  Foreground smoke-test:  cd api; node dist/app.js
│       │  (managed Windows-service launcher = Phase 5) │
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

Three components run on the server: **PostgreSQL 18 + TimescaleDB**, **Mosquitto 2.0**, and **the built API + SPA**. Phase 1+2 of the windows-friendly-rewrite swapped EMQX for Mosquitto and moved the job queue to graphile-worker on Postgres (Memurai/Redis is now optional, only used for non-queue pub/sub: WebSocket events, RPC routing, pipeline tracer, debug recorder). Phase 3 swapped the PDF/chart pipeline to puppeteer-core + Edge and @napi-rs/canvas, eliminating ~150 MB of bundled Chromium and the node-gyp / MSVC / Cairo build chain. Phase 4 retired PM2 and the bundled Nginx config from the customer-facing install path — the API runs in the foreground for smoke-test, and a managed Windows-service launcher is Phase 5 work.

> **Phase 2 Task 2.10 update (2026):** the job queue moved from BullMQ-on-Redis
> to graphile-worker-on-Postgres. Memurai/Redis is now **optional** — the API
> still uses it for non-queue pub/sub (WebSocket events, RPC, pipeline tracer,
> debug recorder). For a queue-only smoke test you can skip Memurai; full
> functionality still wants it.

---

## 3. Prerequisites to install on the target machine

Do these **once** on the target Windows machine before running the install script.
Each is a Next-Next-Finish installer.

| Software | Version | Install URL | Notes |
|---|---|---|---|
| **Node.js LTS** | 20.x or 22.x | https://nodejs.org/ | Accept default options. Ensures `node` and `npm` are on PATH. |
| **PostgreSQL** | 18 | https://www.postgresql.org/download/windows/ | Remember the password for the `postgres` superuser — you'll need it. Install **Stack Builder** and use it to add the **TimescaleDB** extension afterwards. |
| **TimescaleDB** | latest for PG 18 | https://docs.timescale.com/self-hosted/latest/install/installation-windows/ | Needed for time-series data. Follow their Windows guide — it's a DLL copy + one `CREATE EXTENSION` statement. |
| **Memurai** *(optional)* | Developer Edition | https://www.memurai.com/get-memurai | Phase 2 of windows-friendly-rewrite moved the job queue onto Postgres (graphile-worker). Memurai/Redis is **only** needed if you want the non-queue pub/sub features (WebSocket events, RPC routing, pipeline tracer, debug recorder). Free Developer Edition is enough if you do install it. |
| **Mosquitto** *(installed by script)* | 2.0.x | Bundled — `install-on-target.ps1` invokes `install-mosquitto.ps1` automatically | MQTT broker. **No separate install step.** Step 3/9 of `install-on-target.ps1` runs `install-mosquitto.ps1`, which downloads the official 2.0.18 installer, registers the Windows service, deploys the conf, and rewrites paths to absolute (the SCM-managed broker has CWD=System32, no stdout — relative paths and `log_dest stdout` would silently exit it). |
| **Microsoft Edge** | preinstalled on Win10+/Server 2019+ | https://www.microsoft.com/edge | Used by `puppeteer-core` for PDF report rendering. The installer probes for `msedge.exe` and warns if missing. On Windows Server Core, install Chrome and set `PUPPETEER_EXECUTABLE_PATH` in `.env`. |
| **Git (optional)** | any | https://git-scm.com/ | Only needed if you'll pull source updates later. |

> **Phase 4 retired Nginx and PM2 from the customer-facing path.** The Fastify API serves the SPA's static bundle directly on `:3000` (HTTPS), and the API is launched manually for smoke-test (`cd api; node dist/app.js`). A managed Windows-service launcher is Phase 5 work — for now there is no auto-restart-on-crash and no boot persistence. If you want a reverse proxy or SPA-only static server, install Nginx or IIS yourself; nothing in the install script depends on it.

> **Windows Server SKU note:** Phase 3 of windows-friendly-rewrite swapped
> the PDF/chart pipeline to puppeteer-core + @napi-rs/canvas, so **Windows
> Server Core works** for the API itself (Mosquitto and graphile-worker run
> headless; PDFs use Edge headless which doesn't require `dwm.exe`). The
> remaining "Desktop Experience" requirement is the PostgreSQL installer GUI
> — use the headless installer or run the install via psql on Core.

---

## 4. Prepare the deployment package on your dev machine

Before shipping the ZIP to the customer, run the packaging script **on your
development machine** (the one you've been using to build):

```powershell
# From the repo root:
powershell -ExecutionPolicy Bypass -File scripts/package-for-production.ps1
```

This builds the API and web bundles, copies the APK, certs, and .env template
into a `digilog-production/` folder, and creates `digilog-production.zip` next
to it. Transfer that ZIP to the customer by whatever means you prefer (USB,
secure file share, email if under 25 MB).

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

-- Create the two databases
CREATE DATABASE digilog_db     OWNER digilog;
CREATE DATABASE digilog_tsdb   OWNER digilog;

-- Enable TimescaleDB on the time-series DB
\c digilog_tsdb
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

Verify:

```sql
\c digilog_db
SELECT current_database();   -- should print digilog_db
\c digilog_tsdb
SELECT extname FROM pg_extension WHERE extname = 'timescaledb';
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
# ─── PostgreSQL ────────────────────────────────────────
DATABASE_URL=postgresql://digilog:CHANGE_ME_STRONG_PASSWORD@localhost:5432/digilog_db?schema=public
TSDB_HOST=localhost
TSDB_PORT=5432
TSDB_DATABASE=digilog_tsdb
TSDB_USER=digilog
TSDB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

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

### 5.4 Run the install script

```powershell
cd C:\DigiLog
powershell -ExecutionPolicy Bypass -File scripts\install-on-target.ps1
```

This does (9 steps):
1. **Sanity checks** — verifies `api/`, `.env`, Node.js, npm, `psql` (warns if missing), Microsoft Edge (warns if missing — needed for PDF reports)
2. **Enables Windows long-paths** — sets `HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`
3. **Installs Mosquitto 2.0** — invokes `scripts/install-mosquitto.ps1` (idempotent — silently installs MSI, registers the Windows service, copies the conf, rewrites paths to absolute)
4. **Copies `.env` into `api/`** — so the compiled API can read it
5. **`npm ci --omit=dev`** in `api/` — installs production dependencies from the lockfile
6. **`npx prisma generate`** — generates the Prisma client against the deployed schema
7. **`npx prisma migrate deploy`** — applies every migration to `digilog_db`
8. **`npx prisma db seed`** — creates the SUPER_ADMIN role and default superadmin user (config registry also auto-seeds on first API start, so this is best-effort)
9. **Opens Windows Firewall** — ports **80**, **443**, **3000**, **1883**

After the script finishes, **launch the API manually for smoke-test:**

```powershell
cd C:\DigiLog\api
node dist/app.js
```

> **Phase 4 honest disclaimer:** the API runs in the foreground in this console window. There is no auto-restart on crash, no boot persistence, no log rotation. This is for smoke-testing only. A managed Windows-service launcher (NSSM or `sc.exe`-registered service via `verify-windows-deployment.ps1`) is tracked as **Phase 5 work** of the windows-friendly-rewrite plan.

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

# 2. TimescaleDB extension is loaded on the time-series DB
psql -U digilog -d digilog_tsdb -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb';"
# → should print one row with the extension version

# 3. graphile-worker schema bootstrapped on first API connect
psql -U digilog -d digilog_db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='graphile_worker';"
# → should print a non-zero count (jobs, job_queues, known_crontabs, migrations, etc.). Schema auto-creates on first API start; if zero, the API hasn't connected yet.

# 4. Memurai (Redis) — ONLY required for pub/sub features (WebSocket events, RPC, tracer, debug recorder)
redis-cli -p 6379 ping
# → should print PONG (skip if Memurai is not installed)

# 5. Mosquitto service is running
Get-Service mosquitto
# → Status: Running, StartType: Automatic
Test-NetConnection -ComputerName localhost -Port 1883
# → TcpTestSucceeded : True

# 6. API is responding (run AFTER you start the API console with `cd api; node dist/app.js`)
curl -k https://localhost:3000/health
# → returns {"error":"UNAUTHORIZED","message":"Missing token"}  (expected — TLS handshake succeeded, route requires auth)

# 7. SPA is being served by the API directly (Phase 4: no Nginx)
curl -k https://localhost:3000/
# → returns HTML containing <title>DigiLog</title>

# 8. Can log in
# Open a desktop browser on the server itself:  https://localhost:3000
# Default credentials: superadmin / Admin@123
# CHANGE the superadmin password immediately after first login.
```

If step 6 fails, check the API console output directly (it's running in the foreground). Most likely causes: `DATABASE_URL` wrong, TimescaleDB extension missing, or `MOSQUITTO_ADMIN_PASSWORD` / `MOSQUITTO_REFRESH_TOKEN` blank in `.env` (the API refuses to start with a blank token when `USE_MOSQUITTO=true`).

---

## 7. Auto-start on boot — Phase 5 work

**There is no auto-start in this phase.** PM2 was retired in Phase 4 of the windows-friendly-rewrite, and a managed Windows-service launcher has not yet shipped. PostgreSQL, Mosquitto, and (if installed) Memurai all register as Windows services by default and auto-start on reboot — only the **API** needs manual relaunch right now.

If you need auto-restart today, the simplest stopgap is **NSSM**:

```powershell
# Download nssm from https://nssm.cc/download
nssm install digilog-api "C:\Program Files\nodejs\node.exe" "C:\DigiLog\api\dist\app.js"
nssm set digilog-api AppDirectory C:\DigiLog\api
nssm set digilog-api AppStdout C:\DigiLog\logs\api.out.log
nssm set digilog-api AppStderr C:\DigiLog\logs\api.err.log
nssm start digilog-api
```

`scripts/verify-windows-deployment.ps1` (shipped in Phase 5.2 — commit `b4ad539`, review-fix `ad07280`) provides a smoke-check today: API `/api/health`, Mosquitto port 1883, graphile-worker schema, and end-to-end PDF generation. A fully managed-service launcher (with restart policies, log rotation, and boot persistence) remains Phase 5+ work — the NSSM stopgap above covers it for now.

---

## 8. Backups

**Daily, automated via Windows Task Scheduler:**

```powershell
# Dump both databases to C:\DigiLog\backups\
pg_dump -U digilog -F c -f C:\DigiLog\backups\digilog_db-$(Get-Date -Format yyyy-MM-dd).dump digilog_db
pg_dump -U digilog -F c -f C:\DigiLog\backups\digilog_tsdb-$(Get-Date -Format yyyy-MM-dd).dump digilog_tsdb
```

Keep at least **7 daily + 4 weekly** backups off-server (external drive,
cloud, or file share).

---

## 9. Updating to a new version

When you ship a new build:

1. On your dev machine, run `scripts/package-for-production.ps1` again.
2. On the target machine, **stop the API first** — Ctrl-C in the API console, or `nssm stop digilog-api` if you registered it as a service.
3. Replace `C:\DigiLog\api\` and `C:\DigiLog\web\` with the new folders from the ZIP. **Do NOT overwrite `.env` or `certs/`.**
4. Apply any new migrations:
   ```powershell
   cd C:\DigiLog\api
   npx prisma migrate deploy
   ```
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

## 10. Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tablet login fails with "unable to parse tls packet header" | API is running plain HTTP | Check `.env` has `API_HTTPS=true` and restart the API console (Ctrl-C, `node dist/app.js` again) |
| Tablet login fails with "certificate not trusted" | `rootCA.pem` not installed on the tablet | Re-do section 5.5 for that tablet |
| API 500 errors, log says "TimescaleDB extension not found" | Extension not installed on `digilog_tsdb` | `psql -d digilog_tsdb -c "CREATE EXTENSION timescaledb;"` |
| API 500, log says "Cannot connect to Postgres on queue connection" | DATABASE_URL/DATABASE_URL_QUEUE wrong, or Postgres down | Verify `psql -U digilog -d digilog_db -c "SELECT 1;"` works; check the API console output |
| WebSocket events / RPC / debug-recorder failing | Memurai not running (queue still works) | `Start-Service Memurai` — these features are optional after Phase 2 of windows-friendly-rewrite |
| Login works but no data loads | CORS rejecting the origin | Add the LAN IP/hostname to `ALLOWED_ORIGINS` in `.env` and restart the API console |
| Can't find superadmin login after install | Seed didn't run | `cd C:\DigiLog\api; npx prisma db seed` (or restart the API — config registry auto-seeds on first start) |
| API doesn't survive reboots | No managed-service launcher yet | Phase 5 work; for now use NSSM (see section 7) or relaunch manually after reboot |
| MQTT (data ingestion) not working | Mosquitto service not running, firewall, or stale dynsec | `Restart-Service mosquitto`; check Windows Firewall allows port 1883; verify `Get-Content "C:\Program Files\mosquitto\mosquitto.log"` for plugin / auth errors. After every `POST /api/internal/mqtt/refresh-acl`, copy `<repo>/mosquitto/dynamic-security.json` into `C:\Program Files\mosquitto\` and restart the service. |
| Reports/PDF generation fails with "executable not found" | Microsoft Edge missing on the host | Install Edge from https://www.microsoft.com/edge OR set `PUPPETEER_EXECUTABLE_PATH` in `.env` to a Chromium-family browser path |

---

## 11. Handover checklist (print this for the customer)

Give the customer a printed copy of this list:

- [ ] Windows machine meets the prerequisites (section 3)
- [ ] Received `digilog-production.zip`
- [ ] Installed Node.js, PostgreSQL 18 + TimescaleDB. (Memurai optional — only for non-queue pub/sub. Mosquitto installs automatically via `scripts/install-on-target.ps1`.)
- [ ] Unzipped to `C:\DigiLog\`
- [ ] Created `digilog_db` + `digilog_tsdb` databases (section 5.2)
- [ ] Filled in `.env` — **database password + JWT secrets + Mosquitto admin password + Mosquitto refresh token changed from defaults**
- [ ] Ran `scripts\install-on-target.ps1` (which also runs `install-mosquitto.ps1`)
- [ ] Launched the API for smoke-test (`cd api; node dist/app.js`)
- [ ] Verified all 8 smoke tests (section 6) pass
- [ ] Changed superadmin password from `Admin@123`
- [ ] Installed `rootCA.pem` on each tablet (section 5.5)
- [ ] Installed `DigiLog-FilterOps.apk` on each tablet (section 5.6)
- [ ] Logged in from each tablet successfully
- [ ] (Optional, until Phase 5 lands) Registered the API as an NSSM service for auto-restart (section 7)
- [ ] Configured daily backups (section 8)
- [ ] Saved the admin password and DB password in a password manager

---

## 12. Support contact

For technical questions during or after installation, contact the
development team with:

- The exact step number from this guide where the issue occurred
- The last 100 lines of the API console output (or, if running under NSSM, the contents of `C:\DigiLog\logs\api.err.log`)
- Screenshots of any error messages
- The target OS version (run `systeminfo | findstr /B /C:"OS Name" /C:"OS Version"`)
