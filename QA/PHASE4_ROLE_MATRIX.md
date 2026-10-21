# QA Phase 4: Per-role permission matrix

**Run:** 2026-10-21, against the production-build API at `https://localhost:3104` and the disposable clone `digilog_qa_perf`. `digilog_db` and `digilog_test_db` were not touched.
**Roles:** ADMIN, SUPERVISOR, MANAGER, QA, SHIFTOFFICER, OPERATOR. SUPER_ADMIN was set aside by the operator.
**Accounts:** the *last* synthetic user of each role in `tests/performance/results/perf-users.json`, chosen so this run did not end another agent's sessions: `perf_user_300` (ADMIN), `_271` (SUPERVISOR), `_295` (MANAGER), `_286` (QA), `_250` (SHIFTOFFICER), `_220` (OPERATOR).
**Application source:** not edited. Scripts are in `QA/tests/phase4/`; evidence is in `QA/results/phase4/`.

## 1. Method

Three oracles are kept apart, so that one drift is not counted twice:

| Oracle | Source | Used for |
|---|---|---|
| **Target doc** | `tasks/role-privileges-baseline/target-matrix.json` `on`, plus the amendments recorded since 2026-09-04: `filters.review` MANAGER and `filters.approve` QA (filter-approval workflow), and the 2026-10-01 Retirement/Replacement List View table | doc vs live drift |
| **Backend expectation** | Live `roles.permissions` in the clone, evaluated against each route's guard with the backend's own `hasEffectivePermission()`, which applies the `*_VIEW←*_READ` and `*←*_MANAGE` fallbacks. The guard comes from `docs/production-readiness/03_API_ENDPOINT_INVENTORY.md`; flagged rows were checked against the source | code defects |
| **Frontend expectation** | `useCan()`, which tests `node.gate.some(p => perms.includes(p))` with **no** fallbacks (`apps/web/src/hooks/use-can.ts`), over `PERMISSION_TREE` loaded from `packages/shared` *source* | frontend/backend disagreement |

**The live sweep** (`role-sweep.mts`) sends one request for each of the 429 inventory operations as each of the 6 roles, 2,574 requests in total. Responses are classified as follows:
- **GATE_DENY:** 403 `{error:FORBIDDEN, message:"Insufficient permissions"}` from `plugins/rbac.ts`.
- **PASS:** anything that can only come from code that runs after the gate: 404, 409, a business 400, 200, an in-handler 403 with a different code, or **401 REAUTH_REQUIRED**. The re-auth check runs inside the handler, after the rbac `preHandler`. No password was ever sent, so no failed attempt was recorded.
- **INCONCLUSIVE:** a 400 `VALIDATION_ERROR` from Fastify schema validation.

🔴 **Validation runs before the permission gate.** All 306 guards are `preHandler`s, and Fastify validates the request before any `preHandler` runs. Proof: OPERATOR `POST /api/users/ {}` returns **400** `body must have required property 'username'`, while `GET /api/users/` returns 403. A 400 therefore proves nothing in either direction. The heuristic "send an empty body and treat 400 as gate-passed" is wrong for this API.

To get past validation, `bodygen.mjs` builds a minimal schema-valid body from the live `/docs/json`, using a fresh random UUID for every id. A request that passes the gate then dies in the handler with a 404.

Mutation policy:
- A schema-valid body was sent only where it could not change data:
  - The role was expected to be refused.
  - The route's path id was a random UUID.
  - The role must re-authenticate, so a 401 is returned before any work.
  - The body names only random ids, such as the review/approve/bulk-operate routes.
- Otherwise the request was not sent for an allowed role. These are listed in §5.

The rows the first pass left INCONCLUSIVE were re-sent with schema-valid bodies by `retry-inconclusive.mts`, including DELETEs that require `_changeReason`.

Static checks:
- `grant-contains-gate.mjs` checks the CLAUDE.md rule "a node's grant set must never contain another node's gate".
- `unlock-map.mts` lists, for each write route, which single toggle unlocks it under backend semantics.
- `fe-be-gates.mts` lists routes whose backend gate is broader than the button's `useCan` gate, with the live roles affected.
- `effective-vs-toggles.mts` lists writes a live role can perform without the owning toggle being ON.

## 2. Headline results

