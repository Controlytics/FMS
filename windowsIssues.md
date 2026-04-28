# Windows Server Deployment — Difficulty Audit

Authoritative inventory of features and dependencies in the codebase that are **difficult or impossible to run cleanly on Windows Server**, with mitigations. Pair this with `DEPLOY-WINDOWS.md` (the canonical deployment guide) and `LOCAL_SETUP_WINDOWS.md` (local dev).

**Last verified:** 2026-04-29 against commit `5f56cec` on branch `RFID`.

**Severity legend:**
- 🔴 Hard blocker — won't work without significant work
- 🟡 Soft blocker — works with caveats
- 🟢 Fine on Windows (no concerns)

---

## 🔴 Hard blockers

### 1. Puppeteer (Chromium for PDF generation)

**Files:** `apps/api/src/modules/reports/renderers/pdf-renderer.ts`, `apps/api/src/modules/reports/service.ts`
**Used by:** the entire Reports module (Phases A–F). Every PDF report generation goes through here.
**Dependency:** `puppeteer` ^24.40.0 in `apps/api/package.json`

**Why hard:**
- Bundles ~150 MB Chromium binary at install time; corporate proxies and Windows Defender often kill the download mid-stream
- On Windows Server **Core** edition: won't run at all — Chromium needs `dwm.exe` and a window subsystem even in headless mode
- On Windows Server **with Desktop Experience**: works but eats ~300 MB resident per concurrent PDF; sandbox model conflicts with Server hardening
- Service-account constraint: Puppeteer needs `--no-sandbox` flag when running as `LocalSystem` or `NT SERVICE\*`, which is a security regression
- Antivirus often flags `chrome.exe` spawning from a Node.js process

**Mitigation:**
- Require Server with Desktop Experience installed (not Core)
- Whitelist Chromium in AV
- Or move PDF generation to a Linux container behind an internal queue
- Set `PUPPETEER_EXECUTABLE_PATH` to a manually-installed Edge / Chrome to skip the bundled-Chromium download

### 2. `chartjs-node-canvas` + `canvas` (native Skia/Cairo bindings)

**Files:** `apps/api/src/modules/reports/renderers/chart-renderer.ts`
**Dependency:** `chartjs-node-canvas` ^5.0.0; transitively `canvas` ^x.y.z which compiles native bindings

**Why hard:**
- The `canvas` npm package compiles native bindings against Cairo, Pango, libpng, libjpeg, GIF, FreeType
- On Windows you need:
  - **Visual Studio Build Tools 2022** (~5 GB)
  - Python in PATH for `node-gyp`
- Prebuilt binaries are version-locked to specific Node major versions; one mismatch and `npm install` silently falls back to source build → fails on bare Windows Server
- GTK 2 runtime DLLs sometimes need to be on PATH for the loaded shared library

**Mitigation:**
- Pin Node version exactly to one with prebuilts (Node 22 LTS recommended)
- Pre-stage `node_modules` from a build machine with Build Tools installed; ship that bundle to the server

### 3. EMQX MQTT broker

**Files referenced:** `apps/api/src/transport/mqtt-client.ts`, `mqtt-handler.ts`, `mqtt-auth-routes.ts`; consumed via `MQTT_BROKER_HOST` / `MQTT_BROKER_PORT` env vars
**`docker-compose.yml`:** ships an EMQX container for dev

**Why hard:**
- EMQX is Erlang/OTP-based; Windows builds exist but lag Linux releases by 1–2 weeks
- No `Install-Service` script in the Windows installer — you register manually with NSSM or `sc create`
- EMQX **clustering and EMQX Operator are Linux-only**
- Enterprise license validation calls home over HTTPS; corporate proxies break this
- Telegraf/Prometheus exporters that come with EMQX dashboard require Linux

**Mitigation:**
- Swap for **Mosquitto** (Windows-native MQTT broker, simpler, no enterprise feature parity but adequate for filter-management ingestion)
- Or run only EMQX in a Linux container while keeping the API on Windows

### 4. Bash shell scripts

**Files:** `tests/e2e-scripts/*.sh`, references in `future/testing/README.md` to `bash e2e-functional-test.sh`

