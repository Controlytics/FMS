# DigiLog — Application Architecture & Offline Deployment Readiness Assessment

> Assessed against branch `RFID`, 2026-07-25. Every claim below is backed by a
> file/line reference from the live codebase. Roles applied: Solution Architect,
> Enterprise Software Architect, DevOps, Network Security, Deployment Specialist.

---

## 1. Executive Summary

**DigiLog is a self-contained, local-first, on-premises application. It is designed
to run on a single Windows host on a private LAN with no cloud dependencies.** The
core product — login, RBAC, filter cleaning operations, PM scheduling, the 21 CFR
Part 11 audit trail and hash chain, backup/restore, reporting, offline sync — has
**zero Internet dependency**. It boots, serves, authenticates, and persists entirely
against a local PostgreSQL database and a locally-served static SPA.

There were exactly **two** categories of external reference in the codebase, and
**neither blocked core operation**. The first has now been **resolved** (see the
2026-07-25 update below); the second is opt-in and never fires by default:

| # | External reference | Blocking? | Status |
|---|--------------------|-----------|--------|
| 1 | ~~Google Fonts CDN in `apps/web/index.html`~~ | ❌ No | ✅ **RESOLVED 2026-07-25** — fonts self-hosted (`apps/web/public/fonts/`). Zero external refs remain. |
| 2 | **Optional outbound notification channels** (cloud email OAuth, Twilio/Vonage SMS) | ❌ No | Opt-in, admin-configured. Blank by default → no-op. Email also supports plain LAN SMTP. |

**Final verdict: YES — DigiLog can be deployed and operated successfully in a fully
isolated plant environment with only a local network and no Internet access.** As of
the 2026-07-25 change below, there is **no baked-in external reference at all**.

### Resolution log — 2026-07-25

- **Fonts self-hosted (the only baked-in external reference — eliminated).** The three
  faces (Bricolage Grotesque, Sora, JetBrains Mono) are now served from
  `apps/web/public/fonts/` (11 `.woff2` files + `fonts.css` with local `/fonts/*` `src`
  URLs). `apps/web/index.html` loads `<link rel="stylesheet" href="/fonts/fonts.css">`
  instead of the Google CDN `<link>`s. Verified after `vite build`: **0** `googleapis`/
  `gstatic` references anywhere in `dist/`, and all 11 woff2 + `fonts.css` are in the PWA
  service-worker precache (`sw.js`) — so fonts render identically whether LAN-served,
  Internet-air-gapped, or tablet-offline-from-LAN.
- **Secrets finding corrected (was overstated).** The `CHANGE_IN_PRODUCTION` placeholders
  live **only** in the local-dev `apps/api/.env`, which is `.gitignore`d and never
  shipped. The customer installer (`scripts/install.ps1:121-149`) generates fresh,
  cryptographically-random 48-byte secrets (`NewSecret` → `RandomNumberGenerator`) for
  `JWT_SECRET`, `VERIFICATION_TOKEN_SECRET`, and `OFFLINE_REPLAY_SECRET` on every fresh
  install, and preserves them idempotently on upgrade. **No action needed** — production
  secret rotation is already handled. (Item struck from Risks/§12 accordingly.)
- **Remaining items are operational, not code:** notification posture (use a LAN SMTP
  relay / GSM gateway in air-gapped sites), Windows-service auto-start, `pg_dump` backups,
  and off-host backup of `AUDIT_CHAIN_KEY` if enabled. These are runbook items, already
  documented in §5, §11, §12.

---

## 2. Application Architecture

Monorepo (npm workspaces + Turborepo), three deployable surfaces plus shared packages:

```
apps/api/         Fastify backend (TypeScript, Node 20+, port 3000, TLS)
apps/web/         React 19 SPA (Vite 6 build → static dist/)
apps/android/     Capacitor wrapper → DigiLog-FilterOps.apk (loads the SPA)
rfid_scan_app/    Native Kotlin UHF RFID scanner (KC-series readers)
packages/shared/  Permissions / privileges / reauth / zod schemas
```

### Architecture diagram (Mermaid)

