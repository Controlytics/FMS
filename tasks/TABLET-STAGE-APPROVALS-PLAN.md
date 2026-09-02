# Tablet — Stage Approvals tab (SHIFTOFFICER)

**Ask (operator, 2026-09-02):** add a *Stage Approvals* option to the tablet's
bottom nav so SHIFTOFFICER users approve / reject cleaning stage requests from
the tablet instead of having to reach a desktop.

## What already exists (verified against live code + DB, 2026-09-02)

| Thing | State |
|---|---|
| `/api/stage-approvals/{queue,/,:id/approve,:id/reject,bulk-decide}` | ✅ complete, unchanged since 2026-07-10 |
| Desktop page `apps/web/src/routes/stage-approvals/index.tsx` | ✅ 304 lines, the reference implementation |
| `SHIFTOFFICER` role | ✅ exists (no underscore), holds `STAGE_APPROVAL_VIEW` + `STAGE_APPROVAL_DECIDE` |
| `system_config['stage-interlock']` | ✅ `enabled:true`, wash-out **and** dry-out approver = `SHIFTOFFICER`, `requireDifferentApprover:true` |
| Tablet Approvals screen | ❌ deleted 2026-08-10 (`51b6068` + `9aae6af`) at operator request |
| `stage_approvals` tablet-access feature key | ❌ does not exist |

So this is a **frontend-only** feature plus one config toggle. No new
permission, no migration, no new endpoint.

## Decisions

1. **Wrapper only.** The bottom nav lives solely in `mobile-wrapper.tsx`
   (`view !== 'operations'` guard, ~line 3093). `mobile-operations.tsx` has its
   own home tiles but **no** bottom nav, and is only ever rendered by the wrapper
   with `hideHeader`. The 2026-08-10 "delete from both copies" trap applied to
   the *home tiles*, not the nav — re-verified rather than assumed.

2. **New tablet-access key `stage_approvals`, not the retired `approvals`.**
   The old key meant *block-change* approvals plus a read-only stage list. Reusing
   it would resurrect a name whose meaning changed. Added in **two** places
   (`routes/config/tablet-access.tsx` FEATURES **and** the hardcoded SUPER_ADMIN
   bypass array in `config/static-routes/tablet-access.routes.ts`) — missing the
   second is the documented easy-miss. Feature count 6 → 7.

3. **`selfRequested` is computed on the SERVER, not re-derived on the client.**
   `queue()` filters on `status:PENDING` + `approverRole` only — it does **not**
   exclude rows the reader themselves requested, and `approve()`/`reject()` then
   throw 403 `SELF_APPROVAL_FORBIDDEN`. So the un-fixed flow is: tap Approve →
   type your password → 403, with the signature already burned. The server knows
   both `requireDifferentApprover` and `ctx.userSub`, so it returns the verdict;
   the client only renders it. (Client-side re-derivation would need the
   interlock config, which SHIFTOFFICER cannot read — it has no `CONFIG_READ`.)
   Fixed on the **desktop page too** — same latent bug, one shared type.

4. **Single-item decide only.** `/bulk-decide` exists and works, but a tablet
   approver verifies one filter's frozen snapshot at a time; a bulk signature on
   a 5-inch queue is the wrong affordance. Revisit if the operator asks.

5. **Online-only, explicitly.** `tabletAccess`'s SWR key is
   `user && online ? … : null`, so **offline makes `tabletConfigured` false and
   `hasFeature()` returns true for everything** — the tab appears offline whether
   or not the role has it. Both the queue fetch and the reauth signature need the
   server, so the view renders an explicit offline panel. Worded as *offline*,
   never as *not permitted* — the `rfid_assign` tile already conflates those two
   and it misleads.

## Steps

- [x] 1. `stage-approvals/service.ts` — add `selfRequested` to `queue()` + `list()`
- [x] 2. `lib/stage-approval.ts` — `selfRequested` on `StageApprovalSummary`
- [x] 3. Desktop `routes/stage-approvals/index.tsx` — honour it (buttons + select-all)
- [x] 4. Tablet-access key `stage_approvals` (both places)
- [x] 5. `mobile-wrapper.tsx` — View union, `featureForView`, bottom-nav tab, the view
- [x] 6. Shared reauth plumbing: state-driven `actionLabel`, cancel unwind, back button
- [x] 7. Enable `stage_approvals` for SHIFTOFFICER via Config → Tablet Access (UI, not curl)
- [x] 8. Verify (partial — see below)
- [x] 9. Docs: CHANGELOG, FRONTEND_GUIDE, tasks/todo.md, memory

## Verification (2026-09-02)

Done:
- `npx tsc --noEmit` clean on **both** apps; `npx vite build` clean.
- 671/671 web tests (52 files); 14/14 `stage-approvals` API tests.
- `/api/config/tablet-access/my-features` as SUPER_ADMIN returns the 7 keys
  including `stage_approvals`.
- `GET /api/stage-approvals` carries `selfRequested` and does **not** leak
  `requestedBy`.
- Tab renders and both list tabs paint — as SUPER_ADMIN and as real shift
  officer **101014**; All shows 200 archive rows with correct filter / stage /
  block / requester / approver / status chip. No stage-approval console errors.
- `system_config['tablet-access']` now grants `stage_approvals` to
  `SHIFTOFFICER` only, written through the config UI (audited path).

**APK rebuilt 2026-09-02** — `DigiLog-FilterOps.apk` at the repo root
(9,905,597 bytes, 642 entries). Built from a **blank `VITE_API_URL`**, so a
fresh install still shows the Server Address screen and an existing install
keeps its stored address. Verified beyond `BUILD SUCCESSFUL`: valid zip with all
entries readable, manifest + dex present, all 87 JS chunks match
`apps/web/dist/assets` by name, the bundle contains `stage_approvals` /
`Stage Approvals` / `/api/stage-approvals`, the literal `✓` / `✕`
escapes are gone, and the only `192.168.*` strings are the Server Address
placeholder and its error-message example — no baked API base.

Found and fixed while verifying (not in the original scope):
- Decision errors were routed to the screen's shared error banner, which a
  `fixed inset-0` modal completely covers. Now rendered inside the dialog.
- **Three JSX-child unicode escapes rendering as raw text** — JSX does not
  interpret JS escapes in element children. Every tablet success toast read
  `✓ …`, the clear-queue button was labelled `✕`, and Filter
  Operations' recent-submissions rows showed `→ Wash Out`. Rewritten as
  HTML entities so the source stays ASCII. Confirmed absent from the built
  bundle. The `{'•'}` form elsewhere is a real JS string and was fine.

**NOT done — the approve/reject submit.** There are 0 PENDING rows
(367 APPROVED, 40 SUPERSEDED), and manufacturing one means advancing a live
filter from WASH_IN into WASH_OUT, which writes permanent audit rows. Operator
chose to exercise it themselves on the next real cleaning. The decide handler is
a near-verbatim copy of the proven desktop `submit()`, including its
"callback may run twice (pw=undefined → 401 → pw set)" idempotency — but it has
not been watched to fire.

## Known adjacent finding (not fixed here)

`SHIFTOFFICER` is granted the `filter_cleaning` **tablet** feature but holds no
`FILTER_OPERATE` **permission**, so the tablet shows it the scan-stations grid
and the backend then 403s the submit. Pre-existing, unrelated to this change,
flagged for the operator to decide: either drop the tablet feature or grant the
permission.