**Why hard:** Windows Server doesn't ship `bash`. Need WSL, Git Bash, Cygwin, or a PowerShell rewrite.

**Mitigation:**
- `.bat` and `.ps1` equivalents already exist for `start-digilog`/`stop-digilog`
- E2E shell scripts need PowerShell rewrites
- WSL2 install adds Hyper-V dependency — heavy

---

## 🟡 Soft blockers (work, with caveats)

### 5. Native node-gyp modules in the dependency tree

**Beyond `canvas`:**
- `bcrypt` (used in `apps/api/src/lib/password.ts`)
- Transitively: `node-pty`, `better-sqlite3`, `sharp` (if any image processing pulls it)

**Why caveats:** every one needs MSVC + Python + node-gyp on the deploy machine, OR a successful pre-built `node_modules` bundle shipped from a known-good build host

**Mitigation:** `npm ci --prefer-offline` from a pre-built bundle via `scripts/package-for-production.ps1`; never install from scratch on the server

### 6. `mkcert`-generated TLS certificates

**Files:** `certs/server.{key,crt,csr,ext}`, `certs/rootCA.pem`, `certs/ssl.conf`; consumed by `apps/api/src/app.ts` when `API_HTTPS=true`

**Why caveats:**
- `mkcert` installs the root CA into the **interactive user's** Trusted Root Certification Authorities store
- When the API runs as a Windows service (`LocalSystem` or `NT SERVICE\digilog-api`), it uses the **Local Machine** trust store — invisible to the service
- APK trusts the cert via `Settings → Security → Install certificate` on the tablet; if you regenerate certs, every tablet must reinstall

**Mitigation:**
- `install-on-target.ps1` should run:
  ```powershell
  Import-Certificate -FilePath certs/rootCA.pem -CertStoreLocation Cert:\LocalMachine\Root
  ```
- Verify with `Get-ChildItem Cert:\LocalMachine\Root` before starting the service

### 7. Memurai (Redis substitute for BullMQ)

**Files:** `packages/queue/src/connection.ts`, `apps/api/.env` (`REDIS_HOST`, `REDIS_PORT`)

**Why caveats:**
- **Free Memurai** is fine for single-instance dev; **production-grade requires paid Memurai Enterprise** (~$30/year/server)
- BullMQ assumes Redis-protocol semantics; Memurai is mostly compatible but lacks Redis Cluster mode and Streams clustering
- Service runs as `Memurai` Windows service; failure modes hit Windows Event Log, not stderr
- `connection.ts` exposes `getQueueConnection()` (singleton, producers) vs `getWorkerConnection()` (per-call, workers) — verify Memurai handles `LPOP` / `BLPOP` correctly under load

**Mitigation:** budget for Memurai Enterprise; document explicitly that Linux-Redis is not the production target

### 8. PostgreSQL 18 + TimescaleDB extension

**Files:** `apps/api/prisma/schema.prisma` (64 models, 22 enums), `init-tsdb.sql`, `tsdb-migration/init-hypertables.sql`, `apps/api/prisma/sql/extensions.sql`

**Why caveats:**
- TimescaleDB on Windows tracks **specific PG patch versions**; when PG 18.x patches, TimescaleDB Windows builds lag 1–2 weeks
- Hypertable background workers (compression, retention) occasionally fail to start on Windows — silent until you check `pg_stat_activity`
- `pg_dump` / `pg_restore` on Windows have different default flags than on Linux; `scripts/install-on-target.ps1` migration logic must match
- The PG Windows installer creates `postgres` user with NTFS-level perms that sometimes conflict with the API's service account

**Mitigation:**
- Pin PG patch version in `LOCAL_SETUP_WINDOWS.md` exactly
- Add `CREATE EXTENSION IF NOT EXISTS timescaledb;` smoke-check to `install-on-target.ps1`
- Verify hypertable worker status post-deploy

### 9. PowerShell-only deployment scripts

**Files:** `scripts/install-on-target.ps1`, `scripts/package-for-production.ps1`, `scripts/reset-cwh-cycles.sql`

