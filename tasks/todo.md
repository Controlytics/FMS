# STATUS 2026-10-23 — campaign closed (operator: "finish right now")

- [x] Release decision: **CONDITIONAL PASS** (`test-results/FINAL-RELEASE-DECISION.md`); 01–10 written; CHANGELOG through 1.2.3
- [x] Coverage gates 90×4 on API / Web / Shared; Stryker: pipeline 88.7 %, API security libs 96.6 %
- [x] Builds: `DigiLog-FilterOps.apk` (`11e36da`), `dist\FMS-Setup-1.2.3.exe` (unsigned)
- [x] 2026-10-23 operator "fix the installer defects and rebuild" (rebuild AS 1.2.3, operator choice): report 10 § 5 both fixed in `745980d` — install/upgrade run from [Code] (logged to ProgramData\DigiLog\logs, exit 10 + "Setup did not finish" on failure), password via env var (the old [Run] line wrote it into %TEMP%\Setup Log — control-tested), install-incomplete marker, version stamped at build; harness 34/34; installer rebuilt; guide regenerated
- [ ] GO-LIVE CONDITIONS (not run by operator decision): clean-machine install of 1.2.3; 100-user perf + 2–8 h soak on client hardware (plan + tooling in tests/performance); SA probe session (QA/tests/security/sa-session-probes.mjs); copy backups off the server; sign the installer
- [ ] Open decisions: Prisma 7 upgrade (3 HIGH CLI advisories); audit pg_trgm index; whether ADMIN gets back audit-templates / report-signatories / access-matrix
- [ ] Minor known: Deviations PDF date filter west of UTC; desktop offline pending-checklist vs stale-cache; FDM page split; HTTP SSRF pinning; field-ids gate
- [ ] PUSH: operator runs `! git push origin RFID`

# Coverage campaign: ≥90% lines/statements/branches/functions, API and Web separately (started 2026-10-21)

Operator pasted "MASTER PROMPT: Full Application Test Audit and 90%+ Code Coverage". Decisions 2026-10-21:
finish UI Phase 2 first (web tests after the restyle lands); install Stryker (dev-only) for mutation
testing on critical modules; parallel background agents per module, tests only — agents REPORT real
defects (failing test + root cause), production fixes are made centrally with a regression test.

Baseline (reproduced 2026-10-21 on 70adf40-era code, `QA/coverage/baseline-2026-10-21/`):
API 63.3 % lines/statements, 73.7 % branches, 76.6 % functions (34,577 lines). Web 19.7 % / 65.7 % /
42.5 % (56,075 lines). Web branch % is inflated: v8 only counts branches of LOADED files, so it will
fall as pages get rendered before it rises.

- [ ] API wave 1: pm-schedules (98.9 % lines, committed `3deaf18`) · super-admin + debug-traces + deployment-check + block-change + report-reviews (99.7 %) · backup + notification-delivery/rules/notifications (99.2 %)
  - [x] GO-LIVE BLOCKER found + fixed: fresh install had 0 asset_templates → first block impossible (`19d80f5`)
  - [x] PM defects D1–D11 fixed failing-first (`dbde772`); D2 + D4b by operator decision (`b88f754`); `/auth/me` null→{} (`85992cb`, from a sweep of every 200 schema)
  - [x] SA, backup/notif wave-1 defects fixed + committed (see below)
  - [x] Web wave 1 committed `3bcebf7`; F1–F3 `5859053`; harness `7b5bb7b`; config 1–13 `bbc09ce`; filter D4–D10 `8a2014b`
  - [x] 2026-10-22 operator decisions, each fixed failing-first: offline OFF-1..5 + WSH-IDB-1/2 (+ the "network" 4xx replay stall) `037520a` · recorded readings shown exactly `5cb0f9c` · CSV backup exact restore `08c2706` · SMS exact text `3c94263` · A-13 left as is · New Schedule ADDS a visit (D-OPS-10, cov-web-ops) · "Test setup" badge: REMOVE
  - [x] Page size: 11 list pages hard-coded / seeded their size (`1e15dee`); rule split 2026-10-22: list pages open on the FIRST configured option (`usePageSize`), report pages on `limit` = max (`useReportPageSize`; RFID Track Record had a fixed 50). Equipment Groups was one of the 11 (no operator question needed)
  - [x] API wave 2 committed: assets slice `c33cdaf` + D1–D9 `98a9abc`/`2849fef`/`a201b41` + replacement 413 `ac0498a` + fixture isolation `3d48a52`; filter-ops `c5cdcf5`; core `0c3bc94` (+ `cc3d655` untrack a stray upload, ignore apps/api/uploads/)
  - [ ] Web wave 2 commits: cov-web-shared fixes (30 items) · cov-web-ops fixes + D-OPS-10 (API + web) · cov-web-admin tests · cov-web-mobile tests · page-size guard — waiting on a clean full web run
  - [ ] Defect round 2 (each agent fixes its own findings failing-first): cov-api-filterops (4: getFilter accepts AHU ids …) · cov-api-core (19: logout w/o body, config write before check, dashboards, uploads, uuid params …) · cov-web-admin (profile Cancel submits, dashboard cards → Access Denied, cancel-shows-error class, reset-request remarks rule …) · cov-web-mobile (stale dryer duration, refused start shown as started, …, blur timer) · cov-web-ops (create() upload-role check, pm-import version/UTC, drop-zone keyboard) · cov-web-shared (config datetime preview, MMM DD padding)
  - [x] Remove the "Test setup" header badge (operator 2026-10-22) `452407a`
  - [x] A-01 regression: desktop could not complete a cycle whose last stage has a checklist — fixed `6cadccf` (shared advanceMustCarryChecklist)
  - [ ] OPERATOR DECISION 2026-10-22: "stage should be there, checklist should be there, all conditions should work, any stage anywhere and checklist also" → EVERY pipeline shape must complete (Dry In last/first/without Dry Out, single stage, checklists before/between/after/consecutive/disabled, interlock on/off). cov-api-filterops: matrix e2e (red list) → root fixes in shared + server → client half (desktop + tablet) scheduled after cov-web-admin / cov-web-mobile land
    - [x] Server + shared: matrix 99/99 `00bf4d3` (root causes A–F, complete-cycle.ts, assertEquipmentGroupMatchesCycle); desktop batches per filter `fab68fc`
    - [ ] Dry In last + checklist (readings + answers in ONE call): cov-web-admin built it IN the panel (own ChecklistDialog, per-row planFinalStageBatch, executeOrQueue widened; no opener prop needed) — adding an optional `ahuPreflight` prop (the panel path had no AHU pre-flight) → commit → panel passes to cov-web-mobile for 3b, queued-op completion logging, Android back, tablet ahuPreflight wiring
    - [ ] START checklists (tablet + desktop, same rules): dialog FIRST, nothing written; then start → submit-checklist(null) → advance; held through the missed-PM 409; batches grouped by batch-plan.ts, ONE dialog per distinct START checklist; NEVER a compound start-and-advance for such a filter (replay exemption would skip it silently); offlinePerformedAt non-decreasing
    - [ ] Offline final Dry In closes the cycle LOCALLY: dryerReadingsSubmitted written to the cache row BEFORE the recompute (helper beside rememberQueuedDryerStart); offline-cache.ts:351 applies callCompletesStageWork; panel never writes currentCycle back after a completing recompute
    - [x] Desktop half `00a7ac8` (final Dry In + checklist in one call, no-instrument Dry In, START checklists first, profile change = notice); tablet station rule `2ceed59`; offline final Dry In completes on readings + START answer kept `f81c3fa`
    - [ ] cov-web-mobile ran out of context 2026-10-22 → cov-web-mobile2 (handoff): afterStage null + START completion logging; tablet START checklists (reuse admin helpers); loader START gap (local-context ~:416); profileSyncWarning in cache; finding 5 split; later the panel (3b local close, queued completion, Android back, ahuPreflight, panel load flake)
    - [ ] cov-api-filterops: old-APK offline replay cases (plain readings at final Dry In + checklist; second start after local clear)
    - [x] cov-api-filterops: bypass into the final stage completes (6.1); SET_A/SET_B choice frozen on the approval (6.2); docs + API_REFERENCE `f745d8c`. digilog_db: 0 bypass events ever → nothing stranded
    - [ ] Load-only web flakes (pass alone): drying panel exact value; admin-requests reset creds; equipment-groups paging; FDM cycles filters; replacement-schedule paging → cov-web-shared (4) + cov-web-mobile (panel)
  - [ ] OPERATOR DECISION 2026-10-22: a block with >1 active equipment group → the operator PICKS the group in the readings dialog (web Filter Operations, Dry In panel, tablet). Today the UI silently uses the oldest (API now lists every group, `874aa96`). Live data: 1 group per block. Start after cov-web-admin / cov-web-mobile land (they are in filter-operations.tsx / mobile-operations.tsx)
