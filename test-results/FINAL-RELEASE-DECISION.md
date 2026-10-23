# Final release decision — FMS 1.2.3 (branch `RFID`, 2026-10-23)

## Verdict: **CONDITIONAL PASS**

The application is functionally and compliance-ready: every defect found in this campaign that affects
records, signatures or the audit trail is fixed and covered by a test that failed first. It is **not**
proven at production load or on a clean machine, because those tests were stopped by operator decision on
2026-10-23. Release only with the conditions in §2.

## 1. Evidence (test-results/01–10)

| # | Deliverable | Result |
|---|---|---|
| 01 | Architecture audit | DONE 2026-10-21 (A-01..A-17 triaged) |
| 02 | Requirements traceability | 206 rules; 84 fully covered at last recount, +8 EXECUTED by 03 |
| 03 | Functional testing (real UI, 6 roles + tablet) | 34 scenarios; D03-01..15 found — all 15 fixed (e.g. D03-05 `814aef0`, D03-06 `e759a70`, D03-09 `57b704e`/`c7a6730`/`8858ad2`, D03-13 `7382683`/`ad8980d`) |
| 04 | API testing | 2,574 role × route rows: 0 leaks, 0 wrong refusals; 1,120 fuzzed writes: 0 5xx |
| 05 | Database testing | 11 defects, all fixed except D-DB-6 in-app streaming (restore script shipped instead) |
| 06 | Security assessment | P0 0, P1 2 (both fixed: OD-01 always-on signatures; redacted rows verified), P2/P3 fixed or decided |
| 07 | Performance | NOT re-run; 10-17/19 evidence + today's query-level fixes (batch-states 17,931 → 65 queries) |
| 08 | Coverage + test quality | API 97.5 / 95.0 / 99.5 / 97.5 %, Web 97.6 / 94.4 / 97.0 / 97.6 %, gates on; mutation 88.7 % (pipeline) / 96.6 % (security libs) |
| 09 | Reliability + recovery | partial: backup / restore fixes proven; restart / outage / one-year restore not re-run |
| 10 | Deployment readiness | installer 1.2.3 + APK built, packed API smoke OK; installer REBUILT 2026-10-23 with the § 5 fixes (failed install / upgrade now visible + logged, password out of Setup's log, login version stamped; sha256 `b409363a…`); clean-machine install NOT run |

## 2. Conditions for go-live

1. **Install 1.2.3 on a clean Windows machine** (or the client server) and verify install, upgrade and the
   nightly backup task — not done here (operator decision). Use the REBUILT file (sha256 `b409363a…`, report
   10 § 1). It also exercises the new failure handling through the real Setup, which so far has been
   proven only by a harness and by running the staged scripts.
2. **Performance on the client's hardware at 100 users**: at least a 2 h soak, 8 h before sign-off
   (`tests/performance/README.md`). The 100-user failure on 10-17 was the tablet batch-states poll; it is
   fixed at the query level but not re-measured under load.
3. **Super Admin checks**: run `QA/tests/security/sa-session-probes.mjs` once in an SA session (skipped
   here; covered only by automated tests).
4. **Copy backups off the server** (same-disk backups are the biggest recovery risk).
5. **Sign the installer** (`-Sign`) to avoid SmartScreen / AV warnings.
6. **Servers already installed with an earlier Setup**: delete `%TEMP%\Setup Log *.txt` of the installing
   account (it holds the superadmin password) and change that password (report 10 § 5).

## 3. Accepted / open (operator decisions recorded in test-results/README.md)

- Prisma 6 CLI advisories (3 HIGH, install-time tooling) — upgrade to Prisma 7 planned separately.
- Audit-trail search with no date range is a full scan (~26 s at one year) — `pg_trgm` index is an open
  decision; value search is limited to ≤ 31-day ranges.
- Approvals for new filters / replacement schedules remain policy-driven (SEC-07).
- A-08 / A-09 (tablet cleartext option, RFID scanner signing passwords) — accepted 2026-10-21.
- Minor: Deviations PDF date filter off by one day for browsers west of UTC (not the India site); desktop
  offline treats a pending checklist as a stale cache (tablet does not); FDM page re-renders on each
  keystroke; HTTP SSRF guard does not pin the address; field-ids permission question.
- Some raw scratch logs cited by earlier reports were lost on 2026-10-22 (README note).

## 4. Release state

Nothing is pushed. Operator pushes with `git push origin RFID` (then merges to `DigitalFMS` → `main`).
