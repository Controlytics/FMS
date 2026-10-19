# FMS / DigiLog — Production Readiness Report

Date: 2026-10-17. Scope: the application as of branch `RFID` at `755f0ae` plus the fixes made today
(uncommitted at the time of writing; see §6). Environment: the developer's Windows 11 PC (8 logical
cores, 16 GB) with two disposable database clones — a **go-live** copy (300 users, 3,000 filters, one
day of history) and a **one-year** copy (566k cycles, 6.2M filter events, 7.4M audit rows, 10 GB).
Nothing was run against a live or real database. Full evidence: `00`–`12` in this folder, raw results in
`tests/performance/results/`.

## 1. Verdict

**READY WITH CONDITIONS** for the stated workload (300 registered users, ~100 concurrent, 1,500
cleanings/day), **on this evidence and on this test PC** — subject to the conditions in §2. It was
**NOT READY** at the start of the day: at production data volume the app failed outright on My Tasks,
Stage Approvals and the audit verifier, logins failed under load, and the tablet's polling collapsed the
server at 25 users. Twelve defects were fixed and four behaviour changes were approved and applied; the
same 100-user test then ran with 0 errors, median 54 ms, p95 570 ms. A 30-minute soak at 100 users on
2026-10-19 (07 §4) held the error rate at 0.009 % but not the latency: p95 1.9 s overall, with a
14-minute stretch at 2–5 s while the API's CPU doubled at a constant request rate. On this PC the single
Node thread is at its limit at 100 concurrent users; the 10-minute figure is the best case.

This is not a claim of 21 CFR Part 11 compliance and not a capacity guarantee for the client's server,
which was not available (02 §1, 12 H2).

## 2. Conditions (must be done before go-live)

1. **Deploy today's fixes** (§6) — without them the app fails within months of normal use (audit write
   scan, PM-due overflow, verifier false positives).
2. **Rebuild and install the tablet app** — three of the fixes are in the web/tablet code (offline-cache
   refresh cadence, Cycles view window, sync-engine retry behaviour). An old APK keeps the old polling.
3. **Set the Prisma pool explicitly** in the installed `DATABASE_URL` (`connection_limit`,
   `pool_timeout`) after a measurement on the client's server (05 §4; 04 pool what-if).
4. **Run the long soaks on the client's hardware** (2 h minimum, 8 h before sign-off) with the sampler
   — only 30 min was possible here (07). Run them **at 100 users**: here the 100-user soak saturated the
   Node thread after 14 minutes (07 §4), so the client-server run must show whether its core is faster
   or slower than this PC's. If p95 drifts the same way, profile the process (`NODE_OPTIONS=--trace-gc`
   or an inspector CPU profile from minute 12) before changing anything. Also the Postgres-restart test
   (08 §2) and `pg_stat_statements` (05), both of which need an Administrator session.
5. **Define RPO/RTO with the client** and move backups off the application disk (10). Today: nightly
   plain-SQL dump to the same machine, 14-day retention, no off-box copy.
6. **Clean offline install on Windows Server 2022** has never been done (01 §7, 12 H1).
7. Keep `API_DOCS` unset on the customer machine (09 §2).

## 3. What was measured (headline numbers)

