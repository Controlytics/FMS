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
├── web/                           ← built React SPA (static files for nginx / serve)
├── certs/                         ← HTTPS certs (mkcert-generated)
│   ├── server.crt
│   ├── server.key
│   └── rootCA.pem                 ← install this on every tablet
├── DigiLog-FilterOps.apk          ← Android APK for tablets
├── scripts/
│   ├── install-on-target.ps1      ← run once on the target machine
│   ├── start-digilog.ps1          ← start everything
│   └── stop-digilog.ps1           ← stop everything
├── .env.example                   ← copy to .env and edit
└── DEPLOY-WINDOWS.md              ← this file
```

Anything the customer shouldn't need to touch stays inside `api/` and `web/`.
Configuration is all in `.env` and `certs/`.

---

## 2. Architecture

```
┌─────────────── target Windows machine ───────────────┐
│                                                       │
│  ┌─────────┐   ┌────────┐   ┌────────┐   ┌────────┐  │
│  │ Node 20+│   │Postgres│   │Memurai │   │ EMQX   │  │
│  │ API     │←──│ +Timsc │   │(Redis) │   │ MQTT   │  │
│  │ :3000   │   │:5432   │   │:6379   │   │:1883   │  │
│  └────┬────┘   └────────┘   └────────┘   └────────┘  │
│       │                                               │
│  ┌────┴────────────────────┐                          │
│  │  PM2 keeps API alive    │                          │
│  └─────────────────────────┘                          │
│                                                       │
│  ┌────────────────────────┐                           │
│  │  Nginx :80 :443        │  ← serves the SPA         │
│  │  static files + proxy  │    and proxies /api/* →   │
│  │                        │    https://localhost:3000 │
│  └────────────────────────┘                           │
└───────────────────────────────────────────────────────┘
                    ▲
                    │ https
    ┌───────────────┴───────────────┐
    │ Tablets with DigiLog APK      │
    │ (rootCA.pem installed in      │
    │  system cert store)           │
    └───────────────────────────────┘
```

Five components run on the server. Four of them are **off-the-shelf downloads**
(Postgres, Memurai, EMQX, Nginx). The fifth is **your built application**.

---

## 3. Prerequisites to install on the target machine

Do these **once** on the target Windows machine before running the install script.
Each is a Next-Next-Finish installer.

| Software | Version | Install URL | Notes |
|---|---|---|---|
| **Node.js LTS** | 20.x or 22.x | https://nodejs.org/ | Accept default options. Ensures `node` and `npm` are on PATH. |
| **PostgreSQL** | 18 | https://www.postgresql.org/download/windows/ | Remember the password for the `postgres` superuser — you'll need it. Install **Stack Builder** and use it to add the **TimescaleDB** extension afterwards. |
| **TimescaleDB** | latest for PG 18 | https://docs.timescale.com/self-hosted/latest/install/installation-windows/ | Needed for time-series data. Follow their Windows guide — it's a DLL copy + one `CREATE EXTENSION` statement. |
| **Memurai** | Developer Edition | https://www.memurai.com/get-memurai | Redis-compatible server for Windows. The free Developer Edition is enough. |
| **EMQX** | 5.x Windows | https://www.emqx.io/downloads | MQTT broker. Extract the ZIP and run `bin/emqx.cmd start`. |
| **Nginx** | Windows stable | http://nginx.org/en/download.html | Serves the built web SPA and reverse-proxies the API. |
| **Git (optional)** | any | https://git-scm.com/ | Only needed if you'll pull source updates later. |

> **Windows Server SKU note:** On Windows Server 2019/2022, install the
> "Desktop Experience" version so the PostgreSQL and EMQX installers can run.
> On Windows Core, use the headless Postgres installer.

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

This does:
1. `cd api && npm ci --omit=dev` — installs API dependencies from lockfile
2. `npx prisma migrate deploy` — applies every migration to `digilog_db`
3. `npx prisma db seed` (or runs the seed via a node script) — creates the
   SUPER_ADMIN role and default superadmin user
4. Installs **PM2** globally (`npm i -g pm2`) and its Windows startup helper
5. Starts the API under PM2 as `digilog-api`
6. Starts the web static file server (Nginx config is copied into place)
7. Opens Windows Firewall for ports **80**, **443**, **3000**, **1883**, **18083**

### 5.5 Configure Nginx

The script drops a baseline `nginx.conf` next to your Nginx install.
Edit the `server_name` and cert paths if your Nginx lives somewhere else:

```nginx
server {
    listen 443 ssl;
    server_name digilog.local 192.168.1.100;

    ssl_certificate     C:/DigiLog/certs/server.crt;
    ssl_certificate_key C:/DigiLog/certs/server.key;

    root C:/DigiLog/web;
    index index.html;

    # SPA fallback — any unknown path serves index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to the Fastify backend (which is running HTTPS)
    location /api/ {
        proxy_pass https://127.0.0.1:3000/api/;
        proxy_ssl_verify off;           # self-signed internal cert
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Swagger docs (optional — remove in prod if you don't want it exposed)
    location /docs {
        proxy_pass https://127.0.0.1:3000/docs;
        proxy_ssl_verify off;
    }
}

# Redirect plain HTTP to HTTPS
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}
```

Reload Nginx:

```powershell
cd C:\nginx
.\nginx.exe -s reload
```

### 5.6 Install the HTTPS cert on client tablets

The APK connects to `https://<server-ip>:3000` (or `:443` if you've set up
Nginx for port 443). Android requires the signing CA to be trusted. On every
tablet:

1. Copy `certs/rootCA.pem` to the tablet via USB or email.
2. Android → **Settings → Security → Install from storage → CA certificate**.
3. Accept the warning and install.
4. After installation, verify at **Settings → Security → Trusted credentials → User** — you should see the DigiLog root CA.

Without this step the APK will fail to connect with an SSL error.

### 5.7 Install the APK on every tablet

```powershell
# On the tablet (USB connected, USB debugging enabled):
adb install -r DigiLog-FilterOps.apk
```

Or sideload: copy the APK to the tablet's Downloads folder, tap it in the
file browser, accept "Install from unknown sources".

---

## 6. First-run verification

After the install script finishes, verify everything in this order:

```powershell
# 1. PostgreSQL is responding
psql -U digilog -d digilog_db -c "SELECT now();"

# 2. Memurai (Redis) is responding
redis-cli -p 6379 ping
# → should print PONG

# 3. EMQX dashboard is reachable
# Browser: http://localhost:18083  (default login: admin / public)

# 4. API is running under PM2 and responding
pm2 list
# → digilog-api should be online
curl -k https://localhost:3000/health
# → returns {"error":"UNAUTHORIZED","message":"Missing token"}  (expected — it means the server is up)

# 5. Nginx is serving the SPA
curl -k https://localhost
# → returns HTML containing <title>DigiLog</title>

# 6. Can log in
# Open a desktop browser on the server itself:  https://localhost
# Default credentials: superadmin / Admin@123
# CHANGE the superadmin password immediately after first login.
```

If step 4 fails, check:
```powershell
pm2 logs digilog-api --lines 50
```

Most likely cause: `DATABASE_URL` wrong or TimescaleDB extension missing.

---

## 7. Auto-start on boot

```powershell
pm2 save
pm2-startup install
```

This registers PM2 as a Windows service so the API auto-restarts on reboot.
Memurai, PostgreSQL, and EMQX install as Windows services by default and
auto-start already.

For **Nginx on boot**, use **nssm**:

```powershell
# Download nssm from https://nssm.cc/download and extract nssm.exe somewhere
nssm install nginx C:\nginx\nginx.exe
nssm set nginx AppDirectory C:\nginx
nssm start nginx
```

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
2. On the target machine, **stop the API first**:
   ```powershell
   pm2 stop digilog-api
   ```
3. Replace `C:\DigiLog\api\` and `C:\DigiLog\web\` with the new folders from the ZIP. **Do NOT overwrite `.env` or `certs/`.**
4. Apply any new migrations:
   ```powershell
   cd C:\DigiLog\api
   npx prisma migrate deploy
   ```
5. Restart:
   ```powershell
   pm2 restart digilog-api
   C:\nginx\nginx.exe -s reload
   ```
6. Install the new APK on tablets (same `adb install -r` command — `-r` keeps user data).

---

## 10. Common troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tablet login fails with "unable to parse tls packet header" | API is running plain HTTP | Check `.env` has `API_HTTPS=true` and restart: `pm2 restart digilog-api` |
| Tablet login fails with "certificate not trusted" | `rootCA.pem` not installed on the tablet | Re-do section 5.6 for that tablet |
| API 500 errors, log says "TimescaleDB extension not found" | Extension not installed on `digilog_tsdb` | `psql -d digilog_tsdb -c "CREATE EXTENSION timescaledb;"` |
| API 500, log says "BullMQ connection refused" | Memurai not running | `net start Memurai` |
| Login works but no data loads | CORS rejecting the origin | Add the LAN IP/hostname to `ALLOWED_ORIGINS` in `.env` and `pm2 restart digilog-api` |
| Can't find superadmin login after install | Seed didn't run | `cd C:\DigiLog\api && node -e "require('./dist/prisma/seed.js')"` (or run `npx prisma db seed`) |
| PM2 not starting on boot | Startup script not installed | `pm2 save; pm2-startup install` |
| MQTT (data ingestion) not working | EMQX not running or firewall | `cd C:\emqx && bin\emqx.cmd start`; check Windows Firewall allows port 1883 |

---

## 11. Handover checklist (print this for the customer)

Give the customer a printed copy of this list:

- [ ] Windows machine meets the prerequisites (section 3)
- [ ] Received `digilog-production.zip`
- [ ] Installed Node.js, PostgreSQL 18 + TimescaleDB, Memurai, EMQX, Nginx
- [ ] Unzipped to `C:\DigiLog\`
- [ ] Created `digilog_db` + `digilog_tsdb` databases (section 5.2)
- [ ] Filled in `.env` — **database password + JWT secrets changed from defaults**
- [ ] Ran `scripts\install-on-target.ps1`
- [ ] Ran `pm2 save; pm2-startup install`
- [ ] Configured Nginx with cert paths (section 5.5) and set auto-start
- [ ] Verified all 6 smoke tests (section 6) pass
- [ ] Changed superadmin password from `Admin@123`
- [ ] Installed `rootCA.pem` on each tablet (section 5.6)
- [ ] Installed `DigiLog-FilterOps.apk` on each tablet (section 5.7)
- [ ] Logged in from each tablet successfully
- [ ] Configured daily backups (section 8)
- [ ] Saved the admin password and DB password in a password manager

---

## 12. Support contact

For technical questions during or after installation, contact the
development team with:

- The exact step number from this guide where the issue occurred
- The output of `pm2 logs digilog-api --lines 100`
- Screenshots of any error messages
- The target OS version (run `systeminfo | findstr /B /C:"OS Name" /C:"OS Version"`)
