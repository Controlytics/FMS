# 07 — Endurance and Resource Trends

Soak runs on the go-live copy (`digilog_day1_perf`, API on :3102, production build, lean runner),
resource sampler every 15 s (`tests/performance/results/resources/*soak30*`). 2026-10-17.

## 1. Attempts

| Run (UTC) | Users | Ramp | Outcome |
|---|---|---|---|
| 14:42 | 100 | 60 s | aborted at 100 s — cold, just-restarted process; batch-states timeouts |
| 14:45 | 100 | 180 s | aborted at 258 s, right after the ramp completed; batch-states 62/151 timed out |
| **14:52** | **50** | 120 s | **completed: 30 min, 17,036 requests, 9.5 req/s, 0 errors** |

(All three used the *old* tablet polling — batch-states every 30 s per tablet. The 100-user level is
re-measured with the new polling in 04 §8.)

## 2. The 30-minute run at 50 users (20 tablets, 30 desktop)

| Measure | Value |
|---|---|
| Requests / errors | 17,036 / **0** |
| p50 / p95 / p99 overall | 76 ms / 1.43 s / 3.03 s |
| Slowest endpoint p95 | batch-states 4.7 s (954 calls, all 200); Cycles view 3.0 s; instances 1.8 s |
| API CPU (share of the 8-core machine) | avg 18 %, max 31 % |
| Postgres connections max | 12 (pool 9 + sampler/psql) |
| Lock waits | 0 |

**Latency over time (10 s windows, averaged per ten-minute block):**

| Block | avg p95 | worst 10 s window p95 |
|---|---|---|
| minutes 2–12 | 1,582 ms | 14.1 s (end of ramp) |
| minutes 12–22 | 1,450 ms | 6.5 s |
| minutes 22–32 | 1,271 ms | 2.0 s |

Latency **improved** through the run (JIT warm-up, OS file cache, Prisma engine); there is no drift
upward.

**Memory and handles over time (sampler):**

| Elapsed | Working set | Private bytes | Handles |
|---|---|---|---|
| 15 s | 1,994 MB | 2,044 MB | 356 |
| 7 min | 2,054 MB | 2,587 MB | 435 |
| 14 min | 2,022 MB | 2,740 MB | 444 |
| 20 min | 1,910 MB | 2,706 MB | 457 |
| 23 min | 1,899 MB | 2,718 MB | 462 |
| 32 min (end) | — | max 2,868 MB | max 518 |

Private bytes rose during the first ~7 minutes and then **plateaued at 2.7–2.9 GB**; the working set
fell slightly. That is V8 growing its heap to its steady state, not a leak, within 30 minutes. Handles
grew slowly (356 → 518) — consistent with keep-alive sockets from 50 clients; not conclusive either way
in 30 minutes.

## 3. What this does and does not show

- At 50 concurrent users with the old polling, this PC sustains the load with no errors and stable
  latency for 30 minutes. p95 1.4 s is above the 500 ms "ordinary" target because the whole-table polls
  (batch-states, instances, Cycles) dominate; the operator has since approved changes to those (11 §1b).
- 2 h, 8 h, 24 h and 72 h were **not run** (one PC, one evening). The memory plateau and the flat
  latency give no reason to expect a different shape at 2 h, but handle growth and Postgres bloat under
  continuous writes need the long runs on the client's server. Procedure: `--profile soak2h` plus
  `endurance/sample-resources.ps1 -Seconds 7500`, then compare the first and last 20 minutes exactly as
  above.
- The baseline working set at start (2.0 GB) is itself high for an idle API; it is the cost of the
  11 MB batch-states responses and the Prisma engine. `--max-old-space-size` should be set explicitly on
  the service once the client's RAM is known (11 §2).

## 4. 30-minute soak at 100 users with the NEW polling (2026-10-19)

Run `2026-10-19T04-53-21-420Z_web-users_soak30_100vu` (10:25–10:55 IST), go-live copy on :3102, the
API process started fresh (410 MB private, idle since 2026-10-17 21:14 on the final build), 40 tablet
operators + 60 desktop users, ramp 60 s. Sampler: `resources/20261019-102306_soak30_day1_100_newpolling.csv`.

