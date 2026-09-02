# Operational logging integration — plan + decision log

**Started:** 2026-08-31 · **Branch:** RFID

## Goal

When something breaks — app not starting, DB unreachable, an API returning 500,
a background service silently dead — the operator opens a log file and reads
what happened, in plain English, without a developer.

## Non-goal, stated once so it is never confused later

**These logs are NOT the 21 CFR Part 11 audit trail.** `audit_trail` is
hash-chained, immutable, retained forever and SUPER_ADMIN-scoped. These files
**rotate — i.e. they are deleted after 7 days.** Nothing that is a §11 record may
ever live only here. This is an operations surface for diagnosing faults.

## Log types (8) — approved 2026-08-31

| # | Type | Channel | File |
|---|---|---|---|
| 1 | Error (every warn+ from every module, duplicated) | *(fan-in)* | `logs/app/error/` |
| 2 | Application / lifecycle | `app` | `logs/app/application/` |
| 3 | HTTP request | `http` | `logs/app/http/` |
| 4 | Database | `db` | `logs/app/database/` |
| 5 | Postgres server | *(written by Postgres)* | `logs/postgres/` |
| 6 | Services / background | `services` | `logs/app/services/` |
| 7 | Security / access | `security` | `logs/app/security/` |
| 8 | Business module | `mod:<name>` | `logs/app/modules/<name>/` |

## Retention — approved 2026-08-31

**Keep the newest 7 daily files per channel.** Day 8 arrives → day 1 deleted.
Counted per channel (7 error files AND 7 http files, not 7 total).

If the machine was off, we keep the newest 7 files that exist (which may span
more than 7 calendar days) rather than 7 calendar days — chosen so the operator
always has a full week of real activity.

### Why we do NOT use pino-roll's `limit` for this

Read from pino-roll@4.0.0 source, not docs:

1. `removeOldFiles()` is called **only from inside `roll()`**, which fires on the
   midnight timer or a size overflow. It never runs at startup. On a plant PC
   powered off overnight the midnight roll never fires while the process is
   alive, so **files would accumulate forever**.
2. Its two cleanup branches disagree by one: `removeOtherLogFiles:false` keeps
   `count + 1` files (as documented), `true` keeps `count`. "7" could silently
   mean 8.

So pino-roll does the **rolling** (daily switch, same-day reuse on restart,
Windows unlink retry) and `lib/log-retention.ts` owns the **retention**, run at
startup + daily cron. Deterministic and unit-testable.

### Why one subdirectory per channel

pino-roll's `detectLastNumber()` scans the whole directory and takes the highest
trailing number from **any** file in it. With `error.*.log` and `http.*.log`
side by side, the error stream would inherit http's file number. Separate
folders make it correct.

## Format

```
2026-08-31 14:22:01.184  ERROR  [filter-operations]  Failed to advance cycle
    reqId=a3f9c1 user=101012 (OPERATOR) filter=AHU-0A-F12 cycle=8821
    PrismaClientKnownRequestError P2002: unique constraint filter_events_pkey
```

Plain text, one event per record, local time, greppable. Never JSON.

## Steps

- [x] 0. Survey existing logging; verify pino-roll semantics from source
- [x] 1. `tasks/LOGGING-INTEGRATION-PLAN.md` (this file)
- [x] 2. Deps: `pino`, `pino-roll` as direct deps of `apps/api`
- [x] 3. `lib/log-dir.ts` — LOG_DIR resolution, mirrors `uploads-dir.ts`
- [x] 4. `lib/log-format.ts` — the human-readable line formatter
- [x] 5. `lib/log-retention.ts` — keep newest 7 per channel
- [x] 6. `lib/logger.ts` — root pino, channel routing, redaction, `getLogger()`
- [x] 7. `app.ts` — `loggerInstance`, lifecycle lines, http hook, error handler
- [x] 8. `lib/prisma.ts` — database channel + slow-query threshold
- [x] 9. Security channel — login/logout in auth routes, 403/429 via one hook
- [x] 10. Services channel — cron, notifications, LDAP, SMTP, backup
- [x] 11. Replace the `console.*` calls with module loggers (38 across 14 files)
- [x] 12. Business-module channels (filter-operations, sync, pm-schedules, backup)
- [x] 13. Postgres logging in `scripts/provision-db.ps1`
- [x] 14. `scripts/collect-logs.ps1` — one-command diagnostic bundle
- [x] 15. Tests (formatter, retention) — 26 passing
- [x] 16. Docs: CLAUDE.md, CHANGELOG.md, apps/api/CLAUDE.md, memory
- [x] 17. Installer: `LOG_DIR` in `install.ps1`, appended on upgrade too

## Verified end-to-end (2026-08-31)

