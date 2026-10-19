# tests/performance — load, stress and profiling tools

Dependency-free (Node 20+, PowerShell 5.1, psql). Nothing here may touch `digilog_db` or
`digilog_test_db`: every script refuses a database whose name does not end in `_perf`, and the load
runner refuses any target that is not `localhost` or that is port 3000.

## Databases and ports

| Database | Contents | How to start the API |
|---|---|---|
| `digilog_perf` | one year of synthetic volume (see `data-generation/README.md`) | `powershell -File tests\performance\start-perf-api.ps1` → https://localhost:3100 |
| `digilog_day1_perf` | go-live shape: same plant, one day of history | `start-perf-api.ps1 -NoBuild -Database digilog_day1_perf -Port 3102` |
| any `*_perf` | profiling instance (dev mode, slow-query log ON; **never quote its latencies**) | `start-perf-api.ps1 -NoBuild -Profile -Port 3101 [-SlowQueryMs 100]` |

`start-perf-api.ps1` builds `apps/api/dist` (unless `-NoBuild`) and starts a production-mode process
with `LOG_DIR=tests/performance/results/logs` (`logs-profile` for `-Profile`). `stop-perf-api.ps1 -Port N`
kills only the node process listening on that port. Users: `results/perf-users.json`
(`perf_user_001..300`, password `PerfTest@2026!`; 001–220 OPERATOR = tablet personas).

Point the web app at a test API from the browser console:
`localStorage.setItem('digilog.serverUrl','https://localhost:3100'); location.reload()`.

## Running a load test

```powershell
# Git Bash users: export MSYS_NO_PATHCONV=1 first, or every /api/... argument becomes C:\...\api\...
$env:PERF_CONFIRM='yes'                       # required for anything above smoke
node tests\performance\api\run-load.mjs --scenario web-users --profile high            # 100 users, 10 min
node tests\performance\api\run-load.mjs --scenario web-users --profile high --vus 200 --ramp 60 --duration 300
node tests\performance\api\run-load.mjs --target https://localhost:3102 --scenario web-users --profile baseline
```

Profiles: `smoke` 5 users / 2 min (no confirmation needed), `baseline` 25, `normal` 50, `high` 100,
`peak` 300, `stress` 200 at 3× poll speed, `spike` 200 ramped in 10 s, `soak30`, `soak2h`.
Overrides: `--vus --duration --ramp --speed`. Results: `results/runs/<runId>.json` + `.csv`
(per-endpoint p50/p95/p99, status codes, 10 s timeline, error samples).

Scenario `web-users` (`api/scenarios/web-users.mjs`) replays the real pages' first-load waterfalls and
the app's own poll intervals; operators are tablets at `/m`, other roles desktop. A page whose main
request answers 403 is dropped for that user (the menu would hide it). Knobs:

- `PERF_TABLET_SHARE` (default 0.4) — share of operators among the first N users.
- `PERF_EXCLUDE_PAGES=cycles,...` — leave pages out (say so in the run's notes).
- `PERF_SKIP_URLS=/api/filters/batch-states,...` — **what-if only**: never send those requests, to
  measure what fixing one endpoint would buy. Label such runs clearly.

Scenario `tablet-operators` (`api/scenarios/tablet-operators.mjs`) is the **write path**: operators
start cycles on idle filters and follow the server's decision tape (checklists, 1-minute dryer +
readings, stage advances with instrument readings) to completion; shift officers approve the gated
stages from the queue every 30 s; other roles idle. Every write is a real, audited row on the clone.
`PERF_CLEANING_REASON=PM` exercises the missed-PM gate (409 + `pmSkips` retry). After a run, verify
the chain: `npx tsx ../../tests/performance/data-generation/verify-perf-chain.ts --from-position <pos>`.

An "error" is a transport failure, 5xx, 429, **or a server fault the app reports as `400`**: any 400 on
a GET, and `DATA_CONSTRAINT` (how `app.ts` surfaces an unmapped Prisma failure — pool timeout,
transaction timeout, oversized result). Business refusals (403/409) are tracked by status only.

Abort guard: three consecutive 10 s windows with > 10 % errors or p95 > 10 s stop the run (partial
results are still written). Ctrl-C does the same.

**Between runs: wait until the API process is idle.** After an aborted run the server keeps draining
queued work for minutes; a run started on top of that backlog is invalid. Restart the API for a clean
memory baseline when memory is being measured. Never run two load tests at once.

## Other tools

| Script | Purpose |
|---|---|
| `api/single-shot.mjs --role ROLE url...` | one request at a time, no concurrency: an endpoint's own cost |
| `endurance/sample-resources.ps1 -Port -Database -Seconds -IntervalSec -Label` | CSV of API CPU/memory/handles + Postgres connections, idle-in-tx, lock waits, DB size into `results/resources/` |
| `profile/profile-endpoints.mts` | in-process (inject) call with every Prisma query and its duration |
| `profile/cpu-profile-batch-states.mts` | V8 CPU profile + query-shape count of one `getBatchStates()` call |
| `profile/slow-queries.mjs [--since "yyyy-mm-dd hh:mm:ss"]` | groups a `-Profile` instance's slow-query log by statement |
| `equivalence/capture.mjs <dir> --role ROLE url...` | saves response bodies, to diff an old build against a new one |
| `equivalence/pm-due-compare.mts` | runs the original and current `getDueTasks` and diffs the JSON |
| `api/scenarios/bulk-operate.mjs` | tablet batch submit: `PERF_BULK_SIZE` (50) start-and-advance items per request, every `PERF_BULK_THINK_SEC` (60) |
| `recovery/restart-under-load.ps1 -Port -Database -KillAfterSec` | kills the perf API during a run and restarts it; prints time-to-healthy (read the client side from the run's timeline) |
| `recovery/backup-restore-timing.ps1 -Source digilog_perf` | times `pg_dump -Fc` + `pg_restore`, and the nightly's plain-SQL dump + `psql` replay, into a fresh `*_perf` database; prints row counts |
| `start-perf-api.ps1 -PoolLimit 20 -PoolTimeoutSec 30` | what-if: overrides Prisma's connection pool for that instance |
| `security/bcrypt-throughput.mjs` | bcrypt cost-12 throughput vs. libuv threadpool size |
| `data-generation/` | synthetic plant + history generator and chain verifier (own README) |

Run the `.mts` scripts from `apps/api` with `npx tsx` and an explicit `DATABASE_URL` for a `*_perf`
database.