| Check | Result |
|---|---|
| Requests sent / classified | 2,574 rows. 2,389 conclusive OK, 0 LEAK, 0 REFUSED_BUT_GRANTED; 163 skipped (60 public, 54 session/auth/self-service, 49 allowed-role writes with no safe stop); 22 inconclusive after retry |
| The 22 inconclusive | 6 resolved by hand: `POST /api/report-reviews/` returns 403 for all 6 roles (`report-review-probe.txt`). The remaining 16 are outbound-call routes that were deliberately not sent a valid body (`notification-settings/send`, `sms/test`, `equipment-groups/test-url`, `fetch-readings`) |
| 5 rows lost to an over-broad skip regex | `GET /api/admin-requests/` was re-run by hand: ADMIN 200, the other 5 roles 403, as expected (`admin-requests-get.txt`) |
| **Backend versus live DB permissions** | **0 disagreements.** Every conclusive answer matches what `hasEffectivePermission(live perms, route gate)` predicts. The inventory gate column also matched live behaviour on every conclusive row |
| Target doc versus live behaviour | **54 privilege×role cells allowed although the doc denies them. 0 probed cells refused that the doc grants** (9 doc-granted cells were not probed; see §5). Each of the 54 evidence routes was re-evaluated against the doc-baseline permissions (`after-2026-09-04.json` plus the documented amendments, `drift-evidence-check.mts`): **22 are new**, opened only by the 2026-10-08 role edits (19 **D+** with the toggle ON, 3 **X+** with it OFF). The other **32 were already reachable at the doc baseline** through broader backend gates (**D=** / **X=**: P4-02, P4-04, P4-06) |
| Grant sets that contain another node's write gate | 3 classes: P4-03, P4-04 and P4-05 (P4-05 is the known `filters.replace`). The static check found 58 grant-contains-gate hits; the other 54 are same-page or read dependencies (`X.create` grants `X_READ`, filter toggles grant `ASSET_READ`), all listed in `grant-contains-gate.json` |

## 3. Matrix (role × configurable privilege, observed live)

Each cell is the live API result on the route(s) that enforce that privilege's gate. Export privileges use `POST /api/audit/report-export-log`; see P4-02.
Key:
- `Y`: allowed, and the doc agrees.
- `-`: refused, and the doc agrees.
- **D+**: allowed, the doc denies it, the live toggle is ON (P4-01), and the doc-baseline permissions would have been refused, so the 2026-10-08 edit opened it.
- **D=**: as D+, but the evidence route was already reachable with the doc-baseline permissions. Turning the toggle ON added nothing the API did not already allow.
- **X+**: allowed, the doc denies it, and the toggle is OFF. The cell is reachable only because of the 2026-10-08 edit, through another toggle's permission.
- **X=**: allowed, the doc denies it, and the toggle is OFF. Already reachable at the doc baseline through a broader backend gate (P4-02, P4-04, P4-06).
- **d**: the doc denies it and the toggle is ON, but the route was not sent (allowed-role write with no safe stop).
- `-?` / `y?`: no backend route, or not probed; the config matches the doc.

Per-cell evidence (request, status, the reason the cell is flagged) is in `QA/results/phase4/matrix.json`.

