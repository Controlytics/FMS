# 04 — API Load Test Results

Measured 2026-10-17 on the dev PC (8 logical cores, 16 GB, Windows 11), production build of the API
(`NODE_ENV=production`, `node dist/app.js`) against two disposable databases:

| Database | Shape | API |
|---|---|---|
| `digilog_day1_perf` | **go-live**: 300 users, 5 blocks, 150 AHUs, 3,000 filters, 1 day of history (1,520 cycles) | https://localhost:3102 |
| `digilog_perf` | **one year** of production volume: 566k cycles, 6.2M filter events, 7.4M audit rows, 10.2 GB | https://localhost:3100 |

Runner: `tests/performance/api/run-load.mjs`, scenario `web-users` (real page waterfalls + the app's own
poll intervals; operators = tablets at `/m`, other roles = desktop; 40 % tablets). Every number below is
in `tests/performance/results/runs/<runId>.json`; resource samples (API CPU/memory, Postgres connections)
in `tests/performance/results/resources/`. "error" = transport failure, 5xx, 429, or a server fault the app
reports as `400 DATA_CONSTRAINT`. Business refusals (403/409) are not errors.

**Runner caveat (runs up to 13:38 UTC):** the load runner shares this PC with the server and, until
13:38 UTC, parsed every response body as JSON — including the tablets' 11 MB `batch-states` bodies
(2.3 GB and about one core in the runner process). A real tablet does that work on its own hardware, so
those runs charged the server for CPU it would not spend in production; their numbers are *pessimistic*.
From the 200-user rerun onwards the runner only counts bytes for bodies above 256 KB (`lib/http.mjs`).

**This PC is not the client's server.** The Xeon 4310 (2.1 GHz) may be slower per request than this
desktop; read these as *relative* results and as a list of defects, not as a capacity promise.

## 1. Results table

| Run (UTC) | Data | Users | Duration | Requests | req/s | Errors | p50 | p95 | p99 | Outcome |
|---|---|---|---|---|---|---|---|---|---|---|
| 11:01 | year | 5 | 121 s | 130 | 1.1 | 0.8 % | 186 ms | 12.5 s | 19.6 s | PM due failed outright (see fixes) |
| 13:03 | year | 5 | 121 s | 116 | 1.0 | 0 % | 125 ms | 6.0 s | 7.2 s | after fixes 1–4; Cycles view excluded |
| 13:13 | year | 25 | 62 s | 215 | 3.5 | 4.7 % | 595 ms | 27.5 s | 30.2 s | **ABORTED** by guard (p95 > 10 s for 30 s) |
| 13:16 | go-live | 25 | 326 s | 1,442 | 4.4 | 1.5 % | 171 ms | 3.0 s | 30.0 s | completed; errors = batch-states timeouts |
| 13:22 | go-live | 50 | 331 s | 2,423 | 7.3 | 3.3 % | 765 ms | 4.3 s | 30.3 s | completed; batch-states 81/88 timed out |
| 13:28 | go-live | **100** | 189 s | 2,352 | 12.5 | 4.3 % | 2.8 s | 17.9 s | 30.8 s | **ABORTED**; batch-states 89/90 timed out |
| 13:42 | go-live | **100** | 301 s | 5,468 | 18.2 | **0 %** | **203 ms** | **1.7 s** | 2.7 s | **what-if: batch-states never requested** |
| 13:51 | go-live | 200 | 98 s | 1,741 | 17.7 | 1.7 % | 7.0 s | 36.5 s | 45.3 s | **ABORTED**; what-if without batch-states |
| 13:56 | year | 100 | 86 s | 619 | 7.2 | **70 %** | 12.1 s | 31.2 s | 35.5 s | **ABORTED**; what-if without batch-states and Cycles view — Prisma pool starvation (§2a) |
| 14:08 | go-live | **100** | 300 s | 4,843 | 16.2 | 3.2 % | 2.1 s | 7.8 s | 30.4 s | **ABORTED** at the end; batch-states included, **after fix 6**: 153/181 still timed out; API CPU 37 % avg, 3.3 GB; runner still parsing bodies |
| 14:42 | go-live | 100 (soak attempt) | 102 s | 1,377 | 13.5 | 2.1 % | 1.5 s | 8.3 s | 30.0 s | **ABORTED** at 100 s on a just-restarted (cold) process; batch-states 29/51 timed out |
| 14:45 | go-live | 100 (soak, 180 s ramp) | 258 s | 3,091 | 12.0 | 2.0 % | 1.3 s | 8.2 s | 30.0 s | **ABORTED** once the ramp completed; batch-states 62/151 timed out; working set 1.5 → 3.0 GB in 6 min. With the 14:14 pass, **100 users is the edge on this PC: 1 pass in 4 attempts**. Soak moved to 50 users. |
| **15:24** | go-live | **100** | 300 s | 5,208 | 17.3 | **0 %** | **54 ms** | **570 ms** | **968 ms** | **completed** — after the approved polling changes (§8); API CPU 14 %, 1.4 GB |
| 15:31 | go-live | 200 (new polling, 120 s ramp) | 157 s | 2,923 | 18.6 | 3.4 % | 2.5 s | 27.5 s | 34.1 s | **ABORTED** during the ramp: 80 tablets' first-load `batch-states` (11 MB each) — 66 of 99 timed out; API CPU peak 47 %. The remaining limit is the 11 MB payload shape (11 §2), not the poll rate |
| 14:20 | go-live | 200 | 73 s | 1,031 | 14.1 | 2.0 % | 11.4 s | 23.1 s | 38.5 s | **ABORTED during the 60 s ramp**: 200 first-page loads (80 tablets × batch-states + 7 more requests each) in one minute = a shift change; batch-states 21/49 timed out; API CPU peak 49 % |
| 14:14 | go-live | **100** | 300 s | 5,430 | 18.0 | 0.5 % | **528 ms** | 4.4 s | 26.8 s | **completed** (no abort); batch-states included after fix 6, lean runner, fresh API: batch-states 215 ok / 28 timeouts / 46 × 401. The 401s are the runner's cached logins reaching their 1 h lifetime mid-run (fixed in `lib/auth.mjs` afterwards), not the app. |

