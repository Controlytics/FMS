# DigiLog — Customer `Setup.exe` Packaging Plan

**Status:** PLAN ONLY — no code changes yet. Approve before execution.
**Author:** drafted 2026-06-30
**Goal chosen by user:** a **customer-facing `Setup.exe`** (Inno Setup installer) that installs DigiLog on a fresh Windows PC, **with PostgreSQL bundled**, and runs it as an auto-starting Windows service.
**Out of scope:** the Android APK (`apps/android`) and the native RFID Kotlin app (`rfid_scan_app`) — both are unaffected and keep talking to the installed server over the LAN exactly as today.

---

## 0. TL;DR — what we are building

A single `DigiLog-Setup-vX.Y.Z.exe` that, on double-click:

1. Installs the app + a private Node.js runtime + a private PostgreSQL 18 into `C:\Program Files\DigiLog`.
2. Creates an isolated database under `C:\ProgramData\DigiLog\db` (the customer's data lives here, separate from the program).
3. Generates stable secrets, applies the schema, seeds the `superadmin` account.
4. Registers **two Windows services** (PostgreSQL + DigiLog API) set to auto-start on boot.
5. Drops a Start-menu / desktop shortcut that opens `http://localhost:3000`.

The customer needs **nothing pre-installed** — no Node, no Postgres, no certs.

---

## 1. Why these decisions (the honest reasoning)

| Decision | Why |
|----------|-----|
| **Bundle PostgreSQL** (don't assume it exists) | A customer's IT can't be trusted to have PG 18 on the right port with the right user. Bundling portable Postgres on a **private port (5433)** with its **own data dir** makes it turnkey and avoids clashing with any Postgres they already run. Also keeps audit data in one known, isolated, backup-able location (21 CFR §11). |
| **Localhost over plain HTTP** | The exe serves only `localhost`. The mkcert/HTTPS dance exists today *only* so the Android APK can connect. The **desktop install can run HTTP on localhost** and drop all cert complexity. The APK keeps using HTTPS against the same machine via a separate listener / reverse setup (see §9 — APK connectivity is a known follow-up, not a blocker for the desktop product). |
| **Windows service, not a console window** | Survives reboots, no operator typing `tsx`/`vite`. Professional. |
| **Inno Setup** as the installer tool | Free, mature, scriptable (Pascal), the de-facto standard for Windows app installers. NSIS is the alternative; Inno is friendlier. |
| **Data dir under `C:\ProgramData\DigiLog`** | Survives app upgrades and uninstall. Never co-located with the program files. |

---

## 2. Schema upgrades — DECISION LOCKED: real migrations, no `db push`

> **User directive (2026-06-30):** The product is built for **customer upgrades**, not local-only. The `db push` approach is **eliminated**. This section is a committed decision, not an option.

> **⚠️ PLAN CORRECTION (M0 executed 2026-06-30):** The original draft of this section assumed a naive `db push` setup with a stale baseline that needed *regenerating from `schema.prisma`*. **That was wrong and that step is now deleted** — regenerating from the datamodel would have silently dropped the triggers, functions, manual sequences, and partial unique index that the existing baseline (a `pg_dump`) correctly preserves. The actual state and verified results are below.

### 2.0 — Verified actual state (M0 run, 2026-06-30)

The migration infrastructure was **already converted from `db push` to migrations** by prior work (commit `5141131`, 2026-06-25, *"baseline migration history; make migrate deploy replayable"*). Evidence gathered this session:

- The baseline `00000000000000_baseline/migration.sql` is a full `pg_dump --schema-only` of the live DB — it includes 6 trigger functions, 3 manual sequences, and the `idx_cleaning_cycles_one_in_progress_per_filter` partial unique index that `schema.prisma` cannot express. **It must never be regenerated from the datamodel.**
- Prior incremental migrations are archived under `prisma/migrations_archive_20260624/` (29 migrations). Out-of-band raw objects live in `prisma/sql/{extensions,invariants}.sql`.
- `prisma migrate status` against dev → **"Database schema is up to date!"** (baseline recorded as applied in `_prisma_migrations`).
- `git log` of `schema.prisma` since the baseline commit → **zero commits, no uncommitted changes** → baseline is current.
- **Authoritative acceptance gate PASSED:** built a throwaway `digilog_m0_scratch` DB from empty → `extensions.sql` → `prisma migrate deploy` → then `prisma migrate diff --from-url <scratch> --to-url <dev>` returned **`-- This is an empty migration.`** i.e. a fresh `migrate deploy` reproduces the live dev schema **exactly**. Fresh customer installs are schema-safe. ✅

**Net result:** the scary "db push problem" was **largely already solved**. M0 is therefore *not* a conversion — it shrinks to (a) two real fresh-install bugs found & one fixed (below), (b) document the forward-authoring workflow, (c) a drift guard, (d) seed idempotency — already mostly satisfied.

### 2.0.1 — Bugs M0 surfaced (fresh-install blockers)

1. **🔴 FIXED — seed crashed on fresh installs.** `prisma/seed.ts` still seeded the **deleted** `IngestionSystemConfig` model (dropped in the 2026-06-17 ingestion tear-out) → `prisma.ingestionSystemConfig` is `undefined` → seed threw mid-run, leaving help articles + template kinds unseeded. Latent since 2026-06-17 because dev never re-seeds from scratch. **Removed the dead block (seed.ts lines 331–409). Re-verified: seed now completes** — 33 help articles, 6 template kinds, DB invariants applied, *"Seed completed successfully!"*.
2. **🟡 INSTALLER REQUIREMENT — extensions before deploy.** The baseline uses `ltree`/`pgcrypto` (68 refs) but contains **no `CREATE EXTENSION`**. A bare-DB `migrate deploy` fails unless `prisma/sql/extensions.sql` runs **first**. The installer (§7 step) must `CREATE EXTENSION ltree, pgcrypto` before `migrate deploy`.
3. **🟡 INSTALLER REQUIREMENT — `INITIAL_ADMIN_PASSWORD`.** The seed refuses to run without `INITIAL_ADMIN_PASSWORD` set (security guard against a hardcoded default — `seed.ts:72-75`). The installer must set it (prompt the admin, or generate + force-change). The superadmin `upsert` does **not** overwrite the password on re-run → **seed is already upgrade-safe** for the admin account.

---

**Historical finding (for context):** before commit `5141131`, the project evolved the schema with `prisma db push` (hence the CLAUDE.md `db push --accept-data-loss` references). That era is over; the rules below make it stay over.

**Why `db push` is banned for this product:**
- `db push` compares `schema.prisma` to the DB and **alters the DB to match** — it can and will **drop columns/tables** to converge, with no migration history, no review, and no rollback.
- That is fine for a throwaway dev DB. It is **unacceptable** against a customer's live, audited database that must never silently lose a 21 CFR §11 record.
- A `Setup.exe` for **v2** must apply v2's schema changes to a customer's **existing v1 data** safely, forward-only, and audited.

**The committed model:**
- Every schema change from now on is captured as a checked-in, reviewed `migration.sql` under `apps/api/prisma/migrations/`.
- Installers (fresh **and** upgrade) apply schema **only** via `prisma migrate deploy` — forward-only, never destructive, records each step in the DB's `_prisma_migrations` table.
- `prisma db push` is **forbidden** in any path that touches a customer database, and we add a guard to prevent it (see §2.2).

### 2.1 — Baseline status: DONE & VERIFIED (do NOT regenerate)

The conversion from `db push` to migrations is **already complete** (§2.0). The baseline is a `pg_dump` that `migrate deploy` replays correctly, and the M0 acceptance gate proved a fresh deploy reproduces dev exactly. **There is no baseline regeneration to do — doing so would drop out-of-band objects.**

The repeatable acceptance-gate procedure (re-run before every release to prove fresh installs still match dev):

1. `CREATE DATABASE digilog_scratch; ` then apply `prisma/sql/extensions.sql` (ltree + pgcrypto).
2. `DATABASE_URL=<scratch> npx prisma migrate deploy`.
3. `DATABASE_URL=<scratch> INITIAL_ADMIN_PASSWORD=… npx tsx prisma/seed.ts` (smoke-test the full install path).
4. `npx prisma migrate diff --from-url <scratch> --to-url <dev> --script` → must print `-- This is an empty migration.`
5. Drop the scratch DB.

### 2.1b — Forward-authoring workflow (the genuine remaining gap)

Because the baseline is a `pg_dump` **superset** of `schema.prisma` (it carries triggers/functions/sequences the datamodel can't express), `prisma migrate dev` will report "drift" and its shadow-DB auto-generation is unreliable here. The archived history shows the intended pattern: **hand-authored, timestamped migration folders** (e.g. `20260530_filter_reverse_mirror/migration.sql`). The forward workflow for a schema change is therefore:

1. Edit `schema.prisma`.
2. Generate the *table/column* delta SQL: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` — review it, and **strip the out-of-band noise** (the triggers/functions/sequences that are managed in `prisma/sql/*`).
3. Hand-author any new raw objects (triggers/invariants) into the same migration **and** keep `prisma/sql/*.sql` in sync (defense-in-depth for dev).
4. Save as `prisma/migrations/<UTC-timestamp>_<name>/migration.sql`.
5. Run the §2.1 acceptance gate to prove `deploy` reproduces the new dev schema.
6. `prisma migrate resolve --applied <name>` on existing populated DBs (dev/test) so they don't re-run it.

> **Never** `prisma db push` and **never** `prisma migrate dev`'s auto-baseline against a populated DB. Both are unsafe given the out-of-band objects.

### 2.2 — Guardrails so `db push` can't sneak back

- **Remove convenience scripts** that invoke `db push`; replace with `migrate deploy` equivalents in `package.json`.
- **Drift guard — ✅ IMPLEMENTED** as `scripts/verify-migrations.ps1` (run via `npm run db:verify-migrations`). It builds a throwaway scratch DB from migrations (extensions → `migrate deploy`) and asserts it diffs **empty** against the dev DB; exits 1 with the offending delta on drift. This is the *correct* guard — the naive `migrate diff --from-migrations --to-schema-datamodel --exit-code` would **always false-fail** because the `pg_dump` baseline is a superset of `schema.prisma` (out-of-band triggers/functions/sequences read as permanent "drift"). Verified PASS 2026-06-30. **TODO:** wire it into CI (it currently runs locally on Windows; needs a psql + Postgres service in the CI runner).
- **Doc rule** in `apps/api/CLAUDE.md`: "Schema changes ship as hand-authored timestamped migrations (see EXE-PACKAGING-PLAN §2.1b). `db push` and `migrate dev` auto-gen are forbidden against any populated DB — they can destroy customer audit data." (This supersedes the existing `db push --accept-data-loss` guidance, now obsolete for anything customer-facing.)

### 2.3 — Why this fully removes the "db push issue"

With §2.1 done and §2.2 enforced, **every** customer database — fresh or upgraded — is built and evolved exclusively by reviewed, forward-only migrations recorded in `_prisma_migrations`. There is no code path that can silently drop a column on a customer. Upgrades (§8) become deterministic and auditable, which is exactly what a 21 CFR §11 product requires.

---

## 3. Architecture of the installed product

```
C:\Program Files\DigiLog\                 (program — replaced on upgrade)
├─ runtime\
│  ├─ node.exe                            (bundled portable Node 20+)
│  ├─ api\dist\app.js                     (compiled backend, entry point)
│  ├─ api\node_modules\                   (incl. native: bcrypt, @napi-rs/canvas, @prisma/client + engine)
│  ├─ api\prisma\                         (schema.prisma + migrations + seed)
│  ├─ web\dist\                           (built React UI — served by the backend, see §5)
│  └─ queue\crontab.txt                   (graphile-worker crontab; path preserved or via MAINTENANCE_CRONTAB_PATH)
├─ pgsql\                                 (bundled PostgreSQL 18 binaries: initdb, postgres, pg_ctl, psql)
├─ service\
│  └─ winsw\                              (WinSW or nssm wrapper exes that run node + postgres as services)
├─ tools\
│  └─ provision.ps1 / migrate.ps1         (install-time DB provisioning + upgrade scripts)
└─ Uninstall...

C:\ProgramData\DigiLog\                    (DATA — survives upgrade AND uninstall)
├─ db\                                     (PostgreSQL data directory — initdb target)
├─ uploads\                               (UPLOAD_DIR — user-uploaded files, report assets)
├─ logs\                                   (api + postgres + service logs)
└─ config\
   └─ digilog.env                          (generated secrets + connection string — see §6)
```

**Two services:**
1. `DigiLogDB` — runs `pgsql\bin\postgres.exe -D C:\ProgramData\DigiLog\db` on port **5433**.
2. `DigiLogAPI` — runs `runtime\node.exe runtime\api\dist\app.js` with env loaded from `digilog.env`, depends on `DigiLogDB`.

---

## 4. Build pipeline (produces the installer)

Run on the dev machine to create the `Setup.exe`. Encapsulate as `scripts/build-installer.ps1`.

1. **Clean install deps** at the workspace root (`npm ci`) so native modules build against the bundled Node's ABI.
2. **Build shared packages:** `npm run build -w @digilog/shared && npm run build -w @digilog/queue`.
3. **Build backend:** `npx tsc -p apps/api/tsconfig.json` → `apps/api/dist`.
4. **Build frontend:** `cd apps/web && npx vite build` → `apps/web/dist`.
   - Set `VITE_API_URL` to **empty / relative** for the desktop build so the UI calls the same origin (`http://localhost:3000`) instead of a baked IP. (The APK build keeps its own `.env.production` with the LAN IP — separate artifact.)
5. **Stage `runtime/`:** copy `apps/api/dist`, a **production** `node_modules` (`npm ci --omit=dev` in a staging copy, but KEEP bcrypt/canvas/@prisma/client + the Prisma engine binary), `apps/api/prisma`, `apps/web/dist`, `packages/queue/crontab.txt`, and a portable `node.exe`.
   - **Prisma engine:** ensure `node_modules/.prisma/client` and the `query_engine-windows.dll.node` are present in the staged tree; set `PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` env if the runtime can't auto-locate them.
6. **Stage `pgsql/`:** download the **PostgreSQL 18 Windows binary zip** (EnterpriseDB / "binaries only" distribution), extract `bin/` + `lib/` + `share/`.
7. **Stage `service/`:** include WinSW (or nssm) wrapper exe + per-service XML config.
8. **Compile installer:** run Inno Setup (`ISCC.exe DigiLog.iss`) → `dist/DigiLog-Setup-vX.Y.Z.exe`.

**Native-module caveat (verified in code):** the backend depends on `bcrypt` (native), `@napi-rs/canvas` (native), and Prisma's engine (native). These must be **built/copied for the exact Node version we bundle**. If the bundled Node's ABI differs from the dev machine's, rebuild with `npm rebuild` against the target Node before staging.

---

## 5. Required code change #1 — backend serves the UI

**Today:** `apps/api/src/app.ts:161` registers `@fastify/static` **only for `/uploads/`**. The React UI is served by Vite (dev) or baked into the APK. For the desktop product, the **backend must serve the built SPA**.

**Change:** add a second static root for the web build + SPA fallback:
- Register `@fastify/static` with `root = runtime/web/dist`, serving `/` (so `index.html`, JS, CSS load).
- Add a `setNotFoundHandler` that, for non-`/api` GET requests, returns `index.html` (client-side routing fallback for React Router).
- Guard it behind an env flag (e.g. `SERVE_WEB=true`) so dev behavior is unchanged.

**Touch points — verified during M1 (2026-06-30):**
- ✅ `/api/*` routes still match first; unknown `/api/*` returns JSON (not HTML) — API contract preserved.
- ✅ `/uploads/*` still served (uploads static keeps `decorateReply:false`; the web static instance owns `sendFile`).
- ✅ `/docs` (Swagger) still served in dev, still **gated 401 in production** — the SERVE_WEB auth bypass deliberately excludes `/docs`.
- ✅ WebSocket path unaffected.
- 🔧 **Auth-hook gap fixed (the real touch point):** `plugins/auth.ts` has a global `onRequest` that 401s everything not in a public allowlist — so static assets + the login page itself were blocked. Added a narrow bypass: when `SERVE_WEB=true`, GET/HEAD requests that are **not** `/api`, `/uploads`, or `/docs` pass as public (the SPA's own `/api/*` data calls still go through full auth). This does not widen protected-uploads or Swagger access.
- CORS: with same-origin serving the UI no longer needs cross-origin; keep `ALLOWED_ORIGINS` correct for the APK (the installer sets it).

---

## 6. Required code change #2 — config via env, generated at install

The installer must generate **stable** secrets **once** at first install and persist them to `C:\ProgramData\DigiLog\config\digilog.env`. Regenerating on upgrade would break sessions and **invalidate every outstanding offline-replay grant** (see `.env.example` warning on `OFFLINE_REPLAY_SECRET`).

Installer-generated `digilog.env`:
```
DATABASE_URL=postgresql://digilog:<generated-pw>@localhost:5433/digilog_db?schema=public
JWT_SECRET=<64-byte base64, generated once>
VERIFICATION_TOKEN_SECRET=<64-byte base64, generated once>
OFFLINE_REPLAY_SECRET=<48-byte hex, generated once — MUST be stable across restarts/upgrades>
JWT_EXPIRES_IN=1h
NODE_ENV=production
PORT=3000
API_HTTPS=false            # localhost desktop = plain HTTP
SERVE_WEB=true             # new flag from §5
UPLOAD_DIR=C:\ProgramData\DigiLog\uploads
ALLOWED_ORIGINS=http://localhost:3000   # plus LAN origin(s) if the APK connects
MAINTENANCE_CRONTAB_PATH=...\runtime\queue\crontab.txt   # if path differs from bundled layout
```

**Code-side notes (verified):**
- `app.ts:350` reads `process.env.PORT ?? '3000'` (NOT `API_PORT` — the `.env.example` `API_PORT` key is read only by `deployment-check`). Installer must set `PORT`.
- App binds `host: '0.0.0.0'` (`app.ts:352`) — fine; localhost reachable, and LAN reachable for the APK if a firewall rule is added.
- The backend loads env via `dotenv/config` at startup. The service wrapper must point the process at `digilog.env` (e.g. `DOTENV_CONFIG_PATH` or copy/symlink, or the WinSW XML sets the env vars directly).

---

## 7. Install-time sequence (the installer script does this)

1. **Pre-flight:** check Windows version, admin rights, port 3000 + 5433 free; if a previous DigiLog is installed, branch to **upgrade** (§8).
2. **Copy files** into `C:\Program Files\DigiLog`.
3. **Create data dirs** under `C:\ProgramData\DigiLog` (`db`, `uploads`, `logs`, `config`).
4. **initdb:** `pgsql\bin\initdb -D C:\ProgramData\DigiLog\db -U postgres --auth=scram-sha-256 -E UTF8`.
5. **Configure PG:** write `postgresql.conf` (`port=5433`, `listen_addresses='localhost'`) + `pg_hba.conf` (scram local only).
6. **Register + start `DigiLogDB` service**; wait for it to accept connections (`pg_isready`).
7. **Provision DB:** create role `digilog` (random pw → into `digilog.env`), `CREATE DATABASE digilog_db OWNER digilog`.
8. **Generate `digilog.env`** with all secrets (§6).
9. **Apply schema (order matters — verified in M0):**
   - **a. Extensions first:** `CREATE EXTENSION IF NOT EXISTS ltree; CREATE EXTENSION IF NOT EXISTS pgcrypto;` (apply `prisma/sql/extensions.sql`). **Required** — the baseline uses these but doesn't create them; `migrate deploy` fails on a bare DB otherwise.
   - **b. Migrate:** `prisma migrate deploy` (applies the baseline on a fresh DB; on upgrades applies only missing migrations). **No `db push`, ever.**
   - **c. Seed:** run the seed with **`INITIAL_ADMIN_PASSWORD` set** (the seed throws without it — `seed.ts:72`). Creates `superadmin` + roles + system config + 33 help articles + 6 template kinds, and applies `invariants.sql`.
   - **Seed idempotency: confirmed in M0.** The seed is all `upsert` and does **not** overwrite the admin password on re-run, so upgrades that re-seed won't reset customer data. (Still re-confirm per release that new reference-data upserts don't clobber customer-edited rows.)
10. **Register `DigiLogAPI` service** (depends on `DigiLogDB`), start it.
11. **Health check:** poll `http://localhost:3000/health` until 200/401 (TLS-up style check).
12. **Firewall rule** (optional, for APK/LAN): allow inbound TCP 3000.
13. **Shortcuts** → `http://localhost:3000`.
14. Show "Install complete — default login superadmin / Admin@123" page.

---

## 8. Upgrade sequence (v(N) → v(N+1))

1. Stop `DigiLogAPI` (leave `DigiLogDB` running).
2. **Back up the DB first** (`pg_dump` → `C:\ProgramData\DigiLog\logs\pre-upgrade-<ver>.sql`) — non-negotiable for an audited system.
3. Replace `C:\Program Files\DigiLog\runtime` + `pgsql` (if PG minor bump) — **never touch `C:\ProgramData`**.
4. **Apply new migrations:** `prisma migrate deploy` (forward-only, applies only the migrations the customer DB hasn't seen yet, records them in `_prisma_migrations`). Safe and auditable by design (§2). Then re-run the **idempotent seed** for any new reference data.
5. Preserve the existing `digilog.env` secrets (do **not** regenerate).
6. Restart `DigiLogAPI`; health check.
7. On failure: restore from the `pg_dump` backup + reinstall previous program version (document the rollback runbook).

---

## 9. Known follow-ups / open questions (not blockers for v1 desktop)

1. **APK connectivity to a desktop install.** The APK is built for `https://<LAN-IP>:3000` and the WebView `fetch()` rejects self-signed certs. If customers also use the tablet against this PC, we need either (a) a second HTTPS listener with an installed root CA on the tablet, or (b) keep the existing HTTPS-on-3000 model and serve HTTP only on a loopback alias. **Decide whether the desktop product must also serve the tablet.** If yes, the "plain HTTP" simplification in §1 needs revisiting.
2. **§2 migration discipline** — must be resolved before first customer upgrade.
3. **Code signing.** An unsigned `Setup.exe` triggers SmartScreen warnings. For a customer product, budget for an **Authenticode code-signing certificate** (and ideally EV for instant SmartScreen reputation).
4. **Antivirus false positives** on a freshly-built, unsigned, Node-bundling exe are common — signing mitigates.
5. **PostgreSQL licensing** — PG is PostgreSQL-licensed (permissive, redistributable). ✅ No issue bundling. Verify the same for the chosen PG Windows binary distribution.
6. **Backup/restore UX** — the app already has a dynamic backup/restore feature; confirm it points at `C:\ProgramData\DigiLog` paths after install.
7. **Disk footprint:** installer ≈ 200–300 MB (Node + Postgres + node_modules + Chromium-less PDF via system Edge). Confirm acceptable.
8. **Edge dependency for PDF** — `puppeteer-core` auto-detects Edge (present on all modern Windows). If a locked-down customer image lacks Edge, set `PUPPETEER_EXECUTABLE_PATH` or bundle a Chromium. Low risk.

---

## 10. Milestones & sequencing

| # | Milestone | Deliverable | Risk |
|---|-----------|-------------|------|
| **M1** | **Backend-serves-UI bundle** (§5) | ✅ **DONE (2026-06-30).** `SERVE_WEB=true node dist/app.js` serves the full SPA + API from one process (verified compiled, NODE_ENV=production, real login round-trip). Added `scripts/build-bundle.ps1`. Fixed the auth-hook gap (static assets/SPA were 401'd). | Low — foundation for everything |
| **M2** | **Portable runtime staging** (§4) | A `runtime/` folder that runs on a machine with **no global Node**, using bundled `node.exe`. Native modules verified loading. | Medium — native ABI / Prisma engine |
| **M3** | **Bundled Postgres provisioning** (§7 steps 4–9) | Scripts that initdb + provision + migrate + seed a private PG on 5433. | Medium |
| **M4** | **Windows services** | WinSW/nssm wrappers; both services auto-start; survive reboot. | Low–Medium |
| **M5** | **Inno Setup installer** | `DigiLog-Setup.exe` doing the full §7 sequence on a clean VM. | Medium |
| **M0** | **Migration discipline** (§2.0–2.3) | ✅ **DONE (2026-06-30).** Verified prior conversion (acceptance gate empty-diff); fixed the broken fresh-install seed; built+tested the drift guard (`scripts/verify-migrations.ps1`, `npm run db:verify-migrations`, PASS); documented the forward-authoring workflow in `apps/api/CLAUDE.md`; fixed the `db:migrate` footgun (`migrate dev`→`migrate deploy`). **Only leftover:** wire the drift guard into CI (needs a Postgres-equipped runner). | — |
| **M6** | **Upgrade + uninstall safety** (§8) | Tested v1→v2 upgrade preserving data; uninstall that keeps `C:\ProgramData`. Builds on **M0**. | **High** — data-loss surface |
| **M7** | **Code signing + clean-VM acceptance test** | Signed exe; installs on a fresh Windows VM with nothing pre-installed. | Low (mostly procurement) |

**Recommended first action:** do **M0** (migration discipline) and **M1** (backend-serves-UI bundle) — both are foundational. M0 is the one that makes customer upgrades safe and removes the `db push` risk for good; M1 proves the single-process model end-to-end. Neither requires installer tooling, so they're the right place to start.

---

## 11. Decisions

**Settled:**
- ✅ **Customer upgrades are a first-class requirement** (not local-only). — user, 2026-06-30
- ✅ **Real Prisma migrations; `db push` eliminated** (§2). — user, 2026-06-30
- ✅ **Bundle PostgreSQL**, data path `C:\ProgramData\DigiLog`. — user, 2026-06-30

**Still needed from you before execution:**
1. **§9.1:** Must the desktop install **also** serve the Android tablet over the LAN? (Changes the HTTP-vs-HTTPS decision. If yes, we keep an HTTPS listener; if no, localhost HTTP only.)
2. **§9.3:** Budget for a code-signing certificate? (Required for a clean customer experience — unsigned exe triggers SmartScreen/AV warnings.)

---

## 12. What does NOT change

- Android APK (`apps/android`) + RFID Kotlin app (`rfid_scan_app`) — separate artifacts, untouched.
- All 35 API modules, the audit hash-chain, offline sync, reports — run identically; they just run inside a bundled Node + bundled Postgres instead of a dev-installed one.
- The dev workflow (`tsx watch` + `vite`) stays exactly as is; the `SERVE_WEB` flag and the bundle scripts are additive.