- [ ] SECURITY 06 (audit-phase1-2, in progress) findings:
  - [ ] OPERATOR DECISION 2026-10-22 (OD-01): audit edit/redact/delete, Filter Data Management writes, user delete, role + permission saves (incl. per-user overrides) and the re-auth policy save ALWAYS require the password, for every user incl. SUPER_ADMIN (live policy listed SA on 2 of 84 actions; screens had no SA column). Operator ALSO: backup restore, user edit, filter/hierarchy delete + manual lifecycle change (NOT notification deletes) → sec-od01 (API + web + docs; ALWAYS_REAUTH_ACTIONS in shared drives "Always required" rows)
  - [ ] P1 redacted audit rows escape verify-chain (hash-chain.ts checks only "payloads NULL"; who/what/when rewritable by a DB actor) → cov-api-sa
  - [ ] P2 SEC-03 OPERATOR: REMOVE POST /api/notification-settings/send; test e-mail/SMS get an audit row → cov-api-sa
  - [x] SEC-07 OPERATOR: filter + replacement-schedule decisions stay policy-driven (no code change)
  - [ ] npm audit OPERATOR: upgrade server packages now (when no agent runs tests), Capacitor in code (APK later)
  - [ ] P3 fixes to schedule: SEC-08 LDAP test-connection destination check (ssrf.ts), SEC-12 OAuth2 code/state in http log, SEC-13 login 429 not in security log
  - [ ] P2 hypotheses needing the VM / a probe: no ACLs on digilog.env / keys / dumps; xlsx decompression bomb
  - [ ] SA-only dynamic probes: one script, one operator SA session at the end
- [ ] DATABASE 05 defects: D-DB-3/4/5/10/7/8 → cov-api-core; D-DB-1 drift guard + D-DB-2 identifier race → cov-api-assets; D-DB-9 cycles bind overflow (server) → cov-api-filterops, tablet limit=1000000 → cov-web-mobile2
  - [ ] D-DB-6 OPERATOR "Both": restore script + guide now (backup-restore-script agent), in-app streaming rework after
  - [ ] Perf P-1..P-7 (batch-states 17,934 queries/call at volume, audit COUNT seq scans, events COUNT, dashboard aggregates) → deliverable 07
- [ ] Offline queue: same-millisecond ops replay in random order (IDB key `op-${Date.now()}-rand`) → cov-web-mobile2, approved protected fix
- [x] API wave 1 fixes committed: SA `fc2242f`, backup/notif `419358e`, audit signature bound `b00098f`, A-05 one error handler `efa340c` (full API suite 2,427 passed / 0 failed after)
- [ ] Final docs for the waves: CHANGELOG through fab68fc `4918581` (add the client pipeline half when it lands); root CLAUDE.md PM six doors + POST /visits done `d09dd71`; Pipeline Flow section (cov-api-filterops)
- [ ] OPERATOR 2026-10-22: "after completion of testing everything build the exe and apk" -> after the fix rounds + package upgrades + full suites: rebuild prisma/seed.mjs (build-bundle.ps1), build FMS-Setup (next version) + the general APK (Capacitor upgraded); the installer is also what the VM install test (10) uses. Placeholder CA in the general APK: a dev tablet needs a site APK.
- [ ] FINAL SEQUENCE once every agent reports DONE (PC quiet): (1) server npm upgrades + Capacitor in code → full suites; (2) Stryker install + mutation runs (auth / rbac / reauth / audit chain / filter-ops gates, then wider); (3) full serial API + web coverage → 90 % thresholds; (4) perf 07 + soaks 1/4/12/24 h (operator: keep full plan); (5) 09 reliability; (6) operator SA session (probe script); (7) 10 deployment on the operator VM; (8) CHANGELOG + API_REFERENCE doc commit; FINAL-RELEASE-DECISION
- [ ] Coverage thresholds 90 % in both vitest configs + html/json reporters; CI check; exclusions documented (only non-production scripts)
- [ ] Final serial runs, coverage comparison table, `QA/COVERAGE_FINAL_REPORT.md`

# Pending-items pass (2026-10-21, operator: "complete the pending ones")

Decisions 2026-10-21: password reuse = keep strict rule (no 12-month window); dev CA out of
customer builds; PM year-end gap left; fonts + `qa_sa_01` deleted; chain-test rows already gone
(10-07 wipe); P4-01 = 10-08 live roles are correct (update the doc); P4-07 = report reviews stay SA-only.

- [x] Placeholder CA in `res/raw/rootca.pem` (key destroyed) + guard test; build-site-apk docs
- [x] Old fonts deleted; `qa_sa_01` deleted (clone); M27/M37 on digilog_db = 0 rows
- [x] Phase 4 role matrix (`QA/PHASE4_ROLE_MATRIX.md`), Phase 5 write abuse (`QA/PHASE5_WRITE_ABUSE.md`), Phase 12 coverage (API 63.3% lines, web 19.7%)
- [x] Fix P4-02 export-log gates on the export permission, not read
- [x] Fix P4-04 PM entry edit gate + `pm.upload`/`pm.resubmit` granting PM_CREATE
- [x] Fix P4-03 checklist ↔ cleaning-profile cross-unlock
- [x] Fix P4-10 role-config change takes a mandatory reason
- [x] Fix P5-01 generic instance update can un-retire via free-text status
- [x] Fix P5-02 retire/replace offline-replay payload + replayExemptGates
- [x] Fix P5-03 PrismaClientUnknownRequestError → 400; P4-09 small error codes
- [x] P4-01 doc: align ROLE-PRIVILEGES-DOC-ALIGNMENT + target matrix to 10-08 live roles
- [x] VIEWER + MAINTENANCE removed everywhere (operator 2026-10-21) — `edf0955`; live settings via 4 audited rows (chain 22956–22959)
- [x] UI Phase 2 — `7d26909` `0bb90ee` `6ca851d` `fbfd0ec`; 92-route screenshot sweep, 0 console errors
- [x] Full suites green + docs/CHANGELOG + commit `70adf40` (no push). Operator: NO rebuild of APK/installer this session