| Privilege | ADMIN | SUPERVISOR | MANAGER | QA | SHIFTOFFICER | OPERATOR |
|---|---|---|---|---|---|---|
| `dashboard.view` | Y | Y | Y | Y | Y | Y |
| `dashboard.create` | - | - | - | - | - | - |
| `dashboard.manage` | - | - | - | - | - | - |
| `dashboard.assign` | - | - | - | - | - | - |
| `users.view` | Y | - | - | - | - | - |
| `users.create` | Y | - | - | - | - | - |
| `users.edit` | Y | - | - | - | - | - |
| `users.delete` | -? | -? | -? | -? | -? | -? |
| `users.enable_disable` | Y | - | - | - | - | - |
| `users.unlock` | Y | - | - | - | - | - |
| `users.reset_password` | Y | - | - | - | - | - |
| `admin_requests.approve` | Y | - | - | - | - | - |
| `admin_requests.reject` | Y | - | - | - | - | - |
| `config.view` | Y | - | - | - | - | - |
| `config.edit` | Y | - | - | - | - | - |
| `config.field_ids` | - | - | - | - | - | - |
| `roles.manage` | - | - | - | - | - | - |
| `backup.export` | Y | - | - | - | - | - |
| `backup.restore` | y? | - | - | - | - | - |
| `notifications.view` | y? | y? | y? | y? | y? | y? |
| `notifications.delete` | - | - | - | - | - | - |
| `audit.view` | Y | **D+** | Y | Y | **D+** | - |
| `audit.export` | **X=** | **X+** | Y | Y | **X+** | - |
| `audit.delete` | - | - | - | - | - | - |
| `debug.view` | - | - | - | - | - | - |
| `debug.manage` | - | - | - | - | - | - |
| `assets.view` | - | Y | Y | Y | Y | Y |
| `filters.bulk_upload` | - | Y | - | - | Y | - |
| `filters.retire` | - | Y | Y | - | Y | - |
| `filters.review` | - | - | Y | - | - | - |
| `filters.approve` | - | - | - | Y | - | - |
| `filters.replace` | - | - | - | - | **D+** | Y |
| `filters.status_update` | - | **D+** | - | - | - | - |
| `filters.hierarchy_create` | - | **D+** | - | - | **d** | - |
| `filters.create` | - | **D+** | - | - | **D=** | - |
| `filters.edit` | - | - | - | - | **D+** | - |
| `filters.delete` | - | - | - | - | - | - |
| `filters.hierarchy_edit` | - | - | - | - | **D+** | - |
| `filters.hierarchy_delete` | - | - | - | - | - | - |
| `filters.rfid_manage` | - | Y | - | - | Y | Y |
| `filters.export` | - | **D=** | **X=** | **X=** | **D=** | **X=** |
| `retirement.view` | - | Y | Y | **X=** | Y | **D=** |
| `retirement_list.export` | - | **X=** | **X=** | **X=** | **D=** | **X=** |
| `replacement.view` | - | Y | Y | Y | Y | Y |
| `replacement_list.export` | - | **X=** | **X=** | **X=** | **D=** | **X=** |
| `replacement_schedule.view` | - | Y | Y | Y | Y | Y |
| `replacement_schedule.upload` | - | Y | - | - | Y | - |
| `replacement_schedule.review` | - | - | Y | - | - | - |
| `replacement_schedule.approve` | - | - | - | Y | - | - |
| `filters.operate` | - | Y | - | - | Y | Y |
| `filters.bypass` | - | Y | - | - | Y | Y |
| `filters.events` | - | **D+** | - | **D+** | - | **D+** |
| `cycles.view` | - | Y | Y | Y | Y | Y |
| `cleaning_record.export` | - | Y | Y | Y | Y | **D=** |
| `lifecycle.export` | - | Y | Y | Y | Y | **D=** |
| `checklists.create` | - | **D+** | - | - | - | - |
| `checklists.edit` | - | **D+** | - | - | - | - |
| `checklists.delete` | - | - | - | - | - | - |
| `cleaning_profiles.view` | - | **D+** | - | - | - | - |
| `cleaning_profiles.create` | - | **d** | - | - | - | - |
| `cleaning_profiles.edit` | - | **D+** | - | - | - | - |
| `cleaning_profiles.delete` | - | - | - | - | - | - |
| `filter_profiles.view` | - | **D+** | - | - | - | - |
| `filter_profiles.create` | - | **D+** | - | - | - | - |
| `filter_profiles.edit` | - | **D+** | - | - | - | - |
| `filter_profiles.delete` | - | - | - | - | - | - |
| `filter_profiles.assign` | - | - | - | - | - | - |
| `equipment_groups.view` | - | Y | Y | **D=** | Y | **X=** |
| `equipment_groups.create` | - | Y | y? | - | y? | - |
| `equipment_groups.edit` | - | Y | Y | - | Y | - |
| `equipment_groups.delete` | - | - | - | - | - | - |
| `pm.view` | - | Y | Y | Y | Y | Y |
| `pm.create` | - | **D=** | - | - | **d** | - |
| `pm.edit` | - | - | - | - | **D+** | - |
| `pm.delete` | -? | -? | -? | -? | -? | -? |
| `pm.execute` | - | Y | - | - | Y | Y |
| `pm.approve` | - | - | - | Y | - | - |
| `pm.review` | - | - | Y | - | - | - |
| `pm.download_template` | - | Y | **X=** | **X=** | Y | **X=** |
| `pm.upload` | - | Y | - | - | Y | - |
| `pm.edit_entry` | - | - | - | - | **X+** | - |
| `pm.resubmit` | - | Y | - | - | Y | - |
| `block_change.request` | - | - | - | - | - | - |
| `block_change.approve` | - | - | - | - | - | - |
| `stage_approvals.view` | - | - | - | - | Y | - |
| `stage_approvals.decide` | - | - | - | - | Y | - |
| `version_history.view` | - | **X=** | **X=** | **X=** | **X=** | **X=** |

