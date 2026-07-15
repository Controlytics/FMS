# Atomic Advance + Checklist — Plan

**Date:** 2026-07-15
**Branch:** RFID
**Status:** PLANNED — not started
**Decision:** Global fix (all stages, online + offline). Not a regression — design change.

## Step 1 — VERIFIED 2026-07-15 (defect REPRODUCED)

Reproduction test (passes against `digilog_test_db`, asserts CURRENT buggy behaviour):
`apps/api/src/modules/filter-operations/__tests__/terminal-checklist-advance-persistence.test.ts`
— 7/7 green, re-run independently. Profile `START→S1→S2→CHECKLIST(active)→END`;
advance to terminal S2, no checklist submitted. Direct Prisma assertions on the DB:

| | Observed | |
|---|---|---|
| (a) | `filter_events` STATE_TRANSITION → S2, checksummed | **BUGGY** — persisted |
| (b) | `FilterDetails.currentLifecycleState = 'S2'` | **BUGGY** — filter moved |
| (c) | 0 × `CHECKLIST_COMPLETED` for the cycle | CORRECT — never answered |
| (d) | `audit_trail` STATE_TRANSITION row, hash-chained | **BUGGY** — §11 record written |
| (e) | cycle `IN_PROGRESS`, `completed_at` NULL | CORRECT — completion deferred |

Submitting the checklist afterwards → `COMPLETED` + `CYCLE_COMPLETED`. Confirms the
re-scan path users described. **When the fix lands, (a)(b)(d) must flip to expect zero
persisted rows; (c)(e) + the completion test must keep passing unchanged.**

### Live-data archaeology — NO real-world instances found
Searched `digilog_db` for cycles parked at a terminal stage with no checklist. Exactly one
candidate (`CC-G1/AHU/SA/22-004-20260620-M`) — **false positive**: the `-M` suffix comes from
`manual-cycle.ts:91` (manual back-dated path, not the tablet advance), and its pinned profile
(FD v8, ARCHIVED) has `STORAGE_OUT → END` with **no** terminal checklist. So the field impact
is so far **theoretical** — real but unexercised. All 4 ACTIVE profiles end
`STORAGE_OUT → CHECKLIST → END` with an **active** checklist profile, so the T8-c
inactive-profile auto-complete hole below is confirmed **not live**.

## Problem

The advance is persisted **before** the checklist dialog is rendered. Cancel is
client-only state (`dialog-state.ts:95`) with no compensating call, so a cancelled
checklist leaves a permanent record of a stage transition whose mandatory checklist
was never answered.

Persisted by the cancelled advance (`cycle-write/advance.ts`):
- `:455` checksummed `FilterEvent` (`STATE_TRANSITION`)
- `:474` `FilterDetails.currentLifecycleState = targetState`
- `:531` hash-chained `audit_trail` row
- `:481` `CleaningStageApproval` PENDING (WASH_OUT/DRY_OUT, interlock on, online)

NOT persisted: cycle completion (correctly deferred by `hasPendingChecklistAfterTarget`,
`advance.ts:376-395`). Cycle parks IN_PROGRESS — it does not falsely complete.

Client ordering — `apps/web/src/lib/filter-ops/use-core.ts`:
- `:266` `executeOrQueue('advance', ...)` ← write commits
- `:296` `resolveAndDispatchChecklist(...)` ← dialog opens, gated on the result tape

**Not terminal-specific.** Same ordering at every stage; only visible at the terminal
stage because elsewhere the next advance throws `CHECKLIST_PENDING`
(`transitions.ts:114-140`) and forces the operator back. At the terminal stage there
is no next advance, so nothing bites.

**Not a regression.** Pickaxed ~30 commits; advance-first predates the window
(legacy inline code at `dc60cca^` has the identical order). Confirmed with user.

## Feasibility (verified, not assumed)

Client can resolve the checklist BEFORE advancing — it already does so offline:
- `current-state.ts:581` — `stageLookup[<stage>].pendingChecklistProfileIds` is computed
  for **every** STAGE node (`:554`), so `stageLookup[targetState]` is in hand pre-advance
- `offline-sync-service.ts:233` — questions cached via `?expand=questions`
- `offline-cache.ts:160` `buildPendingChecklistFromProfile` — assembles dialog rows from
  cache with **no** server tape
- `use-core.ts:276` `recomputeAndCacheFilterState` already does exactly this offline

Ordering is a design choice, not a data constraint.

## Design