| Measure | Value |
|---|---|
| Requests / errors | 32,608 / **3** (0.009 %) — all three `read ECONNRESET` inside one 10 s window at minute 20.5 (Cycles 30-day list, replacement tasks, notifications); server logs show no 5xx and nothing in `error/` or `application/` at that moment |
| p50 / p95 / p99 overall | 144 ms / **1.89 s** / 3.54 s |
| Slowest endpoint | batch-states: 350 calls, all 200, p50 1.9 s, p95 16.1 s, max 20.1 s |
| API CPU (share of the 8-thread machine) | 15–20 % in minutes 1–13; **29–36 %** in minutes 14–27 at the same request rate |
| API private bytes | 412 MB → 1.3 GB (5 min) → 1.5 GB (10 min) → peak 1.9 GB (21 min) → 1.7–1.8 GB; **283 MB after the run** |
| Handles | 320 → 582–655 → 318 after the run |
| Postgres | 10 connections, 1 active, 0 lock waits throughout; checkpoints wrote 27–43 buffers |

**Two phases.** The run file's 10 s timeline and the server's own `durationMs` in the http log agree:

| Minutes | Client p95 (1-min) | Server-side: `unread-count` p95 | Server-side: batch-states p50 | API CPU |
|---|---|---|---|---|
| 1–13 | 400–850 ms (the 10-min run in 04 §8 gave 570 ms) | 60–320 ms | 0.75–1.1 s | 15–20 % |
| 14–27 | **2.0–5.2 s** | **1.1–3.1 s** | **3.0–11.6 s** | 29–36 % |
| 28–30 | 0.9–1.2 s | 300–500 ms | 1.2–1.7 s | 20–27 % |

The request mix did not change between the phases: ~800 GETs/min, 12 batch-states/min (spread evenly —
no synchronised refresh), 25–30 PM-due/min, no writes, no re-logins (66 logins, all in the first two
minutes), no 401s. A trivial endpoint slowing 10× together with everything else means the Node event
loop itself was behind, not one slow query.

**Ruled out, with evidence:** a thundering herd on the 5-minute refresh (per-minute batch-states counts
flat at 8–19); bcrypt storms (no logins after minute 2); Postgres (no lock waits, 10 connections,
checkpoints trivial); a leak or a degraded cache (idle single-shot right after the run: batch-states
0.88–1.03 s, `unread-count` 12–15 ms, `assets/instances` 0.53–0.60 s — identical to 2026-10-17; process
back to 283 MB).

**Contamination to declare:** from minute 24 four code-reading agents (ripgrep over the repository) ran
on this same PC for the next task; system CPU was 60–100 % in minutes 25–29. They may have worsened
minutes 24–30 but cannot explain minutes 14–23, when system CPU (10–58 %) was no higher than in the good
phase.

**Interpretation (inference, not proven):** 15–20 % of an 8-thread machine is 1.2–1.6 cores, and the
API's single JavaScript thread is one core (12.5 %). In the "good" phase the main thread was therefore
already near saturation; once requests start to queue, more are in flight at once, the live heap grows,
garbage collection takes more of the thread, and each request costs more CPU — a loop that only breaks
when load momentarily eases (as it did at minute 23 and from minute 28). To prove it: rerun with
`NODE_OPTIONS=--trace-gc`, or take a 20-minute inspector CPU profile from minute 12. Not done.

**What this changes:** the 10-minute 100-user figure (0 errors, p95 570 ms) is the best case, not the
sustained one. Sustained 100 users on this PC's core is **p95 1.9 s with a 14-minute stretch at 2–5 s**
and no failures beyond three connection resets. The capacity ceiling at this user count is the single
Node process, as the server-sizing note of 2026-10-08 predicted. The client's Xeon 4310 (2.1 GHz base)
is unlikely to have a faster single core than this desktop, so the same ceiling should be assumed there
until measured.