```mermaid
flowchart TB
    subgraph Plant LAN — no Internet required
        subgraph Clients
            B[Desktop Browser<br/>Vite-built SPA]
            T[Android Tablet<br/>Capacitor APK]
            R[RFID Scanner App<br/>Kotlin, UHF reader]
        end

        subgraph Server Host — single Windows PC
            API[Fastify API :3000 HTTPS<br/>Node 20+ / tsx or node dist]
            STATIC[Static SPA served by<br/>@fastify/static from web/dist]
            JOBS[graphile-worker<br/>notification / pm-overdue /<br/>password-expiry / session-sweep]
            PG[(PostgreSQL 18<br/>digilog_db)]
        end

        B -->|HTTPS REST| API
        T -->|HTTPS REST + offline IndexedDB sync| API
        R -->|HTTPS REST| API
        API --> STATIC
        API --> PG
        JOBS --> PG
        API -. in-process EventEmitter bus .- API
    end

    subgraph Optional — only if Internet + admin config present
        SMTP[LAN or Cloud SMTP relay]
        MSGRAPH[MS365 / Gmail OAuth]
        SMS[Twilio / Vonage / HTTP SMS gateway]
        LDAP[LDAP / AD server on LAN]
    end

    API -.optional notify.-> SMTP
    API -.optional notify.-> MSGRAPH
    API -.optional notify.-> SMS
    API -.optional auth.-> LDAP
```

**Key architectural facts:**
- No web server (IIS/Nginx/Apache) required — Fastify serves both the API *and* the
  static SPA via `@fastify/static` (`apps/api/src/app.ts:8`). Self-hosted Node process.
- No Docker/Kubernetes. No message broker (MQTT/Mosquitto removed 2026-06-17). No Redis
  (removed; in-process EventEmitter bus). No TimescaleDB (dropped 2026-06-11).
- Scheduled work runs in-process (node-cron) — no queue service, no external scheduler.
- Pub/sub is an in-process EventEmitter — nothing leaves the host.

---

## 3. Technology Stack

| Layer | Technology |
|-------|------------|
| Languages | TypeScript (API + web), Kotlin (RFID app), Java (Capacitor plugin) |
| Backend framework | **Fastify 5** (`apps/api/package.json:29`) |
| Frontend framework | **React 19 + Vite 6**, React Router 7, SWR, Tailwind CSS 4 |
| Database | **PostgreSQL 18** via **Prisma 6** (61 models, 24 enums) — single DB `digilog_db` |
| Auth (authN) | Local JWT (`jose`), bcrypt password hashing; optional LDAP (`ldapts`) |
| Auth (authZ) | Permission-based RBAC — `PERMISSION_TREE` (102 perms / 83 privileges / 92 reauth actions) |
| File storage | **Local filesystem** — `UPLOAD_DIR=./uploads` (`apps/api/.env:48`) |
| Logging | Fastify built-in logger + hash-chained `audit_trail` (SHA-256 / HMAC-SHA256) |
| Reporting | **Client-side** `jspdf` + `jspdf-autotable` + `exceljs` (no server Chromium) |
| Background jobs | graphile-worker: `notification`, `pm_overdue_check`, `password_expiry`, `session_sweep` (`apps/api/src/app.ts:44-47`) |
| Cache | In-memory (30s auth cache, 10s reauth cache) — no external cache store |
| Messaging/pub-sub | In-process EventEmitter (no broker) |
| Offline | IndexedDB queue + sync engine (`apps/web`), Capacitor Network plugin, PWA service worker |
| Build | `tsc` (API), `vite build` (web), Gradle (APK) |
| Runtime | Node.js 20+, PostgreSQL 18 |

---

## 4. Deployment Requirements

**How it should be deployed:** self-hosted Node process on one Windows host, serving
the pre-built SPA statically, backed by a local PostgreSQL instance. Clients (browsers,
tablets, RFID app) connect over the LAN via HTTPS.

| Requirement | Detail | Source |
|-------------|--------|--------|
| Web server (IIS/Nginx/Apache) | **Not required** — Fastify self-serves API + SPA | `app.ts:8` (`@fastify/static`) |
| Container/Docker | **Not required** | — |
| Windows service | Optional (run `node dist/app.js` as a service for auto-start); dev uses `tsx watch` | `apps/api/CLAUDE.md` |
| Runtime prerequisites | **Node.js 20+**, **PostgreSQL 18** | `CLAUDE.md` |
| PostgreSQL extensions | `ltree`, `pgcrypto` (`prisma/sql/extensions.sql`) — required before `migrate deploy` | `apps/api/CLAUDE.md` |
| Ports | **3000** (API+SPA, HTTPS), **5432** (PostgreSQL, localhost only) | `apps/api/.env:36` |
| Firewall | Inbound TCP **3000** from LAN clients. PostgreSQL stays localhost-bound (no external rule). | `.env` |
| Certificates | TLS cert/key at `certs/server.{key,crt}` rooted by `rootCA.pem` (mkcert). **APK requires HTTPS**; tablets must trust `rootCA.pem`. | `CLAUDE.md` TLS notes |
| OS features | None beyond Node + PostgreSQL. Windows 10/11. (Linux-compatible in principle — no OS-locked APIs — but only Windows is supported/tested.) | `CLAUDE.md` |

