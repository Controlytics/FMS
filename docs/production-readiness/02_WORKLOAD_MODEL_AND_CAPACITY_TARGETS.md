# 02 — Workload Model and Capacity Targets

Status: model built 2026-10-17 from the operator's answer ("300 users, 1,500 cleanings a day",
with the stated assumptions of **100 concurrent users** and **5 years of retained data**) plus the
measured request behaviour of the web app (`05a_FRONTEND_STATIC_AUDIT.md`). Everything marked
**ASSUMPTION** still needs the client's confirmation.

## 1. Hardware

| Item | Production (quoted, 10-08) | Test box (this PC) |
|---|---|---|
| CPU | 1× Xeon Silver 4310, 12C/24T, 2.1 GHz | 8 logical cores (dev PC) |
| RAM | 64 GB ECC | dev PC |
| Disk | 3× 3.84 TB SSD RAID5 | dev SSD |
| OS | Windows Server 2022 Std | Windows 11 Pro |
| PSU | single 800 W (recommend redundant) | — |

Not verified on real hardware. The quote's R440 chassis does not take an Ice Lake 4310 (R450/R650 do) — see
memory `reference_server_sizing_2026_10_08`. **Because the API is one Node process, per-core speed matters
more than core count:** the 4310 (2.1/3.3 GHz) may be *slower per request* than a modern desktop CPU. Test-box
results must not be read as a lower bound for production.

## 2. Users and sessions

| Parameter | Value | Basis |
|---|---|---|
| Registered users | 300 | operator |
| Peak concurrent users | **100** (planning), 200 and 300 tested as stress | ASSUMPTION (stated in the question, accepted) |
| Desktop vs tablet share | 60 % / 40 % (`PERF_TABLET_SHARE`) | ASSUMPTION |
| Shift changes | 3 per day; login storm = all of a shift's users within ~5 min | ASSUMPTION |
| Session model | 1 session per user, token TTL from session config | code |

## 3. Background (polling) load — measured from code, not assumed

Per user with one visible tab (`05a` §1):

| Persona / page | req/min |
|---|---|
| Desktop, any page (global timers only) | ≈ 3.2 |
| Desktop dashboard | ≈ 12.2 |
| Desktop filter list / stage approvals / my tasks | ≈ 5.2 |
| Tablet operations view | ≈ 13.7–18.7 + 4 × (drying filters on screen) |
| Tablet cycles view (downloads **all** cycles with events) | ≈ 13.7 |

Weighted mix used by the `web-users` scenario (desktop: dashboard 3, filter list 2, cleaning record 2, stage
approvals 1, my tasks 1, filter ops 1; tablet: operations 6, cycles 2, approvals 1):
≈ 7.7 req/min per desktop user, ≈ 14 req/min per tablet.

| Concurrent users | Polling req/s (steady) |
|---|---|
| 100 | ≈ 17 |
| 200 | ≈ 34 |
| 300 | ≈ 51 |

Plus page-load waterfalls (4–9 requests per navigation, ~1 navigation / 3 min / user) and the tablet resume burst
(≈ 40–45 + P requests per tablet, `05a` finding 2) — 40 tablets resuming together ≈ 1,800 requests in seconds.

**Payload size matters more than rate here:** several polled endpoints return whole tables
(`/api/filters/cycles?limit=1000000&includeEvents=true`, `/api/notifications?limit=1000000`,
`/api/assets/instances`, `/api/hierarchy/tree`). Their cost grows with data, so the same rate is cheap on day 1
and expensive in year 3. Measured at 1× and 5× data volume in `04`.

## 4. Business writes

| Parameter | Value | Basis |
|---|---|---|
| Cleanings / day | 1,500 | operator |
| Operations per cleaning | ~10–12 (start, stage advances, checklists, Dry In set + readings, completion) | profile shape |
| Cleaning writes / day | ~15,000–18,000 | derived |
| Working window | 2 shifts × 8 h = 16 h | ASSUMPTION |
| Average write rate | ≈ 0.3 writes/s | derived |
| Peak write rate | bulk-operate of 50–100 tags per request, several tablets at once; modelled as 10× average + bulk bursts | ASSUMPTION |
| Audit rows / day | ≈ 20,000 (one per audited op + logins/re-auth) | derived |

The average write rate is low. **The risk is not volume but concurrency**: every audited write takes the same
global lock (`01` §9), so one 100-tag bulk-operate delays every other user's write for its whole duration.

## 5. Data growth (5 years)

| Table | Per year | 5 years | Basis |
|---|---|---|---|
| `cleaning_cycles` | ~550,000 | ~2.7 M | 1,500/day |
| `filter_events` | ~6 M | ~30 M | ~11 per cycle |
| `audit_trail` | ~7 M | ~36 M | ≈ 20k/day; never deleted |
| `notifications` | depends on rules | — | measured by generator |
| Asset instances (filters) | ~3,000 live + retirements | — | ASSUMPTION (plant size) |

Disk: measured in `04` from the generated scale-1 database and extrapolated linearly (index growth checked).

## 6. Targets (initial engineering targets, not contractual)

| Metric | Target at 100 concurrent users |
|---|---|
| Ordinary endpoints p95 / p99 | ≤ 500 ms / ≤ 1 s |
| Whole-list / heavy endpoints | reported separately; target ≤ 2 s p95 |
| Error rate (transport, 5xx, 429) | < 0.1 % |
| Business refusals (409/400) | reported, not counted as errors |
| API process CPU | < 70 % of **one core** sustained (Node is single-threaded) |
| Memory | no upward trend over a soak |
| Audit chain | verifies after every concurrency test |
| RPO / RTO | **must be set by the client** — not invented here |

## 7. Load profiles (`tests/performance/api/run-load.mjs`)

| Profile | VUs | Duration | Notes |
|---|---|---|---|
| smoke | 5 | 2 min | allowed without `PERF_CONFIRM` |
| baseline | 25 | 5 min | |
| normal | 50 | 10 min | |
| high | 100 | 10 min | = planning peak |
| peak | 300 | 10 min | every registered user at once |
| stress | 200 | 10 min | intervals ÷ 3 (`speed 3`) ≈ 600 users' worth of polling |
| spike | 200 | 5 min | ramp in 10 s |
| soak30 / soak2h | 100 | 30 min / 2 h | with resource sampler |