## 4. Defects

Severity follows the brief. HIGH means a role is allowed something the target matrix denies. MEDIUM means a role is refused something the matrix grants, or the frontend and backend gates disagree. Where the cause is configuration and not code, the defect says so.

### P4-01 — HIGH (config drift, not code): 32 toggles ON that the target doc denies. The 2026-10-08 role edits were never recorded in the doc, but they ship in the installer

**What.** Four `CONFIG_CHANGED role_config` audit rows were written by `superadmin` on 2026-10-08 between 10:33 and 10:42 IST. They turned ON 32 toggles that `target-matrix.json` leaves OFF.
- `ROLE-PRIVILEGES-DOC-ALIGNMENT.md`, `target-matrix.json`, CHANGELOG and the 10-08 session notes record none of it.
- 🔴 **`apps/api/prisma/install-baseline.json` carries exactly this live state.** It was generated 2026-10-14 by `export-install-baseline.ts`, first committed in `c1d4d1b` (FMS-Setup 1.2.0, "approved starting setup") and present in 1.2.2. A diff of its `roles` and `roleConfigs` against the clone shows 0 differences in toggles and permissions for all six roles.
- Every fresh install therefore ships these grants as the "approved setup".
- **One of the two documents is wrong, and the operator must say which:**
  - the target doc / `Role privileges.docx` alignment, or
  - the shipped installer baseline. The rows are in `QA/results/phase4/role-config-changes.json`. Each edit only added toggles; nothing was turned off and no sidebar item changed. `roles.updated_at` and `role_configs.updated_at` carry the same timestamps.

| Role (audit row time) | Toggles turned ON |
|---|---|
| SUPERVISOR (10:33:42) | `pm.create, audit.view, filters.create, filters.events, filters.export, checklists.create, checklists.edit, cleaning_profiles.view/create/edit, filter_profiles.view/create/edit, filters.status_update, filters.hierarchy_create` (15) |
| QA (10:35:17) | `filters.events, equipment_groups.view` (2) |
| SHIFTOFFICER (10:41:42) | `pm.create, pm.edit, audit.view, filters.create, filters.edit, filters.hierarchy_create, filters.hierarchy_edit, filters.replace, filters.export, retirement_list.export, replacement_list.export` (11) |
| OPERATOR (10:42:49) | `filters.events, retirement.view, lifecycle.export, cleaning_record.export` (4) |

**Live proof.** All 32 toggles were checked.
- **19** were confirmed live as capabilities the doc-baseline permissions would have refused (matrix cells **D+**).
- **10** are allowed live, but were already reachable at baseline through a broader gate (**D=**), so the toggle changed nothing on the API side:
  - OPERATOR `cleaning_record.export`, `lifecycle.export`, `retirement.view`
  - QA `equipment_groups.view`
  - SHIFTOFFICER `filters.create` and its 2 list exports + `filters.export`
  - SUPERVISOR `filters.export`, `pm.create`
- **3** were not sent (see below).
- In addition, SUPERVISOR and SHIFTOFFICER `audit.export` and SHIFTOFFICER `pm.edit_entry` were opened indirectly (**X+**).

Examples of **D+**:
- SUPERVISOR `GET /api/audit/` returns 200.
- SHIFTOFFICER `POST /api/filters/{rand}/replace` returns 404 NOT_FOUND, which is past the `FILTER_REPLACE` gate.
- SUPERVISOR `PUT /api/checklist-profiles/{rand}` returns 401 REAUTH_REQUIRED.
- OPERATOR `GET /api/filters/events` returns 200.
- SUPERVISOR `PATCH /api/assets/instances/{rand}/lifecycle-state` returns 401 REAUTH_REQUIRED.

The remaining 3 were not sent, because they were allowed-role creates with no safe stop: SHIFTOFFICER `filters.hierarchy_create` and `pm.create`, and SUPERVISOR `cleaning_profiles.create`.

