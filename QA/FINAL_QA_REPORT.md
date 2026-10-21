# QA — Final Report (2026-10-19)

Branch `RFID`, working tree of 2026-10-19 (uncommitted: the 2026-10-17 load-test fixes plus today's
fixes). Companion documents: `FEATURE_INVENTORY.md`, `TEST_STRATEGY.md`, `DEFECT_REGISTER.md`,
`FIX_PLAN.md`, `_discovery/*`, `results/*`. Performance evidence: `docs/production-readiness/`.

## Recommendation: **READY WITH CONDITIONS**

No known P0 remains. Every P1/P2 found or recorded before today is fixed with a regression test that
fails on the committed code, except the items in §6 (M10 was fixed later the same day). The conditions are the production-readiness ones
(`docs/production-readiness/FINAL_PRODUCTION_READINESS_REPORT.md` §2) plus §7 below. This is not a claim
of 21 CFR Part 11 compliance.

## 1. Scope discovered

| Surface | Count |
|---|---|
| Feature groups (traceability rows) | 40 |
| Web routes / pages-views / dialogs / forms / actions | 75 / 155 / 157 / 154 / 795 |
| API operations | 429 (33 modules, 40 workflows, 128 business rules, 159 error codes) |
| Roles in the clone | 9 incl. SHIFTOFFICER, QA, MANAGER |

## 2. Tests

| Suite | Before today | After |
|---|---|---|
| API (`apps/api`, single-fork) | not measured alone (2026-10-17 workspace run: 258 files · 2,912 incl. web + shared) | **182 files · 1,707 passed · 12 skipped · 0 failed** |
| Web (`apps/web`) | 75 files · 913 | **95 files · 1,037 passed · 0 failed** |
| New regression tests today | — | 17 API files, 19 web files (`git ls-files --others` count) + cases added to 6 existing files |
| Black-box (QA clone :3104) | — | endpoint sweep over 429 ops; race and config probes |

Each new test was run against the committed version of the file(s) it guards and failed there, except:
the orphan-photo sweep (new code, nothing to fail against), the tablet-rules unit test (tests new
modules directly; their wiring is covered by a test that does fail), and the cleaning-profile POST case
(also refused by the old code for another reason). Logs: `results/api-suite-2026-10-19-final.log`,
`results/web-suite-2026-10-19.log`.

## 3. Defects

| | Count |
|---|---|
| New defects found today (QA-D001 … D023) | 23, all FIXED |
| Seeded from earlier records and fixed today | 18 OQ items + 14 July mediums + 13 sweep claims (QA-D024 and the D-rows) |
| Documented decisions, tested as such, not changed | offline Wash Out/Dry Out approval exemption; Replacement Tasks open to all tablet roles; Send for Review hidden; no upload rate limit; contact-admin hides account state; RFID list uncapped; offline-replay gate exemptions; unretire cascade; audit edit/delete break the chain loudly; three rate limits only; SUPER_ADMIN exemptions |
| Already fixed before today (re-check) | 14 of the 28 July mediums |
| Still open | none of the recorded defects (M10 and the M11 residual were fixed later the same day) |

Highest-severity fixed: stage-screen hang (P1), duplicate PM executions (P2, proven 2–5 duplicates →
1 at runtime), unvalidated SUPER_ADMIN policy configs, unsigned/ADMIN-writable SUPER_ADMIN settings,
block-change notifications never delivered, filter-approval self-approval, server idle timeout
disagreeing with the configured one, notification visibility leak to the subject of a notice.

## 4. Security / permission findings
- Unauthenticated access: none (sweep: every protected operation 401 without a token).
- Bad ids / malformed input: no 5xx and no leaked internals across all GET-with-id operations (ADMIN,
  OPERATOR); Prisma validation and not-found errors now map to 400/404.
- Fixed escalations: ADMIN could save SUPER_ADMIN-only settings; three settings saved unsigned;
  notification bulk/row access wider than the list; filter submitter could approve.
- Sanitizer: opt-in per service (11 sites), not global — documented correctly now; no HTML rendering of
  stored text in the web app.

## 5. Performance (from the readiness campaign + today's soak)
100 concurrent users: 10 min p95 0.57 s; 30 min soak p95 1.9 s with a 14-minute stretch at 2–5 s — the
single Node process is the ceiling on this PC's core. 200 users at once fail on the 11 MB tablet
first-load payload (design decision, open).

