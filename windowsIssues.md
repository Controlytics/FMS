# Windows Server Deployment — Difficulty Audit

Authoritative inventory of features and dependencies in the codebase that are **difficult or impossible to run cleanly on Windows Server**, with mitigations. Pair this with `DEPLOY-WINDOWS.md` (the canonical deployment guide) and `LOCAL_SETUP_WINDOWS.md` (local dev).

**Last verified:** 2026-04-29 against commit `5f56cec` on branch `RFID`.

**Severity legend:**
- 🔴 Hard blocker — won't work without significant work
- 🟡 Soft blocker — works with caveats
- 🟢 Fine on Windows (no concerns)

---

## 🔴 Hard blockers

### 1. Puppeteer (Chromium for PDF generation) — ✅ RESOLVED

**Resolved by:** `abdc9dd feat(reports): switch pdf-renderer from puppeteer to puppeteer-core + Edge` and `79937b7 feat(reports): edge-detector helper for puppeteer-core executablePath` (2026-04-29, on `feature/phase3-reports-edge`).

**Files now:** `apps/api/src/modules/reports/renderers/pdf-renderer.ts`, `apps/api/src/modules/reports/renderers/edge-detector.ts`
**Dependency now:** `puppeteer-core` ^24.42.0 (no bundled Chromium download).