The live permission arrays carry the matching extra permissions, compared with `after-2026-09-04.json`:
- SUPERVISOR: +18
- SHIFTOFFICER: +12
- OPERATOR: +5
- QA: +4
- MANAGER: +3, all explained (FILTER_REVIEW and the two list-View permissions)

**Notable against the doc:**
- SHIFTOFFICER and SUPERVISOR can read the Audit Trail. Doc row 32 lists neither.
- SHIFTOFFICER can create and edit filters and the hierarchy, and replace filters.
- OPERATOR holds `RETIREMENT_LIST_VIEW`. The 2026-10-01 table in `ROLE-PRIVILEGES-DOC-ALIGNMENT.md` says "OPERATOR | Retirement List: no".
- SUPERVISOR and SHIFTOFFICER now hold `AUDIT_READ`, but their sidebar still has no `audit` item. The API grants the page while the menu hides it. This is an inconsistency, not tested in a browser.

**Why HIGH but not a code bug.** The backend enforced exactly what the role rows say. Shipping the state in the installer suggests it was the operator's intent on 2026-10-14. Even so, none of the four audit rows carries a reason (see P4-10), and the doc the brief names as the oracle was never updated. The operator must either update the doc and `target-matrix.json`, or revert the toggles and re-export the install baseline. Not fixed (read-only brief).

**Assumption:** `digilog_qa_perf` is a clone of `digilog_db`, so the dev database very likely has the same drift. This was not verified, because `digilog_db` is out of bounds.

### P4-02 — MEDIUM (frontend/backend gate disagreement): export permissions are UI-only; the API checks read permissions

**What.** Every PDF/Excel export is generated in the browser. The only server step is `POST /api/audit/report-export-log`, and it gates on **read** permissions:
- `REPORT_READ_GATES` at `apps/api/src/modules/audit/routes.ts:30-43`
- the check at `:512-517`

It never checks `AUDIT_EXPORT`, `FILTER_LIST_EXPORT`, `RETIREMENT_LIST_EXPORT`, `REPLACEMENT_LIST_EXPORT` or `REPORT_EXPORT`/`REPORT_GENERATE`. Those are the gates of the export buttons (`packages/shared/src/types/permission-tree.ts:255, 449, 472, 509`). The tree marks these nodes `enforce:'c'` (cosmetic). This contradicts doc rule 2, and specifically doc row 33: "Admin views but does not export".

**Live proof** (`export-gate-probe.txt`). Each request was `{reportType, format:'PDF', recordCount:0, search:'QA-PHASE4-PROBE'}`. Each 200 below is a role whose button is hidden (`useCan` false) and whose doc row denies the export:
- Audit Trail: ADMIN, SUPERVISOR, SHIFTOFFICER
- Filters: MANAGER, QA, OPERATOR
- Retirement List: SUPERVISOR, MANAGER, QA, OPERATOR
- Replacement List: SUPERVISOR, MANAGER, QA, OPERATOR

That is 14 cells (**X+** in the matrix). OPERATOR is denied the Audit Trail export (403) because it has no `AUDIT_READ`.

**Impact.** A user can only "export" rows they can already read through `GET`, so no data leaks. What the toggle does not control is the ability to produce and sign the export record, and the doc's export restrictions are therefore not enforced server-side.

Also: Deviations, RFID Track Record, PM Schedule, Replacement Schedule and Quality Notifications exports have **no configurable toggle at all**. "Quality Notifications" is allowed for every role, including ADMIN, because its gate list is empty (`audit/routes.ts:38`).

🔴 **The backend contradicts itself here.** OPERATOR `GET /api/pm-schedules/qnn` returns **403** "Not allowed to view Quality Notifications." (in-handler check, `role-sweep-latest.json`). The same OPERATOR's `POST /api/audit/report-export-log {reportType:'Quality Notifications'}` returns **200**, and a `REPORT_GENERATED` audit row is written. The server signs an export record for a report it refuses to show that role.

### P4-03 — MEDIUM (grant set contains another node's gate, latent): Checklists and Cleaning Profiles unlock each other's writes

