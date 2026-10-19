# 08 — Failure Injection (clone-only)

All experiments ran against the disposable go-live clone API on :3102 / `digilog_day1_perf`, never
against the dev database or a live system. Script: `tests/performance/recovery/restart-under-load.ps1`.

## 1. API process killed under load — RUN

Setup: 50 users (20 tablets, 30 desktop, new polling model) in a 4-minute run; at 100 s the API
process was killed with `Stop-Process -Force` and immediately restarted the way the WinSW service
would (`start-perf-api.ps1 -NoBuild`), then `/api/health` was polled.

| Measure | Value |
|---|---|
| Kill | 21:14:13.86 (pid 15188, 808 MB working set) |
| Replacement process start | 21:14:14 (Windows process StartTime) |
| API scheduler "started" line in `stdout.log` | 21:14:17.96 → **≈ 4 s to serving** |
| Client-visible errors | 32 of 2,283 requests (1.4 %): `read ECONNRESET` on in-flight requests and failed polls in two 10 s windows (4.9 % then 33 % of that window's requests) |
| Recovery | next 10 s window: 0 errors, p95 300 ms; the rest of the run identical to an undisturbed one (overall p50 43 ms, p95 604 ms) |
| Data | no writes were in flight (read scenario); the write path's idempotency (`clientOpId`) and the tablet queue cover a kill mid-write — not exercised here |

What this means for the client: a crash or a service restart costs about **5–15 s of failed requests**
on the web (SWR re-polls on its own; the user sees a brief error toast or a stale widget) and nothing
on a tablet with queued work (the sync engine keeps the operation pending — 11 §1b). The 4 s includes
Node start, Prisma engine start and the TLS listener; on the slower Xeon expect a few seconds more.
WinSW's own restart delay (`<onfailure action="restart" delay="…">` in `register-services.ps1`) must
be added to this — it was not measured here because the dev box runs the perf API without WinSW.

Not seen: the "drain for minutes after the load stops" behaviour of the overloaded runs (04 §2) — a
restart clears the queued backlog at once, which is the one argument *for* restarting an overloaded
instance rather than waiting.

## 2. Postgres restart / outage under load — BLOCKED

`Restart-Service postgresql-x64-18` needs an Administrator PowerShell, which this session does not
have (the same restart is needed for `pg_stat_statements`). Procedure, when run: start the 50-user
run, restart the service at 100 s, then verify (a) the API's `/api/health` reports `db: disconnected`
and then `connected` without an API restart (Prisma reconnects lazily), (b) the client timeline as
above, (c) `verify-perf-chain.ts` from the pre-outage chain position. Expected but **not verified**:
every request during the outage answers `503 SERVICE_BUSY` (P2024 pool timeout after 10 s) and the
tablet keeps its queue pending.

## 3. Database connection pool exhausted — RUN (unintended, 04 §2a)

Produced naturally by 100 users on the one-year copy: 70 % of requests failed with Prisma `P2024`
(pool of 9, 10 s timeout). Before today's change those were reported as `400 DATA_CONSTRAINT`; they
are now `503 SERVICE_BUSY`, and the tablet's sync engine treats a 5xx as an interruption (keeps the
operation pending). A re-run with a larger pool is in 05 §4 / 04 (pool what-if).

## 4. Disk full, backup failure, clock skew, network partition of a tablet — NOT TESTED

- Disk full: the nightly backup writes `LAST-BACKUP-STATUS.txt` with the failure; the API's own
  behaviour when the data disk fills (Postgres refuses writes → every audited action fails) was not
  provoked. Postgres on a full disk stops accepting writes and may need manual intervention; monitoring
  free space is the control.
- Tablet network partition during a cycle: covered functionally by the offline queue design (03 §…,
  OFFLINE_SYNC_ARCHITECTURE.md) and the existing offline test suites; not load-tested here.
- Clock skew between tablet and server: `offlinePerformedAt` is validated by
  `lib/offline-time-window.ts`; not exercised.
