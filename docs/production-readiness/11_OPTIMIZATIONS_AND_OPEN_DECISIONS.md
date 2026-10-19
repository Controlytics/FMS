# 11 — Evidence-Based Optimisations and Open Decisions

Rule followed: no change without a measurement that shows the need, and no change to what a request
returns. Every fix below was proven **byte-identical** old vs new on the same database before it was
kept (`tests/performance/equivalence/`), and the relevant test suites pass. All numbers are from
2026-10-17 on the dev PC; "year" = `digilog_perf` (one year of volume), "go-live" = `digilog_day1_perf`.

## 1. Fixes applied (CHANGELOG 2026-10-17)

| # | File | Defect | Evidence before | After | Proof of same output |
|---|---|---|---|---|---|
| 1 | `apps/api/src/lib/audit-verify.ts` | `verify-chain` never selected `signature_audit_id`, which is inside every e-signed row's checksum | 1,019,018 rows flagged tampered (year), 138 of 976 (dev DB) | 0 false positives | regression test in `e2e/audit-chain.test.ts` fails without the fix |
| 2 | `apps/api/src/lib/audit.ts` | chain-head read `ORDER BY chain_position DESC NULLS LAST` cannot use the ascending index → full-table sort **under the global audit lock on every audited write** | `EXPLAIN ANALYZE`: 1,442 ms, 458,108 buffers read (3.5 GB) at 7.4 M rows; under load P2028 transaction timeouts → **login and `session_sweep` failed** | 0.13 ms, 4 buffers (index scan backward) | same row (no NULL positions exist; `chain_position` is BIGSERIAL); 156 audit/lib tests; chain verifies across post-fix rows |
| 3 | `apps/api/src/modules/pm-schedules/pm-due-tasks.ts` | loaded every cycle of every filter under the AHUs in view, full width | 23.7 s then `400` (result > V8 max string); 3,700 cycles/AHU/year | 1.6 s default view, 841 KB | 18 cases (dev DB + year; skipped visits, past, future, ranges) JSON-identical: `equivalence/pm-due-compare.mts` |
| 4 | `apps/api/src/lib/last-cleaned.ts` | `groupBy/MAX` aggregated all 6.2 M events for every list call (`/api/assets/instances`, `/hierarchy/filters`, `/hierarchy/tree`) | 1.8 s per call (slow-query log) | 0.5 s (per-filter probe on `(filter_id, performed_at DESC)`) | SQL: 3,031 rows, 0 mismatches; the three endpoints byte-identical (2.2 / 1.9 / 2.0 MB) |
| 5 | `apps/api/src/modules/filter-operations/filter-operations.service.ts` (Cleaning Record) | loaded every cycle id + every manual change (566k rows) and sorted in Node to show 25 | 3.7–5.7 s per page; 0.6 s of it SQL | 0.3 s | 8 cases byte-identical (pages 1/2/40/560, date range, filter, block, AHU) |
| 6 | `apps/api/src/modules/filter-operations/batch-preload.ts` (+ `getFilter` memo) | `GET /api/filters/batch-states`: six primary-key reads per filter | 17,299 queries, 6.3–7.0 s/call, 59 % CPU in the Prisma client; polled every 30 s per tablet → **the cause of the collapse at 25–100 users** | 286 queries, 0.63 s in-process, 0.9–1.4 s over HTTPS | 4 captured responses byte-identical (both DBs, ± `cleaningAreaId`); D5 parity + 186 filter-ops tests + phase2 e2e |

What these have in common: each one worked at the volume the app had ever seen (dev DB: 38 cycles, 976
audit rows) and failed only at production volume. **No test, environment or dashboard had ever held a
year of data before this assessment.**

## 1b. Behaviour changes approved by the operator (2026-10-17, after the measurements above)

| Change | Was | Now | Where |
|---|---|---|---|
| Tablet offline-cache refresh (`batch-states`) | on every 30 s `instances` poll — 11 MB per tablet per 30 s | when the tablet comes online, every 5 min, on sync, on the manual button | `mobile-operations.tsx` |
| Tablet Cycles view | every cycle ever recorded, with events, every 30 s (never completes at one year) | last 30 days (key fixed per mount) | `mobile-operations.tsx`, `mobile-wrapper.tsx` (Cycles view only; status/rfid/replace keep the full list, loaded once, as a last-cleaned fallback) |
| Stage Approvals "All" tab | every approval ever (1.0 M rows → 39 s, failure) | all PENDING + last 30 days: `GET /api/stage-approvals?from=` | `stage-approvals/{routes,service}.ts`, `stage-approvals/index.tsx`; unit test `list-window.test.ts` |
| Dashboard audit total | `COUNT(*)` over 7.4 M rows every 30 s per user (1.8–2.0 s) | identical filters reuse the count for 60 s; rows never cached | `audit/routes.ts` |
| Capacity errors | `400 DATA_CONSTRAINT`; tablet drops queued work after 5 | `503 SERVICE_BUSY` for `P2024`/`P2028`; sync engine keeps the op pending on any 5xx/429 | `app.ts`, `sync-engine.ts` (+ test 4b) |
| bcrypt threadpool | default 4 threads | `UV_THREADPOOL_SIZE=8` in the service definition | `register-services.ps1` |