**What.** The backend accepts the shared `FCP_*` permissions on both pages:
- `apps/api/src/modules/checklist-profiles/routes.ts:32,61`: `any(FCP_CREATE, CHECKLIST_CREATE)`
- `checklist-profiles/routes.ts:42,71,89`: `any(FCP_UPDATE, CHECKLIST_EDIT)`
- `checklist-profiles/routes.ts:51,80`: `any(FCP_DELETE, CHECKLIST_DELETE)`
- `apps/api/src/modules/cleaning-profiles/routes.ts:99`: `any(FCP_CREATE, CP_PAGE_CREATE)`
- `cleaning-profiles/routes.ts:160,227`: `any(FCP_UPDATE, CP_PAGE_EDIT)`
- `cleaning-profiles/routes.ts:252`: `any(FCP_DELETE, CP_PAGE_DELETE)`

Each page's toggle grants the shared permission (`permission-tree.ts:626-670`):
- `checklists.create` grants `FCP_CREATE`; `cleaning_profiles.create` grants `FCP_CREATE`
- `checklists.edit` grants `FCP_UPDATE`; `cleaning_profiles.edit` grants `FCP_UPDATE`
- the same holds for delete

So "Edit Cleaning Profiles" alone lets a role edit, reorder and change questions on **checklist** profiles through the API, and the reverse is also true (`unlock-map.json`). `useCan('checklists.create')` checks only `CHECKLIST_CREATE`, so the button stays hidden while the API allows the write.

**Live status:** latent. No live role holds one page's toggle without the other's: SUPERVISOR holds both, and nobody else holds either. It was not proven by request, because that would need a new role or a role edit in the shared clone. The proof is static: the guard lines above plus the shared `hasEffectivePermission`.

**Repro (when a role holds only `cleaning_profiles.edit`):** `PUT /api/checklist-profiles/<id>` returns 200, not 403.

### P4-04 — MEDIUM (live frontend/backend disagreement and cross-grant): PM entry edit, upload and resubmit accept the broader PM permissions

**What:**
- `PUT /api/pm-schedules/entries/:id/edit` accepts `any(PM_UPDATE, PM_EDIT_ENTRY)` (`apps/api/src/modules/pm-schedules/routes.ts:494`). `useCan('pm.edit_entry')` checks only `PM_EDIT_ENTRY` (`permission-tree.ts:770`).
- `upload` (`routes.ts:203`, `any(PM_CREATE, PM_UPLOAD)`) and `resubmit` (`:466`, `any(PM_CREATE, PM_RESUBMIT)`) behave the same way.
- The reverse direction is the grant-set rule:
  - `pm.upload` and `pm.resubmit` grant `PM_CREATE` (`permission-tree.ts:766, 774`), which is the gate of `pm.create` (`POST /api/pm-schedules/`, `routes.ts:661`).
  - `pm.edit_entry` grants `PM_UPDATE` (`permission-tree.ts:770`), which is the gate of `pm.edit`: `PUT /api/pm-schedules/:id` at `routes.ts:697`, `ahu-configs` at `:303`, and `deviations/sweep` at `:548`.

**Live proof:** SHIFTOFFICER has `pm.edit` ON (from P4-01) and `pm.edit_entry` **OFF**. `PUT /api/pm-schedules/entries/{random}/edit` with `{plannedDate}` returns **404 NOT_FOUND**, past the gate. The same request as SUPERVISOR returns 403. The PM page hides "Edit entry" from SHIFTOFFICER, but the API performs it (subject to the EDIT_PM_SCHEDULE reauth and the `uploadRole` workflow checks).

The upload/resubmit-to-create direction is latent: every live role with `pm.upload` also has `pm.create`. It was not latent at the doc baseline. `after-2026-09-04.json` shows SUPERVISOR **and** SHIFTOFFICER with `pm.upload` and `pm.resubmit` ON, `pm.create` OFF, and `PM_CREATE` in their permission arrays. The doc-aligned configuration therefore let both roles call `POST /api/pm-schedules/` (gate `PM_CREATE`) although the doc gives neither of them "Create PM Schedules".

### P4-05 — LOW (known, open): `filters.replace` grants `FILTER_OPERATE`

`permission-tree.ts:407` (the open item in `ROLE-PRIVILEGES-DOC-ALIGNMENT.md` "Not applied"). This toggle unlocks start-cycle, advance, submit-checklist, bulk-operate and `equipment-groups/fetch-readings` (`unlock-map.json`). It is still latent: both holders, OPERATOR and now SHIFTOFFICER, already hold `FILTER_OPERATE` from `filters.operate`.