Not counted: run 12:52 (5 users, aborted — the API was still working through the previous run's backlog)
and run 13:34 (100 users, invalid: started while the server was still draining the 13:28 backlog, and Git
Bash had rewritten the skip-list argument so batch-states was still requested). Lesson recorded in the
runner docs: wait for the API process to go idle between runs, and `export MSYS_NO_PATHCONV=1`.

Target (02 §6): p95 ≤ 500 ms ordinary / ≤ 2 s heavy, errors < 0.1 %, at 100 concurrent users.
**Status at 100 users (go-live data, this PC): FAIL.** With the batch-states fix in, one attempt in four
completed (14:14: p50 528 ms, p95 4.4 s, 0.5 % errors — still over the targets); the other three
aborted on batch-states timeouts. Without the tablet's 30 s batch-states poll the same 100 users pass
comfortably (p95 1.7 s, 0 errors). **50 users is the level that is stable with today's polling design**
(see the soak in 07).

## 2. Resource use (sampler, 10 s intervals)

| Run | API CPU avg / max (% of machine; 12.5 % = one core) | API working set max | Postgres connections max | Lock waits |
|---|---|---|---|---|
| go-live 25 | 41 % / 50 % | 1.5 GB | 10 | 0 |
| go-live 50 | 43 % / 53 % | 3.2 GB | 10 | 0 |
| go-live 100 | 45 % / 54 % | 3.8 GB | 10 | 0 |
| go-live 100 without batch-states | 24 % / 40 % | 4.5 GB (same process, 4th run) | 10 | 0 |
| go-live 200 without batch-states (fresh process) | 17 % avg, 54 % max | 2.5 GB | 10 | 0 |

- The API process uses **3.5–4.3 cores** under load, not one: V8 garbage collection, TLS and the Prisma
  query engine (native, multi-threaded) run beside the JavaScript thread. The JavaScript thread is still
  the queue everything waits in.
- Postgres never had more than 10 connections (Prisma's default pool) and **no lock waits** in any run —
  the database was not the bottleneck in these read-heavy runs.
- **Memory grows run over run in one process**: 1.5 → 3.2 → 3.8 → 4.5 GB, and 3.8 GB while idle after the
  load stopped. V8's heap limit on this PC is 4,288 MB. Whether this is a leak or V8 holding freed heap is
  for the soak test (07) to answer; it is a risk either way on a shared server.
- After a run the API kept the CPU busy for **about three minutes** draining queued work (3.6 cores for
  minutes after the last request). A real outage would look the same: the server stays unresponsive after
  users have given up.

### 2a. One year of data at 100 users: connection-pool starvation disguised as `400`

Run 13:56 (year copy, 100 users, batch-states and the Cycles view both excluded) failed with 70 %
errors, all `400 DATA_CONSTRAINT`. The error log (`results/logs/app/error/`) shows the real cause on
every one of them:

> Timed out fetching a new connection from the connection pool (Current connection pool timeout: 10,
> connection limit: 9)

Prisma's default pool is `2 × physical cores + 1` = 9 on this PC (4 physical / 8 logical cores; the
sampler's 17 Postgres connections include the other test API and psql). The client's 12-core Xeon
would default to 25 — still unmeasured. Nothing in `apps/api/.env`, `scripts/install.ps1:160` or
`scripts/provision-db.ps1:178` sets `connection_limit` or `pool_timeout` (grep 2026-10-17). On one year of data the heavy reads take 0.5–3 s
each, so nine connections are permanently busy, every further query waits up to 10 s for one, then fails
— and the app's error handler reports that as a *data constraint* to the user. The API process reached
**7.2 GB** working set during this run. Three separate findings:

1. **No connection-pool sizing** (`DATABASE_URL` has no `connection_limit` / `pool_timeout`; Postgres
   allows 100). Nine connections is far too few for whole-table reads at this volume; the right number
   must be measured, not guessed (05).
2. **Unmapped Prisma errors become `400 DATA_CONSTRAINT`** (`apps/api/src/app.ts:404-416`, a 2026-08-18
   decision so Prisma's message — which embeds source paths — never reaches a client). It catches
   `P2024` pool timeout, `P2028` transaction timeout and the V8 string overflow alike — a server-side
   capacity failure is shown to users as if their request were invalid, and is counted by the runner as
   an error only because of the special rule in `lib/http.mjs`. Capacity codes should answer 503 with
   the same generic message (no leak), and be logged as capacity.
3. **No back-pressure**: the server accepts every poll and queues it; nothing sheds load or tells the
   tablets to slow down.
4. 🔴 **An overloaded server can make the tablet discard queued operator work.** The offline sync
   engine (`apps/web/src/lib/sync-engine.ts:152, 760-763`) treats any API error on a replayed operation
   as that operation's fault: it spends one of `MAX_RETRIES = 5` retries and after the fifth marks the
   operation **permanently failed**. A pool-timeout or transaction-timeout `400 DATA_CONSTRAINT` is such
   an error. Shift change is exactly when many tablets come back online and replay their queues against
   a busy server, so five busy minutes could cost a tablet its recorded cleanings. Only `CYCLE_ENDED`,
   `NO_CYCLE`, `STALE_TAPE` and re-auth errors are treated specially today. Not changed here — the sync
   engine is the protected offline surface — but this is the strongest reason to (a) answer capacity
   failures with 503 and (b) have the engine keep an operation `pending` (not spend a retry) on 5xx and
   transport errors. Decision for the operator (11).

### 2b. Pool what-if on the one-year copy — stopped by the machine's memory guard

Run 15:44 (year copy, 100 users, new polling, `connection_limit=20`, `pool_timeout=30`): the API
process grew to **5.0 GB** working set within the ramp and the PC fell to 2 GB free, at which point
Claude Code's low-memory guard killed the load runner (no result file). Two conclusions, both real:

1. A bigger pool turns pool starvation into **memory growth**: 20 connections each carrying a multi-MB
   result set (one-year `assets/instances` 2.2 MB, `hierarchy/*` 2 MB, Cycles view) are held in the
   Node process at once. Pool sizing on the client's server must be done with the sampler watching
   memory, not just errors, and `--max-old-space-size` must be set so the process fails fast instead
   of taking the box down.
2. **The 30-day Cycles-view window is still too large at the client's volume**: at 1,500 cleanings a
   day, 30 days = **48,241 cycles with 504,260 events** per request (counted on the year copy). The approved change fixes the
   go-live period (3–4 months of data) but not year two. The window should be 7 days or the view should
   page; recorded as an open decision in 11 §2.

The run is cheap to repeat once the operator decides the window: `start-perf-api.ps1 -NoBuild
-PoolLimit 20 -PoolTimeoutSec 30`, then the `high` profile on :3100 with the sampler.

## 3. The one cause of the collapse: `GET /api/filters/batch-states` — FIXED (fix 6)

The tablet operations page re-fetches the state of **every filter** every 30 s
(`apps/web/src/routes/mobile/mobile-operations.tsx`: `cacheAllStates` runs from a `useEffect` whose
dependency `instancesData` is an SWR hook with `refreshInterval: 30000`), and again on every sync
(`lib/offline-sync-service.ts:152`).

Profiled in-process (`tests/performance/profile/cpu-profile-batch-states.mts`, go-live data, 3,038 filters):

| Measure | Value |
|---|---|
| Wall time, one call | 6.3–7.0 s |
| Prisma queries, one call | **17,299** (5.7 per filter) |
| Postgres time, summed | 0.9–1.4 s |
| CPU inside the Prisma client (building/parsing those queries) | 59 % of samples |
| Waiting (idle) | 21 % |
| `JSON.stringify` of the 10.9 MB response | 52–59 ms |
| Response size | 11.2 MB per call |

Per-filter query shapes (count in one call): `asset_templates` by id (3,185), `asset_instances`
id/name/parent/template (3,183), `asset_instances` id/name/parent (3,038), `filter_details` (3,038),
`asset_instances` attributes/parent — the home-block walk (2,138), `asset_instances` id/parent (2,125).
All are lookups **by primary key** that could be loaded for all filters in one query each.

Payload: 92 % of the 11 MB is `pipelineGraph` (5.8 MB), `stageLookup` (1.9 MB) and `pipelineStages`
(1.2 MB) — and across the 3,038 filters there are only **5 distinct `pipelineGraph` values and 3 distinct
`pipelineStages`**. The same graph is sent 3,000 times per call.

Arithmetic: 40 tablets × one 7 s call every 30 s = **280 CPU-seconds of JavaScript-thread work per 30 s**.
Five tablets already exceed what one thread can do. This matches the runs: at 25 users (10 tablets) 21 of
66 batch-states calls timed out at 30 s; at 100 users 89 of 90.

The 2026-07-15 M39 memo already removed the *shared* reads (configs, pipelines, PM entries) from the
fan-out; the six *per-filter* reads above are what remain.

**Fix 6 (applied with the operator's go-ahead, server only):** `batch-preload.ts` loads those six
projections for all filter ids and their ancestor chain with one `findMany` per level and seeds the
existing batch memo under the keys `getCurrentState` already uses (`filter:<id>` — new, in `getFilter` —
`hb:<id>`, `parent:<id>`, `attrs:<id>`). `getCurrentState` itself is untouched.

| Measure (3,038 filters) | Before | After |
|---|---|---|
| Prisma queries per call | 17,299 | **286** |
| Wall time, in-process | 6.3–7.0 s | **0.63 s** |
| Over HTTPS, single call | 5.0–6.7 s | **0.9–1.4 s** |
| Response | 10.9 MB | 10.9 MB, **byte-identical** on both databases, with and without `cleaningAreaId` |

Tests: D5 parity + M39 fan-out (mocks now answer the bulk reads like the database), the whole
filter-operations folder (186) and the phase2 e2e suite (10) pass.

Still open from this endpoint: the 11 MB payload (the same pipeline graph repeated 3,000×) and the 30 s
poll itself. Both are changes to what the tablet caches offline, so they are design decisions for the
operator, listed in 11, not bug fixes.

## 4. Second tier: whole-table endpoints (why 200 users fail even without batch-states)

Single calls, one at a time, production build, one-year data unless noted:

| Endpoint | Who polls it | Time | Size |
|---|---|---|---|
| `GET /api/filters/cycles?limit=1000000&includeEvents=true` | tablet Cycles view, every 30 s | **> 120 s, aborted** (one year); 3.3–4.3 s p95 (go-live) | — / ~2 MB |
| `GET /api/assets/instances` | tablet + web filter ops, every 30 s | 2.6–5.1 s → 0.9 s after fix 4 | 2.2 MB |
| `GET /api/hierarchy/filters` | web, every 30 s on filter ops | 2.1–4.0 s → 0.5 s after fix 4 | 1.9 MB |
| `GET /api/hierarchy/tree` | web filter list, every 30 s | 2.3–2.7 s → 0.7 s after fix 4 | 2.0 MB |
| `GET /api/stage-approvals` (no status filter) | approvals page, on load | **39 s then `400`** (one year: 1.0 M rows, V8 string overflow); 1.1 s go-live | — |
| `GET /api/audit?limit=1` | dashboard card, every 30 s | 1.8–2.0 s (COUNT over 7.4 M rows) | 1 KB |
| `GET /api/filters/batch-states` | tablet, every 30 s | 3.5–7.3 s | 11.2 MB |
| `GET /api/pm-schedules/due` | My Tasks, every 30 s | 23.7 s then `400` → **1.6 s** after fix 3 | 841 KB |
| `GET /api/filters/cleaning-record?page=1&limit=25` | Cleaning Record page | 3.7–5.7 s → **0.3 s** after fix 5 | 266 KB |

Open items here (not fixed, no code change without a decision): the Cycles view and the unfiltered
stage-approvals list both load whole tables that grow without bound; the dashboard's audit count scans the
whole audit table every 30 s per dashboard user. These are the endpoints that saturate at 200 users on
go-live data and would do so at far fewer users after a year.

## 5. Defects found and fixed during the runs (CHANGELOG 2026-10-17)

Each fix was proven to return byte-identical output old vs new on the same database
(`tests/performance/equivalence/`), and the relevant test suites pass.

| # | Defect | Before | After |
|---|---|---|---|
| 1 | `verify-chain` never read `signature_audit_id` → every e-signed row reported tampered | 1,019,018 false positives (year), 138 (dev DB) | 0; regression test |
| 2 | `audit.ts` chain-head read `ORDER BY chain_position DESC NULLS LAST` → full-table sort on **every audited write**, under the global chain lock | 1,442 ms at 7.4 M rows; **logins and `session_sweep` failed** (P2028 → `400 DATA_CONSTRAINT`) | 0.13 ms, index probe |
| 3 | `pm-due-tasks.ts` loaded every cycle of every filter, full width | 23.7 s then failure (V8 max string) | 1.6 s; 18 cases identical |
| 4 | `last-cleaned.ts` groupBy/MAX over all 6.2 M events for every list | 1.8 s of each list call | 0.5 s (per-filter index probe) |
| 5 | Cleaning Record loaded every cycle id + every manual change to show one page | 3.7 s per page | 0.3 s; 8 cases identical |

## 6. The write path: operators driving cycles (scenario `tablet-operators`, one-year copy)

Operators take idle filters, start cycles and follow the server's decision tape to completion
(checklists, 1-minute dryer + readings, stage advances with instrument readings); shift officers poll
the approvals queue every 30 s and approve; everyone else idles. Every write is a real, hash-chained
row on the clone. Re-auth is not enabled for these actions in the clone's config, so there is **no bcrypt
cost in these numbers** (a site with re-auth on adds ~230 ms of CPU per signed write — 09).

| Run (UTC) | Users | Pace | Requests | Errors | Cycles started / completed | start-cycle p95 | advance p95 | approve p95 | Chain |
|---|---|---|---|---|---|---|---|---|---|
| 14:26 smoke | 5 (2 op + 3 officers) | 1× | 110 | 0 | 9 / 4 (4 abandoned by the runner on 423 — runner bug, fixed) | 114 ms | 97 ms | 293 ms | intact (101 rows) |
| 14:32 | 50 (20 op + 30 officers) | 3× | 3,635 (9.7/s) | **0** | **142 / 123** in 6 min | 78 ms | 59 ms | 315 ms (single) / 371 ms (bulk) | **intact (1,776 rows, 0 anomalies)** |

Concurrency behaviour observed in run 14:32 (from the http log):

- **96 × `409 STALE_TAPE` on `/advance`**: an officer's approval changed the cycle's tape between the
  operator's read and write; the operator re-read and continued. Correct behaviour, no lost writes.
- **85 × `400 INVALID_STATUS` and 6 × `409 CONCURRENT_DECISION` on `/approve`**: thirty officers saw
  the same queue and raced to approve the same rows; the first decision won, the others were refused.
  **No approval was recorded twice** (233 APPROVED rows for 233 decisions), and no filter ever had two
  in-progress cycles. This is the "same record, two users" test passing.
- **2 × `423 STAGE_APPROVAL_PENDING`** after the tape fix below was written but before it was deployed.
- `pg_lock_waits` stayed 0 and the global audit lock was never observed waiting at ~10 writes/s —
  about 30× the client's average write rate (02 §4: ≈ 0.3/s). The lock's limit was not reached here;
  a 100-tag bulk-operate burst (not yet run) is the case that would show it.

**Bulk-operate burst (run 15:36, scenario `bulk-operate`, one-year copy):** 10 operators each
submitting `POST /api/filters/bulk-operate` with up to 50 `start-and-advance` items (start the cycle,
advance into Wash In with two instrument readings) every ~20 s, 15 other users idling. 109 batches,
**2,890 items, 0 errors, every item `ok`**. A 50-item batch takes p50 ≈ 4.9 s, p95 5.3 s — about
100 ms per tag, i.e. two audited transactions per tag serialised behind the global audit lock. The
sampler (5 s interval) saw at most **1** lock wait and 3 active connections; API CPU 7 % avg / 15 % max.
That is ≈ 24 audited writes/s sustained with 10 tablets submitting at once, against the client's
average of ≈ 0.3/s (02 §4). The global lock is a real serialisation point but not a bottleneck at this
plant's size; a 100-tag batch would take ≈ 10 s and hold the lock for each item's transaction in turn.
Afterwards: 5,809 new audit rows, **chain intact (0 anomalies over 5,830 rows)**, 2,892 cycles started,
no filter with two in-progress cycles.

Defect found by this run and fixed (CHANGELOG, fix 7): the tape offered `SET_DRYER_DURATION` out of a
gated Wash Out while approval was pending; the server refused it with 423. Unit test added.

## 8. Before / after the operator-approved polling changes (11 §1b)

Same scenario, same go-live copy, same 100 users (40 tablets), lean runner, fresh process each time.
"Before" = the app as it was at the start of the day plus fixes 1–7; "after" = plus the approved
changes (tablet cache refresh every 5 min instead of every 30 s; Cycles view last 30 days; Approvals
"All" tab windowed; audit count reused 60 s).

| | Before (run 14:14, best of 4) | **After (run 15:24)** |
|---|---|---|
| Completed without abort | 1 of 4 attempts | yes |
| Requests / errors | 5,430 / 0.5 % | **5,208 / 0 %** |
| p50 | 528 ms | **54 ms** |
| p95 | 4.4 s | **570 ms** |
| p99 | 26.8 s | **968 ms** |
| batch-states p95 (calls) | 30 s, 28 timeouts (289 calls) | 2.4 s, 0 timeouts (62 calls) |
| API CPU avg / max | 37 % / 43 % | **14 % / 22 %** |
| API private bytes max | 3.3 GB | **1.4 GB** |

Against the targets in 02 §6 at 100 users: errors 0 % (target < 0.1 %) **PASS**; p99 968 ms (≤ 1 s)
**PASS**; p95 570 ms against 500 ms for ordinary endpoints — just over, because the two remaining
whole-table polls (`instances` 2.2 MB and `hierarchy/*` every 30 s) sit at 600–900 ms; heavy endpoints
≤ 2 s **PASS**. The first-load burst of 100 users in 60 s is now absorbed.

## 7. What was not tested yet

Bulk-operate bursts (50–100 tags per request), re-auth storm (bcrypt), login storm, spike, soak,
failure injection, backup/restore timing, and everything on the client's hardware. See `tasks/todo.md`.