---

## 5. Hosting Recommendation

**Single-host, self-hosted deployment on the plant's Windows server/PC:**

1. Install **Node.js 20+** and **PostgreSQL 18** (offline installers).
2. Create `digilog_db`; apply `ltree` + `pgcrypto` extensions; run `npx prisma migrate deploy`; seed with `INITIAL_ADMIN_PASSWORD`.
3. Build the SPA once (`vite build` → `apps/web/dist/`); Fastify serves it.
4. Run the API as a Windows service (`node apps/api/dist/app.js`) for auto-start/restart. `start-digilog.bat` / `stop-digilog.bat` exist for manual control.
5. Provision mkcert TLS certs; install `rootCA.pem` on every tablet.
6. Open firewall inbound TCP 3000 to the plant subnet only.

No reverse proxy is required, though Nginx/IIS in front is a valid hardening option
(TLS termination, request logging) — **optional, not required**.

---

## 6. External Communication Analysis (Runtime Outbound Requests)

Every outbound network request the code can make, with trigger and necessity:

| Destination | Protocol / Method | Module | Trigger | Essential? | Internet? |
|-------------|-------------------|--------|---------|-----------|-----------|
| `fonts.googleapis.com` / `fonts.gstatic.com` | HTTPS GET (browser) | `apps/web/index.html:26-28` | Every SPA page load | No — CSS falls back to system fonts | Yes (but non-blocking) |
| Configured SMTP host | SMTP | `email-channel.ts` (nodemailer) | A notification fires **and** email channel is configured | No | **Depends** — LAN relay = no Internet; cloud host = Internet |
| `login.microsoftonline.com`, `outlook.office365.com` | HTTPS POST | `email-channel.ts:47,68,75` | Email channel with `authType: oauth2`, provider MS365 | No | Yes |
| `oauth2.googleapis.com` | HTTPS POST | `email-channel.ts:118` | Email channel with Google OAuth2 | No | Yes |
| `api.twilio.com` | HTTPS POST | `sms-channel.ts:40` | SMS notification + Twilio configured | No | Yes |
| `rest.nexmo.com` (Vonage) | HTTPS POST | `sms-channel.ts:72` | SMS notification + Vonage configured | No | Yes |
| Custom HTTP SMS gateway | HTTPS POST | `sms-channel.ts` | SMS notification + http-gateway configured (can target a LAN gateway) | No | Depends |
| LDAP/AD server | LDAP(S) | `modules/ldap`, `ldapts` | LDAP login, if enabled | No | No (on-prem LAN) |

**Nothing fires at boot.** `apps/api/src/app.ts:1-60` imports only local modules,
Fastify plugins, and the Postgres-backed job runner. No telemetry, analytics, license
check, or update poll exists anywhere in the codebase or dependency tree.

Non-network `http(s)://` string matches confirmed as **not** network calls: `www.w3.org`
(SVG `xmlns` namespace, `select.tsx:37` etc.), placeholder example URLs in config form
fields (`email-settings.tsx:482,486,832`, `equipment-groups.tsx:594`), and test fixtures
(`__tests__/*` with `192.168.1.55`, `example.com`, etc.).

---

## 7. Internet Dependency Report

| Finding | File:Line | URL / Endpoint | Purpose | Internet required? | Replaceable locally? | Recommendation |
|---------|-----------|----------------|---------|--------------------|--------------------|----------------|
| ~~Google Fonts stylesheet~~ | ~~`apps/web/index.html:28`~~ | ~~`fonts.googleapis.com/css2?...`~~ | Fonts | No | — | ✅ **RESOLVED 2026-07-25** — self-hosted at `/fonts/fonts.css`; no external ref remains. |
| MS365 email OAuth | `email-channel.ts:47,68,75`, `routes.ts:227-316` | Microsoft login/Graph | Cloud-email notification auth | Only if configured | Use LAN SMTP relay instead | Leave unconfigured, or point email at a plant SMTP relay. |
| Gmail OAuth | `email-channel.ts:118` | `oauth2.googleapis.com` | Gmail notification auth | Only if configured | LAN SMTP relay | Same as above. |
| Twilio SMS | `sms-channel.ts:40` | `api.twilio.com` | SMS notifications | Only if configured | No cloud-free SMS; use a LAN GSM gateway via http-gateway | Leave SMS disabled unless a gateway exists. |
| Vonage SMS | `sms-channel.ts:72` | `rest.nexmo.com` | SMS notifications | Only if configured | LAN GSM gateway | Same. |