## 6. Not done / not testable here
- **Browser pass (done 2026-10-19, Playwright, dev web server → QA clone :3104):** stage screen —
  scan + PM reason on an AHU owing a visit → 409 → the missed-PM dialog appears (before: hang); reason
  saved → cycle IN_PROGRESS with reason PM and the visit written off. Admin Requests — Enable Account
  label + readable details, prompt names "Approve / Reject Admin Request", already-enabled approval says
  "No action taken". System Health real disk figures; System Health hidden from MANAGER's sidebar;
  "Filter Cleaning Record" title; PM AHU links open the detail page; Equipment Groups back arrow for a
  role without CONFIG_READ goes to the dashboard, not Access Denied. No unexpected console errors.
  Not covered in the browser: every other changed page (covered by render/source tests).
- **Tablet fixes on a real device:** APK rebuilt and verified (`DigiLog-FilterOps.apk`, valid zip, 88
  scripts all from the 2026-10-19 build), but no tablet is connected, so it is not installed or tried.
  Offline eviction and the offline allowlist are tested in jsdom only.
- **SUPER_ADMIN black-box runtime probes:** set aside (operator); covered in-process.
- **Phases not executed in full:** per-role permission matrix against `tasks/role-privileges-baseline/`
  (Phase 4), write-path abuse sweep with real tokens (Phase 5 writes), fault injection beyond the
  readiness campaign (Phase 8), coverage report (Phase 12).
- `digilog_db`: only the additive migration was applied (operator request "resolve pending things");
  the M27/M37 leftover-row checks are still the operator's (SQL in
  `tasks/ENTERPRISE-AUDIT-MEDIUMS-VERDICTS-2026-07-15.md`).

## 7. Conditions — status 2026-10-19
| # | Step | Status |
|---|---|---|
| 1 | `npm run db:migrate` on `digilog_db` | **done** (block-change notification types) |
| 2 | Drift guard `scripts/verify-migrations.ps1` | **PASS** |
| 3 | Commit | **done** — `4ddd2cd` on `RFID` (one commit: the two days share files) + a docs follow-up; **not pushed** (operator) |
| 4 | Dev API :3000 on the new client | **done** — `tsx watch` restarted itself after the client regeneration |
| 5 | RFID tags in non-canonical form on `digilog_db` | **0 of 38** — nothing to migrate |
| 6 | Web `dist` + APK | **rebuilt**; APK at repo root; **not installed** (no tablet connected) |
| 7 | Browser pass | **done** for the pages in §6 |
| 8 | Tablet pass (Perform first stage, overdue acknowledgement, login conflict, SIGNATURE question, offline scan of a retired filter) | **operator** — needs a tablet |
| 9 | Push `RFID` (and merge to `main`) | **operator** |
| 10 | Password-reuse window | removed — **confirmed by the operator 2026-10-21**: the strict last-N rule stays |

## 8. Follow-up 2026-10-21 — Phases 4, 5 and 12 executed, every finding fixed

| Phase | Result | Report |
|---|---|---|
| 4 — per-role permission matrix | 2,574 live requests (429 ops × 6 roles, SA excluded): **0** code-level leaks against each role's stored permissions. 54 cells differ from the target doc — P4-01, decided by the operator: the 2026-10-08 live roles are correct (doc updated). | `QA/PHASE4_ROLE_MATRIX.md` |
| 5 — write-path abuse | 1,063 role probes + 218 no-token, 45 re-auth, 15 mass-assignment (DB-verified), IDOR, SSRF, upload, 1,127 fuzz: **0** bypasses. 2 P2 + 1 P3 + 2 observations. | `QA/PHASE5_WRITE_ABUSE.md` |
| 12 — coverage | API 63.3 % lines / 73.7 % branches / 76.6 % functions (182 files, 1,707 tests); web 19.7 % / 65.7 % / 42.5 % (96 files, 1,041 tests). Web line coverage is low because most pages are checked by source-level tests, not rendered. | this section |

Fixed (each with a test that fails without the fix): P4-02 export gates, P4-03/04/05 cross-granted
write gates (+ a tree-wide guard test), P4-09 client errors labelled INTERNAL_ERROR / 400-for-404,
P4-10 mandatory reason on permission changes, P5-01 lifecycle-owned filter status, P5-02 offline grant
scoped to the six replayed routes, P5-03 NUL / out-of-range → 400, P5-04 photoUrl, P5-05 settings
merge, plus a role-name > 20 chars login failure found while testing. Details: CHANGELOG 2026-10-21.

Left as decided / recorded: P4-06 toggles that hide a page but not its data (documented design),
P4-07 report reviews SUPER_ADMIN-only (operator), P4-08 tablet stage-approvals tile config (inert),
access-matrix full-document save, admin-request trailing-slash 401 (fails closed).

Still not testable here: real tablets / RFID, long soaks, clean-machine install, SUPER_ADMIN black-box.
Clone side effects of Phases 4/5 are listed in each report (§ mutations); `digilog_qa_perf` only.