**Why caveats:**
- `ExecutionPolicy` defaults to `Restricted` on Windows Server; users must run `powershell -ExecutionPolicy Bypass -File ...` or change policy
- Group Policy in AD-joined environments often locks `ExecutionPolicy` to `Restricted` — the GPO overrides user-level changes
- These scripts are not signed; corporate signing requirements may block them entirely

**Mitigation:**
- Sign the `.ps1` files with a code-signing certificate
- Document the bypass-flag invocation
- For AD-locked environments, ship a `.cmd` wrapper that uses `-ExecutionPolicy ByPass -Command` inline

---

## 🟡 APK / Android build chain (only if building APK on the server)

### 10. JDK 21 + Android SDK + Gradle

**Files:** `apps/android/`, `rfid_scan_app/`, references in `apps/web/CLAUDE.md` and `DEPLOY-WINDOWS.md`

**Why caveats:**
- Needs:
  - JDK 21 at a known path (e.g. `C:\Users\hello\jdk-21.0.2`)
  - Android SDK (e.g. `C:\Users\hello\Android\Sdk`)
  - `JAVA_HOME` and `ANDROID_HOME` env vars set system-wide
  - **Long-path support enabled** in registry: `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1`
- Without long paths, Gradle generates paths > 260 chars deep in `node_modules\@capacitor\android\capacitor\android\app\build\generated\...` → `ENAMETOOLONG`
- Domain-joined Windows Servers often have **Group Policy** that disables long paths regardless of registry
- Gradle daemon holds file locks; service restarts require killing `java.exe` first

**Recommended:** **build APKs on a developer Windows desktop**, copy `DigiLog-FilterOps.apk` to the server. Don't try to build on Server.

### 11. RFID native plugin compilation

**Files:** `apps/android/android/app/src/main/java/com/digilog/filtermanagement/RfidPlugin.java`, `Reader_Usb.jar` (vendor-supplied)

**Why caveats:**
- `Reader_Usb.jar` is a vendor-supplied JAR; needs to be in `apps/android/android/app/libs/`
- Capacitor's `cap sync` doesn't auto-copy vendor JARs; manual step in build pipeline
- RFID hardware testing requires the actual KC-series UHF reader USB-attached to the build host

---

## 🟡 Operational hassles

### 12. Filesystem case-insensitivity

**Surface:** anywhere code uses different casing for identifiers (e.g. `ChecklistProfile` vs `checklistprofile`)

**Why caveats:** Windows is case-insensitive by default; bugs that pass Mac/Linux dev review can ship broken on Windows. Common offenders are dynamic `import()` statements with computed paths and `require()` resolution.

**Mitigation:** enable per-directory case-sensitivity for `node_modules` / `apps/web/dist` if needed:
```powershell
fsutil.exe file setCaseSensitiveInfo node_modules enable
```

### 13. NTFS ACL permissions on uploads / reports directories

**Files:** `apps/api/uploads/photos/`, `apps/api/uploads/reports/`

**Why caveats:** the API service account needs explicit `(OI)(CI)Modify` rights on these dirs; default NTFS perms inherit from parent and can deny write

**Mitigation:** `install-on-target.ps1` should run:
```powershell
icacls apps\api\uploads /grant 'NT SERVICE\digilog-api:(OI)(CI)M'
```

### 14. Optional Nginx reverse proxy on Windows

**Why caveats:**
- Nginx for Windows is a community build, lower performance than Linux Nginx
- No Windows Authentication / Kerberos integration
- WebSocket proxying works but reconnection edge cases differ

**Mitigation:**
- Use **IIS with URL Rewrite + ARR** for reverse-proxying `/api` to Fastify, OR
- **Skip the proxy entirely** — Fastify on `:3000` direct + Capacitor APK pointed at it. This is the simpler default for local-Windows deployments.

### 15. `.gradle/`, `.kotlin/`, `node_modules/` cleanup

**Files:** stray `RFID/` directory at repo root (~1.2 MB Gradle cache, separate from `rfid_scan_app/`)

**Why caveats:** these directories pile up and Gradle / npm sometimes refuse to release file handles cleanly. After a failed build, `Remove-Item -Recurse -Force` may fail with "file in use" until processes are killed.

**Mitigation:**
```powershell
Stop-Process -Name java*, gradle*, node -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force <path>
```