**No** hardcoded cloud APIs, CDN JS/CSS libraries, external auth providers, license
validation, update services, telemetry, analytics, cloud storage, or push-notification
services exist. All JS/CSS libraries are bundled at build time by Vite. Swagger UI
assets are served locally by `@fastify/swagger-ui` (no CDN).

---

## 8. Third-Party Service Inventory

| Service | Used for | Offline classification |
|---------|----------|------------------------|
| PostgreSQL 18 (local) | Primary datastore + job queue | **Offline compatible** (self-hosted) |
| Google Fonts | Typeface | Internet-optional (graceful fallback) |
| MS365 / Gmail (SMTP OAuth) | Email notifications | Internet-required — **optional feature** |
| Twilio / Vonage | SMS notifications | Internet-required — **optional feature** |
| LDAP / Active Directory | Optional enterprise login | LAN service (no Internet) |
| SMTP relay (nodemailer) | Email notifications | LAN-compatible (no Internet if relay is local) |

**Dependency classification (npm):**
- **Offline-compatible (all runtime deps):** fastify + plugins, @prisma/client, prisma,
  bcrypt, jose, zod, nodemailer, ldapts, exceljs, adm-zip, sanitize-html, dotenv (API);
  react, react-dom, react-router-dom, swr, react-hook-form, jspdf, jspdf-autotable,
  exceljs, lucide-react, clsx, tailwind-merge (web). None phone home, download resources,
  validate licenses, or check for updates at runtime.
- **Internet-optional:** none structurally — the only Internet use is data the operator
  explicitly points at a cloud endpoint (email/SMS config).
- **Internet-required:** none.

Build-time tools (`vite`, `tsc`, `tsx`, `vitest`, Gradle, `@tailwindcss/vite`,
`vite-plugin-pwa`) fetch packages **once during `npm install` / build** — that must be
done before shipping to the plant (or via an offline npm cache). At **runtime** they are
not involved.

---

## 9. Configuration Review

`apps/api/.env` (the single config source) is **fully local** — no external URLs, public
IPs, domains, cloud endpoints, license servers, or update servers:

- `DATABASE_URL=postgresql://digilog:...@localhost:5432/digilog_db` (`.env:2`)
- `CORS_ORIGIN` / `ALLOWED_ORIGINS` = `localhost:5175/5173/3000` (`.env:44-45`)
- `API_PORT=3000`, `API_HTTPS=true`, `UPLOAD_DIR=./uploads` (`.env:36,41,48`)
- Secrets (`JWT_SECRET`, `OFFLINE_REPLAY_SECRET`, optional `AUDIT_CHAIN_KEY`) are local.

Runtime service config (SMTP host, SMS credentials, LDAP) lives in the DB `system_config`
table, configured via the UI — **blank by default**, so a fresh install has no external
endpoints until an admin deliberately adds one.

> ⚠️ **Production hardening (not offline-related):** `JWT_SECRET` and
> `VERIFICATION_TOKEN_SECRET` in `.env` carry the literal `CHANGE_IN_PRODUCTION`
> placeholder values. Rotate these to strong random secrets per install (§11).

The APK bakes `VITE_API_URL=https://<plant-IP>:3000` at build, but a tablet's stored
Server Address (`localStorage['digilog.serverUrl']`) overrides it — so the server URL is
set on-device, LAN-local.

---

## 10. Offline Compatibility Assessment

| Capability | Works fully offline? | Notes |
|------------|----------------------|-------|
| Login / JWT auth / RBAC | ✅ | Local bcrypt + `jose`, no external IdP |
| Filter cleaning operations (start/advance/checklist/bypass/terminate) | ✅ | Server + Postgres only |
| Bulk filter-operate (tablet 50–100 tags) | ✅ | Local |
| Offline tablet sync (IndexedDB queue) | ✅ | Designed for intermittent LAN; syncs to local API |
| RFID assign/scan | ✅ | Native reader + local API |
| PM scheduling, replacement schedule | ✅ | Local jobs |
| 21 CFR Part 11 audit trail + hash chain | ✅ | Local SHA-256/HMAC |
| Backup / restore (all tables) | ✅ | Local files |
| Reporting / PDF / Excel export | ✅ | **Client-side** jspdf/exceljs — no server Chromium, no cloud |
| Config, roles, themes | ✅ | Local |
| **Fonts (visual polish)** | ✅ | Self-hosted 2026-07-25 (`public/fonts/`); pixel-perfect offline, PWA-precached |
| **Email notifications** | ⚠️/❌ | Works with a **LAN SMTP relay**; cloud OAuth email needs Internet |
| **SMS notifications** | ❌ | Cloud gateways need Internet; a LAN GSM gateway (http-gateway) works |

