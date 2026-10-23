# 07 — Performance testing

**Status: NOT re-run in this campaign (operator 2026-10-23: "finish right now").** The full plan — load
profiles at one-year and go-live volume, the tablet write path, and the 1 / 4 / 12 / 24 h endurance soaks —
was prepared but not executed. This report carries forward the 2026-10-17/19 measurements and adds the
targeted measurements taken today while fixing the hot spots. **No load test was run against the code as
committed today.**

## 1. Carried forward (2026-10-17/19, `docs/production-readiness/04_*`, `07_*`, FINAL report)

| Result | Value | Evidence |
|---|---|---|
| 100 concurrent users, go-live data, after the 10-17 fixes (10 min) | 0 errors, p50 54 ms, **p95 570 ms**, p99 968 ms | FINAL report / 04 §8 — CARRIED FORWARD 2026-10-17 |
| 100 users with the tablet's 30 s batch-states poll (go-live data) | FAIL: 3 of 4 runs aborted on batch-states timeouts; the 4th p95 4.4 s | 04 §2 — CARRIED FORWARD |
| 30-min soak, 50 users, go-live data | p95 1.43 s overall, errors ~0, memory plateau 2.7–2.9 GB (no leak) | 07 — CARRIED FORWARD |
| 30-min soak, 100 users (10-19) | errors 0.009 %, p95 1.9 s, Node thread saturated after ~14 min | FINAL §4 — CARRIED FORWARD |
| One-year volume, 25 users (before 10-17 fixes) | ABORTED (p95 > 10 s) | 04 — superseded by the fixes below, NOT re-measured |

## 2. Executed 2026-10-22/23 (single-request and query-level, one-year copy `digilog_perf`)

These were measured by the agents fixing each hot spot (before / after on the same data); they are
query / call costs, **not** load-test results.

| Hot spot | Before | After | Commit |
|---|---|---|---|
| batch-states (the tablet poll that broke the 100-user runs) | 17,931 queries / call, 25.8–34.6 s | **65 queries / call, 3.2–7.5 s** (PC at 100 % CPU), byte-identical response | `213d54c`, `387810f` |
| Audit list total (visibility filter) | 68–73 s cold / 2.1 s warm | 171 ms (capped "10,000+") | `83bb8b4` |
| Filter events list total | 17 s cold | 80 ms (capped); pages 2+ 33–93 ms | `83bb8b4`, `d9aa1b3` |
| In-progress cycles list (equipment groups page) | 38.6 s cold / 6.4 s warm | 9.4 s cold / 1.8 s warm | `d9aa1b3` |
| Stage approvals, newest 100 / 30-day window | 1.6–2.0 s / 2.1–3.0 s | 0.3 ms / 0.4–2.1 s (index + split query) | `a92b6d3`, `ced1e4b` |
| Dashboard stats | 4.6–6.0 s per call | one shared 60 s snapshot (0 queries on repeat) | `460470b` |
| Cycles list at > 32k cycles / page | 400 DATA_CONSTRAINT after ~145 s | loads; tablet now pages on the server | `928ea36`, `a33ec8c` |
| Desktop Filter Operations page open | ~3,044 serial current-state GETs (~4 min) | 1 batch request per block | `e759a70` |
| Tablet "last cleaned" fallback | every cycle ever, with events | server's `lastCleanedAt` per row | `376b03c` |

## 3. Not done (and what it means)

- No load test, stress, spike, or soak on today's code. The biggest 10-17 failure (batch-states under the
  tablet poll) was fixed at the query level (275× fewer queries) but **its effect under 100 concurrent
  users is not measured**.
- No 1 / 4 / 12 / 24 h endurance run; the longest soak on record is 30 min (10-19).
- Audit search without a date range is still a full-table scan (≈ 26 s at one year); a `pg_trgm` index
  would fix it (operator decision, needs a migration).

**Recommendation (condition of the release decision):** run the prepared plan on the client's server
before go-live at 100 users — at least a 2 h soak, 8 h before sign-off (`tests/performance/README.md`).
