# Cleaning Stage Interlock — Implementation Plan

**Branch:** RFID (confirm before starting — currently on RFID; ingestion-removal work is on a separate branch)
**Created:** 2026-06-12
**Status:** PLAN APPROVED — awaiting go-ahead to start Phase 1

## Goal
Two-point QA interlock inside the cleaning cycle. After **WASH_OUT** and after **DRY_OUT**,
the cycle pauses; the filter's identity + context is snapshotted and sent to a configurable
approver role. Approver re-auths (= digital signature) and Approves or Rejects.
- Approve → filter continues per the cleaning-profile graph.
- Reject after WASH_OUT → state back to WASH_IN.
- Reject after DRY_OUT → state back to DRY_IN.
- While pending, operator CANNOT advance past the stage (interlock).

## Locked design decisions (user, 2026-06-12)
1. **Approver role configurable per stage** (WASH_OUT and DRY_OUT can differ).
2. **Offline = block until online + approved.** No work proceeds without the signature.
   current-state must surface "awaiting connectivity to request approval" so the tablet
   isn't a silent dead-end.
3. **Different-role user must approve.** Enforce server-side: approver ≠ performer AND
   approver.role === stage's configured approverRole.

## Details to snapshot for the approver
Block, Area, AHU, AHU type, Micron size, Filter type, Filter dimensions, Filter set.
Sources:
- Block/Area/AHU → walk filter.parentId chain, identify by template_kind (extend
  `getFilterHomeBlock` in filter-resolver.ts to collect all levels).
- micron size / filter type / dimensions → filter attributes (micronSize, filterType, filterSize).
- AHU type → AHU instance attribute (ahuType).
- filter set → FilterDetails.filterSet.

## Phases

### Phase 1 — Data model + config (backend foundation)  ✅ DONE 2026-06-12
- [x] Prisma model `CleaningStageApproval` + enum `CleaningStageApprovalStatus`
      (PENDING/APPROVED/REJECTED). Fields: cycleId, filterId, stageKey, status,
      approverRole, rejectToStateKey, detailsSnapshot Json, requestedBy/Name/At,
      decidedBy/Name/At, decisionRemarks, attemptSeq. Indexes (cycleId,stageKey)
      / (status,approverRole) / (filterId). No Prisma relations (mirrors ReportReview).
- [x] HAND-WRITTEN migration 20260612120000_add_cleaning_stage_approvals/migration.sql,
      applied to digilog_db via psql + table verified. Client regenerated (API stopped
      for DLL lock, restarted clean — 36 modules).
- [x] Config def `stage-interlock.def.ts` (FLAT settings, not nested points):
      enabled(false) / requireDifferentApprover(true) / washOutApproverRole(ADMIN) /
      dryOutApproverRole(ADMIN). Reject targets fixed in service, not config.
      Registered in config-discovery.ts + card in config/index.tsx. Default seeded + verified.

NOTE: config shape is FLAT (washOutApproverRole/dryOutApproverRole) not the {points:[]}
array from the original plan — simpler, matches block-change-approval def pattern. The
service maps stageKey→config key + holds the fixed STAGE_INTERLOCK_POINTS
(WASH_OUT→WASH_IN, DRY_OUT→DRY_IN).

### Phase 2 — Engine integration (the interlock itself)
- [ ] Helper `collectFilterApprovalDetails(filterId)` → the 8-field snapshot.
- [ ] advance.ts (a): block leaving a gated stage — if fromState is interlock point &
      latest approval for (cycle, stage) !== APPROVED → 423 STAGE_APPROVAL_PENDING.
- [ ] advance.ts (b): on entering an interlock stage, create PENDING approval + snapshot +
      notify approverRole + audit STAGE_APPROVAL_REQUESTED. (online-only; offline replay
      defers — see offline note.)
- [ ] bypass.ts: SAME leave-gate guard (interlock must not be a bypass escape hatch).
- [ ] current-state.ts: add `interlock: {pending, stageKey, approvalId, approverRole} | null`.

### Phase 3 — Approver module
- [ ] `stage-approvals/{service.ts, routes.ts}` @ /api/stage-approvals.
      GET /queue, GET /:id, POST /:id/approve (reauth APPROVE_CLEANING_STAGE → digital
      signature → notify operator → audit), POST /:id/reject (reauth + remarks → REJECTED →
      tx: deviation FilterEvent + set currentLifecycleState=rejectToStateKey + notify + audit).
- [ ] Enforce approver ≠ performer + role match in approve/reject.
- [ ] Register module in app.ts.

### Phase 4 — Permissions / notifications / shared (12-touchpoint)
- [ ] permissions.ts: STAGE_APPROVAL_VIEW, STAGE_APPROVAL_DECIDE.
- [ ] reauth-actions.ts: APPROVE_CLEANING_STAGE, REJECT_CLEANING_STAGE.
- [ ] feature-privileges.ts, BOTH sidebar files, seed.ts grants + live UPDATE roles.
- [ ] NotificationType: STAGE_APPROVAL_REQUESTED / APPROVED / REJECTED (hand-written
      ALTER TYPE migration, per report-review precedent).
- [ ] cd packages/shared && npx tsc (nx not wired).

### Phase 5 — Frontend
- [ ] Approver inbox /stage-approvals (clone report-reviews inbox): To-Action/All tabs,
      details-snapshot card, Approve/Reject reauth dialog. Notification deep-link.
- [ ] Operator block UI: pending banner + disabled advance — web (filter-operations.tsx)
      AND tablet (mobile-operations.tsx + mobile-wrapper.tsx).
- [ ] Config page for stage-interlock (per-point role pickers + enable toggle).
- [ ] Sidebar item stage-approvals.
- [ ] Cleaning Record / audit: render new event + notification types.
- [ ] vite build + APK if tablet flow changes.

## Touchpoints to test (CLAUDE.md correctness rule)
start-cycle · advance (both gates + block) · submit-checklist (CHECKLIST between WASH_OUT
and next) · bypass (must respect interlock) · terminate · current-state · offline replay ·
mobile + web operator UI · reports/Cleaning Record · audit-trail rendering · notifications.

## Risks / edge cases
1. Offline: interlock = online-only checkpoint. Queued advance-out-of-stage must NOT poison
   the offline queue — it should hold gracefully and surface "needs connectivity".
2. Bypass must respect the gate.
3. Profiles without WASH_OUT/DRY_OUT → interlock simply never fires (keys off stateKey).
4. Reject→redo loop: attemptSeq prevents a stale attempt-1 APPROVED from releasing attempt-2.
5. Gate rule: leave stage X allowed only if LATEST approval for (cycle, X) is APPROVED.

## Reuse map (don't re-derive)
- State machine shape → report-reviews/service.ts
- Digital signature → enforceReauth + auditLog signatureMeaning
- Snapshot → report-review dataSnapshot pattern
- Notify role → createNotification({forRole})
- Hierarchy walk → getFilterHomeBlock (filter-resolver.ts)
- Gate guard style → executor.assertChecklistGatePassed (advance.ts)