Invert to: **resolve → render → submit both atomically.**

Existing `bulk-operate` is NOT sufficient: it fans out to separate service calls with a
transaction **per item** (`bulk-operate.ts:64`). Advance + submit-checklist as two items
= two transactions = same orphan-advance window. Requires a real atomic op.

### Server
New op `advance-with-checklist`: ONE transaction performing advance then submitChecklist.
Refactor `advance.ts` + `submit-checklist.ts` to expose tx-participating internals
(`advanceTx(tx, ...)`, `submitChecklistTx(tx, ...)`) so both compose in a single tx and
roll back together. Keep existing single-op endpoints for stages with no post-stage
checklist. Reuse the same gates — no gate may be bypassed by the composed path.

### Client
1. Before dispatch, resolve pending checklist for `targetState` from stageLookup + cached
   profiles (reuse `buildPendingChecklistFromProfile` — do NOT rebuild server logic).
2. If none → advance as today (unchanged path).
3. If pending → render dialog FIRST, dispatch nothing. Close = true no-op, nothing written.
4. On submit → dispatch ONE `advance-with-checklist`.

### Offline
Enqueue the combined op as a single IDB entry. Cancel must enqueue nothing.
Preserve idempotency keys, tombstones, `offlineTime` anchoring.

## Touch points (test ALL after change)

- `apps/web/src/lib/filter-ops/use-core.ts` — `advance`, `startAndAdvance`, batch `:1073`, single `:1731`
- `apps/web/src/lib/filter-ops/dialog-state.ts`, `resolve-pending-checklist.ts`
- `apps/web/src/routes/mobile/mobile-operations.tsx` — dialog `:3928`, Close `:4070`, `handleSubmitQueue` `:1156`
- `apps/web/src/lib/offline-cache.ts`, `offline-sync-service.ts`, `hooks/use-offline.ts:94`
- `apps/api/src/modules/filter-operations/cycle-write/{advance,submit-checklist,bulk-operate}.ts`
- `packages/shared/src/pipeline-executor/transitions.ts`
- Desktop filter-ops page (shares use-core — must not regress)

## Risks

- **Offline queue is a protected surface** (see `feedback_offline_sync_protected_surface`).
  Verify git-clean before commit; never sweep it incidentally.
- **Batch/single parity** — mirror across `handleSubmit` / `handleSubmitQueue`.
- **REAUTH must escape batch try/catch** — re-throw `REAUTH_FAILED/REQUIRED` first.
- **Interlock interaction**: `advance.ts:405-411` `INTERLOCK_TERMINAL_STAGE` 422 currently
  does NOT fire because `hasPendingChecklistAfterTarget` keeps `willComplete=false`. If the
  checklist now submits in the same tx, `willComplete` may flip true → this 422 could start
  firing. **Must test WASH_OUT/DRY_OUT terminal stages explicitly.**
- **In-flight cycles** pin `profileId` at start — reassign does not migrate.

## Pre-existing issue found (separate, do not bundle)

`advance.ts:381-385` + `__tests__/without-final-checklist.test.ts:255` ("T8-c"): if the
terminal CHECKLIST node points at a profile with `isActive:false`, the probe returns 0 rows
→ `hasPendingChecklistAfterTarget=false` → **cycle auto-completes with NO checklist at all.**
Not firing today (user reports the cycle does not complete), but confirm the terminal
checklist profile is active. Track separately.

## Second pre-existing bug found 2026-07-15 (separate, do not bundle)

`manual-cycle.ts` **never sets `manualEntry`** — all 14 back-dated manual cycles in
`digilog_db` carry `manual_entry = false`. The column exists to mark hand-entered records
for compliance and is wrong on every row; only the `-M` cycle_code suffix distinguishes them.
Track separately.

## Steps

- [x] 1. Live-verify — **DONE 2026-07-15, defect REPRODUCED.** See "Step 1" above.
      Reproduction test committed; live-data archaeology found no field instances.
- [ ] 2. Server: tx-composable `advanceTx` + `submitChecklistTx`; new atomic op. Tests first.
- [ ] 3. Client: pre-advance resolve + dialog-first ordering.
- [ ] 4. Offline: single combined queue entry; cancel enqueues nothing.
- [ ] 5. Test all touch points above + batch/single parity + interlock terminal stages.
- [ ] 6. Rebuild web dist + APK; verify on tablet (source is invisible until `npx vite build`).
- [ ] 7. Docs: CHANGELOG, CLAUDE.md if counts move.