**Nothing in the core workflow fails offline.** Only the two optional/cosmetic surfaces
degrade.

---

## 11. Risks

| Risk | Severity | Impact | Mitigation |
|------|----------|--------|------------|
| ~~Google Fonts `<link>` in `index.html`~~ | ~~Low~~ | — | ✅ **RESOLVED 2026-07-25** — fonts self-hosted |
| ~~Placeholder JWT secrets in `.env`~~ | ~~High~~ | — | ✅ **NON-ISSUE** — installer (`scripts/install.ps1`) generates random per-install secrets; `.env` placeholders are dev-only and gitignored |
| Email/SMS misconfigured to cloud in an air-gapped plant | Medium | Notification sends fail silently; operators may not get alerts | Use LAN SMTP relay; leave SMS off or use LAN gateway; document in runbook |
| `AUDIT_CHAIN_KEY` loss (if enabled) | High (compliance) | v3 audit rows become permanently unverifiable | Back the key up **outside** the DB host |
| npm/build artifacts require Internet to *produce* | Low | Only affects build machine, not the plant host | Build before shipping, or ship an offline npm cache |
| Single-host, no HA | Medium | Host failure = downtime | Windows service auto-restart + scheduled `pg_dump` backups |

---

## 12. Recommended Changes (to reach a perfectly clean air-gapped deployment)

1. ✅ **DONE (2026-07-25) — Self-hosted the three fonts.** The `.woff2` files for
   Bricolage Grotesque / Sora / JetBrains Mono are in `apps/web/public/fonts/` with a
   local `fonts.css`; `index.html` loads `/fonts/fonts.css` instead of the CDN. Verified
   `dist/` has zero `googleapis`/`gstatic` refs and the PWA precaches all faces.
2. ✅ **Already handled — per-install secret generation.** `scripts/install.ps1` generates
   random `JWT_SECRET` / `VERIFICATION_TOKEN_SECRET` / `OFFLINE_REPLAY_SECRET` on fresh
   install (the `.env` `CHANGE_IN_PRODUCTION` placeholders are dev-only, gitignored, never
   shipped). No action required.
3. **Document the notification posture** in the install runbook: for an air-gapped plant,
   either leave email/SMS unconfigured or point email at a **LAN SMTP relay** and SMS at a
   **LAN GSM http-gateway**. Never rely on MS365/Gmail/Twilio/Vonage in an isolated site.
4. **Run the API as a Windows service** and schedule periodic `pg_dump` backups (+ back up
   `AUDIT_CHAIN_KEY` off-host if used).
5. **Optional:** open only inbound TCP 3000 to the plant subnet; keep PostgreSQL bound to
   localhost.

**Status: the app is now offline-clean.** The fonts (the only baked-in external
reference) are self-hosted as of 2026-07-25, and per-install secrets are already
generated by the installer. The only remaining items are operational runbook notes
(items 3–5), not code — no blockers remain.

---

## Final Verdict

> **Can this application be deployed and operated successfully in an isolated client
> environment with only a local network and no Internet access?**
>
> ## ✅ YES.
>
> DigiLog is architecturally local-first and self-hosted. Every core capability —
> authentication, RBAC, filter operations, PM/replacement scheduling, the 21 CFR Part 11
> audit trail and hash chain, backup/restore, client-side reporting, and offline tablet
> sync — runs entirely against a local PostgreSQL database and a locally-served SPA, with
> **no Internet dependency at boot or in any core flow**.
>
> The **only** Internet touchpoints are (1) a cosmetic Google Fonts stylesheet that
> already falls back to system fonts offline, and (2) fully-optional, admin-configured
> outbound notification channels (cloud email OAuth and SMS gateways) that are blank by
> default and have LAN-local alternatives (SMTP relay, GSM http-gateway).
>
> No blocking dependency exists. Self-hosting the three fonts (~5 minutes) removes the
> single baked-in external reference and yields a perfectly clean air-gapped deployment.