| Test | Result |
|---|---|
| 100 concurrent users, go-live data, after changes (10 min) | **0 errors, p50 54 ms, p95 570 ms, p99 968 ms**, API CPU 14 % of this PC (04 §8) |
| **30-minute soak, 100 users, new polling (2026-10-19)** | 32,608 requests, 3 connection resets (0.009 %), **p50 144 ms, p95 1.9 s, p99 3.5 s**. Minutes 1–13 matched the 10-min run; minutes 14–27 p95 2–5 s with API CPU 29–36 % at the same request rate, then partial recovery. Idle cost unchanged afterwards (no leak); Postgres idle throughout. The single Node thread is the ceiling (07 §4) |
| Same, before today's changes | 1 in 4 attempts completed; p95 4.4 s; batch-states timeouts |
| 200 users (shift-change shape: everyone opening the app within 2 min) | fails during the ramp: 80 tablets × 11 MB first-load payload (04); needs the payload-shape change (§4) |
| 30-minute soak, 50 users | 17,036 requests, 0 errors, latency flat/improving, memory plateau 2.9 GB (07) |
| Write path: 20 operators driving cycles + 30 approvers, 3× pace | 3,635 requests, 0 errors, 142 cycles started / 123 completed in 6 min; races answered correctly; audit chain intact (04 §6) |
| Bulk tag submit: 10 operators × 50 tags at once | 2,890 items, 0 errors, 50-tag batch p95 5.3 s; ≈ 24 audited writes/s; chain intact (04 §6) |
| API killed under load | serving again in ≈ 4 s; 32 of 2,283 requests failed (08) |
| One year of data, 100 users | pool starvation (9 connections) → 70 % failures; now reported as 503. With a 20-connection pool the process grew to 5 GB and the PC's memory guard stopped the run — pool sizing and `--max-old-space-size` are condition 3 (04 §2a–2b) |
| Cycles view at one year | the approved 30-day window is still 48,241 cycles / 504,260 events per request at 1,500 cleanings/day — fine at go-live, not in year two; 7 days or paging is an open decision (11 §2) |
| Audit chain over 7.4 M generated + all test rows | intact, 0 anomalies (09) |
| Backup / restore of the 10 GB copy | see 10 |

## 4. What remains open (decisions, not defects)

- **The tablet's all-filters payload is 11 MB** because 5 pipeline graphs are repeated 3,000 times. This
  is what still breaks the 200-user shift change. Sending each graph once needs a tablet-side change in
  step with the server (11 §2).
- Three tablet views (status / RFID-assign / replace) still load the full cycle list once when opened.
- **One Node process is the capacity ceiling at about 100 concurrent users on this PC's core** (07 §4).
  The cheap half of the answer is the 11 MB payload above (less JSON to build and send per refresh); the
  other half is a second API process (Node cluster or two services behind one port), which is an
  infrastructure change this assessment deliberately did not make without the client-hardware
  measurement. The global audit lock is a Postgres advisory lock, so it would survive a second process;
  the in-process cron jobs and the 60 s audit-count cache would need a single-owner rule.
- Postgres memory settings were deliberately left at stock: the database was never the bottleneck in any
  run (0 lock waits; DB time a minority of every slow request).

## 5. What was not tested

8/24/72 h soaks; the client's Xeon server; real tablets, RFID readers and plant Wi-Fi; a clean offline
install; Postgres restart under load; five years of data (extrapolated linearly from one year: ≈ 50 GB);
disk-full behaviour; penetration testing. Each is marked NOT TESTED or BLOCKED in 12 with the procedure
to run it.

## 6. Changes made today (all measured, none changing stored records)

Defects fixed (CHANGELOG 2026-10-17; each proven byte-identical old vs new where output exists):
verifier false positives on signed rows · audit chain-head full scan on every write · PM-due overflow ·
last-cleaned aggregate · Cleaning Record paging · batch-states 17,299 queries → 286 · tape offered a
refused action at a gated stage · capacity failures reported as `400` (now `503`) · tablet sync engine
dropping queued work on server errors.

Operator-approved behaviour changes: tablet cache refresh every 5 min (was every 30 s) · Cycles view
last 30 days · Approvals "All" tab windowed · dashboard audit count reused 60 s · `UV_THREADPOOL_SIZE=8`.

Tests after all changes (2026-10-17 21:52): full workspace run from `apps/api` in single-fork mode —
**258 files, 2,912 tests passed, 13 skipped, 0 failed**; web suite alone 75 files / 913 passed. New
tests: verifier signed-row regression, interlock tape filter, approvals list window, sync-engine 4b.
Nothing is committed yet; the operator commits and pushes.

## 7. How to repeat

`tests/performance/README.md` — one command per scenario, clone-only safety guards, the data generator
for a fresh one-year copy, the resource sampler, and the equivalence tools used to prove each fix.
