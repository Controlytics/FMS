# 05 — Database Stress and Scalability

Measured 2026-10-17 on PostgreSQL 18.3 (stock settings: `max_connections=100`, `shared_buffers=128MB`)
against the one-year clone `digilog_perf` unless noted. `pg_stat_statements` is configured in
`postgresql.conf` but **the Postgres restart (needs Administrator) has not happened yet**, so per-statement
totals are not available; the figures below come from `EXPLAIN (ANALYZE, BUFFERS)`, the app's slow-query
log (profiling instance), and the resource sampler.

## 1. Volume reached

| Table | Rows (one year) | Size | Per day | 5 years (linear) |
|---|---|---|---|---|
| `audit_trail` | 7,399,215 | 5.3 GB | ≈ 20,000 | ≈ 37 M rows, ≈ 27 GB |
| `filter_events` | 6,226,649 | 4.0 GB | ≈ 17,000 | ≈ 31 M rows, ≈ 20 GB |
| `cleaning_stage_approvals` | 1,018,929 | 555 MB | ≈ 2,800 | ≈ 5 M rows |
| `cleaning_cycles` | 565,998 | 301 MB | ≈ 1,550 | ≈ 2.8 M rows |
| whole database | | **10.2 GB** | ≈ 28 MB | **≈ 50 GB** |

Index growth is included in the sizes (`pg_database_size`). The generator's numbers match the workload
model in 02 §5 (1,500 cleanings/day, ~11 events per cycle, ~13 audit rows per cycle including the two
e-signatures of the stage interlock).

## 2. Queries that stopped scaling (found by load, fixed, measured)

| Query | Plan before | Plan after | Where |
|---|---|---|---|
| audit chain head, run on **every audited write under the global lock** | `Parallel Seq Scan` + top-N sort over 7.4 M rows: **1,442 ms, 458,108 buffers (3.5 GB)**, because `ORDER BY chain_position DESC NULLS LAST` cannot use the ascending index | `Index Scan Backward` on `audit_trail_chain_position_idx`: **0.13 ms, 4 buffers** | `lib/audit.ts` (fix 2) |
| latest cleaning event per filter (every filter list) | `GROUP BY filter_id` + `MAX` over all 6.2 M events: 1.8 s | `LATERAL ... ORDER BY performed_at DESC LIMIT 1` per filter on `(filter_id, performed_at DESC)`: 0.5 s for 3,061 filters, 0 mismatches | `lib/last-cleaned.ts` (fix 4) |
| PM due: every cycle of every filter under the AHUs in view | full-width fetch of ~3,700 cycles per AHU; result > V8 string limit | bounded to `IN_PROGRESS OR completed_at >= earliest window`, 5 columns; + `DISTINCT ON (filter_id)` for the last cycle | `pm-due-tasks.ts` (fix 3) |
| Cleaning Record paging | `SELECT id, started_at FROM cleaning_cycles ORDER BY started_at DESC` — all 566 k rows to show 25 (0.6 s SQL + 3 s Node sort) | `take = page × limit` on each source + two `COUNT(*)` | `filter-operations.service.ts` (fix 5) |
| batch-states | 17,299 primary-key lookups per call (DB time < 1.4 s; client overhead 5 s) | 286 queries (bulk `id IN (...)` per level) | `batch-preload.ts` (fix 6) |

## 3. Queries that still do not scale (measured, not changed — see 11)

| Query | Cost at one year | Trigger |
|---|---|---|
| `SELECT COUNT(*) FROM audit_trail WHERE user_role <> 'SUPER_ADMIN' AND action NOT IN (…)` | 1.8–2.0 s, full scan of 7.4 M rows | dashboard card `GET /api/audit?limit=1`, every 30 s per dashboard user |
| `SELECT … FROM cleaning_cycles … ORDER BY started_at DESC` + events for every cycle | > 120 s, aborted (client timeout) | tablet Cycles view `?limit=1000000&includeEvents=true`, every 30 s |
| `SELECT … FROM cleaning_stage_approvals …` unfiltered, 1.0 M rows | 8.1 s SQL, then V8 string overflow → `400` | approvals page `GET /api/stage-approvals` |
| `SELECT TO_CHAR(started_at,'YYYY-MM'), COUNT(*) … WHERE started_at >= ?` and `AVG(EXTRACT(EPOCH …))` over all completed cycles | 1.0–1.2 s and 0.7–0.9 s | dashboard stats, every 20 s per dashboard user |
| `COUNT(*) … cleaning_cycles WHERE status='COMPLETED' AND completed_at >= ?` (×2) | 0.4 s each | dashboard stats |

All five are **aggregates or whole-table reads driven by polling**. None is a missing index: the chain
head was the only index mistake found. They are design decisions (limit the window, cache the aggregate,
or stop polling them) listed in 11 §2.

## 4. Connections, locks, pool

- **Lock waits: 0** in every run (sampler column `pg_lock_waits`, 10 s samples). The global audit
  advisory lock was never observed waiting — but the write-path load test (tablet-operators scenario)
  had not run when this was written; see 04 for its result.
- **Idle-in-transaction: 0** in every sample.
- **Prisma pool: default 9 connections** (`2 × physical cores + 1`), no `connection_limit` /
  `pool_timeout` anywhere in the configuration. At 100 users on one year of data the pool was exhausted
  (`P2024` after the 10 s pool timeout) and 70 % of requests failed, reported to users as
  `400 DATA_CONSTRAINT` (04 §2a). Postgres itself was never above 17 connections of its 100.
- `max_connections=100` is not the limit; the pool is. The right pool size depends on the real server's
  query times and must be measured there (05 §6).

## 5. Postgres memory settings

Stock `shared_buffers=128MB` against a 10 GB database: the chain-head scan read 3.5 GB from disk/OS
cache per call before fix 2. After the fixes the measured hot paths are index probes and the sampler
shows the database is **not** where request time goes (DB time is a minority of every slow request in
04 §4). Tuning `shared_buffers`/`work_mem` would have been speculation at this point and was not done.
Revisit on the real server with `pg_stat_statements` once the restart is possible.

## 6. Not done here

- `pg_stat_statements` totals (restart pending).
- Scale 5 (five years) data: generation at scale 1 took 66 min and 10 GB; scale 5 is ~5.5 h and 50 GB
  on this PC's disk. The linear extrapolation above is the estimate until it is run.
- Concurrency/lock tests on the write path (the `tablet-operators` scenario) — in progress, see 04.
- Vacuum/bloat behaviour over months (needs a soak with writes).