### 16. Scheduled background tasks

**Files:** `apps/api/src/workers/maintenance.worker.ts`

**Why caveats:** uses BullMQ scheduling, not OS scheduler. On Linux this is fine. On Windows, if the API service crashes, scheduled jobs lag — there's no `cron`/`systemd timer` fallback.

**Mitigation:** alternatively, register critical maintenance jobs as Windows Scheduled Tasks via `schtasks.exe` from `install-on-target.ps1`

### 17. `node_modules` long paths during install

**Files:** root `package.json` (Turborepo workspaces) + 5 workspace `package.json` files

**Why caveats:** the Turborepo monorepo + Capacitor + Android SDK + Prisma generates extreme path depth. Without `LongPathsEnabled = 1` in registry, install fails cryptically with `ENAMETOOLONG`.

**Mitigation:** `install-on-target.ps1` enables long paths in registry as step 1, requires reboot if first time:
```powershell
New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' `
                 -Name 'LongPathsEnabled' -Value 1 -PropertyType DWORD -Force
```

### 18. CI / GitHub Actions

**File:** `.github/workflows/ci.yml`

**Why caveats:** if CI runs on `windows-latest` runners (Windows Server 2022), all of the above apply. `ubuntu-latest` runners avoid every issue in this list.

**Mitigation:** keep CI on `ubuntu-latest`; the deployable artifact (compiled JS + dist/ + node_modules bundle) is the same regardless of build OS. Build the production bundle from a Linux runner, ship the zip to Windows for `install-on-target.ps1`.

---

## 🟢 Things that work fine on Windows Server

- Fastify, Prisma client, ioredis, BullMQ (assuming Memurai), all pure-JS code
- React 19 + Vite 6 build (frontend) — pure JS
- ESLint, Vitest, TypeScript — pure JS
- `jose` (JWT), `ldapts` (LDAP), `nodemailer` — pure JS
- PostgreSQL 18 itself
- `mqtt` npm package (the **client**, talking to whatever broker)
- HTTPS via mkcert (after the cert-import step in §6)
- Windows Service registration via NSSM
- Memurai (Redis substitute, paid)
- The 30 config defs + 26 config pages + 109 permissions — all pure JS

---

## Recommended deployment stance

For a **Windows Server production deployment**, the realistic stance is:

| Component | Windows-native? | Notes |
|---|---|---|
| Fastify API | ✅ keep | Compiled JS via NSSM service |
| React SPA | ✅ keep | Built artifact, served by Fastify static or IIS |
| PostgreSQL 18 + TimescaleDB | ✅ keep | Pin patch version exactly |
| Memurai | ✅ keep (paid) | Production target, not Redis-on-Linux |
| MQTT broker | ⚠️ swap or container | Mosquitto Windows-native, or EMQX in a Linux container |
| Reports module (Puppeteer + canvas) | ⚠️ Linux container | Biggest pain point — worth carving out |
| APK builds | ❌ off-server | Build on dev machine, copy artifact |
| Native RFID hardware | ❌ off-server | Tablet + USB reader on operator floor |
| CI builds | ✅ ubuntu-latest | Leave Windows out of CI loop |

---

## How to use this document

1. **Before deployment:** read this top-to-bottom, audit each 🔴 item against your target environment
2. **During `install-on-target.ps1` development:** every 🟡 mitigation should be enforced or documented in the script
3. **When adding a new dependency to `apps/api/package.json` or `apps/web/package.json`:** check whether it has native bindings or external runtime requirements; add an entry to this document if Windows-hostile
4. **When upgrading PG / Node / EMQX:** verify the Windows builds are still in lockstep before upgrading dev environments

## Cross-references

- `DEPLOY-WINDOWS.md` — the deployment runbook (mitigations encoded as commands)
- `LOCAL_SETUP_WINDOWS.md` — local dev setup
- `scripts/install-on-target.ps1` — the production installer that should enforce every mitigation here
- `future/qa/KNOWN_ISSUES.md` — operator-facing gotcha summary
- `future/overview/CURRENT_STATUS.md` — KNOWN GOTCHAS taxonomy at the architecture level
