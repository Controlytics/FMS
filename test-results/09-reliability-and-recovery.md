# 09 — Reliability and recovery

**Status: partial.** The planned restart-under-load, database-outage and one-year restore runs were NOT
executed (operator 2026-10-23: "finish right now"). This report carries forward the 2026-10-17
failure-injection and backup results and adds what was EXECUTED 2026-10-22/23 while fixing backup and
restore.

## 1. Executed 2026-10-22/23

| Check | Result | Evidence |
|---|---|---|
| BR-100: a restore keeps live audit rows the backup lacks (JSON, BAK, pg_dump) | PASS — 6/6 post-backup rows survive with id, position, checksum, signature link; chain intact | 05 §3.4 |
| BR-101: a truncated .dump is refused and the DB rolled back | PASS — 0 of 61 tables changed, chain intact | 05 §3.4 |
| CSV backup restores its own file (numeric usernames) | FAIL → fixed (`7cdd9c5`): 0 chain failures (was 802), restores without force | 05 D-DB-3 |
| '' vs NULL, timestamp microseconds | fixed (`7cdd9c5`, `0b823f4`): JSON / CSV round trip 0 table differences | 05 D-DB-4/5 |
| Failed restore leaves an unprotected audit copy | fixed (`7cdd9c5`, `eadcf9a`, `7321f87`, `16223ce`) | 05 D-DB-10/11 |
| Archive carrying `digilog_keep` erased live audit rows | FAIL → fixed (`eadcf9a`): 6/6 kept | 05 D-DB-11 |
| Restore at any size: `scripts/restore-database.ps1` | built + tested on disposable clusters at day-1 volume: good restore, truncated file refused, mid-file SQL error rolled back, simulated crash + `-RollBackInterrupted` → DB identical; signed by a Super Admin (`-EmergencyUnsigned` only when no SA is readable). One-year run: read 6 min, safety dump 10.5 min, load 35 min, move-back 12 s (refused correctly at the version check); the success-path tail and the full chain check at one-year size were **not** measured (est. 50–75 min downtime) | `e17368d` … `be1d4eb`, `ccdad31` |
| Packed API from the installer stage starts, connects, serves web, logs in, starts cron | PASS (1.2.3 pre-date-fix build, on `digilog_qa_perf`) | session log |
| Concurrent RFID assign / remove / replace | fixed and proven under real concurrency (`df5e6a1`, `dfa6073`, DB unique index `a92b6d3`) | 05 D-DB-2 |
| Postgres connection exhaustion from a second Prisma pool | fixed (`a8dad9a`) | 08 |

## 2. Carried forward (2026-10-17, `docs/production-readiness/08_*`, `10_*`)

| Check | Result |
|---|---|
| API process killed under load | 5–15 s of failed requests (1.4 % of the run), then normal — CARRIED FORWARD |
| Overload | 100 users on one-year data exhausted the Prisma pool (P2024) before the 10-17 fixes — superseded by the batch-states fix, not re-measured |
| Disk full, backup failure, clock skew, tablet network partition | NOT TESTED (10-17) and still not tested |
| Backups on the same disk as the database | the single biggest recovery risk — copy `<DataRoot>\backups` off the machine (no code needed) |

## 3. Not done

Restart-under-load and DB-outage behaviour on today's code; the one-year end-to-end restore; disk-full
and backup-failure injection. Recommended on the client's server before go-live.