`detectEdgePath()` resolves the browser executable in this order:
1. `PUPPETEER_EXECUTABLE_PATH` env override
2. `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
3. `C:\Program Files\Microsoft\Edge\Application\msedge.exe`
4. `…\Google\Chrome\Application\chrome.exe` (either Program Files variant)
5. Linux: `/usr/bin/chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`
6. macOS: Edge, Chrome, Chromium `.app` bundles

Original pain points all neutralised:
- ~150 MB Chromium download — gone (puppeteer-core bundles nothing)
- Server Core incompatibility — Edge headless does not require `dwm.exe` in modern releases
- AV scanning `chrome.exe` — Edge is a Microsoft-signed binary preinstalled on Win10+/Server 2019+

Cold-start render also dropped from ~34 s (bundled puppeteer first launch) to ~1.9 s on the same hardware. Smoke test at `apps/api/src/modules/reports/renderers/__tests__/pdf-renderer.test.ts` exercises the real Edge headless and asserts `%PDF-` magic bytes for both A4 portrait and landscape.

### 2. `chartjs-node-canvas` + `canvas` (native Skia/Cairo bindings) — ✅ RESOLVED

**Resolved by:** `d72d44c feat(reports): replace chartjs-node-canvas with @napi-rs/canvas` (2026-04-29).

**Files now:** `apps/api/src/modules/reports/renderers/chart-renderer.ts`
**Dependency now:** `@napi-rs/canvas` ^0.1.100 (replaces `chartjs-node-canvas`); `chart.js` 4.x stays; `chartjs-adapter-date-fns` added for time-axis charts.

`@napi-rs/canvas` ships prebuilt N-API binaries for Windows / macOS / Linux on x64 + arm64, so `npm ci` on a clean Windows Server box no longer needs Visual Studio Build Tools, Python, node-gyp, Cairo, or GTK runtime DLLs. The renderer calls `chart.js` directly against an `@napi-rs/canvas` 2D context (one structural-cast required because chart.js's DOM types and @napi-rs/canvas's types aren't nominally identical) and explicitly fills the canvas white before drawing because chart.js leaves it transparent by default and PDF embedders expect opaque.

`renderChart` public signature is unchanged (input config + resolved-series Map → base64 PNG data URL). 4-test smoke covers line / bar / pie + a PNG-signature byte assertion. Suite went from 464 ms (chartjs-node-canvas) to 151 ms.

### 3. EMQX MQTT broker — ✅ RESOLVED

**Resolved by:** `feature/phase1-mosquitto-rewrite` (commits `510f903..7d33dbf`, merged into `windows_dep` via the integration branch). Plus follow-up: `0ecc151 fix(mosquitto): make install script produce a service-bootable conf` (2026-04-29).

**Files now:** `apps/api/src/transport/mqtt-client.ts` selects creds based on `USE_MOSQUITTO`; `mosquitto-acl-generator.ts` + `mosquitto-refresh-routes.ts` produce/regenerate dynsec; `scripts/install-mosquitto.ps1` performs the silent install.

The install script's path-rewrite step is the load-bearing fix discovered during the live Windows Server e2e on 2026-04-29: the SCM-managed Mosquitto service runs with `CWD = System32` and no stdout, so the source `mosquitto.windows.conf` (which uses `./data/`, `./dynamic-security.json`, `log_dest stdout` for dev-foreground use) silently exited the broker on every launch. The install script now rewrites the deployed copy at `C:\Program Files\mosquitto\mosquitto.conf` to use absolute install-dir paths and `log_dest file <InstallDir>/mosquitto.log`. Source conf keeps the relative + stdout values so the dev-mode `mosquitto -c mosquitto.windows.conf` still works from the repo's `mosquitto/` directory.

End-to-end verified live: device `mosquitto_pub` → Mosquitto service → API admin subscriber → graphile-worker `ingestion` task → `ts_pipeline_traces` row in `digilog_tsdb`. No EMQX dependency anywhere; `docker-compose.yml` swap to `eclipse-mosquitto:2.0` shipped in Phase 1.

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

### 7. Memurai (Redis substitute for BullMQ) — ✅ RESOLVED

**Resolved by:** `feature/phase2-pg-queue` cut-over commits ending at `7832af1 chore(queue): drop BullMQ + Redis; graphile-worker is sole backend` (2026-04-29).

**Files now:** `packages/queue/src/index.ts` exports `getProducer()` + `getRunner()` against [`graphile-worker`](https://github.com/graphile/worker), backed by PostgreSQL. `apps/api/.env` no longer needs `REDIS_HOST` / `REDIS_PORT`; queue jobs ride the same Postgres connection as the rest of the app.

Why this kills the issue entirely:
- No separate Redis-protocol service. Memurai (paid for prod) and standalone Redis both gone.
- graphile-worker uses **PG `LISTEN/NOTIFY`** for instant dispatch (no polling), `SELECT … FOR UPDATE SKIP LOCKED` (PG 9.5+) for concurrent worker pickup, `pg_advisory_lock` for cron leader election, and JSONB columns for payloads — all native PG18 features, no extensions.
- `addJob()` runs in the caller's PG transaction, so jobs don't fire if the business txn rolls back (a feature BullMQ never offered).
- Single Postgres backup covers the queue too; no separate Memurai persistence story.

Live-verified: graphile-worker schema auto-bootstraps on first connect, cron task `dlq_check` and `connectivity_check` fire every minute, `ingestion` task processes the live MQTT round-trip (see §3 above).

Redis/Memurai is still used for non-queue pub/sub (WebSocket events, RPC routing, pipeline tracing, debug recorder). Phase 4 of the windows-friendly-rewrite plan will replace those with PG `LISTEN/NOTIFY` for full Redis removal.

### 8. PostgreSQL 18 + TimescaleDB extension

**Files:** `apps/api/prisma/schema.prisma` (65 models, 22 enums), `init-tsdb.sql`, `tsdb-migration/init-hypertables.sql`, `apps/api/prisma/sql/extensions.sql`

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

> **Phase 4 status (2026-04-29):** the bundled Nginx config and PM2 startup helper were both retired from `scripts/install-on-target.ps1` (commits `127f25d`..`60d3c90` on `feature/phase4-tooling`). The customer-facing path is now Fastify-direct on `:3000`. NSSM-as-stopgap is documented in `DEPLOY-WINDOWS.md` § 7 until Phase 5 ships a managed-service launcher (`verify-windows-deployment.ps1`).

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

- Fastify, Prisma client, graphile-worker on Postgres, all pure-JS code (BullMQ + ioredis was retired in Phase 2 of windows-friendly-rewrite, commit `7832af1`)
- React 19 + Vite 6 build (frontend) — pure JS
- ESLint, Vitest, TypeScript — pure JS
- `jose` (JWT), `ldapts` (LDAP), `nodemailer` — pure JS
- PostgreSQL 18 itself (now also hosts the graphile-worker queue schema)
- `mqtt` npm package (the **client**, talking to whatever broker — Mosquitto 2.0 in the current shipping install)
- HTTPS via mkcert (after the cert-import step in §6)
- Windows Service registration via NSSM (stopgap until Phase 5 ships a managed-service launcher)
- Memurai (Redis substitute, paid) — **optional** post-Phase-2; only used for non-queue pub/sub features
- The 30 config defs + 27 config pages + 105 permissions — all pure JS

---

## Recommended deployment stance

For a **Windows Server production deployment**, the realistic stance is:

| Component | Windows-native? | Notes |
|---|---|---|
| Fastify API | ✅ keep | Compiled JS via NSSM service |
| React SPA | ✅ keep | Built artifact, served by Fastify static or IIS |
| PostgreSQL 18 + TimescaleDB | ✅ keep | Pin patch version exactly. Also hosts the graphile-worker job queue. |
| ~~Memurai~~ | ✅ removed | Phase 2: replaced by graphile-worker on Postgres. Redis still used for non-queue pub/sub; Phase 4 will swap to PG `LISTEN/NOTIFY`. |
| MQTT broker | ✅ Mosquitto (Windows-native) | Phase 1: Mosquitto 2.0 silent install via `scripts/install-mosquitto.ps1`. EMQX gone. |
| Reports module (PDF + charts) | ✅ Edge + @napi-rs/canvas | Phase 3: puppeteer-core drives preinstalled Edge; @napi-rs/canvas ships prebuilt N-API. No bundled Chromium, no MSVC, no node-gyp. |
| APK builds | ❌ off-server | Build on dev machine, copy artifact |
| Native RFID hardware | ❌ off-server | Tablet + USB reader on operator floor |
| CI builds | ✅ ubuntu-latest | Leave Windows out of CI loop |

---

## How to use this document

1. **Before deployment:** read this top-to-bottom, audit each 🔴 item against your target environment
2. **During `install-on-target.ps1` development:** every 🟡 mitigation should be enforced or documented in the script
3. **When adding a new dependency to `apps/api/package.json` or `apps/web/package.json`:** check whether it has native bindings or external runtime requirements; add an entry to this document if Windows-hostile
4. **When upgrading PG / Node / Mosquitto:** verify the Windows builds are still in lockstep before upgrading dev environments

## Phase 5 status footnote (2026-04-29)

Phase 5 of the windows-friendly-rewrite did **not** close any of the 18 issue entries directly — Phase 1 (EMQX), Phase 2 (Memurai), Phase 3 (Puppeteer + chartjs-node-canvas), and Phase 4 (Nginx + PM2) had already resolved the four 🔴 hard blockers and reduced the 🟡 surface for §14. What Phase 5 delivers is the **verification gap** that prior phases left open:

- `tests/integration/windows-server-stack.test.ts` (`INTEGRATION_TEST=1`-gated) exercises the post-Phase-1+2+3 stack end-to-end — Mosquitto round-trip → graphile-worker pickup → TimescaleDB hypertable insert → reports/generate → PDF magic bytes — so future regressions surface in CI rather than during a live customer install.
- `scripts/verify-windows-deployment.ps1` (Phase 5.2) gives an operator a one-shot smoke-check that hits the same path on a deployed box, so the receipts in this doc can be re-validated after every install or upgrade.

The two remaining open items — a managed Windows-service launcher (replaces the NSSM stopgap in `DEPLOY-WINDOWS.md` § 7) and end-to-end install-script proof on a fresh box — remain Phase 5+ work.

## Cross-references

- `DEPLOY-WINDOWS.md` — the deployment runbook (mitigations encoded as commands)
- `LOCAL_SETUP_WINDOWS.md` — local dev setup
- `scripts/install-on-target.ps1` — the production installer that should enforce every mitigation here
- `future/qa/KNOWN_ISSUES.md` — operator-facing gotcha summary
- `future/overview/CURRENT_STATUS.md` — KNOWN GOTCHAS taxonomy at the architecture level