# QA campaign: exhaustive feature / workflow / abuse testing (started 2026-10-19)

Operator pasted "MASTER PROMPT 2" (14 phases, deliverables under `QA/`). Rules carried over from the
load-test campaign: disposable DBs only (`digilog_perf`, `digilog_day1_perf`, test DB for vitest), never
`digilog_db`; synthetic accounts `perf_user_*`; no test marked PASS unless executed; every number grep-backed.

- [x] 2026-10-19 per-site tablet app: `scripts/build-site-apk.ps1` builds `dist/site-apks/FMS-<site>.apk` with the site's rootCA.pem built in (refusals, restore, zip diff, server-cert verify, same signing key all proven with throwaway certs). Operator: run it with a real site's rootCA.pem + server.crt and try it on a tablet
- [x] 2026-10-19 release: APK rebuilt (`7fe4417`, sha256 a11b7eb6…), branding baseline 1.2.2, `dist/FMS-Setup-1.2.2.exe` built (sha256 048bdae4…, UNSIGNED, bundled APK = repo APK, new migration staged). Operator: push RFID, run Setup on a clean machine + as an upgrade over 1.2.1, install the APK on a tablet
- [x] Phase 1 discovery (4 read-only agents → `QA/_discovery/`): frontend inventory (7 parts deleted by an agent's cleanup, all restored, counts re-verified) · backend workflows + error codes · code smells · existing-tests map
- [x] `QA/FEATURE_INVENTORY.md` (40 feature groups, R1–R15) + `QA/TEST_STRATEGY.md` (two lanes, denylist, triage) + `QA/DEFECT_REGISTER.md` (seeded: 19 OQ bugs, 32 July mediums, 2 operator decisions)
- [x] QA clone `digilog_qa_perf` (from go-live copy) + API on :3104 (`start-perf-api.ps1 -Database digilog_qa_perf -Port 3104 -NoBuild`)
- [x] Probes: R2 session config validated (PASS; sweep overstated) · R6a PM execution race **FAIL** (QA-D001: 2–5 duplicates per 20 concurrent) · R1 stage-screen dialogs (QA-D002, code) · QA-D003 dynamic config unvalidated (code) · QA-D004 block-change race (code)
- [ ] ⚠️ `qa_sa_01` SUPER_ADMIN created on the clone by SQL; auto-mode classifier then flagged it as a permission grant → paused, NOT used. Operator to decide: keep (unblocks D003/D004 runtime probes + SA-only sweep rows) or delete
- [ ] Next: endpoint sweep over 429 ops (non-SA roles), remaining risk probes (R7, R8, R10, R11, R15, sanitizer), Playwright for QA-D002
- [ ] **"fix everything" (operator 2026-10-19)** — plan `QA/FIX_PLAN.md`. Answers: no commit until done; Cycles 30 d kept; filter approval needs a different person; offline: fix access fail-open + cache eviction only, keep offline approval skip. SA runtime testing set aside (verify in-process)
  - [x] Re-verify OQ 19 + July 32 against today's code (`QA/_discovery/reverify-open-items.md`: 14 July already fixed)
  - [x] Batch 1 server · [x] Batch 2 frontend blockers · [x] Batch 3 OQ · [x] Batch 4 UX/perf · [x] offline access + cache (helpers did web/tablet; I verified: backups restored, 16/17 new web test files fail on committed code, offline diff reviewed)
  - [x] Suites 2026-10-19: API 180 files 1,704 passed / 0 failed; web 94 files 1,031 passed / 0 failed. Rebuilt QA API: PM race 5×20 → 1 execution each; sweep clean
  - [x] CHANGELOG entry, `QA/DEFECT_REGISTER.md` (D001–D024), `QA/FINAL_QA_REPORT.md` (READY WITH CONDITIONS), CLAUDE.md sanitizer + scheduler (5 jobs) corrected
  - [x] 2026-10-19 later: M10 (SQL paging, 23/23 equivalence), M11 residual, two back arrows fixed; migration applied to digilog_db, drift guard PASS; RFID tags on digilog_db 0/38 non-canonical; web dist + APK rebuilt (APK verified, not installed — no tablet); browser pass done (stage-screen missed-PM dialog proven end to end); committed `4ddd2cd` + `e09851f` on RFID (one commit — the two days share files). Suites: API 182/1,707, web 95/1,037, shared 20/361
  - [ ] Operator: push RFID (+ merge to main), install APK + tablet pass, confirm password-reuse window removal, decide on deleting `qa_sa_01` (QA clone), `digilog_restore_perf` + 9 GB dumps
  - [ ] Not done: Phase 4 role matrix vs baseline, write-path abuse sweep with real tokens, coverage report
- [ ] Phases 2–10 test implementation + execution (safe subset on this PC), defect register, regression after each fix
- [ ] Phases 12–14: traceability, commands, `QA/FINAL_QA_REPORT.md`
- [x] Soak 30 min @100 users with NEW polling (go-live copy, :3102, 2026-10-19 10:25–10:55): 32,608 req, 3 ECONNRESET (0.009 %), p50 144 ms / p95 1.9 s / p99 3.5 s; minutes 14–27 p95 2–5 s with API CPU doubled at constant load → single Node thread is the ceiling at 100 users (07 §4, FINAL §1/§3/§4). Idle cost unchanged after; no leak. [ ] prove the GC/queueing hypothesis with `--trace-gc` or an inspector profile (not run)

# Production readiness / load testing (started 2026-10-17)

Plan + risks: `docs/production-readiness/00_PLAN_AND_RISKS.md`. Target = clone `digilog_perf` +
production-build API on :3100 (`tests/performance/start-perf-api.ps1`). Never `digilog_db`.

- [x] Clone `digilog_perf`; prod API on :3100 healthy
- [x] `postgresql.conf`: `shared_preload_libraries='pg_stat_statements'` (backup `.bak-2026-10-17-perf`) — **needs an ADMIN restart** of `postgresql-x64-18`, then `CREATE EXTENSION pg_stat_statements` in digilog_perf
- [x] Load runner (`tests/performance/api/run-load.mjs`), token cache, resource sampler
- [x] 03 endpoint inventory · 05a frontend static audit · synthetic data generator (scale 1 = one year, 10 GB in `digilog_perf`; go-live copy `digilog_day1_perf`)
- [x] Fixed from load-test evidence (CHANGELOG 2026-10-17): verify-chain false positives; audit chain-head full scan on every write; PM due overflow; last-cleaned groupBy; Cleaning Record loading every cycle id. Each proven byte-identical old vs new (`tests/performance/equivalence/`).
- [x] Scenario: web users (polls + pages, role-based personas). [x] tablet operators (cycle state machine) — 50 users @3×: 3,635 req, 0 errors, 142/123 cycles, chain intact; races answered correctly (INVALID_STATUS / CONCURRENT_DECISION / STALE_TAPE). Found + fixed tape defect (SET_DRYER_DURATION offered while gated, fix 7). [ ] bulk-operate burst, login/re-auth storm
- [x] Soak 30 min: 100 users aborted ×2 (old polling); 50 users PASS (0 err, memory plateau 2.9 GB) — doc 07
- [x] 100 users with NEW polling: 0 err, p50 54 ms, p95 570 ms (04 §8). 200 still fails on the 11 MB first-load payload
- [x] Bulk burst 10 ops × 50 tags: 2,890 items, 0 err, chain intact (04 §6). Restart under load: back in ≈4 s (08). Backup/restore of 10 GB: 4.1/6.4 min custom, 1.6/10.4 min plain; restored chain window intact (10)
- [x] Pool what-if (year copy, 100 users, connection_limit 20) — KILLED by the Claude Code memory guard at 5 GB API RSS; recorded as a finding (04 §2b), not rerun. [x] full test suites 2026-10-17 21:52: 258 files / 2,912 passed / 13 skipped / 0 failed; web 913 passed
- [x] Ramp: smoke · 25 · 50 · 100 · 200 on go-live data, before and after every fix (04). Final: 100 PASS with the new polling; 200 still fails during the ramp (11 MB first-load payload). Year copy @100: pool starvation → now 503, open decision. Spike profile and the writes scenario ran (04 §6); chain verified intact after every write run
- [x] 🔴 `GET /api/filters/batch-states`: 17,300 Prisma queries + 7 s CPU per call → **fixed** (`batch-preload.ts`, operator approved): 286 queries, 0.63 s, response byte-identical on both clones; reruns at 25/50/100/200 in 04
- [x] 503 for P2024/P2028 + sync-engine keeps ops pending on 5xx (test 4b); UV_THREADPOOL_SIZE=8 in service def
- [x] Operator-approved (20:35): tablet cache refresh 5 min, Cycles view 30 d, Approvals `?from=` (test), audit count 60 s cache; before/after 100-user run in 04 §8. Open: batch-states 11 MB payload shape; wrapper status/rfid/replace full cycle list; Cycles window 30 d vs 7 d/paging at year-two volume (11 §2)
- [x] DB: EXPLAIN on the slow queries at scale 1 (05); scale 5 extrapolated only (≈ 50 GB), not generated. `pg_stat_statements` still needs the ADMIN Postgres restart
- [x] Soak 30 min (07). 2 h / 8 h / 24 h / 72 h NOT run — condition 4 of the final report (client hardware)
- [x] Failure injection on clones: API kill under load (08). Postgres restart under load BLOCKED (needs admin)
- [x] Reports 00–12 + FINAL written (verdict READY WITH CONDITIONS)
- [ ] NOT possible here: 8/24/72 h soak, WS2022 clean offline install, real tablets/RFID, production-server numbers, Postgres restart (admin)
- [ ] Operator: commit + push (exclude `apps/web/tsconfig.tsbuildinfo`); rebuild + install the APK; drop `digilog_restore_perf` (9.2 GB) and `tests/performance/results/backups/` (9.1 GB) when no longer needed; stop the test APIs on :3100 / :3102 (`tests/performance/stop-perf-api.ps1 -Port`)

# Tablet leftovers from 10-05 (2026-10-06)

- [x] Status "Scan RFID" popup: shared `normalizeRfidScan` + case-insensitive match; 4 copies replaced
- [x] `GET /api/config/cleaning-profile-assignment/current` (no permission) + tablet reads it; e2e
- [x] Tablet polls block changes only when the role holds BLOCK_CHANGE_REQUEST / _APPROVE
- [x] Browser check: Status popup resolves `ca000c07ca000c07` → FD/AHU-02/20-00 (`.playwright-mcp/status-scan-rfid.js`)
- [x] APK rebuild (zip verified, bundle == dist) — NOT installed, no tablet attached

# Dry In as the FIRST stage: no dryer duration (2026-10-06)

Operator (2026-10-05): "duration selection is not coming in Dry In" on the CWH block, whose
profile (DRY STORAGE) begins with Dry In. The cycle entered Dry In with no duration and the
dryer phase was skipped silently (executor, server, tablet, web).

- [x] Executor: at DRY_IN with no dryer start the tape offers ONLY `SET_DRYER_DURATION` in place (`actions.ts`)
- [x] Server: entering DRY_IN needs `SET_DURATION` unless the dryer runs (guard #28, `dryer.ts` + `advance.ts`)
- [x] Server: leaving DRY_IN with the dryer never started is refused (`DRYER_DURATION_REQUIRED`), no longer a silent pass
- [x] Tablet: every start-and-advance payload for a DRY_IN start carries the duration from the queue header
- [x] Web: single + batch start payloads carry the duration; cache primed like the mid-pipeline dryer start
- [x] Core hook: a QUEUED SET_DURATION writes the dryer timing to the cache row BEFORE the tape recompute (offline Dry Out scan was going to be refused otherwise)
- [x] Tests: executor (11), server e2e (6), core hook
- [x] Existing Dry In suites green (phase2-filter-operations, bulk-operate x2, concurrent-operator, ahu-completion-gate x2) — 91 tests
- [x] Browser check: tablet + web Dry In start send `dryerAction: SET_DURATION` + header minutes (faked writes, zero rows; `.playwright-mcp/dry-in-start-*.js`); live tape of stuck CWH/AHU-02/18-00 = `SET_DRYER_DURATION→DRY_IN` only
- [x] CHANGELOG + CLAUDE.md note + memory
- [x] APK rebuild (blank `VITE_API_URL`; zip verified, bundle == dist; sha256 dee0d81e…) — NOT installed, no tablet attached

# Tablet: refused cycle start -> "No active cleaning cycle" (2026-10-01)

- [x] Root cause from the API log (start-cycle 409, advance 400 x2) + `handleEquipSubmit`
- [x] Refusal shown; start payload kept; next Submit is a START (`mobile-operations.tsx`)
- [x] `startWithPmGate` shared by the reason path and the readings-dialog path
- [x] Batch: `retryBulkStartsForMissedPm` (both /bulk-operate start paths)
- [x] First-stage check before a start, online (tablet single + cold-cache queue, web batch)
- [x] Browser-verified with faked server answers (3 scenarios, zero writes); guard test; tsc; web suite
- [x] Missed-PM question for the deferred first-stage-checklist start (`extraCycleFields`; unit-tested)
- [x] Refusal code + message on the http / error / security log lines (`lib/refusal-log.ts`)
- [x] Offline replay: a refused compound start skips the filter's dependents (`markStartRefused`)
- [x] `GET /api/config/field-ids/current` — field labels 403'd for every operator
- [x] Tested for real: tablet cycle start, tablet bulk reject + single approve, Permissions tab (SA)
- [x] Tested with faked answers: batch missed-PM retry, offline missed-PM question
- [ ] Android back button on a real device (cannot be driven from here)
- [ ] APK rebuild to carry this and the Stage Approvals change

# Tablet Stage Approvals = the web page (2026-10-01)

Operator: the tablet's Stage Approvals differed from web; wants them exactly the same.

- [x] `/m` Stage Approvals tab renders the web `StageApprovalsPage`; the tablet copy in `mobile-wrapper.tsx` deleted
- [x] Android back closes the page's dialog (`overlayBackRef`); offline notice kept
- [x] Touch sizing on the page under `pointer: coarse` (buttons 40–44px, checkboxes 24px)
- [x] Guard test `routes/mobile/__tests__/stage-approvals-single-implementation.test.ts`
- [x] Verified web vs tablet at 4 sizes; dialogs opened + cancelled; tsc + web suite
- [ ] Operator: decide the PENDING Wash Out on MUPS/RCB/SA/17-01 from the tablet (real approve / reject not exercised)
- [ ] APK rebuild to carry it (blank `VITE_API_URL`); back button on a real device

# Retirement / Replacement List View permissions (2026-10-01)

Operator: the Permissions tab had no View toggle for the Retirement List or the
Replacement List (both rode on "View Filters").

- [x] `RETIREMENT_LIST_VIEW` / `REPLACEMENT_LIST_VIEW` constants; `retirement.view` / `replacement.view` configurable (single-permission grant); snapshot + count tests (106 / 87)
- [x] Sidebar visibility + route guards on the new permissions; Replacement List tab gated; Module Guide steps
- [x] `GET /api/filters/{retirements,replacements}` accept the new permission or `ASSET_READ`
- [x] Data migration `20261001090000_list_view_permissions` (dev + test DB applied; before-snapshot saved); `default-roles.ts`
- [x] Tests: shared, web (sidebar + Permissions-tab grouping), API e2e; tsc; drift guard
- [x] Live check as MANAGER / QA / OPERATOR / ADMIN
- [x] Docs: CHANGELOG, CLAUDE (root + shared), role-matrix note, count sweep
- [ ] Operator to confirm on the Permissions tab (SUPER_ADMIN screen not screenshotted — session was live)
- [ ] OPEN (found on the way, NOT changed): `prisma/seed.ts` upsert overwrites `roles.permissions` for the 6 default roles, and `scripts/apply-schema.ps1` runs the seed on upgrade — a customer upgrade would reset ADMIN / SUPERVISOR / OPERATOR to the shipped defaults. Needs an operator decision.

# UI redesign — all screens (started 2026-10-01)

Operator ask: "update all the screens ui colors, cards, everything, fonts — more
professional". 189 screen/component files, no shared page primitives, so the work
is done from the foundation outwards. Light theme only; the 10 colour themes keep
working; web and tablet share pages, so one change covers both.

Direction ("the batch record"): paper-white surfaces, hairline borders instead of
heavy shadows, tighter corners, ONE brand hue (the active theme) for actions and
navigation, status colours reserved for status, identifiers / timestamps /
readings in a mono face. IBM Plex Sans + IBM Plex Mono, self-hosted (air-gapped).

## Phase 1 — foundation (touches ~20 files, changes every screen)
- [x] P1.1 Self-host IBM Plex Sans (400/500/600/700) + IBM Plex Mono (400/500); drop Sora / Bricolage / JetBrains Mono
- [x] P1.2 `app.css` tokens: font stacks, radius scale, shadow scale, `brand-*` / `accent-*` scales derived from the theme, `cyan-*` / `teal-*` remapped onto them (hardcoded cyan now follows the theme), focus ring, base table / form rules
- [x] P1.3 `lib/themes.ts`: primaries that fail AA contrast with white text deepened (ocean, emerald, sunset, forest)
- [x] P1.4 `components/ui/*`: button, card, badge, input, select, table, dialog, pagination, toast, message-dialog
- [x] P1.5 Shell: sidebar, header, app-layout
- [x] P1.6 Auth screens: login, contact-admin, forgot-password, change-password
- [x] P1.7 Verify: before/after screenshots (desktop 1440 + tablet 800), console clean, web tsc + vitest

## Phase 2 — page sweeps (per area, each verified by screenshot)
- [~] P2.1 Page headers: rainbow gradient icon tiles -> brand DONE (codemod1 + header pass); a shared `PageHeader` primitive is NOT built
- [ ] P2.2 Stat cards -> one `StatCard`
- [ ] P2.3 Tables: density, header style, row actions (30 raw tables)
- [ ] P2.4 Filter bars / form controls (raw inputs + selects)
- [ ] P2.5 Dashboard
- [ ] P2.6 Filter management (list, operations, status, traceability, retirement, replacement)
- [~] P2.7 Config hub + 34 config pages — colours / labels / focus done by the codemods; no per-page layout work
- [~] P2.8 Users, admin requests, audit, notifications, reports — colours / labels / focus done by the codemods; no per-page layout work
- [ ] P2.9 Tablet wrapper (`/m`) touch targets re-checked
- [ ] P2.10 Text below 11px raised (596 uses of 9-11px)

## Done outside the original list
- [x] Codemod 1 (gradients, glow shadows, ALL-CAPS labels, backdrops, 2px borders), codemod 2 (focus states), codemod 3 (decorative violet/indigo/purple -> brand). Scripts kept in the session scratchpad; rules + skip lists are described in `apps/web/CLAUDE.md` § Theme.
- [x] `components/auth-shell.tsx` — all signed-out screens incl. tablet `/m/login`, `/m/forgot-password`
- [x] Fixes: `use-rfid-guard` autofill crash; RFID Track Record 317px rows; wrapping in Cleaning Cycles + PM Schedules
- [ ] Delete the unreferenced old fonts in `apps/web/public/fonts/` (11 woff2 + `fonts.css`) — needs operator OK
- [ ] Tablet home / operations (`routes/mobile/*`) not restyled beyond the shared tokens — those files carry uncommitted 09-25 work

## Constraints
- No logic changes. Offline / sync surface is not touched.
- Semantic colours stay semantic: emerald = active/done, amber = pending, red = rejected/terminated, stage colours on Filter Operations.
- Uncommitted 09-25 work is still in the tree: Phase 1 files do not overlap it; Phase 2 does — commit before Phase 2.

---

# Stage Approvals: stage details on every request + SUPER_ADMIN edit (2026-09-05)

Operator ask: (1) SUPER_ADMIN Edit on the Stage Approvals page; (2) a Wash Out
request shows the Wash In details (done time, RO water pressure, air pressure,
cleaning reason, user) and the Wash Out done time + user; a Dry Out request
shows Dry In started time, duration, temperature, ended time, user, and the
Dry Out done time + user. Web AND tablet. Existing frozen snapshot stays.

Decisions:
- Stage details are DERIVED LIVE on the server from the cycle + `filter_events`
  (not frozen into `detailsSnapshot`): historic rows get them too, and a
  SUPER_ADMIN edit of an event shows up immediately.
- Edit = two existing dialogs, no new editor: the approval RECORD through a new
  `PUT /api/super-admin/filter-data/stage-approvals/:id`; the stage details
  (cycle + events) through the existing cycle editor + console PUTs.
- Edit is on the web page only; the tablet shows the details (read-only).

## Backend (apps/api)
- [x] B1 `stage-approvals/stage-details.ts` — pure `deriveStageDetails()` + DB `collectStageDetails()`; attached as `stageDetails` on queue / list / getById rows
- [x] B2 (15 tests) unit tests for the pure derivation (event picking rules: reject rows excluded, dryer started/ended discriminator, latest-before-request, fallbacks)
- [x] B3 `super-admin/record-edit-routes.ts` new `PUT /filter-data/stage-approvals/:id` (status, approverRole, requestedBy/At, decidedBy/At, decisionRemarks) → MANUAL_RECORD_UPDATED

## Frontend (apps/web)
- [x] F1 `lib/stage-approval.ts` — `StageDetails` type + `stageDetailGroups()` rows builder (+ test)
- [x] F2 `components/stage-approval-details.tsx` — one card for web + tablet
- [x] F3 (+ Row inline-component -> render function) `routes/stage-approvals/index.tsx` — details in the decision dialog + per-row expander; SA Edit (record dialog) + Edit stage details (cycle editor)
- [x] F4 `routes/mobile/mobile-wrapper.tsx` — details in the card expander + in the decision dialog
- [x] F5 `routes/audit/audit-helpers.ts` — `cleaning_stage_approval` record-type label

## Verify
- [x] V1 API tsc clean, 42/42 module tests (queue-supersede mock gained cycle/event/user models); web tsc clean, 827/827
- [x] V2 live `verify_stage_details.cjs` 27/27: drive a MUPS test filter DRY_IN → DRY_OUT to raise a PENDING; check `stageDetails` on queue/list for DRY_OUT and on a historic WASH_OUT row; SA PUT + ADMIN 403; edit reverted
- [x] V3 browser (Playwright; real pointer clicks went dead mid-session -> JS clicks via evaluate): web page as SA (details, both Edit paths), as non-SA (no pencils); tablet /m card + dialog
- [x] V4 docs: CHANGELOG, BACKEND_GUIDE, docs/compliance/stage-interlock.md, API docs, memory

# SUPER_ADMIN record edits on 6 user-facing pages (2026-09-05)

Operator ask (confirmed): SUPER_ADMIN-only Edit on RFID Track Record, Filters,
Admin Requests, Notifications, Retirement List, Replacement List. Edits write
through the API to the linked tables. Chain break on audit-row edits ACCEPTED.
"Update live tag too" ACCEPTED for RFID / Filter RFID changes.

## Rules applied to every edit
- backend `requireRole('SUPER_ADMIN')` + `requireDataEditReauth` (SUPER_ADMIN_DATA_EDIT) + `_changeReason` >= 5
- audit row per edit (MANUAL_RECORD_UPDATED, or AUDIT_RECORD_UPDATED meta-row FIRST when the record IS an audit row)
- reference values are dropdowns (Area/AHU/Filter/Set/Status/Event/User/type enums)

## Backend touch points (apps/api)
- [x] B1 `assets/services/identifier.service.ts` getRfidTrackRecord: rows carry `id`, `filterId`, `ahuId`, `userId`
- [x] B2 `super-admin/record-edit-routes.ts` NEW `PUT /filter-data/rfid-events/:id` — edit ASSET_IDENTIFIER_CREATED/DELETED audit row (timestamp, event, rfidNumber, filterId, user, remarks->reason), meta-audit first, live `asset_identifiers` update when the row is the tag's LATEST event
- [x] B3 `super-admin/record-edit-routes.ts` NEW `PUT /filter-data/filters/:id` — full filter edit: name/attrs/set via filterService.update, AHU move (filters.ahu_id + trigger + asset_relationships swap), lifecycle via instanceService.changeLifecycleState, RFID via identifierService create/delete, MANUAL_RECORD_UPDATED audit
- [x] B4 `super-admin/routes.ts` extend `PUT /filter-data/retirements/:id` with retiredAt / retiredBy / remarks -> FILTER_RETIRED audit row (meta-audit first, chainBroken)
- [x] B5 `super-admin/routes.ts` `PUT /data/notifications/:id` accept `createdAt`; `notifications/routes.ts` GET list returns targetUserId/forUserId/forRole/createdBy (currently stripped by the response schema)
- [x] B6 unit tests: `__tests__/rfid-event-edit.test.ts` 14/14 (payload placement + live-tag rule; the own-row rule was found by the test, fixed); shared helpers moved to `super-admin/manual-change.ts`

## Frontend touch points (apps/web)
- [x] F1 NEW `components/super-admin-record-edit.tsx` — shared dialog (fields spec, reason, own reauth dialog, chain warning) + `useIsSuperAdmin`
- [x] F2 `routes/filter-management/rfid-track-record.tsx` — SA Edit column + dialog (datetime, Event, RFID, AHU->Filter cascade, User, Remarks)
- [x] F3 `routes/filter-management/filter-list.tsx` + `filter-list/dialogs/EditFilterDialog.tsx` + `filter-list/types.ts` — SA sees Area/AHU cascade, Status, RFID, reason in the same Edit dialog; submit goes to the SA endpoint; retired rows also editable for SA
- [x] F4 `routes/admin-requests/index.tsx` — SA Edit (all columns)
- [x] F5 `routes/notifications/index.tsx` (`forUserId` is a USERNAME - picker keyed by username; full 33-value NotificationType list) — SA Edit (all columns)
- [x] F6 `routes/filter-management/retirement-list.tsx` — SA Edit (name, set, date, performer, remarks)
- [x] F7 `routes/filter-management/replacement-list.tsx` — SA Edit (old/new filter, date, performer, remarks)

## Batch 2 (same day): Cleaning Record, cycle View, Lifecycle report, Deviations, Quality Notifications
- [x] G1 `components/super-admin-cycle-edit.tsx` — cycle row + every stage event (from/to, time, performer, remarks, reading values) through the console's cycle + event PUTs, one reason, one re-auth; cycle=null for a manual status update row
- [x] G2 backend `PUT /data/deviations/:id` + `PUT /data/quality-notifications/:id` (user pickers resolve `*Name`; QNN unique -> 409); `CONSOLE_ENUM_FIELDS.deviation`; QNN list exposes `performedBy`
- [x] G3 **bug fixed**: event PUT replaced `attributes` wholesale -> now merges (the console's cycle dialog was dropping `action` / `dryerDurationMinutes` / `cleaningReasonKey`)
- [x] G4 pages: `cleaning-cycles/history.tsx` (cycle + manual rows), `timeline.tsx` (Edit record in the header), `filter-lifecycle.tsx` (inside the expanded cycle), `deviations/index.tsx`, `quality-notifications.tsx`
- [x] G5 verify: API tsc + touched tests 82/82; web tsc + 820/820; live `verify_sa_edit2.cjs` 19/21 (the 2 "fails" = the QNN row's original performer is a deleted user, which the API rightly refuses - restored by SQL); browser: SA Edit on all five surfaces, MANAGER none, real saves through the cycle editor (reading value) and the QNN dialog, Lifecycle editor opens inside the expanded cycle; nested-<button> warning found by the sweep and fixed (`PencilIcon`)
- [x] G6 docs: CHANGELOG, BACKEND_GUIDE, MODULES, API_ENDPOINTS, API_LIST
- [x] H1 Audit Trail page: SA pencil per row (not redacted / not meta rows) -> existing `PUT /api/audit/:id` (reauth UPDATE_AUDIT_RECORD, body key `reason`); generic dialog gained `reauthAction`; audit list now returns `userName`. Browser 13/13 (real save + meta row + revert; MANAGER none); meta row PUT -> 409 live

## Verify (each page: web typecheck + vitest, API typecheck + vitest, live curl, browser as SA + as ADMIN (no button, 403))
- [x] V1 API tsc clean; touched-module tests 191/191; web tsc clean; web suite 820/820 after making `useIsSuperAdmin` router-free (the admin-requests page test renders without a Router)
- [x] V2 live `verify_sa_edit.cjs`: 34/34 (403s for ADMIN, RFID remarks + tag move with `asset_identifiers` following, filter attrs + AHU move + tag with mirror/relationships/track record, lifecycle with reason rule, retirement audit-row fields, notification createdAt + enum rejection). Test edits reverted; the retirement row's performer restored by SQL (the API cannot write a NULL performer)
- [x] V3 browser (headless): SA sees Edit on all 6 pages (Filters list = `/filter-list`, block card -> Filters tab), a temp ADMIN sees none; real saves through the Notifications dialog and the Filters dialog (Area/AHU cascade preselected from the row, micron size written, reason on the audit row), both reverted. RFID <-> Filters cross-page refresh verified at the API level (track record shows the tag rows), not by a second browser tab
- [x] V4 docs: CHANGELOG, BACKEND_GUIDE, future/backend/{MODULES,API_ENDPOINTS}.md, future/overview/API_LIST.md, memory

Residue: PENDING WASH_OUT approval f1a9b925-064d-49aa-a1e8-f7625d25391a on MUPS/RCB/SA/17-01 (cycle CC-MUPS/RCB/SA/17-01-008-20260905) left for the operator's tablet check; MANUAL_RECORD_UPDATED rows with "verification:" / "browser verification" reasons on that approval and its WASH_IN event (values reverted).

# Strict audit — non-SUPER_ADMIN surface (2026-09-04)

Operator ask: complete, strict audit for bugs / broken / dead connections /
"other reviews", skipping SUPER_ADMIN role and functionality.

Rule for this audit: **nothing goes in the report unverified.** A static
finding must be reproduced live (API or browser) or it is dropped/downgraded.

## Passes

- [x] A1 — Backend route + gate inventory (381 routes; brace-matched, not windowed)
- [x] A2 — Frontend API-call inventory (301 calls, 168 distinct)
- [x] A3 — Cross-check: **0 dead connections** (15 candidates, all live-verified as artefacts)
- [x] A4 — Strict response schemas: 22 hits, all request-body or fully-read; no strip bug
- [x] B1 — Per-role API smoke: 128 reachable GETs × 6 temp users (one per role).
      **0 × 5xx.** 10 status-0 cells re-probed 3× each → all real statuses (they
      coincided with tsx-watch restarts while patching). Non-200/403 breakdown:
      19 × 400 = missing required query params (`user-lookup`, `filter-upload-template.xlsx`,
      `action-reauth/check`) + 1 × `notification-rules/:id` (see #7);
      1 × 401 = `backup/export` reauth-required by design; 42 × 404 = substituted
      id of the wrong entity type. Temp users deleted (verified 0 remaining).
- [x] B2 — Per-role browser sweep (headless Chromium, token injected into
      sessionStorage): 6 roles × every sidebar page = 63 page loads.
      **0 page errors, 0 error boundaries, 0 redirects.** Two distinct failing
      calls only (#8, #9), both fixed; re-sweep after the fixes: 63/63 clean.
- [x] C  — Re-verified the 32 open Mediums (5 out of scope: M06 M07 M50 M51 M76)
- [x] D  — Fixed confirmed bugs; the rest reported with evidence

## Findings (verified) and what was done

| # | sev | where | what | status |
|---|---|---|---|---|
| 1 | Med | `POST /api/backup/restore` catch-all | any unmatched error → 500 RESTORE_FAILED, incl. Fastify's own 406 multipart error | **fixed** (4xx passed through; verified 406 live) |
| 2 | Low | `POST /api/audit/report-export-log` | any authenticated user can write a REPORT_GENERATED audit row with caller-supplied reportType/recordCount (self-attributed) | **fixed** (reportType allow-listed; verified 400 live) |
| 3 | Low | `GET /api/admin-requests/user-lookup` (public, rate-limited) | pre-login exact employee-ID existence check returns fullName; by design for contact-admin | **fixed** (name masked; request resolves the real name server-side) |
| 4 | Info | `GET /api/replacement-schedules/{due,tasks,blocked-filters}` | ungated by design; ADMIN/QA can read replacement tasks via API though the doc gives them no Replacement List | **fixed** (VIEW or OPERATE required; ADMIN 403 live) |
| 5 | Med | `/api/filters/{events,cycles,cleaning-record,manual-status-changes}` | `page=-1` / `limit=0` reached Prisma → 500 | **fixed** (schema `minimum`; verified 400 live). Regression: the `maximum: 100` added with it 400'd the tablet cycles view (`limit=200`, clamped to 100 by the service for months) - removed same day |
| 6 | Med | AHU dashboard "Recent Activity" (M89) | queried `/api/filters/events?filterId=<AHU id>` — events are per filter, so always empty | **fixed** (`ahuId` param resolves child filters; 43 rows live, random uuid → 0) |
| 7 | Info | `GET /api/notification-rules/:id` unknown id | 400 DATA_CONSTRAINT instead of 404 (findUniqueOrThrow). No FE caller of the GET | **fixed** (404 NOT_FOUND; verified live) |
| 8 | Med | `GET /api/config/report-labels/current` | gated CONFIG_READ but read by every report page for every role → 403 + SWR error on 22 of 63 page loads | **fixed** (all-authenticated, same contract as page-titles) |
| 9 | Low | `triggerSync('app-start')` + 60 s poll | roles without ASSET_VIEW/FILTER_OPERATE (ADMIN) 403 on `/api/sync/since` at start and every poll | **fixed** (gated on the user's permissions) |

## Phase C — the 32 open Mediums, verdicts

Fixed this session: **M15** (cleaning-profiles PUT items schema), **M23**
(filter-profiles PUT constraints), **M58** (contact-admin blank Email/Department/
Role/Status rows — lookup returns username + fullName only), **M62** (DRY_OUT
badge text-amber-200 → 700), **M70** (audit search debounced 300 ms), **M88**
(cleaning-profile search server-side; was current page only), **M89** (#6),
**M90** (`filterTemplateIds` Set memoised).

Already closed on re-check: M11, M29 (400s), M32, M74, M87.

**M27 CLOSED 2026-09-04** (was 6 by then: legacy delete path now refuses a
mid-cycle filter with 409; the six stranded cycles were ended through the
audited console edit). Open, reported: **M30** (visibility rule duplicated in service +
repository + single-read), **M47** (`delete()` lacks isSystem guard; gate
ROLE_MANAGE, SA-only in practice), **M63/M79/M82** (history / pm-schedules /
admin-requests never render a fetch error), **M80** (orphan
`/pm-schedules/:entityId` route). Latent: **M55** (0 photos on disk). Out of
scope (SUPER_ADMIN): M06 M07 M50 M51 M76.

## Test evidence

- API: filter-operations + cleaning-profiles + filter-profiles + backup →
  23 files, 254 passed, 4 skipped. Config/sync/notification-rules run after #8.
- Web: 63 files, 816 passed. `tsc --noEmit` clean on both apps.
- `vite build` rebuilt after the FE edits.

## False positives caught (recorded so they are not re-raised)

- Dashboard `PUT /:id` / widget writes "ungated" — windowed grep stopped before a
  long schema; they gate on `DASHBOARD_MANAGE`. Inventory rewritten to brace-match.
- 15 "dead" FE calls — `fetch(apiUrl())` POSTs logged as GET, runtime-generated
  `/api/config/dynamic/*` + un-suffixed config paths, bare `/` root routes.
- B1 status-0 cells — my own API restarts, not server faults (re-probed clean).
- The per-role page sweep covered SIDEBAR pages only; the tablet `/m` views were
  not in it, which is how the `limit=200` regression got past. Next sweep must
  include the tablet views with the exact params they send.

## Follow-up the same day - every record cap removed (operator decision)

See the CHANGELOG entry "Every record cap removed, backend and web
(2026-09-04)" for the full removed / kept lists. Rule going forward: no
`maximum` on limit, no `Math.min(limit, N)`, no hard `take: N` on a list, no
`maxItems` on a bulk action, no `.slice(0, N)` on a rendered data list. Fetch-all
web calls use `ALL_ROWS` from `lib/page-size.ts`.

---

# Dry In: multi-select duration + temperature, auto-fetch on half time (2026-09-04)

Operator ask (confirmed 3 assumptions: edited fetched value recorded as
AUTO_OVERRIDDEN; per-filter half-time; fetch failure -> manual fallback).

- [x] A. Backend: `readingSources` on advance + bulk payloads; `source` stored per reading in the event
- [x] B. Shared hook `useDryerAutoFetch`: auto-start at half time, no Get Values, editable -> AUTO_OVERRIDDEN
- [x] C. Desktop: queue checkboxes + one DRY_IN duration dropdown; drying panel checkboxes + one temperature + change value + Submit selected (bulk)
- [x] D. Tablet: same on the scan queue and the Currently Drying panel
- [x] E. Tests (hook 14/14, web 820/820), typecheck both apps, desktop live check (source AUTO + AUTO_OVERRIDDEN in filter_events), CHANGELOG, commit
- [x] F. Tablet half-time submit - verified 2026-09-05 headless on `/m` (operator 101012, block MUPS, tags CA000BEA + CA000BD9), ONLINE and OFFLINE:
  - offline temperature: both drying rows ready from the cached state, Select all ready, one temperature, Submit (2) -> 2 SUBMIT_READINGS ops queued with `readingSources: MANUAL`; reconnect drained them in 4 s; `filter_events` hold `source: MANUAL`, `dryer_readings_submitted = true`.
  - offline duration: 2 tags scanned offline, one 5-min duration, Submit Selected (2) -> 2 SET_DURATION ops queued, Currently Drying counted down from the cache; half time reached offline -> one temperature -> 2 more ops; 4 ops synced on reconnect; `dryer_started_at` anchored to the offline time (10:23), not the sync time (10:26).
  - no fetch offline by design (`isAuto` requires `online`); the manual dropdown is used. No code change was needed.
  - harness note: an injected token skips the login page, so the offline-replay grant must be minted by hand (`POST /api/auth/offline-grant`) or sync stalls on "waiting on re-authentication" - that is the harness, not the app.
  - the physical tap on a real tablet is still the operator's.

## 2026-09-24 — Strict whole-application audit (audit log)

Five sub-audits + page sweep + npm audit; ~45 findings verified and fixed in the
working tree (uncommitted at time of writing — see CHANGELOG "Strict
whole-application audit"). Docs touched: CHANGELOG, CLAUDE.md (lib count 39→45,
audit actions 97→98, Important Notes), memory `project_strict_audit_2026_09_24`.
Live data changed through the API: 4 audit rows redacted (plaintext password),
`PROCESS_RESET_REQUEST` + 4 PM re-auth rows set. Open: grant-header ≠ proof of
offline (design), non-SA backup restore, 2 orphan FILTER parents, AHU soft-delete
orphans, bulk tapeVersion optional, offline timestamp floors.

## 2026-09-25 — Close the items the 09-24 audit left open

Operator: "fix the open items one by one". Order = code first, then live data,
then dependencies. Destructive data steps (chain test rows, 174 gaps) need
explicit operator confirmation before they run.

- [x] 1 Offline-grant header ≠ proof of offline — replay calls must carry
      `offlinePerformedAt` + `clientOpId`; every gate a replay skips is recorded
      on the event + audit row (`replayExemptGates`) so an inspector can see it.
      Retroactive PENDING approvals at replay = follow-up needing the operator.
- [x] 2 A-F4 `PUT /api/assets/instances/:id` on a FILTER: parent must be an
      active AHU; attributes go through the filter master-data validator.
      Repair the 2 live rows (L8/AHU-89/SA/00-00 parent NULL, Pre-Filter-21 →
      inactive AHU "PC").
- [x] 3 A-F7 AHU/Block soft-delete orphans — consumers ignore inactive AHUs
      (PM due tasks, replacement tasks); equipment groups deactivated in the tx.
- [x] 4 C-F10 offline timestamp per-event floor (≥ latest event in the cycle).
- [x] 5 C-F11 bulk `tapeVersion` required for cycle-bound kinds.
- [x] 6 web F3 approval gate on scan surfaces (tablet + web ops).
- [x] 7 web F6 `use-offline.ts` cache refresh for the `-with-checklist` kinds.
- [x] 8 compliance F2 e-signature row ↔ signed row: `signature_audit_id` column,
      stamped from the REAUTH_SUCCESS row via AsyncLocalStorage; in the checksum.
- [x] 9 compliance F5 restore must never destroy post-backup audit rows —
      live rows absent from the backup are re-inserted after the load (JSON/BAK
      and pg_dump paths).
- [x] 10 filter-ops F15 terminate replay dedup before `assertCycleActive`;
      F8 lifecycle-state audit inside its tx.
- [x] 11 Stranded tags: retire() KEEPS the tag (2026-07-15 invariant kept); re-assignment
      releases a tag held by a retired/deactivated filter, audited. The 12 live ones released
      through `DELETE /api/assets/identifiers/:id`.
- [x] 12 Phantom roles PROJECT_LEADER / VIEWER stripped from action-reauth.
- [x] 13 Live data: orphan IN_PROGRESS cycle 0c71d6e8 (filter hard-deleted);
      12 deleted performers restored as DISABLED users (old ids, audited);
      12 stranded tags released; unique index on active names (migration).
- [ ] 14 Chain test rows (141) + 174 gaps — OPERATOR DECISION before any delete (asked 2026-09-25, still open).
- [x] 15 npm: uuid pinned ^11.1.1 via root override (exceljs advisory gone), esbuild 0.27.7;
      7 advisories remain, ALL major bumps (prisma 7, vitest 5, esbuild 0.28 blocked by tsx ~0.27) — reported.
- [x] 16 Tests + tsc + docs + memory. NOT committed — operator did not ask.

### Audit log (2026-09-25)
Items 1–13 closed; see CHANGELOG "Strict-audit follow-up". Extra defect found
and fixed on the way: offline replay never applied the tablet's missed-PM
write-offs. Live data changed through audited endpoints only (12 tag releases,
1 filter re-parented, 1 filter soft-deleted, 1 orphan cycle terminated, 12
disabled user rows restored under their original ids, re-auth policy
de-phantomed). Two migrations, both additive; drift guard PASS. Tests updated
where they asserted the old behaviour (audit insert shape, AHU gate return
value, replay payload fields, bulk tapeVersion, delete-tx mock).
