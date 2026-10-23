# 10 — Deployment readiness

**Clean-machine install: NOT run** (operator 2026-10-23: "vm or spare test i dont need now"). This report
rests on the build, the packed-API smoke test and the staged-payload checks below.

## 1. Artifacts (built 2026-10-23 from branch `RFID`, not pushed)

| Artifact | Detail |
|---|---|
| `dist\FMS-Setup-1.2.3.exe` | **REBUILT 2026-10-23 14:00 from `745980d`** (the § 5 installer fixes; operator: rebuild under the same version), UNSIGNED (SmartScreen / AV will warn), 172,206,653 bytes, SHA256 `b409363a2ce97e42724de5a3d778180eccae644a91c462993e9879a2c7ca1b5f`; bundles `tablet\FMS.apk` = the APK below (sha256 matches). Application code identical to the first build (`745980d` changes only `installer/`, `scripts/` and a comment in `export-install-baseline.ts`). **Superseded:** the first 1.2.3 build from `11e36da`, 172,211,682 bytes, SHA256 `9280ee4448c4dedebb473ec6c827b741ad5c2fcb74cf8dd1a85d8c9fd932dee3` — overwritten in `dist\`; do not ship a copy of it |
| `DigiLog-FilterOps.apk` (repo root, bundled as `tablet\FMS.apk`) | `11e36da`, SHA256 `33b8beb5bae4a7eaabff98fc1fe3cd7db88393c0a3d89d7c90333aff2756bfa3`; Capacitor 8.5.3; built with `VITE_API_URL` blank (a fresh install asks for the server; an update keeps the stored address); `res/raw/rootca.pem` is the inert PLACEHOLDER authority, so this general APK trusts no development CA (per-site APK: `scripts/build-site-apk.ps1`) |
| Restore tool | `scripts/restore-database.ps1` (+ helper + `.cmd` launcher) in the installer with a Start-menu entry. The operator guide `docs/RESTORE-LARGE-DATABASE.md` is NOT installed (corrected 2026-10-23); its essentials are in the install guide § 10 |
| Install guide | `FMS-Installation-Guide.docx` / `.pdf` 1.2.3 edition (12 pages, regenerated 2026-10-23 14:03 for the rebuilt installer: new SHA256 and size, the § 5 workarounds replaced by the new behaviour) next to the exe in `dist\` and in Downloads; the 1.2.0 edition kept as `FMS-Installation-Guide-1.2.0.*`. Generator outside git: `C:\Users\hello\fms-docs-source\install-guide\` |

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

## 5. Found while writing the install guide (2026-10-23) — FIXED the same day (`745980d`, installer rebuilt)

- **Login page showed "Version 1.2.2" on a fresh 1.2.3 install.** The text is the `branding` setting created
  from `install-baseline.json`, which was edited by hand per release: 1.2.0 / 1.2.1 shipped "1.1.0", and the
  first 1.2.3 build shipped "1.2.2". **Fix:** `build-installer.ps1` stamps `-AppVersion` (now mandatory,
  `x.y.z`) into the STAGED baseline with `scripts/stamp-install-version.mjs` and reads it back. The rebuild
  log shows `branding.version: '1.2.2' -> '1.2.3'`. **Still by design:** an upgrade keeps the site's own
  value (create-only seed, operator 2026-10-14); the guide (§ 9) says to set it after an upgrade.
- **A failed install or upgrade was invisible.** The scripts ran as hidden `[Run]` entries: no exit-code
  check, no log, and the normal Finish page. **Fix:** they run from `[Code]` (`installer/run-setup-script.iss`,
  `ExecAndLogOutput`):
  - every line, stdout and stderr, goes to `C:\ProgramData\DigiLog\logs\install-*.log` / `upgrade-*.log`;
  - on failure, a message box shows the FATAL / FAILED / ERROR lines, what to do next and the log path;
  - the Finish page reads "Setup did not finish" and Setup exits 10;
  - an exit 0 that printed WARN lines shows them.
- **Found while fixing it — the superadmin password was in Setup's own log.** Inno writes every `[Run]`
  command line to Setup's log (`SetupLogging=yes`), and the fresh-install line carried
  `-AdminPassword "<password>"`, both since the first installer (2026-06-30). A control build proved the
  line is logged. **Fix:** the password is handed over in the `FMS_SETUP_ADMIN_PASSWORD` environment
  variable, which `install.ps1` reads and removes. **Sites installed with an earlier Setup:** delete
  `%TEMP%\Setup Log *.txt` of the installing account and change the superadmin password (guide § 9.1).
- **Found while fixing it — re-running Setup after a failed first install took the upgrade path.**
  `digilog.env` is written before the database, so the next run either stopped ("no initialised DB
  cluster") or seeded the half-built database with a random superadmin password. **Fix:** `install.ps1`
  keeps `config\install-incomplete` from the start of a first install (on an empty data root only) until the
  database is migrated and seeded. Setup refuses to run over it and says what to do.

**Verification (2026-10-23, this PC, no admin, nothing installed):**
- `installer/test/test-run-setup-script.ps1`: 34 / 34 PASS. It compiles `DigiLog.iss` against a dummy stage,
  then runs a harness on the same include in fail / warn / ok modes. Checked:
  - Setup exit codes 10 / 0 / 0;
  - the log holds Write-Host lines and a native program's stdout AND stderr;
  - the password reaches the script and is absent from both logs.
  - Message box and Finish page checked by screenshot.
- The STAGED `install.ps1` from the rebuild, run against a scratch data root on port 5499: database
  migrated and seeded, `branding.version` = 1.2.3, the 7 approved roles, the superadmin password equal to
  the one handed over (it contained `"` `&` `!`; a wrong one does not match), marker removed. It then stopped
  at service registration (not admin), as expected.
- The same script with no `runtime` folder: provisioning failed and left `digilog.env` + `install-incomplete`
  behind — the state Setup now refuses.
- **Not executed:** the real Setup.exe (needs admin and a machine without FMS). That includes the
  `PrepareToInstall` refusal itself, which was reviewed and compiled but not run, and a failing UPGRADE
  through the real Setup.
