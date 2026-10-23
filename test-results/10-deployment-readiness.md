# 10 — Deployment readiness

**Clean-machine install: NOT run** (operator 2026-10-23: "vm or spare test i dont need now"). This report
rests on the build, the packed-API smoke test and the staged-payload checks below.

## 1. Artifacts (built 2026-10-23 from branch `RFID`, not pushed)

| Artifact | Detail |
|---|---|
| `dist\FMS-Setup-1.2.3.exe` | built from HEAD `11e36da` (all fixes through the date-range fix), UNSIGNED (SmartScreen / AV will warn), 172,211,682 bytes, SHA256 `9280ee4448c4dedebb473ec6c827b741ad5c2fcb74cf8dd1a85d8c9fd932dee3`; bundles `tablet\FMS.apk` = the APK below (sha256 matches) |
| `DigiLog-FilterOps.apk` (repo root, bundled as `tablet\FMS.apk`) | `11e36da`, SHA256 `33b8beb5bae4a7eaabff98fc1fe3cd7db88393c0a3d89d7c90333aff2756bfa3`; Capacitor 8.5.3; built with `VITE_API_URL` blank (a fresh install asks for the server; an update keeps the stored address); `res/raw/rootca.pem` is the inert PLACEHOLDER authority, so this general APK trusts no development CA (per-site APK: `scripts/build-site-apk.ps1`) |
| Restore tool | `scripts/restore-database.ps1` + `docs/RESTORE-LARGE-DATABASE.md`, in the installer with a Start-menu entry |

## 2. Executed

| Check | Result |
|---|---|
| Installer build | `build-installer.ps1 -AppVersion 1.2.3`: clean-room from `git archive HEAD`, prod `npm ci`, Prisma engine present, pgsql bin/lib/share only, ISCC compile OK; the dev tree's node_modules untouched (0 missing after) |
| Packed API smoke (staged `runtime\node.exe dist/app.js`, port 3906, `digilog_qa_perf`, HTTP) — run on the first 1.2.3 build (pre date-fix; the rebuild differs only by the date-range fix) | `/api/health` 200 (db connected, jobRunner running); web `/` 200; SPA route `/m/login` 200; OPERATOR login OK; cron jobs started (log_retention, notification_retry_recovery) |
| Migrations in this release | `20261022…_volume_indexes_and_one_tag_per_filter` (2 indexes + unique one-tag-per-filter, with an upgrade guard that names duplicate filters instead of failing bare), `20261022130000_drop_filter_events_cycle_type_at_idx`; both applied to `digilog_db` / test / perf with `migrate deploy`; drift guard PASS (251 objects) |
| Seed bundle | `prisma/seed.mjs` rebuilt by the installer's `build-bundle.ps1` (fixes the splitter that skipped 5 invariants.sql statements, `f3153ee`) |
| Dependency audit after upgrades | remaining: 3 HIGH in the Prisma CLI config merge (`prisma`, `@prisma/config`, `deepmerge-ts`) — install-time tooling, not the running client; fix = Prisma 7 (planned separately) |

## 3. Not done

- Install / upgrade / uninstall-reinstall on a clean Windows machine (service registration, firewall,
  certificate, scheduled backup task) for 1.2.3.
- Code signing (`-Sign`).
- Tablet install of the new APK on a device.

## 4. Upgrade notes for the operator

- Upgrading applies the two migrations above; the one-tag-per-filter index stops with a clear message if a
  site already has a filter holding two tags (none on this PC's databases).
- Behaviour changes users will see: Super Admin is now asked for the password on destructive / rule-changing
  actions (OD-01); approval decisions require remarks; several SA-only settings pages are now SA-only on the
  server too; "10,000+" on very large lists; LDAP `ldap://` uses StartTLS.
- Copy the backups folder off the server (single biggest recovery risk, 09).