Before/after of these under load: 04 §8 (the 100-user rerun with the new polling model).

## 2. Remaining decisions (measured; still open) — the rows marked *applied* moved to 1b

| Item | Evidence | Why it is a decision, not a fix | Options |
|---|---|---|---|
| **Still open:** `batch-states` payload 11 MB (5 distinct graphs × 3,038 filters) | 92 % of the body is repeated graph | response shape = what the tablet caches offline | send graphs once + per-filter reference; needs the tablet change in step |
| **Still open:** Prisma pool size | default 9 here exhausted at 100 users on one year of data | depends on the real server's query times | measure on the client's box; set `connection_limit` + `pool_timeout` in `DATABASE_URL` |
| **Still open:** the Cycles view's 30-day window is too large at the client's volume | 30 days at 1,500 cleanings/day = 48,241 cycles / 504,260 events per request (counted on the year copy); the 100-user pool what-if on that copy drove the API to 5 GB | the window was chosen for go-live, not year two | 7 days, or page the view (e.g. 200 most recent + "load more") |
| **Still open:** tablet status / rfid-assign / replace views still load the full cycle list once per view open | same query as the Cycles view, without the window | only a fallback for "last cleaned"; the server's `lastCleanedAt` already covers it | drop the fallback or window it too |
| *applied* — tablet 30 s cache refresh, Cycles view window, Approvals window, dashboard count, 503 mapping, threadpool | | | see 1b |
| Tablet polls `batch-states` every 30 s (`mobile-operations.tsx`, `useEffect` on `instancesData`) | **measured after fix 6** (run 14:08, 100 users): 153 of 181 calls still timed out. 40 tablets × ~0.6 s of JS-thread work every 30 s ≈ 80 % of the one thread for this call alone, before any other request | changes when the offline cache refreshes — protected offline surface | (a) refresh on sync/resume + every N minutes instead of 30 s; (b) ETag/304 so an unchanged batch costs nothing to send; (c) a short server-side cache of the computed batch (10–15 s) so N tablets share one computation — accepted staleness must be the operator's call |
| `batch-states` payload 11 MB | 92 % is `pipelineGraph`/`stageLookup`/`pipelineStages`; **5 distinct graphs across 3,038 filters** | response shape = what the tablet caches offline | send graphs once + per-filter reference; needs tablet change in step |
| Tablet Cycles view `GET /api/filters/cycles?limit=1000000&includeEvents=true` every 30 s | > 120 s and aborted at one year; 3–4 s on go-live | page-size caps were deliberately removed by the operator (2026-09-04) | server-side window (e.g. last N days) chosen by the operator; or paginate the view |
| `GET /api/stage-approvals` unfiltered (approvals page) | 1.0 M rows → 39 s then V8 overflow at one year | same cap decision | default to PENDING/last-30-days unless a filter is given |
| Dashboard `GET /api/audit?limit=1` every 30 s | `COUNT(*)` over 7.4 M rows = 1.8–2.0 s per dashboard user per 30 s | the card wants the total; the count is the cost | approximate count (`pg_class.reltuples`) or cache the total for 60 s |
| Prisma connection pool | default 9 here (2 × physical cores + 1); exhausted at 100 users on one year of data → `P2024` | the right size depends on query times on the real server | measure on the client's box; set `connection_limit` + `pool_timeout` in `DATABASE_URL` (install.ps1 writes it) |
| `400 DATA_CONSTRAINT` for every unmapped Prisma error (`app.ts:404-416`) | pool/transaction timeouts shown as a client error; the tablet spends a retry on it and after 5 **drops the queued operation** (`sync-engine.ts:152, 760-763`) | status-code contract between server and the protected sync engine | server: `P2024`/`P2028` → 503 (same generic message); engine: keep `pending` on 5xx/transport errors |
| `UV_THREADPOOL_SIZE` for bcrypt | 40 concurrent logins: 17/s at pool 4, 29/s at 8 (`security/bcrypt-throughput.mjs`) | env change on the service | set 8 in the WinSW service definition |
| API memory | 1.5 → 4.5 GB across runs in one process, 3.8 GB idle; heap limit 4,288 MB; 7.2 GB during the year run | leak vs. V8 keeping freed heap is unknown until the soak (07) | `--max-old-space-size` sized to the box; soak first |

## 3. Not optimised because the measurement said no

- Postgres settings (`shared_buffers` 128 MB, `work_mem` default): **no lock waits, pool never above 10
  connections, DB time a minority of every slow request** in all runs so far. Tuning memory would have
  been speculation; revisit after the pool is sized and on the real server.
- Caching layers, replicas, queues, a second API process: nothing measured calls for them yet. The
  JS-thread CPU per request is the limit; removing wasted queries (above) bought 10× where it mattered.