### P4-06 — LOW: page toggles that hide the page but not the data (inert toggles)

These checks were live; each request was made with the toggle OFF:
- **`version_history.view`:** no role holds `VERSION_HISTORY_VIEW`, yet every version endpoint also accepts the page's read permission. Examples: `GET /api/equipment-groups/{id}/versions` returns 404 (past the gate) for 5 roles through `ASSET_READ` (`equipment-groups/routes.ts:32,52`), and the checklist, cleaning-profile and filter-profile versions return 200/404 for SUPERVISOR. The toggle controls nothing on the API side.
- **`pm.download_template`:** `GET /api/pm-schedules/template.csv` accepts `PM_READ` (`pm-schedules/routes.ts:188`). MANAGER, QA and OPERATOR get 200 with the toggle off.
- **`equipment_groups.view` for OPERATOR:** the doc removed it (the 09-04 delta lists EG_VIEW and the menu as lost). Its tree gate contains `ASSET_READ` (`permission-tree.ts:707`), so `useCan` is still **true** for OPERATOR, and `GET /api/equipment-groups/` returns 200.
- **`retirement.view` for QA:** `GET /api/filters/retirements` returns 200 through `ASSET_READ` (`filter-operations/routes.ts:770`). CLAUDE.md documents this as intentional ("the toggle hides the PAGE, it does not seal the data"), so it is listed for completeness only.

### P4-07 — LOW (informational): the report-review workflow cannot be granted

No configurable toggle grants `REPORT_REVIEW_SUBMIT`, `REPORT_REVIEW` or `REPORT_APPROVE`. Their nodes (`report_reviews.*`) are enforced-only, and `unlock-map.json` shows no unlocking toggle. `POST /api/report-reviews/` returns 403 for all 6 roles (`report-review-probe.txt`). The workflow CLAUDE.md says "survives" is usable by SUPER_ADMIN only.

### P4-08 — LOW (config drift, inert): `tablet-access` grants `stage_approvals` to OPERATOR and SUPERVISOR

The doc says "tablet already matches… QA `[]`… SHIFTOFFICER (+stage_approvals)". The live `system_config['tablet-access']` also gives `stage_approvals` to OPERATOR and SUPERVISOR, and keeps a stale `MAINTENANCE` key. This is inert: `canUseStageApprovals` (`apps/web/src/routes/mobile/use-tablet-access.ts:53-61`) also requires `STAGE_APPROVAL_VIEW` or `DECIDE`, which neither role holds.

Note, however, that `GET /api/stage-approvals/` accepts `FILTER_OPERATE` (`stage-approvals/routes.ts:23`), so OPERATOR and SUPERVISOR can read the full approvals list through the API (200). `/queue` and the per-id routes return 403 for them.

### P4-09 — LOW (not RBAC; found by the sweep)

- A JSON body posted to the multipart routes `POST /api/backup/validate` (ADMIN) and `POST /api/replacement-schedules/validate` (SUPERVISOR, SHIFTOFFICER) returns **406 `INTERNAL_ERROR` "Internal server error"**. This is a client error mislabelled as a server error.
- `PUT /api/hierarchy/filters/{unknown}` returns **400 `VALIDATION_ERROR` "Filter not found"** where a 404 is expected.
- Some routes' response schemas strip the error body:
  - `PUT /api/config/field-ids/:fieldId` and `POST /api/config/user-id/validate` answer a schema failure with `{"error":"VALIDATION_ERROR"}` and no message.
  - `DELETE /api/roles/:name` answers a 403 with `{"error":"FORBIDDEN"}` and no message.

  The client cannot tell why the request was refused.

### P4-10 — LOW (§11 observation): role-privilege changes carry no reason

`PUT /api/config/roles/:role` (`config/static-routes/roles.routes.ts:89-100`) takes no reason field, so the four 2026-10-08 privilege grants in P4-01 sit in the audit trail with `reason = NULL`. A signed re-auth row exists only where `UPDATE_ROLE_CONFIG` re-auth is configured for the editor's role. Nobody can now say why SHIFTOFFICER was given filter create/edit/replace. This finding asks whether the operator wants a mandatory reason, as Filter Data Management already requires one.

## 5. Not checked, or only partly checked

