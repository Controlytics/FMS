# 04 — API testing

Deliverable 04 of the production-readiness campaign (rules: `test-results/README.md`). Two parts:

1. **Role × route permission matrix** — QA Phase 4 re-run at `723afdd` (qa-phase4-matrix), §1.
2. **Write-path abuse** — QA Phase 5 re-run at `ebb5244` (qa-phase5-writes), §2.

The two parts measured different commits. §1 ran at the later `723afdd`, where SEC-03 (`4eeb864`) had removed `POST /api/notification-settings/send`, so it answers 404 to every role there. §2's note that the route still answers 200 to ADMIN describes `ebb5244`, not a defect at `723afdd`.

---

## 1. Role × route permission matrix — QA Phase 4 re-run at `723afdd` — EXECUTED 2026-10-22

Baseline: `QA/PHASE4_ROLE_MATRIX.md`, EXECUTED 2026-10-21 on the :3104 build. That build predates `70adf40`, the commit that fixed the 2026-10-21 findings.

Everything below was re-run on 2026-10-22. The 2026-10-21 results appear only as the "before" side of the diff in §1.4.

**Result in one line:**
- 429 operations × 6 roles = **2,574 role×route rows**.
- **0 role allowed past a gate its stored permissions do not grant. 0 role refused a gate its permissions grant.**
- Every verdict that changed since 2026-10-21 is explained by a commit (§1.4).
- One new defect, P3 (§1.5).

### 1.1 Set-up

