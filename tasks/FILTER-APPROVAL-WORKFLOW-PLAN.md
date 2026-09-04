# Filter create / bulk-upload → review → approve workflow (2026-09-04)

Operator request: filter creation and bulk upload should follow the same
upload → review → approve concept as PM Schedules, with a per-step role
configuration.

This is the feature behind rows 13 ("Filters Review" → Manager) and 14 ("Filter
Approve" → QA) of `Role privileges.docx`, which
[`ROLE-PRIVILEGES-DOC-ALIGNMENT.md`](ROLE-PRIVILEGES-DOC-ALIGNMENT.md) recorded
as not implementable at the time.

## Decisions taken with the operator

1. **A pending filter EXISTS but is NOT OPERABLE.** Created immediately, visible
   in the Filters list with a status badge, but no cleaning cycles and hidden
   from Filter Operations / scan / PM scope / replacement scope until APPROVED.
   Mirrors a PM entry generating no tasks until approved.
2. **Scope: bulk upload + single create.** NOT edit, NOT delete/retire.
3. **Reject marks REJECTED and the uploader can resubmit** — nothing is
   destroyed, and the rejection reason + attribution survive.
4. **`workflowEnabled` defaults FALSE.** Filter creation behaves exactly as it
   does today until an admin turns it on.

## Why the status goes on `AssetInstance`, not a staging table

The PM/Replacement pattern keeps the record in its own table with an
`approvalStatus` column, and the operator asked for "the same concept". A
staging table would duplicate every filter field and defer parent/RFID wiring.

🔴 **`AssetInstance` also holds Blocks, Areas and AHUs.** The new column
therefore defaults to `APPROVED`, so every existing row and every non-filter
asset is unaffected and stays usable. Only the two filter-creation paths ever
write a non-APPROVED value, and only when the workflow is enabled.

5. **UI: actions on the existing Filters page**, not a dedicated review screen —
   status badge + status filter + Review / Approve / Reject on the rows, shown
   only to the configured role.
6. **Approve/reject take an ARRAY of filter ids**, mirroring PM's
   `reviewEntries` / `approveEntries`. No batch entity: a 200-row upload is
   cleared by selecting rows, and "these 198 are fine, those 2 are wrong" works.

## Findings that fixed the design

- **Reuse `PmEntryApprovalStatus`; do NOT add a new enum.** It has **zero**
  TypeScript consumers (nothing switches on it), and `ReplacementEntry` already
  reuses it with a different default — the house precedent for exactly this.
  A new enum would cost a drift-guard entry and a doc count for no benefit. The
  PM-specific name is a comment problem, not a schema problem.
- 🔴 **The gate does NOT belong in `getFilter()`.** It looks like the shared
  loader, but 6 of its 9 callers are READS that must keep working (event/cycle
  list scoping, `getCycleById`'s ownership check). Throwing there would break
  reading a pending filter's own record. The real write seam is
  **`loadLocalContext()`** — used by advance / bypass / advance-with-checklist /
  submit-checklist — plus **`start-cycle.ts`**, which loads via `getFilter`
  directly. `ahu-completion-gate.ts` also calls `loadLocalContext`, and must
  EXCLUDE pending filters from readiness rather than throw.
- **`resubmitEntry` accepts corrected values** and clears every review/approve/
  reject field before setting `PENDING_REVIEW`. Filter resubmit must do the same
  — a rejection you can only resubmit unchanged is a dead end, and the row is
  reused so the name stays taken (see Open, now closed).

## The gate is the real work

Adding the column is easy; making "not operable" true is not. A pending filter
must be refused by every path that starts or advances work. Each has to be found
and covered, or the workflow is decorative:

THROW (write paths) — all verified live against a PENDING filter:
- [x] `loadLocalContext()` — covers advance / bypass / advance-with-checklist / submit-checklist
- [x] `start-cycle.ts` (loads via `getFilter`, not `loadLocalContext`)
- [ ] bulk-operate (inherits, but verify per-item failure reporting)
- [ ] 🔴 offline REPLAY — a filter pending at queue time and still pending at
      replay must fail as a reportable per-item rejection, not a silent drop

EXCLUDE from lists (must not throw):
- [ ] scan / RFID identifier lookup
- [ ] PM due-task + deviation scope
- [ ] replacement schedule scope
- [x] AHU completion readiness (`ahu-completion-gate.ts`)

## Tasks

- [x] F1 — `FilterApprovalStatus` enum + columns on `AssetInstance` (additive, default APPROVED)
- [x] F2 — `filter-approval` config def (workflowEnabled / uploadRole / reviewRole / approvalRole) + its 12 touchpoints
- [x] F3 — `filter-workflow.ts` helper (config read + role gate, reusing `assertPmRole`)
- [x] F4 — Write paths: single create + bulk upload stamp the status and assert uploadRole
- [x] F5 — review / approve / reject / resubmit endpoints
- [x] F6 — The operability gate (every path listed above)
- [x] F7 — Permissions: `FILTER_REVIEW` / `FILTER_APPROVE` + tree nodes, and grant them per `Role privileges.docx` (review → MANAGER, approve → QA)
- [x] F8 — status badge + Review / Approve / Reject buttons on the Filters page bulk bar
- [x] F9 — Tests, doc sync (counts change), CHANGELOG, memory

## Closed

- *Does a rejected filter block its name?* Yes, and that is correct — resubmit
  reuses the row. The uploader fixes the REJECTED row in place (resubmit carries
  corrected values); they must not re-upload a file with the same name and hit a
  duplicate-name error.

## Footprint to budget

F7 moves counts that were updated earlier today: permissions 102 → 104, feature
privileges 83 → 85. That touches CLAUDE.md System Stats, its RBAC section, the
frozen `legacy-maps-snapshot`, both count tests, `target-matrix.json` (+2 entries
whose notes should record that these finally implement doc rows 13/14), and a
re-run of the role apply + exact-match audit.

## Status at end of 2026-09-04

Backend COMPLETE and verified end-to-end against the live API:
create -> PENDING_REVIEW -> review -> PENDING_APPROVAL -> approve -> APPROVED -> operable;
reject -> REJECTED (distinct refusal message) -> resubmit -> PENDING_REVIEW with every
review/approve/reject field cleared. One audit row per FILTER per decision.

**The workflow is now ENABLED** (`workflowEnabled: true`, reviewRole MANAGER,
approvalRole QA, uploadRole blank = anyone with the create permission), at the
operator's request once the buttons landed.

F8 verified through the real UI: creating a filter lands it in PENDING_REVIEW
with its badge; selecting it shows `Review (1)` / `Approve (1)` / `Reject`;
Review moves it to PENDING_APPROVAL and the badge refreshes without a reload;
Approve clears it to APPROVED and the badge disappears. Two audit rows written.
Zero console errors.

### Per-row AHU in the bulk upload (same day, operator request)

The template now carries an `ahu` column with a dropdown of the selected
block's AHUs; each row lands in the AHU it names, then enters the workflow.

- `GET /instances/filter-upload-template.xlsx?blockId=` — **blockId REQUIRED**,
  400 without it; 400 `NO_AHUS` if the block has none.
- Dropdown is built **per download** (no cached template), so a new AHU shows
  up in the next download. Verified: 4 → create one → 5.
- Blank cell → dialog AHU (mirrors filterSet's dialog default). Preview shows
  the RESOLVED AHU; on an errored row it shows what was TYPED.
- Name match is case-insensitive and **scoped to the block**. Cross-block name
  → per-row error listing the valid names, never a silent fallback.
- `ParsedRow.ahu` is a required string (`''` when the column is absent) so the
  `.trim()` calls stay safe on old sheets.
- Locked by `filter-upload-template.service.test.ts` — note every column index
  there shifted by one, and `_lists` column order too, because `ahu` is the
  first dropdown.

### Still to do

- **Offline replay** (from the gate list) is NOT yet covered. A filter pending at
  queue time and still pending at replay currently fails through the generic
  per-item error path rather than a purpose-built reportable rejection.
- **Bulk upload role assertion runs per row** (each row calls
  getFilterWorkflowConfig -> one config read). Correct but wasteful at 200 rows;
  hoist it to the bulk entry point.