**Allowed-role writes not sent (49 role×route rows).** These are id-less creates or config writes where a schema-valid body would have changed the shared clone. The gate for these rows is proven only in the deny direction, by the 403s of the roles without the permission, and by the shared rbac function. Examples:
- `POST /api/users/`, `/roles/`, `/dashboards/`, `/pm-schedules/`, `/replacement-schedules/`, `/equipment-groups/`, `/filter-cleaning-profiles/`
- `PUT /api/config/pagination|export-limit|backup-format`
- `ldap/config`, `notification-settings/*`
- `POST /api/assets/instances` (SHIFTOFFICER)
- `POST /api/pm-executions/`

**Outbound or destructive routes not sent with a valid body:**
- `backup/restore`
- `notification-settings/send`, `email/test`, `sms/test`
- `ldap/test-connection`
- `equipment-groups/test-url`, `equipment-groups/fetch-readings`
- `users/password-expiry-sweep`, `pm-schedules/deviations/sweep`

For the roles expected to be refused, 16 of these rows stayed INCONCLUSIVE. Code inspection: each is a plain `requirePermission`/`requireAnyPermission` preHandler.

**Doc-granted cells not probed (9), so the "0 refused" headline does not cover them:**
- ADMIN `backup.restore`: destructive.
- MANAGER and SHIFTOFFICER `equipment_groups.create`: id-less create.
- `notifications.view` for all 6 roles: no backend route checks `NOTIFICATION_VIEW`.

**Other limits:**
- **Auth/session routes** (`login`, `logout`, `refresh`, `verify`, `change-password`, `offline-grant`, `profile`, `uploads/photo`) were excluded, because they would end sessions or record failed attempts.
- **In-handler second gates** were exercised only incidentally: `assertPmRole` (`FORBIDDEN_ROLE`), self-approval and the per-report export map. No check used real records, so the workflow-role refusals with real entries are not covered here.
- **P4-03 and the PM upload-to-create direction of P4-04** were not live-proven. That would require creating a role or editing a role in the shared clone.
- **The UI was not driven in a browser.** Frontend expectations were computed from `useCan` and `PERMISSION_TREE`, not observed on rendered pages, so sidebar visibility per role was not exercised.
- **SUPER_ADMIN** was excluded by brief.
- **`digilog_db`** was not compared (out of bounds).

## 6. Side effects on the clone

Accepted, disposable DB:
- **61 `REPORT_GENERATED` audit rows** from the export probe. They can be found with `after_value->>'search' = 'QA-PHASE4-PROBE'` and `recordCount 0`. No EXPORT_* action requires re-auth in the clone, so a passing export probe writes its row.
- **6 `LOGIN_SUCCESS` rows and sessions** for the six accounts above.
- **No other write reached a handler that persists.** Every 2xx write was a read-only compute or validate route, or `bulk-operate` with random filter ids, which failed per item and wrote no audit row.

## 7. Files

**Scripts** (`QA/tests/phase4/`):
- `role-sweep.mts`: the 2,574-request sweep
- `retry-inconclusive.mts`
- `bodygen.mjs`: schema-valid body builder
- `inventory.mjs`
- `accounts.mjs`
- `export-gate-probe.mts`
- `report-review-probe.mjs`
- `admin-requests-get.mjs`
- `dump-tree.mts`
- `grant-contains-gate.mjs`
- `unlock-map.mts`
- `fe-be-gates.mts`
- `effective-vs-toggles.mts`
- `matrix.mts`
- `matrix-md.mjs`

**Evidence** (`QA/results/phase4/`):
- `role-sweep-latest.json`: every row, with url, body type, status, error, observed and verdict, and the retry where one was made
- `matrix.json`
- `export-gate-probe.json`
- `role-config-changes.json`
- `live-roles.json`
- `tree.json`
- `grant-contains-gate.json`
- `unlock-map.json`
- `fe-be-gates.json`
- `openapi.json`

**Re-run:** `MSYS_NO_PATHCONV=1 npx tsx QA/tests/phase4/role-sweep.mts`, then `retry-inconclusive.mts`, `export-gate-probe.mts`, `matrix.mts`, `drift-evidence-check.mts` and `matrix-md.mjs`, in that order. `drift-evidence-check.mts` adds `passedAtBaseline` to `matrix.json`.