| Item | Value |
|---|---|
| Code measured | **`723afdd`** (branch `RFID`). It includes OD-01 part 2 (`8372478`), SEC-03 (`4eeb864`), D-DB-2/-5 (`dfa6073`, `0b823f4`) and SEC-08/14 SMTP (`86b300a`). The code came from a `git archive` of that commit, extracted outside the repo and run with `tsx` from source. Other agents' uncommitted edits (about 30 files in the working tree) were not under test. `@digilog/shared` was rebuilt from the same commit; its `node_modules` is a junction farm onto the repo's. Launcher: `QA/tests/phase4/start-head-api.sh`, which refuses any database but `digilog_qa_perf`. **All file:line references are at `723afdd`.** |
| Later commits | Six API commits landed after `723afdd` and before this report was committed (HEAD `052c27e`): `eadcf9a`, `d9aa1b3`, `213d54c`, `b8de8b4`, `55e66d9`, `b152596`. They cover backup, cycles/batch-states performance and LDAP transport. `git diff -U0 723afdd..052c27e` (source, tests excluded) changes **0** lines with a permission gate, a role check, a re-auth call, a `preHandler` or a route registration, so the matrix still holds at `052c27e`. Not re-run |
| First pass | The whole run was first made at `ebb5244`, before those five commits had landed (`QA/results/phase4/2026-10-22-ebb5244/`). Rows that differ between the two passes: **0**, apart from the 6 rows of the removed `/send` route |
| API | `https://localhost:3111`, `NODE_ENV=production`, `API_DOCS=on` (scratch only). `LOG_DIR` and `UPLOAD_DIR` are in the session scratchpad |
| Database | `digilog_qa_perf` only. It was shared with qa-phase5-writes (:3112) and the deliverable-03 agent |
| Roles and data | `roles.permissions` and `role_configs` are byte-identical to the 2026-10-21 run (`live-roles.json`, diffed); `updated_at` is still 2026-09-04 or 2026-10-08. Every configurable toggle now equals the target matrix at `723afdd`: 0 differences in either direction for all six roles |
| Actors | The **last** perf user of each role: `perf_user_300` (ADMIN), `_271` (SUPERVISOR), `_295` (MANAGER), `_286` (QA), `_250` (SHIFTOFFICER), `_220` (OPERATOR). SUPER_ADMIN was not tested (no password; the operator's SA session covers it). |
| Account overlap | qa-phase5-writes' wrong-password probe uses the same ADMIN account (`perf_user_300`). Before my first sweep, `audit_trail` records one REAUTH_FAILED and two FORCED_LOGOUT on it. **No sweep row got an unexpected 401** (0 `AUTH_FAIL`), so no verdict was affected. |
| Gates under test | The 429-operation inventory (`docs/production-readiness/03_API_ENDPOINT_INVENTORY.md`, derived at `4ddd2cd`), brought to `723afdd` by `QA/tests/phase4/gates-head.mjs`:<br>• **17 changed gates**, each with file:line and commit<br>• 1 operation added, `POST /api/pm-schedules/visits` (`5e7f488`)<br>• 1 operation removed, `POST /api/notification-settings/send` (`4eeb864`)<br>• the always-on re-auth actions<br>These were found by diffing `4ddd2cd..723afdd` on every `require*Permission` / `requireRole` / `requireSuperAdmin` / `addHook` / `AppError(403)` / `enforceReauth*` line, and confirmed by an OpenAPI diff: `/docs/json` at `723afdd` has 429 operations, +1 and −1 against 10-21 |

### 1.2 Method

The method is the 2026-10-21 one (`QA/PHASE4_ROLE_MATRIX.md` §1), carried forward unchanged.

**Validation runs before the permission gate.** Fastify validates the schema before any `preHandler`, so a 400 proves nothing about the gate. Every write is therefore sent a body built from `/docs/json` that passes the schema, with a random UUID for every id.

Each answer is classified:
- **GATE_DENY:** 403 `FORBIDDEN` "Insufficient permissions".
- **PASS:** anything that can only come from code after the gate: 404, 409, a business 400, 200, an in-handler 403, or 401 `REAUTH_REQUIRED`. No password is ever sent.

**Expected outcomes** are computed per row from the gate and the role's stored permissions, using the backend's own `hasEffectivePermission()` (fallbacks included).

**Mutation policy.** A write that would succeed is sent a valid body only when it cannot change data:
- the role is expected to be refused;
- or the id is a random UUID;
- or re-auth comes first;
- or the body names only random ids.

Otherwise it is skipped. The 2026-10-21 rules are unchanged, with two changes to the test harness:
- `POST /api/pm-schedules/visits` was added to the "random ids only" list. With a random `entityId` it answers 404 "AHU not found" before any write (`pm-visits.ts:55-59`).
- `GET /api/admin-requests/` is no longer skipped. A regex intended for the self-service POST was also catching the GET on 10-21.

A third pass (`retry-manual.mts`) hand-writes the two bodies the schema sampler cannot satisfy: the `if/then` on `dashboards/{id}/assign`, and the untyped `dataSnapshot` on `report-reviews`.

### 1.3 Results

| Check | Result | Evidence |
|---|---|---|
| Rows sent and classified | 2,574 rows:<br>• **2,407 conclusive OK**: 1,675 refused as expected, 528 allowed as expected, 204 open to any signed-in user as expected<br>• **0 LEAK**<br>• **0 REFUSED_BUT_GRANTED**<br>• 156 skipped: 60 public, 48 session/auth/self-service, 48 allowed-role writes with no safe stop<br>• **11 inconclusive**: the outbound-call routes `notification-settings/sms/test`, `equipment-groups/test-url` and `fetch-readings` for the roles expected to be refused, which were deliberately not sent a valid body. Each is a plain `requirePermission` preHandler | `role-sweep-latest.json` |
| Operations with at least one conclusive row | 406 of 429 | same |
| Backend against stored permissions | **0 disagreements** | same |
| Removed route (SEC-03) | `POST /api/notification-settings/send` → **404 for all 6 roles** | `removed-ops-probe.json` |
| Added route (PM visits) | ADMIN, MANAGER, QA, OPERATOR → 403 (no `PM_CREATE`). SHIFTOFFICER → 404 "AHU not found". SUPERVISOR → 401 `REAUTH_REQUIRED` (`CREATE_PM_SCHEDULE` policy) | `role-sweep-latest.json` |
| Export gates (`POST /api/audit/report-export-log`, 12 reports × 6 roles) | **72/72** answers match the route's own gate (`REPORT_EXPORT_GATES`, `audit/routes.ts:45-58`). For every configurable export toggle the frontend button (`useCan`) and the API agree. The only "doc denies, API allows" cells are Deviations and RFID Track Record: those have no configurable toggle, so the export follows page access by design (as on 10-21) | `export-gate-probe.json` |
| Always-on signatures, non-SA side | All 11 role×route rows where a non-SA role passes the gate on an always-on action answered **401 `REAUTH_REQUIRED` (11/11)**, unchanged since 10-21. 9 of them answer 401 although the clone's policy does not list the role: ADMIN on `access-matrix`, `audit-templates`, `report-signatories` and `tablet-access`; three roles on PM-overdue acknowledge; SHIFTOFFICER on stage approve and reject. All 9 use actions that were already always-on before OD-01.<br>**No OD-01 change (part 1 `1f8b8de` or part 2 `8372478`) can be told apart from the non-SA side on this clone.** The only OD-01 actions a non-SA role reaches are `UPDATE_USER` (ADMIN) and `UPDATE_FILTER_LIFECYCLE` (SUPERVISOR), and the clone's policy already lists both. LDAP save and restore list ADMIN as well, and no non-SA role passes the delete gates. OD-01 is left to the SA session | `od01-check.json` |
| Grant set containing another node's gate (static, `PERMISSION_TREE` at `723afdd`) | 53 hits (was 58); **0 write cross-grants.** The only non-read hits are `filters.rfid_manage` → `ASSET_IDENTIFIER_CREATE/DELETE`, the enforced-only nodes of the same RFID capability (intended, as on 10-21). P4-03/04/05 are gone | `grant-contains-gate.json` |
| Frontend vs backend gate on writes (static + live roles) | One pair: `POST /api/assets/instances/reject` accepts `FILTER_REVIEW` or `FILTER_APPROVE`, while each step's button checks one of them. **Not a defect:** the handler limits each step to its own role (`98c79bb`, A-06) | `fe-be-gates.json` |
| Writes a live role can perform without the owning toggle ON | 2, both read-only computations behind `ASSET_READ` (`ahu-completion-status/batch`, `ahu-set-availability`), as on 10-21 | `effective-vs-toggles.json` |
| Role × configurable privilege, against the target doc | 87 privileges × 6 roles = 522 cells: **489 OK**, 23 n/a (no backend route), **10 "allowed although the doc denies"**. All 10 are the P4-06 class, which the operator decided on 2026-10-21 to leave as documented (CHANGELOG): `version_history.view` ×5, `pm.download_template` ×3, QA `retirement.view`, OPERATOR `equipment_groups.view`. A toggle hides the page, not the data | `matrix.json`, `matrix.md` |
| Unreachable permissions left in role arrays | SUPERVISOR still holds `FCP_CREATE` and `FCP_UPDATE`. No toggle grants them since `70adf40`, and no route or `useCan` gate checks them any more, so they are **inert**. `updateRoleConfig` keeps unmapped permissions (CLAUDE.md), so only `PUT /api/roles/:name` removes them. INFO | `orphan-perms.txt` |

### 1.4 Every verdict that changed since 2026-10-21, with its commit

Diff tool: `QA/tests/phase4/diff-runs.mjs`, keyed on role × method × path (`diff-vs-2026-10-21.json`).

| # | Rows | 2026-10-21 | `723afdd` | Explained by |
|---|---|---|---|---|
| 1 | SHIFTOFFICER `PUT /api/pm-schedules/entries/{id}/edit` | PASS (404; through `PM_UPDATE`) | **403** | `70adf40` (P4-04): `requirePermission('PM_EDIT_ENTRY')` (`pm-schedules/routes.ts:507`), was `any(PM_UPDATE, PM_EDIT_ENTRY)`. The only gate change that alters a live role's outcome; the other 16 changed gates affect no live role (every role holds both alternatives or neither) |
| 2 | `POST /api/pm-schedules/visits` × 6 | — | 403 ×4, 404, 401 | `5e7f488` (new route, gate `PM_CREATE`, `pm-schedules/routes.ts:717`) |
| 3 | `POST /api/notification-settings/send` × 6 | inconclusive ×5 (outbound, never sent a valid body) / ADMIN skipped | 404 ×6 | `4eeb864` (SEC-03, route removed) |
| 4 | Export log: Audit Trail (ADMIN, SUPERVISOR, SHIFTOFFICER); Filters (MANAGER, QA, OPERATOR); Retirement List and Replacement List (SUPERVISOR, MANAGER, QA, OPERATOR) | 200 | 403 | `70adf40` (P4-02): the log gates on the Export permission (`audit/routes.ts:46,51,55,57`). Closes P4-02 |
| 5 | Export log: Quality Notifications, ADMIN | 200 | 403 | `70adf40`: gate `[]` → `['PM_READ']` (`audit/routes.ts:53`). See **D04-01** |
| 6 | `POST /api/admin-requests/{id}/process` (ADMIN); `POST /api/users/reset-requests/{id}/process` (ADMIN) | 401 REAUTH | 400 "Remarks are required…" | `edb2154` (remarks checked before the signature). Gate unchanged |
| 7 | `POST /api/assets/instances/{review,approve,reject}` (MANAGER/QA) | 404 | 400 "Remarks are required…" | `e0dcb3c`. Gate unchanged |
| 8 | `POST /api/backup/validate` (ADMIN), `POST /api/replacement-schedules/validate` (SUPERVISOR, SHIFTOFFICER) with a JSON body | 406 `INTERNAL_ERROR` | 406 `INVALID_REQUEST` "the request is not multipart" | `70adf40` (P4-09). Closes P4-09 part 1 |
| 9 | SHIFTOFFICER `PUT /api/hierarchy/filters/{unknown}` | 400 `VALIDATION_ERROR` | 404 | `70adf40` (P4-09, `filter.service.ts` `update()`). Closes P4-09 part 2 |
| 10 | `PUT /api/notifications/bulk-{read,unread}` × 6 | 400 `DATA_CONSTRAINT` | 200 `{count:0}` | `8d43bec`: `ids` items became `format: uuid`, so the sampler now sends UUIDs instead of a string that failed the uuid cast. Gate and visibility unchanged |
| 11 | `POST /api/report-reviews/` × 6 | inconclusive (separately probed 403 on 10-21) | 403 | Harness only: the manual third pass is now part of the run. No code change |
| 12 | `GET /api/admin-requests/` × 6 | skipped (harness bug) | ADMIN 200, others 403 | Harness only: matches the hand probe of 10-21 (`admin-requests-get.txt`) |

**Unchanged:**
- The other **2,533 rows** have the same outcome and the same status as on 2026-10-21.
- **The role × privilege matrix:** of the 54 cells that broke the doc on 10-21, 32 now agree because the target matrix was updated to the 10-08 roles in `70adf40` (P4-01 decision: the 10-08 roles are correct). 15 now agree because of the P4-02 / P4-04 fixes in rows 1 and 4. The 10 that remain are the P4-06 class.

### 1.5 Defects

| ID | Sev | Where | Scenario | Observed | Expected |
|---|---|---|---|---|---|
| **D04-01** | P3 | `apps/api/src/modules/audit/routes.ts:53` (`'Quality Notifications': ['PM_READ']`) vs `apps/api/src/modules/pm-schedules/qnn.ts:9-19` + `routes.ts:123` (`canSeeQnn`, config `qnn-notifications.visibleRoles`) | Who may export the QNN report and who may view it are decided by two unrelated rules:<br>(a) OPERATOR: `GET /api/pm-schedules/qnn` → **403** "Not allowed to view Quality Notifications.", yet `POST /api/audit/report-export-log {reportType:'Quality Notifications'}` → **200**.<br>(b) ADMIN: `GET /qnn` → **200** (ADMIN is in `visibleRoles` and is the code default), yet the export log → **403** "You cannot export the Quality Notifications report." | (a) A signed `REPORT_GENERATED` row (a §11 record) for a report the role cannot open.<br>(b) ADMIN sees the report but its Export is refused (since `5859053`, a refused export produces no file). `70adf40` moved the gate from `[]` to `PM_READ`. That fixed neither direction of the 10-21 observation and created direction (b) | The export gate is the same rule as the view: `canSeeQnn(role)` (plus `PM_READ` if the page needs it) |

INFO (clone data, not code): in `digilog_qa_perf`, `system_config` `qnn-notifications.visibleRoles` and `tablet-access` still carry the removed `MAINTENANCE` role. `edf0955` cleaned those settings in the developer database through audited rows, but not in this clone. The `stage_approvals` tablet tile for OPERATOR and SUPERVISOR (P4-08) is still inert: `canUseStageApprovals` also needs the STAGE_APPROVAL permissions.

### 1.6 Not covered

- **SUPER_ADMIN**: every SA-only and `ROLE_MANAGE` route answers 403 to all six roles in the sweep. The "SA must sign" half needs the operator's SA session.
- **OD-01 part 2** for non-SA roles: not distinguishable on this clone (§1.3).
- **P4-10** (a reason is required on permission saves): the routes are `ROLE_MANAGE`, which only SA holds.
- **48 allowed-role writes not sent**, because a valid body would change the clone. Examples: `POST /api/users/`, `/roles/`, `/dashboards/`, `/pm-schedules/`, config PUTs without re-auth, `ldap/test-connection`, `backup/restore`. For these the gate is proven only in the refuse direction, by the 403s of the roles without the permission.
- **The 11 inconclusive outbound rows** (§1.3).
- **In-handler second gates with real records**: `assertPmRole`, separation of duties. Covered by §2 (qa-phase5-writes).
- **The UI**: frontend expectations are computed from `useCan` and `PERMISSION_TREE`, not observed on rendered pages.

### 1.7 Clone side effects and evidence

**Writes to the clone:**
- **92 `REPORT_GENERATED` audit rows**: two export-probe passes, `after_value->>'search' = 'QA-PHASE4-PROBE'`, `recordCount 0`. No EXPORT_* re-auth is configured, so a passing probe writes its row.
- 12 `LOGIN_SUCCESS` rows for my six accounts. The sessions were later ended by the scratch API's own `session_sweep`.
- No other write persisted. Every 2xx write is a read-only computation or validation, a `{count:0}` notification mark, or `bulk-operate` with random filter ids (fails per item).

**Evidence** (git-ignored): `QA/results/phase4/2026-10-22/`
- `role-sweep-latest.json`: every row
- `diff-vs-2026-10-21.json`, `diff-vs-ebb5244.json`
- `export-gate-probe.json`, `removed-ops-probe.json`, `od01-check.json`
- `matrix.json`, `matrix.md`, `matrix-diff-vs-2026-10-21.txt`
- `tree.json`, `target-matrix-723afdd.json`, `openapi.json`
- the static checks

The first pass at `ebb5244` is in `QA/results/phase4/2026-10-22-ebb5244/`.

**Scripts:** `QA/tests/phase4/`:
- `start-head-api.sh`, `gates-head.mjs`
- `role-sweep.mts` (`P4_HEAD=1`, `P4_SPEC`, `P4_OUT`)
- `retry-inconclusive.mts`, `retry-manual.mts`
- `export-gate-probe.mts`, `removed-ops-probe.mjs`, `od01-check.mts`, `diff-runs.mjs`
- `matrix.mts`, plus the static checks

**Re-run, in order:**
1. `start-head-api.sh`
2. `dump-tree.mts`
3. `role-sweep.mts`
4. `retry-inconclusive.mts`
5. `retry-manual.mts`
6. `export-gate-probe.mts`
7. `matrix.mts`
8. `diff-runs.mjs`

---

## 2. Write-path abuse — QA Phase 5 re-run on HEAD — EXECUTED 2026-10-22

Baseline: `QA/PHASE5_WRITE_ABUSE.md` (EXECUTED 2026-10-21 against the then-current build on :3104).
Everything below was re-run; the 2026-10-21 numbers appear only as the "before" column of the diff.

### 2.1 Set-up

| Item | Value |
|---|---|
| Source | git worktree **pinned at `ebb5244`** (HEAD when the run started), `tsx` from source. The main tree held 58 uncommitted files from in-flight work (OD-01 part 2, SEC-03 `/send` removal, `identifier-locks.ts`); a worktree keeps every verdict attributable to a commit. `@digilog/shared` built from the same commit. Launcher: `QA/tests/phase5/start-scratch-head.sh` |
| API | `https://localhost:3112`, `NODE_ENV=production`, own `LOG_DIR` / `UPLOAD_DIR` in `%LOCALAPPDATA%\Temp\digilog-p5-scratch` |
| Database | `digilog_qa_perf` only (launcher and `qa.mjs` both refuse anything else). Shared with qa-phase4-matrix (:3111) and a deliverable-03 agent — table-level snapshot deltas below include their writes; my own mutations are listed from my records (§2.7) |
| Actors | perf user **index 3** of each role (`perf_user_004/224/254/275/290/299`); wrong-password probes use index 4 (`_005/225/255/276/291/300`). Index 0 is left to the other agents (a login here is `force:true`). Role permissions are byte-identical to 2026-10-21 (`whoami.json` diff: 0 added, 0 removed per role) |
| Not used | SUPER_ADMIN (no password available) — see §2.6 |
| Inventory | `/docs/json` on HEAD: 430 operations = 2026-10-21's 429 + `POST /api/pm-schedules/visits` (5e7f488); none removed |

Re-run: `PERF_TARGET=https://localhost:3112 P5_OUT=phase5-rerun P5_USER_IDX=3 node QA/tests/phase5/<script>.mjs`
(Git Bash: `export MSYS_NO_PATHCONV=1`). Raw results: `QA/results/phase5-rerun/*.json` (git-ignored).

### 2.2 Results by category

| Category | Probes | Result on HEAD | vs 2026-10-21 |
|---|---|---|---|
| 1 Authorization (every write op × every role lacking its gate, + no token) | 1063 role + 218 no-token (`authz-sweep`) + 18 (`authz-fixups`) + 12 (`report-reviews-authz`) | **0 bypass.** All 403 / 401; 2xx = 0 | 1291 rows identical; 6 changed rows = a schema change (§2.3 #1), re-probed → 403 |
| 2 Re-auth (no pw / wrong pw body+header / grant on and off replay routes / foreign / forged / legacy header / typed `_currentPassword`) | 21 (`reauth`) + 22 (`reauth2`) + 11 (`reauth3`, new) | **0 bypass.** Literal password search over all 62 tables: 0 hits before and after; 0 hits in the scratch logs | 4 changed rows, all the P5-02 fix (§2.3 #2) |
| 3 Mass assignment (DB-checked) | 15 (`mass-assign`) | **0 privileged field persisted** | 5 changed rows: P5-01 + P5-04 fixes (§2.3 #3, #4) |
| 4 Scope / IDOR (notifications) | 4 | 404 / 403 as before | unchanged |
| 5 Input abuse | 1127 (`input-fuzz`, 94 ops × 7 body mutators + 5 path-id + 4 raw) | **0 × 5xx, 0 leaks** (scratch http log: 0 lines `→ 5xx` for the whole run) | was 4 × 500 — P5-03 fixed (§2.3 #5); other changes §2.3 #6–#10 |
| 5 SSRF / upload | 6 + 4 | blocked / magic-byte checked, as before | unchanged |
| 6 Segregation of duties | stage self-approve (single + bulk), **self-reject (single + bulk, new)**, report-export gates (7), admin-request subject = SUPER_ADMIN | all refused | export "Filters" for OPERATOR 200 → 403 (§2.3 #11) |
| New: concurrent RFID assign | 5 scenarios (`ident-race`) | **5/5 PASS** | new (§2.4) |

### 2.3 Every changed verdict, with its commit

| # | Probe | 2026-10-21 | HEAD | Explained by |
|---|---|---|---|---|
| 1 | `POST /api/dashboards/{id}/assign`, 6 roles | 403 | 400 VALIDATION (sweep body) | 06fc578 added an `if/then` (`assigneeType` USER→`userId`, ROLE→`roleValue`) the sweep's sampler cannot model. Re-sent valid USER and ROLE bodies: **403 for all 6 roles** (`authz-fixups.json`). No gate change |
| 2 | `/retire` + valid grant, no replay fields (SUPERVISOR) | **404 = password gate skipped (P5-02)** | 401 REAUTH_REQUIRED | 70adf40: `OFFLINE_REPLAY_ROUTES` (`plugins/auth.ts:483`) lists only the 6 cycle-write routes; elsewhere the grant header is not read. The two other `/retire` rows (foreign / forged grant) moved from 401 `OFFLINE_REPLAY_TOKEN_*` to 401 REAUTH_REQUIRED for the same reason; token verification itself re-proved on a replay route (`reauth3`: foreign → 401 `OFFLINE_REPLAY_TOKEN_USER_MISMATCH`, forged → 401 `OFFLINE_REPLAY_TOKEN_INVALID`) |
| 3 | `PUT /api/assets/instances/{id}` `status` on a Retired filter / to Retired / to `<img…>` (SHIFTOFFICER) | **200, retirement record dropped from the list (P5-01)** | 409 `FILTER_STATUS_LIFECYCLE_OWNED`, row unchanged | 70adf40 (`instance.service.ts:89`) |
| 4 | `PUT /api/auth/profile` `photoUrl` = traversal text / external URL | 200, stored (P5-04) | 400 "Photo must be uploaded through the profile page" | 70adf40 |
| 5 | NUL byte → checklist-profiles / user-groups / sms test; `year:-2147483649` → pm-schedules | **500** (P5-03) | 400 | 70adf40 (`lib/errors.ts:43` maps `PrismaClientUnknownRequestError`) |
| 6 | `POST /api/assets/instances/{review,approve,reject}` (fuzzed, no remarks) | 404 | 400 "Remarks are required…" | e0dcb3c (remarks checked before the lookup). Direct probes in `reauth3`: review / approve / blank-remark reject → 400 |
| 7 | `PUT /api/pm-schedules/entries/{id}/edit` (SHIFTOFFICER) | 404 (passed the gate) | **403** | 70adf40 (P4-04): route now `requirePermission('PM_EDIT_ENTRY')` (was `PM_UPDATE` or `PM_EDIT_ENTRY`). SHIFTOFFICER holds `PM_UPDATE` (= `pm.edit`), and the operator's target matrix gives it `pm.edit`, not `pm.edit_entry` — intended. **Note for the operator:** no non-SA role on the clone holds `PM_EDIT_ENTRY`, so editing an approved visit is SUPER_ADMIN-only until a role is granted "Edit PM Entries" |
| 8 | `PUT /api/notifications/bulk-{read,unread}` (fuzzed) | 400 DATA_CONSTRAINT | 200 `{count:0}` | 06fc578 made `ids` `format: uuid`, so the sampler now sends random UUIDs: no row of anyone else's matched (count 0). Not a scope change — IDOR rows (§2.2 cat 4) unchanged |
| 9 | `PUT /api/hierarchy/filters/{id}` unknown id | 400 | 404 | 98a9abc (D2: unknown filter → 404) |
| 10 | `POST /api/users/reset-requests/{id}/process` (fuzzed, no remarks) | 404 | 400 "Remarks are required…" | edb2154 (remarks rule) |
| — | `POST /api/user-groups`, `/notification-settings/templates` | 200 | 409 | **Data, not code:** the same names were created by the 2026-10-21 fuzz (duplicates) |
| — | `PUT /api/notification-settings/email` with `{}` | 200, **config wiped to `{}`** (P5-05) | 200, stored value unchanged | 70adf40 (merge over the stored value) |
| 11 | report-export-log "Filters" as OPERATOR | 200 | 403 "You cannot export the Filters report" | 70adf40 (P4-02: the export log gates on the Export button's permission, `FILTER_LIST_EXPORT`, `audit/routes.ts:51`) |

No verdict changed without a commit that explains it.

### 2.4 New cases for today's changes

| Change | Case | Result |
|---|---|---|
| D-DB-2 identifier locks (df5e6a1) | Fixtures: SUPERVISOR creates 2 filters under the empty AHU-3 → MANAGER reviews → QA approves (filter workflow ON). Then, as OPERATOR, simultaneously: **A** 2 assigns, different tags, untagged filter · **B** 5 assigns, untagged filter · **C** 2 `replaceExisting` on one filter · **D** one new tag to both filters at once · **E** delete a tag while a replace runs | **A** [409 `ENTITY_HAS_IDENTIFIER`, 201], 1 tag · **B** one 201 + four 409, 1 tag · **C** [201, 201], 1 tag · **D** [201, 409 `DUPLICATE_IDENTIFIER_VALUE`], tag on 1 filter · **E** [404, 201], 1 tag. **5/5 PASS**, no 5xx. One run per scenario (not a statistical trial) |
| P5-02 / replay rules (70adf40) | grant on `/bypass` and `/advance-with-checklist` without replay fields; grant + fields; `bulk-operate` with a grant and an item without replay fields | 400 `OFFLINE_REPLAY_FIELDS_REQUIRED` · 404 (gates passed) · bulk item `NOT_FOUND`, identical to the no-grant control = grant ignored on bulk-operate |
| Bypass completion (f745d8c) | `/bypass` with `answers` (A-01 carry), OPERATOR, random filter | 404 (FILTER_BYPASS held, no re-auth row for OPERATOR); 403 for roles without FILTER_BYPASS (sweep) |
| A-03 SoD (98c79bb) | SHIFTOFFICER advances a real cycle into Wash Out, then **rejects** its own approval (single + bulk) | 403 `SELF_APPROVAL_FORBIDDEN` / bulk item failed with the same code; a second SHIFTOFFICER then approved |
| PM visits (5e7f488) | `POST /api/pm-schedules/visits` × 6 roles, random AHU | 403 ×4 (no PM_CREATE) · SHIFTOFFICER 404 "AHU not found" · SUPERVISOR 401 REAUTH_REQUIRED |
| e0dcb3c | filter review / approve / reject without or with blank remarks | 400 ×3 |
| Redaction of a meta row (54f23fc) | non-SA: `/api/audit/{id}/redact`, `/bulk-redact` | 403 for all 6 roles (sweep — the routes are SUPER_ADMIN-only). The SA half (409 `META_AUDIT_IMMUTABLE`) is in §2.6 |

### 2.5 Defects found (reported to the lead)

| ID | Sev | Endpoint | Repro | Observed | Expected | Source |
|---|---|---|---|---|---|---|
| **P5R-01** | P3 | `POST /api/pm-schedules` | SHIFTOFFICER (PM_CREATE, no re-auth row) `{entityId:<random uuid>, year:1, entries:[]}` | **201**, an ACTIVE `pm_schedules` row for an entity that does not exist, year 1, no visits (row `6c6980a0…`). The same id on `POST /api/pm-schedules/visits` → 404 "AHU not found" | 404 / 400 like `/visits`: entity must be an active AHU; year bounded; at least one visit | `modules/pm-schedules/pm-schedule-crud.ts:41-56` (`create()` reads `entityId`/`year` and never checks the entity; contrast `pm-visits.ts:55-59`); schema `routes.ts:684-687` (`year: {type:'integer'}`, no bounds). **Also present on 2026-10-21** (fuzz row `2f1d2ac1…`) — I recorded it only as a mutation then, not as a defect; reported now |
| P5R-02 | P3 (wording) | `POST /api/stage-approvals/{id}/reject`, bulk reject | performer rejects own stage | 403 with message "…cannot **approve** it…" on a **reject** | message naming the action taken | `modules/stage-approvals/service.ts:77` (one message for both decisions) |

Still as on 2026-10-21 (benign, unchanged): public `POST /api/admin-requests/` with a trailing slash → 401 (`plugins/auth.ts:245` matches the exact path; the web client posts without the slash).

### 2.6 Not covered / not at HEAD

- **SUPER_ADMIN writes** (OD-01 part 1 always-on gates on user delete, role / permission saves, re-auth policy, FDM; audit redact/edit/delete; 409 `META_AUDIT_IMMUTABLE` on a meta row): every one of these routes is SUPER_ADMIN-only or `ROLE_MANAGE` (held by no other role), so non-SA callers get 403 (sweep) and the "always asks the password" half needs an SA session. **Prepared, NOT EXECUTED:** `QA/tests/phase5/sa-meta-redact.mjs` (S1–S3 unsigned SA destructive writes → expect 401; S4 signed redaction of the SA's own login row as fixture; S5–S7 redact / bulk-redact / edit of the resulting meta row → expect 409; S8 meta row unchanged). Operator runs it with the password at a hidden prompt; deliverable 06's `sa-session-probes.mjs` covers the same unsigned writes on :3110.
- **Not at HEAD `ebb5244`** (uncommitted when the run started), so not tested here: SEC-03 removal of `POST /api/notification-settings/send` — on HEAD it still answers 200 to ADMIN (the fuzz sent 3; email/SMS are disabled on the clone, 8 FAILED `notification_logs`, nothing left the machine); OD-01 part 2 (backup restore, user edit, per-user overrides, filter / hierarchy delete, manual lifecycle change); the `identifier-locks.ts` follow-up. Re-run `reauth*.mjs` + `input-fuzz.mjs` once they are committed.
- Multipart file parsing of bulk filter / PM / replacement uploads; destructive config and backup fuzzing (excluded on purpose, as on 2026-10-21).
- Filter / PM / replacement approval self-approval end-to-end: no non-SA role holds both the submit and the approve permission (unchanged from 2026-10-21).

### 2.7 My mutations on `digilog_qa_perf` (for the clone reset)

- Filters: `QAP5-RACE-MVJNA7QX-1` (`24a7bf60…`) and `-2` (`b223585c…`) under AHU-3 — created, reviewed, approved, tagged, then **retired** (each keeps its last RFID tag, per the retire invariant); `QAP5-MA-FILTER-RR1` (`f5797a23…`, PENDING_REVIEW, under AHU-3).
- Cycles advanced WASH_IN → WASH_OUT and approved by `perf_user_225`: filters `d82551de…` (approval `e87d1ec5…`) and `23a256a0…` (approval `42cd36b1…`).
- `pm_schedules`: `6238bc13…` and `6c6980a0…` (orphans, P5R-01).
- From the fuzz: 5 `checklist_profiles`, 3 `admin_requests` + 1 FORGOT_PASSWORD(superadmin) request (`d3a7e4f0…`, refused on approval), 8 `notification_logs`, 3 `USER_CREATION_REQUEST_SUBMITTED` notifications; plus the stage-approval requested / approved notifications of the two SoD advances.
- Restored by me: `perf_user_004.full_name` (my M1 body sent another user's name; fixed in the script), `system_config` `notification-email` / `-sms` attribution (values were unchanged).
- Uploaded test PNG in the scratch `UPLOAD_DIR` (temp folder, not the repo).
- `audit_trail` grew 57777 → 58175 (all agents on the DB; chain **not re-verified** here).
