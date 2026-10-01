# Align role permissions to `Role privileges.docx` (2026-09-04)

Source: `Role privileges.docx` — a 41-row Activity × Role matrix for
Admin / Supervisor / Manager / QA / Shift Officer / Operator, plus a
"Tab Operations" section for the tablet.

## Decisions taken with the operator (2026-09-04)

1. **The document is EXHAUSTIVE.** Anything not listed is REVOKED, not left alone.
2. **"Record/Report, View" INCLUDES the PDF/Excel export** on that page.
3. Rows 13 "Filters Review" + 14 "Filter Approve" are **skipped and flagged** —
   filter bulk upload creates records directly; there is no review/approve chain
   for it (unlike PM Schedule and Replacement List, which both have one).
   Building one is a feature, not a permission change.
4. Kept although the document does not list them: **Stage Approvals**
   (SHIFTOFFICER), **Filter Operations privileges** (`filters.operate` /
   `filters.bypass` — the tablet needs FILTER_OPERATE), **`notifications.mark`**.
   **NOT kept: `dashboard` + `home` sidebar items** — removed from every role.

## Findings that change the work

- [x] **Tablet already matches the document exactly.** `system_config['tablet-access']`
      grants login/filter_cleaning/filter_status/my_tasks/rfid_assign/logout to
      SUPERVISOR, SHIFTOFFICER (+stage_approvals) and OPERATOR; QA is `[]`;
      ADMIN and MANAGER have no entry, which the resolver treats as deny-all.
      **No change needed.**
- [x] `/` (Dashboard) has **no route guard**, so dropping the `dashboard`
      sidebar item hides the menu entry without dead-ending login.
- [x] 🔴 **`replacement_schedule.view` grants `REPLACEMENT_SCHEDULE_UPLOAD`.**
      Granting "Replacement List View" (Manager/QA/Operator per the doc) hands
      out the upload permission, whose gate is exactly that permission. Same bug
      class as the 2026-07-01 ASSET_* over-grant. Neutralised today only by
      `assertPmRole`'s separate workflow-role check.
- [x] 🔴 **`uploadRole` is a single-role `select`.** The document grants PM +
      Replacement upload to **Supervisor AND Shift Officer**; the config can
      hold one role. Shift Officer upload is unfulfillable without widening it.
      `multiselect` is already a supported setting type (3 defs use it).
- [x] **`filters.operate` does NOT grant `CYCLE_READ`.** Revoking `cycles.view`
      from OPERATOR (doc row 28) would 403 the tablet's Filter Cleaning Record
      tile, which is not tablet-access gated and always shows.

## Tasks

- [x] T1 — Two grant-set over-grants fixed (see below)
- [x] T2 — Widen `uploadRole` to many roles — **DONE 2026-09-04** (operator:
      "resolve shift officer thing"). `assertPmRole` accepts `string | string[]`
      (`normalizeRoles`, legacy single-role strings still work); the three
      `*-approval` defs declare `uploadRole` as `multiselect`; the Role
      Assignments Upload step renders role chips. Live config set through the
      audited dynamic PUT: PM + Replacement upload = `[SUPERVISOR, SHIFTOFFICER]`.
      Verified with a throwaway SHIFTOFFICER: both uploads now reach parsing
      (junk file rejected on content), OPERATOR still 403 by permission.
- [x] T3 — `tasks/role-privileges-baseline/target-matrix.json`
- [x] T4 — Applied via `PUT /api/config/roles/:role` (all 6 → 200)
- [x] T5 — Exact permission array set via `PUT /api/roles/:name`; the rebuild
      keeps unmapped perms, so ASSET_*/ENTITY_ASSIGN and the dead REPORT_*
      constants from the 2026-07-04 tear-out needed clearing explicitly
- [x] T6 — Verified three ways (see Verification)
- [x] T7 — Docs + CHANGELOG + memory

## T1 — two over-grants, both found by applying this document

1. **`replacement_schedule.view` granted `REPLACEMENT_SCHEDULE_UPLOAD`**, which
   is the gate of `replacement_schedule.upload` AND of
   `POST /api/replacement-schedules/upload`. Viewing granted writing. Masked,
   never prevented, by `assertPmRole`'s separate uploadRole check — see
   `pm-schedules/__tests__/upload-role.test.ts`, which records MANAGER / QA /
   OPERATOR all holding the permission live.
2. **`filters.retire` granted `FILTER_OPERATE`.** `POST /api/filters/:id/retire`
   gates on `FILTER_RETIRE` alone, but `FILTER_OPERATE` is the gate for
   start-cycle / advance / bypass. The document gives MANAGER Filter Retirement
   Activity (row 25) and NOT Cleaning Operations, yet MANAGER ended up able to
   run cleaning cycles through the API. `FILTER_OPERATE` is now held by exactly
   the three roles the document's Tab Operations grants it to.

Both are the class CLAUDE.md records at 2026-07-01 (ASSET_* over-grant): a
read/adjacent toggle whose grant set includes another node's *gate*.

## Verification

1. **Exact permission array** — every role's live `roles.permissions` matches
   the matrix exactly (0 extra, 0 missing).
2. **Every document row** resolved back through the tree gates: 0 mismatches.
3. **Live sessions** — one throwaway user per role (`9900xx`, deleted after;
   the 9 real accounts untouched), 8 endpoint checks, 0 mismatches. A permission
   change needs a fresh login, so each check logged in anew.

Before / after / delta: `tasks/role-privileges-baseline/`.

## Not applied

- Rows 13 + 14 (Filters Review / Filter Approve) — no such workflow exists.
- ~~SHIFTOFFICER upload — blocked by the single-role `uploadRole` (T2).~~ Resolved 2026-09-04, see T2.
- `filters.replace` also grants `FILTER_OPERATE`. Left alone: its only holder
  (OPERATOR) is granted `FILTER_OPERATE` anyway, so unlike `filters.retire` it
  changes no role's effective capability. Worth revisiting with T2.

## Deviations from the document, and why

| Doc row | Deviation | Reason |
|---|---|---|
| 13, 14 Filters Review / Approve | not applied | no such workflow exists |
| 19 Replacement List View — QA `-` | QA KEEPS the page | row 22 gives QA **Approve**; approving is impossible without reaching the list |
| 28 Cleaning Record — Operator `-` | desktop page hidden, `CYCLE_READ` KEPT | the tablet's Filter Cleaning Record needs it; the doc grants Operator tablet Cleaning Operations |

## 2026-10-01 — Retirement List / Replacement List View permissions

The two list pages no longer ride on "View Filters". Each has its own toggle
(`retirement.view` → `RETIREMENT_LIST_VIEW`, `replacement.view` →
`REPLACEMENT_LIST_VIEW`). The matrix did not change: migration
`20261001090000_list_view_permissions` gave the new permission to exactly the
roles that already saw each page.

| Role | Retirement List | Replacement List |
|---|---|---|
| ADMIN | no | no |
| SUPERVISOR | yes | yes |
| MANAGER | yes | yes |
| QA | no | yes |
| SHIFTOFFICER | yes | yes |
| OPERATOR | no | yes |

Before-snapshot: `role-privileges-baseline/before-2026-10-01.json`. To change a
row, use Config → Roles & Access → Permissions (the View toggle) together with
the Sidebar tab — enabling the menu on the Sidebar tab re-grants the View
permission on every save, so untick it there to take the page away.
