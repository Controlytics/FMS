# Production-readiness test campaign — progress (started 2026-10-21)

Source: operator's "MASTER PROMPT: COMPLETE APPLICATION TESTING, DEEP AUDIT, PERFORMANCE, SECURITY &
PRODUCTION READINESS" (13 phases), run in the three rounds it recommends. The earlier coverage prompt
(≥ 90 % lines/statements/branches/functions, API and Web separately) is this campaign's Phase 9.

**Rule for every report here:** each result is marked **EXECUTED 2026-10-21+** (run in this campaign) or
**CARRIED FORWARD <date>** (from `docs/production-readiness/` 2026-10-17, `QA/` 2026-10-19, or the
2026-10-21 QA Phase 4/5 reports), with a pointer to the original evidence. Anything the code has changed
since its date is re-run, not carried forward. Nothing estimated is presented as executed.

## Operator decisions (2026-10-21)

| Topic | Decision |
|---|---|
| Evidence | Reuse earlier dated results; re-run everything affected by code changed since |
| SUPER_ADMIN testing | Operator types the superadmin password via `!` when needed; it never goes in a report |
| Endurance | 1 h, 4 h, 12 h and 24 h soaks, back to back, only while no agents run (performance numbers must not be distorted) |
| Clean-machine install | Operator provides a clean Windows VM / spare PC (WinRM or OpenSSH + admin account) |
| Coverage | ≥ 90 % per metric for API and Web; parallel test-writing agents; Stryker for mutation testing |
| UI Phase 2 | Finish the restyle first; web tests are written after it lands |
| Rebuild | No APK / installer rebuild in this session (1.2.2 still carries the dev CA and none of the 2026-10-21 fixes) |
| A-01 terminal checklist | Server REFUSES a plain advance into a stage whose mandatory checklist is unanswered (clients must use advance-with-checklist) — verify all clients first |
| BR-086 / A-02 re-auth policy | A legacy-format policy is CONVERTED to the rules it describes (prompts stay on); saving unknown action names / roles is refused |
| A-03 / A-06 SoD | Stage-approval "different approver" switch REMOVED (always required); filter approval step: only the approver may approve or reject |
| A-08 / A-09 | Tablet cleartext HTTP and the RFID scanner's tracked signing passwords: LEFT AS IS — accepted by the operator, documented |
| OD-01 (2026-10-22) | Audit edit / redact / delete, Filter Data Management writes, user delete, role + permission saves (incl. per-user overrides), the re-auth policy save, backup restore, user edit, and filter / hierarchy delete + manual lifecycle change ALWAYS require the password, for every user including SUPER_ADMIN (not configurable). Notification deletes stay policy-driven |
| SEC-07 (2026-10-22) | Filter create review/approve/reject and replacement-schedule decisions stay POLICY-driven (operator ticks the roles on Config → Action Re-auth; live policy has no rows for them today). Stage approvals + report reviews remain always-on |
| SEC-03 (2026-10-22) | `POST /api/notification-settings/send` (arbitrary e-mail/SMS, unaudited, no caller) is REMOVED; the test e-mail / test SMS buttons stay and gain an audit row |
| D-DB-6 (2026-10-22) | Large-database recovery: ship a tested restore script + guide for the nightly pg_dump NOW, then rework in-app export/restore to stream with no row/size cap |
| npm audit (2026-10-22) | Upgrade the vulnerable server packages now (full suites after); upgrade Capacitor in code now — reaches tablets only with the next APK build |

## Environment

Developer PC: Windows 11 Pro, 8 logical cores, 15.8 GB RAM, ~200 GB free, PostgreSQL 18, Node 24.14.
No Hyper-V. Disposable databases: `digilog_test_db` (vitest), `digilog_qa_perf` (go-live clone, perf
users), `digilog_perf` (one-year volume clone, 10 GB), `digilog_restore_perf` (restore target).
`digilog_db` is the developer's working database — read-only for this campaign except audited,
operator-approved changes.

## Rounds and status

| # | Deliverable | Round | Status |
|---|---|---|---|
| 01 | `01-architecture-audit.md` | 1 | DONE 2026-10-21 (findings A-01..A-17 in triage) |
| 02 | `02-requirements-traceability.md` | 1 | DONE 2026-10-21 — 206 rules; re-map after next full run |
| 03 | `03-functional-testing.md` | 1 | waiting for UI Phase 2 + SA password |
| 04 | `04-api-testing.md` | 1 | partial evidence: QA Phase 4/5 (2026-10-21) |
| 05 | `05-database-testing.md` | 1 | DONE 2026-10-22 — 10 defects (D-DB-1..10) being fixed; BR-100/101 PASS (runtime) |
| 08 | `08-coverage-and-test-quality.md` | 1 | IN PROGRESS — API wave 1 agents running |
| 06 | `06-security-assessment.md` | 2 | DONE 2026-10-22 — P0 0 · P1 2 · P2 5 · P3 13; fixes in progress; SA-session probes pending (`QA/tests/security/sa-session-probes.mjs`) |
| 07 | `07-performance-testing.md` | 2 | not started (needs idle PC) |
| 09 | `09-reliability-and-recovery.md` | 3 | not started |
| 10 | `10-deployment-readiness.md` | 3 | waiting for operator VM |
| — | `FINAL-RELEASE-DECISION.md` | 3 | not started |