- All 10 channel files created and written on a real boot.
- `FAILED TO START — could not listen on port 3000` with the EADDRINUSE stack
  landed in BOTH `application` and `error` — the exact "app not starting" case
  this was built for, caught by accident during testing.
- `security` gets Login SUCCESS / Login FAILED (with the attempted username) /
  blocked-by-existing-session / Logout. A no-token 401 correctly does NOT appear;
  a rejected TOKEN does.
- `http` lines carry user + userId + role once authenticated.
- **Retention proven on the PRODUCTION path**, not just in unit tests: seeded 9
  days under the real default root, booted, and the boot sweep reported
  `deletedFiles: 8, removedDates: [08-23, 08-22, 08-21]`, leaving exactly 7
  dates per channel. The 3-part size-split day (`.1 .2 .3`) was removed as ONE
  day, an operator's `operator-saved-copy.txt` in the same folder was untouched,
  and today's open file was not affected by the unlink on Windows.
- `http` no longer reaches stdout once file logging is up (verified 0 `[http]`
  lines in captured stdout, present in the http file) — WinSW's 10 MB x 8 window
  stays available for the pre-logger crash evidence it exists for.
- 41 new unit tests pass (format 15, retention 11, redaction/channels 15). Full
  API suite: 1392 passed, 0 test failures; the single failing FILE is the
  pre-existing "Test DB has no AHU to hang a filter on" `beforeAll` throw.
- `collect-logs.ps1` produced a valid zip with all sources; `install.ps1 -DryRun`
  completes through the whole orchestration.

### NOT verified — graceful shutdown logging

The "Received SIGTERM / Database disconnected cleanly / Shutdown complete" lines
could **not** be exercised on this machine. Windows refuses a graceful close to a
detached process (`taskkill` without `/F` answers *"can only be terminated
forcefully"*), and Git Bash's `timeout`/`kill -INT` reach the npx shim, not node.
Every test stop was therefore a hard `TerminateProcess`, which no handler can
intercept in any language.

What this means:
- The CRASH paths ARE verified — the `FATAL FAILED TO START` line with its
  EADDRINUSE stack landed in both `application` and `error` during testing.
- The shutdown handler itself is PRE-EXISTING (`process.on('SIGTERM'/'SIGINT')`
  with a "Received ..." log line); this change added three lines inside it
  (`disconnectDatabase()`, a completion line, `flushLogs()`). Whether it fires
  under WinSW's service stop is a pre-existing property of the deployment, not
  something this change alters — but it is unproven either way.
- **To close this**, stop the real `DigiLogAPI` service on an installed box
  (`sc.exe stop DigiLogAPI`) and check for a `Database disconnected cleanly`
  line in `logs\app\database\`. If it is absent, WinSW is hard-killing and the
  service XML needs a `<stopparentprocessfirst>` / stop-signal review.
- Practical exposure from a hard kill is small: SonicBoom writes promptly
  (an http line survived a `TerminateProcess` in testing), so the loss window is
  milliseconds, not a session.

### Known gaps (deliberate, not started)

- **Frontend / tablet errors are not collected.** `error-boundary.tsx` still
  reports nowhere. An unauthenticated `POST /api/client-logs` would be a
  disk-fill DoS on a single-box install, so it needs auth + its own rate limit.
- **No log viewer in the UI.** Reading files off the box is more reliable when
  the app is the thing that is broken.
- **Real volume not yet measured.** The estimate is 50–200 MB for 7 days with
  `http` dominating. Measure with `logDirSizeBytes()` (reported at every boot)
  after a full day of real traffic before quoting a number.

## Decisions

- **stdout is never removed.** WinSW captures stdout and is the ONLY thing that
  catches a crash before our logger initialises (e.g. the `readFileSync` of the
  TLS cert at module load). Files are an addition, never a replacement.
- **Test mode writes no files.** vitest runs `--pool=forks --singleFork`; file
  handles opened at import time leak across the suite. `NODE_ENV=test` or
  `VITEST` → stdout only.
- **Redaction is explicit paths, not `maskSecrets`.** `maskSecrets` is an
  allowlist built for audit config payloads — on a request body it would redact
  everything. Use pino `redact` on `authorization`, `x-reauth-password`,
  `password`, `currentPassword`, `newPassword`, `token`.
- **No config def for log level.** Env var (`LOG_LEVEL`). A config def is the
  12-touchpoint rule for something set once.
- **WinSW's own logs are left alone.** Already bounded (10 MB x 8) and Windows
  will not let us unlink a file WinSW holds open.
- **Postgres retention uses Postgres.** `log_filename='postgresql-%a.log'` +
  `log_truncate_on_rotation=on` + `log_rotation_age=1d` = exactly 7 files,
  recycled by weekday, no code.
