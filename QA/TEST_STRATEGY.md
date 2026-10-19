# QA — Test Strategy

Campaign started 2026-10-19 from the operator's "MASTER PROMPT 2". This document says where tests run,
what they may touch, in what order the work is done, and how a result is classified. It is the rulebook
for every other file in `QA/`.

## 1. Environments (and what is off-limits)

| Target | What it is | Who may use it |
|---|---|---|
| `digilog_db` | the operator's real development data | **never** touched by this campaign |
| `digilog_test_db` | owned by the API vitest suite (`apps/api/vitest.env.ts` rewrites `DATABASE_URL`) | only through `npm test` in `apps/api`, single-fork |
| `digilog_qa_perf` (new, cloned from the go-live copy) | QA black-box target, API on **https://localhost:3104** | QA scripts in `QA/tests/`; Playwright |
| `digilog_day1_perf` (:3102) / `digilog_perf` (:3100) | load-test copies; kept untouched so the soak numbers stay comparable | load tests only |

Every black-box script loads accounts through `tests/performance/lib/auth.mjs`, which refuses any
database whose name does not end in `_perf`. No script embeds a URL or password; the target comes from
`PERF_TARGET` and the account file.

## 2. Two test lanes only

1. **In-process API tests** live beside the code (`apps/api/src/**/__tests__`, `apps/api/src/e2e/`) and
   run on the existing single-fork harness against `digilog_test_db`. The existing 11-module
   `buildApp()` in `e2e/test-helper.ts` is not changed. Modules it does not mount get their own
   builder in a new helper so existing tests keep their exact setup.
2. **Black-box HTTP and browser tests** live in `QA/tests/` and reuse `tests/performance/lib/http.mjs`
   and `auth.mjs`. Browser journeys are driven through the Playwright MCP and saved as replayable
   scripts in `QA/tests/e2e/`. `@playwright/test` is **not** installed; doing so is an operator
   decision (it adds a dependency and a browser download).

There is deliberately no third harness: a vitest project under `QA/` that imported API code would read
`apps/api/.env` and point at `digilog_db`.

## 3. Safety rules for sweeps and probes

- **Never sent by any automated sweep:** `PUT /api/super-admin/api-lock` (locks the SUPER_ADMIN out),
  `POST /api/backup/restore`, `DELETE /api/audit/:id`, `POST /api/audit/bulk-delete`,
  `POST /api/users/bulk-delete`, any `password-expiry-sweep` / `deviations/sweep` trigger. These are
  tested once, by hand-written probes, on `digilog_qa_perf` only.
- **Rate limits** (login 100/min, `/verify` 50/min, change-password 50/min): tokens are cached and
  reused; probes that must hit login are paced.
- **Lockout:** wrong-password and re-auth-failure probes use sacrificial accounts
  (`perf_user_2xx` with known roles), never the accounts other scripts depend on.
- **Config probes restore what they change** (e.g. the legacy `action-reauth` shape) in a `finally`.
- **Load** stays inside the limits already proven in `docs/production-readiness/`; no new stress
  runs without the operator asking.

## 4. Order of work (most evidence per hour first)

1. **Direct probes of the verified-candidate risks** (§6): each becomes PASS (behaves correctly), a
   defect in `DEFECT_REGISTER.md`, or "documented decision".
2. **One generated sweep over all 429 operations** (`QA/tests/api/endpoint-sweep.mjs`), per operation:
   no token → 401; a role without the gate → 403; malformed body → 400 (not 500); unknown id → 404
   (not 500); no response leaks Prisma text, stack frames or file paths. Driven from
   `docs/production-readiness/03_API_ENDPOINT_INVENTORY.md`.
3. **Workflow e2e tests for the modules with zero HTTP coverage** (PM schedules, stage approvals,
   block-change requests, report reviews, filter approval, filter profiles, notification rules, guest,
   Filter Data Management), in-process lane.
4. **Role/permission matrix** (Phase 4) with the operator's target matrix as the oracle:
   `tasks/ROLE-PRIVILEGES-DOC-ALIGNMENT.md` + `tasks/role-privileges-baseline/target-matrix.json`.
   Roles are read from the clone's `roles` table, not from `default-roles.ts`.
5. **Browser journeys** for the top-risk pages only (stage screen, tablet `/m`, Filter Data Management,
   replacement schedule, PM schedules, audit), saved as scripts.
6. Fault injection on the clone (Phase 8), volume checks reuse the one-year copy's evidence (Phase 7).

## 5. Classification

