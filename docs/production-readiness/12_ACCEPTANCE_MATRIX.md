# 12 — Acceptance Matrix

Statuses: **PASS** (executed, met the target), **FAIL** (executed, did not), **PARTIAL** (executed,
met some of it), **BLOCKED** (could not be executed here, reason given), **NOT TESTED** (not executed).
Nothing is marked PASS that was not run. Targets are from 02 §6 (engineering targets, not contractual).
Everything was measured on the dev PC against disposable clones; the client's server will differ.

| # | Criterion | Target | Measured | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Smoke: app serves real page traffic at production data volume | no errors, p95 ≤ 2 s | after fixes 1–5: 0 errors, p50 125 ms, p95 6.0 s (one-year copy, 5 users) | PARTIAL | 04 §1 run 13:03 |
| A2 | Baseline 25 users | errors < 0.1 %, p95 ≤ 0.5/2 s | go-live: 1.5 % errors (batch-states timeouts), p95 3.0 s | FAIL | 04 run 13:16 |
| A3 | Normal 50 users | same | go-live: 3.3 % errors pre-fix; soak at 50 users after fix 6 — see A6 | see A6 | 04 run 13:22, 07 |
| A4 | High 100 users (planning peak) | same | **10 min, after the approved polling changes: 0 % errors, p50 54 ms, p95 570 ms, p99 968 ms, API CPU 14 %** (before them: 1 of 4 attempts completed, p95 4.4 s). **30 min (2026-10-19): 0.009 % errors, p50 144 ms, p95 1.9 s, p99 3.5 s** — minutes 14–27 at p95 2–5 s with API CPU doubled at constant load | **PARTIAL** — errors met; p95 met for 10 min only, not sustained (single Node thread saturates on this PC's core) | 04 §8, 07 §4 |
| A5 | Stress 200 / peak 300 users | degrade gracefully, recover | old polling: collapse during the 60 s ramp. New polling, 120 s ramp: still aborts during the ramp — 80 tablets' 11 MB first-load batch-states, 66/99 timeouts. 300 not attempted. | **FAIL** (limit = 11 MB payload shape, open decision) | 04 runs 13:51, 14:20, 15:31 |
| A6 | Endurance 30 min | no memory growth, stable latency | 50 users, old polling: 17,036 req, 0 errors, p95 improving 1.58 → 1.27 s over the run, private bytes plateau 2.7–2.9 GB. **100 users, new polling (2026-10-19): 32,608 req, 3 connection resets, memory peak 1.9 GB and back to 283 MB after (no leak), but latency NOT stable — p95 0.5 s for 13 min, then 2–5 s for 14 min, partial recovery** | **PASS at 50 / PARTIAL at 100** (memory criterion met at both; latency criterion met only at 50) | 07 §2, §4 |
| A7 | Endurance 2 h / 8 h / 24 h / 72 h | same | not run — no time on this PC; 8 h+ needs the client's server | NOT TESTED | — |
| B1 | Write path: cycles end to end under concurrency | 0 errors, chain intact | 50 users (20 operators @3×, 30 officers): 3,635 req, 0 errors, 142/123 cycles, chain intact | **PASS** | 04 §6 |
| B2 | Same-record race (two users deciding the same approval) | one decision recorded, the other refused | 85 × INVALID_STATUS + 6 × CONCURRENT_DECISION, 233 approvals for 233 decisions | **PASS** | 04 §6 |
| B3 | Stale-screen guard | stale write refused | 96 × 409 STALE_TAPE, clients re-read | **PASS** | 04 §6 |
| B4 | Bulk-operate burst (50 tags/request, 10 operators at once) | completes; lock contention measured | 109 batches / 2,890 items, 0 errors; 50-tag batch p95 5.3 s (~100 ms per tag); max 1 lock wait seen; chain intact | **PASS** | 04 §6 |
| B5 | Re-auth (bcrypt) storm | login/sign throughput known | 17/s at threadpool 4, 29/s at 8 (40 concurrent); not run as a scenario (re-auth off in the clone's config) | PARTIAL | 09 §1 |
| C1 | Audit chain verifies after every concurrency test | intact | 7.4 M generated + all load-test rows: 0 anomalies | **PASS** | 09 §1 |
| C2 | Verifier correct on e-signed rows | 0 false positives | was 1,019,018 false positives → 0 after fix 1 | PASS (after fix) | 11 §1 |
| D1 | Database at one year of volume | queries scale; no lock waits | 5 non-scaling queries fixed; 5 remain (whole-table polls, design decisions); 0 lock waits; pool exhausted at 100 users (9 connections) | PARTIAL | 05 |
| D2 | Five years of volume | — | not generated (≈ 5.5 h, 50 GB); linear extrapolation only | NOT TESTED | 05 §1 |
| D3 | `pg_stat_statements` evidence | per-statement totals | Postgres restart needs Administrator; not done | BLOCKED | 05 |
| E1 | Frontend payloads at volume | known | tablet downloads ~14 MB per 30 s; Cycles view never completes at one year | FAIL (design) | 06 |
| E2 | Browser/tablet render and memory | measured | not measured (no device) | NOT TESTED | 06 §4 |
| F1 | API process restart under load | recovers; clients resume | killed at 100 s of a 50-user run: serving again in ≈ 4 s; 32 of 2,283 requests failed (two 10 s windows), then 0 errors | **PASS** | 08 §1 |
| F2 | Postgres restart / outage under load | API reconnects | needs Administrator | BLOCKED | 08 |
| F3 | Disk full / backup failure behaviour | reported | not run | NOT TESTED | 08 |
| G1 | Backup of production-size DB (10.2 GB, one year) | time and size known | custom: 4.1 min → 1.6 GB; nightly plain SQL: 1.6 min → 7.7 GB | **PASS** (measured) | 10 §2 |
| G2 | Restore into a clean DB + chain verify | time known, chain intact | custom restore 6.4 min, plain replay 10.4 min, all rows present; chain window verified (see todo notes) | **PASS** (measured; backups live on the same disk — see G3) | 10 §2, §5 |
| G3 | RPO / RTO | set by the client | **not defined** — must come from the client | BLOCKED | 10 |
| H1 | Clean offline install on Windows Server 2022 | works without internet | never done | NOT TESTED | 01 §7 |
| H2 | Client hardware numbers (Xeon 4310) | — | not available | NOT TESTED | 02 §1 |
| I1 | Security controls exercised under load | behave | rate limit, session, chain, races: as designed; capacity failures mislabelled 400 | PARTIAL | 09 |
| I2 | Compliance claim | — | **no claim made**; validation is the client's | — | 09 |

Overall: see `FINAL_PRODUCTION_READINESS_REPORT.md`.
