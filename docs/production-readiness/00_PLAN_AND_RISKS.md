# Production Readiness — Plan, Risks and Open Questions

Status: **PLAN — awaiting operator answers and "go".** Nothing has been load-tested yet.
Written 2026-10-17 against branch `RFID` @ `755f0ae`. Every fact below was read from the
repo or the live dev DB on that date; anything not verified is marked **ASSUMPTION**.

---

## 1. Architecture summary (what actually exists)

| Layer | Implementation | Evidence |
|---|---|---|
| Web client | React SPA (Vite), SWR data fetching, jsPDF + exceljs **in the browser** | `apps/web/package.json` |
| Tablet | Capacitor Android wrapper of the same SPA + offline IndexedDB queue + sync engine; RFID via `Reader_Usb.jar` plugin | `apps/android/`, `lib/sync-engine.ts` |
| API | **One** Fastify process (TypeScript, Node 24 locally), HTTPS, `bodyLimit` 10 MB, no cluster | `apps/api/src/app.ts:159`, `:728` |
| Scheduler | in-process `node-cron`, 4 jobs (only run while the API runs) | `app.ts` |
| Database | PostgreSQL 18, one DB (`digilog_db`), Prisma ORM, default pool (no `connection_limit` in `DATABASE_URL`) | `apps/api/.env`, `lib/prisma.ts` |
| Postgres config | **stock**: `max_connections=100`, `shared_buffers=128MB`; extensions `plpgsql, pgcrypto, ltree` (no `pg_stat_statements`) | queried 2026-10-17 |
| Audit trail | hash-chained `audit_trail`, every chained write takes **one global** `pg_advisory_xact_lock` | `lib/audit.ts:103,194` |
| Passwords | native `bcrypt`, cost **12** (`BCRYPT_ROUNDS`), async → libuv threadpool (default 4 threads; `UV_THREADPOOL_SIZE` not set anywhere) | `lib/password.ts` |
| Rate limits | only login / verify / change-password | `lib/__tests__/rate-limit-policy.test.ts` |
| Backups | Windows Scheduled Task, daily 01:30 | installer |
| Services | WinSW-wrapped API + Postgres, installer `installer/DigiLog.iss` | |
| Internet at runtime | none by design (fonts self-hosted, no CDN) — **to be verified by a no-network clean install** | |

No Redis, MQTT, TimescaleDB, Nginx, PM2 or job queue: all removed earlier (see CLAUDE.md). None
will be proposed back unless a measurement shows the need.

Current data: dev DB is **26 MB, essentially empty** (post-wipe baseline: `sessions` 120 rows,
`audit_trail` 11). So **no current number says anything about data-volume behaviour** — a
synthetic generator is required.

---

## 2. Ten highest-risk concerns (found in code; none measured yet)

1. **One Node process serves everyone.** All HTTP, JSON serialisation, Excel exports, cron jobs and
   bcrypt callbacks share one event loop. One slow handler (big list, big export) delays every user.
   Nothing restarts a hung (not crashed) process.
2. **Every audited write in the whole app is serialised by one global lock** (`pg_advisory_xact_lock`
   in `auditLog()`), held until the business transaction commits. A 100-tag `bulk-operate`, an
   import or a restore blocks every other user's audited action for its whole duration. This sets
   the app's maximum write throughput. Its integrity under concurrency (no forked chain) is the most
   important thing to prove.
3. **Login / re-auth storm at shift change.** bcrypt cost 12 ≈ 200–300 ms of CPU each, and only 4
   run at once (libuv default). Re-auth is ON, so many gated actions also cost a bcrypt compare. At
   shift change, logins queue behind each other and behind file I/O on the same 4 threads.
4. **Connection pool and Postgres config are unsized.** Prisma uses its default pool. Requests waiting on
   the audit lock hold pool connections → pool exhaustion → `P2024` timeouts for unrelated reads.
   Postgres runs factory defaults (128 MB buffers on a 64 GB server).
5. **Polling load.** ~30 SWR polls (19 at 30 s, others 10–60 s). With ~300 users this is a constant
   background request rate before anyone does any work — it needs to be measured, not guessed.
6. **Unbounded lists and exports grow with time.** 223 `findMany` call sites; page-size caps are
   deliberately absent (operator decision 09-04 — will be **measured, not "fixed"**); retirement /
   replacement / admin-request lists return whole arrays; `export-limit` has no ceiling; two server-side
   `.xlsx` GETs build the workbook in memory.
7. **Data growth is untested.** Index adequacy, the `audit_trail` (append-only, never deleted) and
   `GET /api/audit/verify-chain` over years of rows: all unknown at 1–5 years of volume.
8. **Recovery objectives are undefined.** Daily 01:30 backup ⇒ RPO up to ~24 h; backups on the same box
   (single PSU, RAID5) are not a disaster-recovery copy. RTO never timed.
9. **Restart and failure behaviour unproven.** No measured evidence that the WinSW services restart
   cleanly, that Prisma reconnects after a Postgres restart, that cron jobs resume, or what a tablet
   replay storm does after a network outage.