| Status | Meaning |
|---|---|
| PASS | executed, assertions met, evidence file named |
| FAIL | executed, defect logged with an ID |
| BLOCKED | cannot run here (named reason: no device, no clean machine, needs admin) |
| NOT TESTED | not yet executed — the default |
| NOT APPLICABLE | with a one-line justification |
| DOCUMENTED DECISION | behaves the way an operator decision recorded in `CLAUDE.md` or memory says it should; tested as such, logged as a risk, **never "fixed"** |

**Defect severity** (P0 data corruption / security breach / outage; P1 major workflow failure;
P2 significant defect or degraded performance; P3 minor/usability) is set by consequence. **Remediation
priority** is separate and is the operator's call for anything touching a regulated workflow.

## 6. Risk triage (from `FEATURE_INVENTORY.md` §3)

| Risk | Classification before testing | Reason |
|---|---|---|
| R1 stage-screen dialogs not mounted | **verify** | structural evidence only |
| R2 config PUTs unvalidated | **verify** | sweep claim; check what `config.service` actually does with a bad body |
| R3 offline replay skips gates | DOCUMENTED DECISION (test that `replayExemptGates` records every skip) | CLAUDE.md "strict audit 2026-09-24/25"; the OQ list also records "offline Wash Out / Dry Out skips the Shift Officer approval" as a Part 11 point for the operator |
| R4 unretire hard-deletes replacement history | DOCUMENTED DECISION (test the `_sideEffects` record) | CLAUDE.md FDM retrofit 2026-08-27 |
| R5 audit edit/delete break the chain | DOCUMENTED DECISION ("breakage stays loud"); missing Verify Chain UI = **verify** | CLAUDE.md 2026-07-01 / 2026-08-27 |
| R6 PM execution + block-change races | **verify** | sweep claim |
| R7 gated endpoints with no re-auth prompt | **verify** | matches the 🔴 CLAUDE.md anti-pattern |
| R8 legacy action-reauth shape disables gates | **verify** (restore config after) | |
| R9 filter approval no separation of duties | **operator question** (also on the OQ bug list) | PM / replacement enforce it |
| R10 FDM lifecycle delete wrong endpoint | **verify** | confirmed structurally |
| R11 SIGNATURE question unanswerable | **verify** | |
| R12 tablet offline access fail-open etc. | **verify** (also on the OQ bug list) | |
| R13 guest request unlimited | DOCUMENTED DECISION (only three rate limits, operator 2026-10-10) | |
| R14 250 untested operations | coverage work, not a defect | |
| R15 password-reuse cap, notification retries, wmic | **verify** | |
| SUPER_ADMIN bypass / no MFA / lockout exemption | DOCUMENTED DECISION | memory `feedback_super_admin_exempt_no_mfa_2026_07_25` |
| HTML sanitizer applied at 11 call sites, CLAUDE.md says "all text fields" | **verify** (doc or code is wrong) | |

## 7. Seeds for the defect register

Before new findings are logged, the register imports the defects already recorded and never fixed, so
nothing is double-counted:

- the OQ bug list of 2026-10-12/13 (22 items; operator chose "document only"),
- the 2026-07-15 confirmed-live mediums (`tasks/ENTERPRISE-AUDIT-MEDIUMS-VERDICTS-2026-07-15.md`;
  41 CONFIRMED-LIVE, 10 fixed in `bad2ca4`; each re-verified before it is counted open),
- the two open operator decisions of 2026-07-15 (SUPER_ADMIN audit hard-delete without gate or
  re-auth; notification enum / test-fire succeeding for a rule that never fires).

## 8. Change control

- The 2026-10-17 load-test fixes (32 files) are still uncommitted. New fixes from this campaign should
  land **after** that batch is committed so the two diffs stay separable; each register entry lists the
  files its fix touches.
- Tests and test helpers may be added without asking. A fix that changes behaviour in a regulated flow
  (cycles, approvals, audit, re-auth, offline) is batched into one approval question to the operator.
- Every fix gets a regression test that fails without it, then the affected suites run single-fork.

## 9. Commands (filled in as suites are written)

| Purpose | Command |
|---|---|
| Existing API suite | `cd apps/api && npm test` |
| Existing web suite | `cd apps/web && npm test` |
| Coverage (text) | `cd apps/api && npm run test:coverage`; `cd apps/web && npm run test:coverage` |
| Start the QA target | `powershell -File tests/performance/start-perf-api.ps1 -Database digilog_qa_perf -Port 3104 -NoBuild` |
| Black-box sweep | `PERF_TARGET=https://localhost:3104 PERF_CONFIRM=yes node QA/tests/api/endpoint-sweep.mjs` (Git Bash: `export MSYS_NO_PATHCONV=1` first) |
| Load tests | `tests/performance/README.md` |
