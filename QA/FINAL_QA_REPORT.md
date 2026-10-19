# QA — Final Report (2026-10-19)

Branch `RFID`, working tree of 2026-10-19 (uncommitted: the 2026-10-17 load-test fixes plus today's
fixes). Companion documents: `FEATURE_INVENTORY.md`, `TEST_STRATEGY.md`, `DEFECT_REGISTER.md`,
`FIX_PLAN.md`, `_discovery/*`, `results/*`. Performance evidence: `docs/production-readiness/`.

## Recommendation: **READY WITH CONDITIONS**

No known P0 remains. Every P1/P2 found or recorded before today is fixed with a regression test that
fails on the committed code, except **M10** (RFID Track Record reads the whole identifier audit history
into memory per request — latent at today's volume, P2 at scale) and the items in §6. The conditions are the production-readiness ones
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
| API (`apps/api`, single-fork) | not measured alone (2026-10-17 workspace run: 258 files · 2,912 incl. web + shared) | **181 files · 1,705 passed · 12 skipped · 0 failed** |
| Web (`apps/web`) | 75 files · 913 | **94 files · 1,033 passed · 0 failed** |
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
| Still open | **M10** (see above); M11 residual — the `parentId=null` root filter on `GET /api/instances` is unreachable (schema allows only a uuid); P3 |

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
- **Browser (Playwright) runtime proof** of the stage-screen fix and the other UI fixes: not run (the
  fixes are proven by source/render tests; the web `dist` has not been rebuilt since).
- **Tablet fixes on a real device:** APK not rebuilt; no device. Offline eviction and the offline
  allowlist are tested in jsdom only.
- **SUPER_ADMIN black-box runtime probes:** set aside (operator); covered in-process.
- **Phases not executed in full:** per-role permission matrix against `tasks/role-privileges-baseline/`
  (Phase 4), write-path abuse sweep with real tokens (Phase 5 writes), fault injection beyond the
  readiness campaign (Phase 8), coverage report (Phase 12).
- `digilog_db` was never touched: the new migration and the M27/M37 leftover-row checks are for the
  operator (SQL in `tasks/ENTERPRISE-AUDIT-MEDIUMS-VERDICTS-2026-07-15.md`).

## 7. Conditions added by this campaign
1. `npm run db:migrate` on `digilog_db` (adds the block-change notification types), then
   `npm run db:verify-migrations` (the drift guard compares against `digilog_db`, so it fails until the
   migration is applied), then commit the 2026-10-17 and 2026-10-19 work as two commits.
2. Restart the dev API on :3000 so it loads the regenerated Prisma client (new enum values).
   Count RFID tags stored in a non-canonical form before go-live — canonical writes start now, existing
   rows are not rewritten; lower-case rows still resolve (case-insensitive fallback), doubled ones do not:
   `select count(*) filter (where identifier_value <> upper(identifier_value)) lower_case, count(*) filter (where length(identifier_value)>=6 and length(identifier_value)%2=0 and upper(left(identifier_value,length(identifier_value)/2))=upper(right(identifier_value,length(identifier_value)/2))) doubled from asset_identifiers where identifier_type='RFID';`
   (QA clone: 0 of 3,038.)
3. Rebuild the web `dist` and the APK; install the APK on the tablets.
4. One browser pass over the changed pages, and one tablet pass (Perform first stage, overdue
   acknowledgement, login conflict, SIGNATURE question, offline scan of a retired filter).
5. If the 12-month password-reuse window was a deliberate policy, say so — it was removed because no
   decision was recorded.