10. **Clean install on a fresh WS2022 box without internet has never been done** (memory: 1.2.0/1.2.1
    "clean-machine install still untested"). That is a go-live blocker by itself.

---

## 3. Test environment and safety rules

- **Never load-test `digilog_db`.** `audit_trail` rejects DELETE, so synthetic rows could never be
  removed. Never touch `digilog_test_db` (vitest owns it).
- Write tests use a **disposable clone** `digilog_perf` (`createdb -T digilog_db digilog_perf`) and a
  **second API instance on port 3100**, built for production (`tsc` → `node dist/app.js`,
  `NODE_ENV=production` — dev mode logs every Prisma query and would skew numbers).
- Synthetic users (`perf_user_001…N`, one per virtual user — sessions are single-per-user), each logged in
  **once** and the token reused (login is limited to 100/min). Gated writes send `_currentPassword`.
- Scripts drive real state machines (start → advance → checklist → Dry In with duration …), not blind POSTs,
  or they only measure 409s.
- Every heavy script refuses to run unless `PERF_TARGET` is a localhost URL **and** the DB name ends in
  `_perf`, ramps up in steps, and aborts automatically above an error-rate / p95 / CPU threshold.
  Stop = Ctrl-C, or `scripts/perf-stop.ps1` (kills only the port-3100 API).
- **Limitation:** this dev PC (8 logical cores, load generator on the same box) is not the production Xeon
  4310 server. Results are this-box numbers; production capacity must be re-measured on the real server.
- Things that need explicit permission each time: installing tools, enabling `pg_stat_statements`
  (Postgres restart), restarting Postgres or services for failure tests, dropping `digilog_perf`.

---

## 4. Testing plan, by risk

| Stage | What | Runs on | Can do now? |
|---|---|---|---|
| A | Architecture + dependency audit, endpoint inventory from `/docs/json` | read-only | yes |
| B | Production build, smoke test, baseline latency per endpoint (1 VU) | `digilog_perf` :3100 | after "go" |
| C | Synthetic data generator (Block→AHU→Filter→cycles→events→audit) at 1×, 5×, 10× a year of volume; `EXPLAIN (ANALYZE, BUFFERS)` on the top queries | `digilog_perf` | after "go" |
| D | Concurrency ramp 5→25→50→100→200 VUs, realistic mix (polling + operations + logins) | :3100 | after "go" |
| E | Targeted: audit-lock contention (bulk-operate vs. single ops) + **verify-chain after concurrent writes**; login storm; same-record races; idempotency/replay duplicates; spike | :3100 | after "go" |
| F | Soak 30 min and 2 h (background), memory / handles / pool / latency sampled every 30 s | :3100 | after "go" |
| G | Failure injection: kill API mid-write, restart Postgres, offline replay after long outage; backup → restore into a second clone, timed, with counts + chain check | clones only | needs permission |
| H | Security/compliance readiness review (building on the 2026-08-17 assessment + 09-24 strict audit) — evidence list, **no compliance claim** | read-only + :3100 | after "go" |
| I | Fix only what measurements show, retest before/after | | |
| J | Final report: READY / READY WITH CONDITIONS / NOT READY | | |
| — | 8 h / 24 h / 72 h soak, clean offline WS2022 install, real tablets + RFID readers, production-server capacity | **real hardware** | NOT TESTABLE here → scripts + instructions provided |

---

## 5. Initial targets and assumptions to confirm

| Item | Assumed value | Source |
|---|---|---|
| Registered users | ~300 | 10-08 sizing discussion — **CONFIRM** |
| Peak concurrent users | **unknown** (planning 100, stress 200) | **CONFIRM** |
| Cleanings per day | ~1,500 | 10-08 — **CONFIRM** |
| Tablets in use at once | **unknown** | **CONFIRM** |
| Shift changes / day | **unknown** (assume 3) | **CONFIRM** |
| Data retention | **unknown** (assume 5+ years, audit trail forever) | **CONFIRM** |
| RPO / RTO | **must come from the client** | **REQUIRED** |
| Latency | p95 ≤ 500 ms, p99 ≤ 1 s for ordinary endpoints at normal load; exports/bulk judged separately | prompt §12 |
| Error rate | < 0.1 % at normal load (business refusals like 409 counted separately) | prompt §12 |
| Integrity | 0 broken chain links, 0 duplicate committed ops after retries | |

---

## 6. Files to be created (no application code changed until a measurement justifies it)

```
docs/production-readiness/            01…12 reports + FINAL_PRODUCTION_READINESS_REPORT.md
tests/performance/
  config/        targets.example.env, profiles (smoke/baseline/normal/high/stress/spike/soak)
  data-generation/  seed-perf-db.ts (synthetic hierarchy, users, cycles, audit rows)
  api/           load scripts (k6, or a dependency-free Node runner — see question 3)
  database/      EXPLAIN suite, concurrency/lock tests, growth measurement
  endurance/     soak runner + resource sampler (CPU, RSS, handles, pool, pg_stat_activity)
  recovery/      backup/restore timing, restart scripts (clone-only)
  security/      authz matrix checks (IDOR / role escalation) against :3100
  results/       JSON/CSV output (gitignored)
scripts/perf-stop.ps1
```
