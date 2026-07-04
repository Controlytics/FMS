# Full Application Audit — 2026-07-04

**Scope:** bugs, DB integrity, remaining dead-code, content — across the whole app
(~102K LoC: api 37.5K/221 files, web 64.5K/245 files, packages/shared).
**Method:** test suites (ground truth) + madge + DB integrity SQL + 3 adversarial
bug-hunting agents (filter-ops / offline-sync / auth-RBAC), each finding requiring a
concrete failure scenario. **Prioritized and report-only — NOT exhaustive** (a 102K-LoC
bug audit can't be). Dead-code was already swept exhaustively this session (14 commits);
this pass covers correctness + integrity + the few remaining dead-code categories.

---

## Test / build health (ground-truth regression check)
- **api suite: 844 passed / 0 failed / 15 skipped** (79 files) — GREEN. First full run
  since all 14 of this session's commits → clean regression check on the whole session.
- **web suite: 363 passed / 1 FAILED** (24 files) — the 1 failure is Finding #1 below.
- api tsc / web tsc / vite build: all pass (verified during the dead-code sweep).

---

## FINDINGS (prioritized)

### 🔴 #1 — RBAC nav-visibility divergence (checklists → operators) — CONFIRMED (failing test)
- **Where:** `packages/shared/src/types/permission-tree.ts:592` — the `checklists` sidebar
  node (checklist **profile management**) lists `checklists.submit` in `visibilityPrivilegeIds`.
- **Symptom:** `sidebar-visibility.test.ts` case `item="checklists" perms="operatorish"` fails:
  tree-based `isSidebarItemVisible` returns **true**, legacy `SIDEBAR_PRIVILEGE_MAP` returns **false**.
- **Cause:** `operatorish` = `[ASSET_VIEW, ASSET_READ, FILTER_OPERATE, CHECKLIST_SUBMIT, ...]`.
  `checklists.submit`'s gate is satisfied by an operator, so the checklist **management** nav
  item shows for operators — but submitting checklists (during cleaning) ≠ managing checklist
  templates. Semantically the submit privilege belongs to the filter-operations flow, not the
  checklist-admin sidebar.
- **Pre-existing:** yes — from Phase 5B commit `90d814c`; NOT introduced this session.
- **Severity pending the route-gate check** (auth agent): if the `/checklists` (checklist-admin)
  route is itself gated on CREATE/EDIT perms → cosmetic nav leak (operator sees item, gets 403 on
  click). If the route is unguarded → real access bug. **Fix:** remove `checklists.submit` from the
  checklists sidebar's `visibilityPrivilegeIds` (or, if intended, update the stale test expectation).

### 🟠 #2 — 10 circular dependencies (madge) — CONFIRMED
`npx madge --circular` (the configured `check:cycles`, not run in a while) reports 10 cycles:
- **6 in the core filter-operations money-path:** `filter-operations.service.ts` ↔
  `current-state.ts` and ↔ `cycle-write/{advance,bypass,start-cycle,submit-checklist,terminate-cycle}.ts`.
  Circular imports risk undefined-at-init / partial-module bugs. (filter-ops agent verifying whether
  any manifests as a real runtime bug.)
- 3 in the derived RBAC maps: `feature-privileges.ts` ↔ `permission-tree.ts` ↔ `sidebar-privilege-map.ts`.
- 1 in `pipeline-executor`: `types.ts` ↔ `context.ts`.
- **Impact:** code-smell + latent init-order risk; refactor to break the cycles (extract shared
  types/helpers). Not proven to crash today, but the money-path cycles are worth resolving.

### ℹ️ #3 — Audit hash-chain: 171 deleted rows / 41 breaks in dev DB — EXPECTED, not a bug
- The dev `digilog_db` audit chain has 171 missing `chain_position`s and 41 `previous_checksum`
  breaks — residue from testing the `AUDIT_DELETE` hard-delete feature (added 2026-07-01).
- This is the **documented design**: physical deletion breaks the tamper-evident chain and
  `verify-chain` reports it invalid *permanently* ("breakage stays loud"; REDACT is the compliant path).
- **So the design works as intended.** Flag only: in a *production* 21 CFR context, any hard-delete
  is a compliance event — ensure operators use REDACT, not DELETE, on real data.

### ✅ Clean surfaces (audited, no findings)
- Web components + hooks — no unused files.
- Prisma enums, permissions, config-defs — clean (from the dead-code sweep).

---

## Bug-hunt agent findings (filter-ops / offline-sync / auth-RBAC)
All verified/traced with a concrete failure scenario (adversarial discipline held).

### 🔴 #4 — HIGH — `submitChecklist` missing post-lock (state,cycle) recheck → contradictory 21 CFR record — ✅ FIXED (`d45c317`)
> Fixed 2026-07-04: routed the lock through `lockAndVerifyFilterState(tx, filterId, currentState, cycle.id)` (same recheck as advance/bypass/terminate), kept the ALREADY_SUBMITTED guard on top. Un-skipped the 2 placeholder tests → real STATE_CHANGED/CYCLE_CHANGED cases. Full api suite 846/0/13, tsc clean.
- **Where:** `apps/api/src/modules/filter-operations/cycle-write/submit-checklist.ts:190-259`.
- **Defect:** advance/bypass/terminate all call `lockAndVerifyFilterState` (409 on STATE_CHANGED/CYCLE_CHANGED); `submitChecklist` locks with a bare `SELECT 1 … FOR UPDATE` and **never re-reads state**. Its completion branch fires on the stale pre-lock `currentState`/`cycle.id`.
- **Scenario:** filter at final stage (`STAGE→CHECKLIST→END`, `shouldComplete=true`). Operator A calls submitChecklist (reads state=final, cycle=X). Operator B concurrently terminates cycle X (status=TERMINATED, currentCycleId=null). A then gets the lock, skips the recheck, passes ALREADY_SUBMITTED (no prior CHECKLIST_COMPLETED for that stage), and runs the completion writes: **flips the just-TERMINATED cycle back to COMPLETED**. Cycle X ends with BOTH `CYCLE_TERMINATED` and `CYCLE_COMPLETED` immutable events — self-contradictory. Same with a concurrent bypass out of the final stage.
- **Confidence:** verified (code asymmetry traced; `concurrent-operator.test.ts:268-276` explicitly `it.skip`s these recheck cases, documenting the known gap). Timing-dependent (needs 2 concurrent operators on 1 filter).
- **Fix:** route submitChecklist through the same `lockAndVerifyFilterState` recheck as the other writers.

### 🟠 #8 — MEDIUM-HIGH — orphaned `'syncing'` offline ops → silent data loss under tablet OOM-kill — ✅ FIXED (`125bb44`)
> Fixed 2026-07-04: `requeueStuckSyncing()` requeues `'syncing'` ops+tombstones→`'pending'` in `startAutoSync()` before the first drain (idempotent re-replay via clientOpId; no retryCount bump). web tsc 0, web suite 365 pass, vite build 0.
- **Where:** `apps/web/src/lib/sync-engine.ts:472` (+ :272 tombstones).
- **Defect:** drain sets op `'pending'→'syncing'` *before* the multi-second network POST; **nothing ever resets `'syncing'`→`'pending'`** (only two `'syncing'` writes exist repo-wide; no startup requeue). `getPendingOperations` queries the `'pending'` index only.
- **Scenario:** tablet is killed mid-replay (the documented OOM/429 auto-close from memory). The row stays `'syncing'` forever — the 30s retry, count refresh, and cleanup all skip it. If the crash preceded the server commit, the operator's cleaning advance/checklist is **silently lost while "Data Synced" shows green** — a 21 CFR data-integrity loss.
- **Confidence:** verified (traced; no `'syncing'`→`'pending'` reset anywhere).
- **Fix:** on app boot, requeue any `'syncing'` rows back to `'pending'` (they're idempotent via clientOpId, so re-replay is safe).

### 🟠 #6 — MEDIUM — replacement-execute route has no authorization guard
- **Where:** `apps/api/src/modules/replacement-schedule/routes.ts:175` — `POST /api/replacement-schedules/entries/:id/execute`.
- **Defect:** no `requirePermission`/`requireRole` preHandler; the only control is `enforceReauth('REPLACE_FILTER')`, which returns `{ok:true}` **without a password** whenever `REPLACE_FILTER` isn't in the `action-reauth` config (the default/legacy state). So the JWT is the sole control.
- **Scenario:** any authenticated user with **zero filter perms** (viewer/auditor/notifications-only) POSTs a valid due-entry id → `executeReplacement()` retires the old filter + creates a replacement (21 CFR lifecycle mutation). Marked "intentional" in a 2026-06-04 comment, but a genuine broken-access-control.
- **Confidence:** verified (traced).
- **Fix:** add a `FILTER_REPLACE`/`REPLACEMENT_SCHEDULE_*` permission preHandler; don't rely on config-dependent reauth as the sole gate.

### 🟠 #9 — MEDIUM — online cycle-writes omit clientOpId → lost-response replay fails or duplicates
- **Where:** `apps/web/src/hooks/use-offline.ts:131-205` (online post paths) + `apps/api/src/lib/idempotency.ts:57-70`.
- **Defect:** online cycle-writes send no `clientOpId`, so if the op commits server-side but the HTTP response is lost (routine WiFi drop), the retry is queued with a *fresh* clientOpId that can't correlate to the committed op.
- **Scenario:** tap Start Cycle online → server creates cycle (no clientOpId) → response lost → op queued → replay POSTs start-cycle → `findExistingStartByClientOpId`=false → server sees `currentCycleId` set → **409 CYCLE_ACTIVE**, op burns 5 retries → `failed` with misleading "already has active cycle" toast (data is fine). **Worse:** if the cycle was terminated elsewhere first, the replay creates a **duplicate cycle**.
- **Confidence:** verified (traced).
- **Fix:** attach a clientOpId to online cycle-writes too (so online+offline share one idempotency key), or add benign-409 handling to the standalone start-cycle replay branch.

### 🟡 #5 — MEDIUM — stage-interlock QA gate skipped at a terminal interlock stage
- **Where:** `apps/api/src/modules/filter-operations/cycle-write/advance.ts:379-384`.
- **Defect:** when a WASH_OUT/DRY_OUT interlock stage is *also* the final stage, `willComplete` zeroes `enteringInterlock` → no PENDING `CleaningStageApproval` created → cycle auto-completes with **no QA sign-off**.
- **Scenario:** admin configures `WASH_IN→WASH_OUT→END` with `stage-interlock.enabled=true`; advancing WASH_IN→WASH_OUT auto-completes, skipping the required WASH_OUT approver. Defeats the interlock's purpose for a terminal interlock stage.
- **Confidence:** verified (uncommon config, not prevented).
- **Fix:** create the interlock approval before the auto-complete when `enteringInterlock` on a terminal stage (or block that profile config).

### 🟡 #10 — LOW — `ensureCycleAlive` pre-empts server idempotency for the cycle-completing op
- **Where:** `apps/web/src/lib/sync-engine.ts:176-192` + :575.
- **Defect:** the pre-replay `ensureCycleAlive` guard fetches `/current-state`; if the cycle-completing op committed server-side but its response was lost, the next drain sees `currentCycle==null` and throws `CYCLE_ENDED` **without calling the server**, so `findExistingByClientOpId` (which would return the cached success) never runs → op misreported "failed/discarded" though server data is correct.
- **Confidence:** verified. Cosmetic (no data loss; misleading status only).

### 🟡 #7 — LOW/informational — PM deviation acknowledge gated on a read perm
- `apps/api/src/modules/pm-schedules/routes.ts:569` — `POST /deviations/:id/acknowledge` gated on `PM_READ` (read) for a state change, but mitigated by always-on `enforceReauthAlways('ACKNOWLEDGE_PM_OVERDUE')` (password required, non-toggleable) and non-destructive. Borderline; identity-bound.

### 🟡 #1 (severity resolved) — LOW/cosmetic — checklists nav leak to operators
- Downgraded from #1: the auth agent verified `GET /api/checklist-profiles` requires `FCP_READ`/`CHECKLIST_TOGGLE`/`VERSION_HISTORY_VIEW`, so an operator clicking the leaked nav gets a **403 on data load** — no leak, no mutation. **Cosmetic nav artifact only.** Fix: remove `checklists.submit` from the node's `visibilityPrivilegeIds` (or update the stale test).

### ⚪ #2 (updated) — circular deps: filter-ops ones are NOT a runtime hazard
- The filter-ops agent cleared the 6 money-path cycles: `cycle-write/*` import the service as `import type` (compile-erased) + receive the live instance as a call-time arg → no init-order bug. The remaining cycles (RBAC maps, pipeline-executor types) are also type-level. **Code-smell, not a runtime bug.** Optional cleanup.

### Strong explicit clears (bounded false positives)
- **Auth-cache staleness: FIXED** — `invalidateUserAuthCache`/`invalidateSessionAuthCache`/`invalidateRolePermsCache` wired into all mutation + logout sites; plugin re-reads authoritative role from DB. Prior logout bug confirmed fixed (`3e87785`).
- Reauth result handling, gate-vs-grant (`useCan` uses the discriminating gate), SUPER_ADMIN bypass, JWT/session TTL clamps — all correct.
- Filter-ops: checklist gate, version pinning, advance/bypass/terminate concurrency recheck, idempotency scoping, dryer offline anchor — all correct.
- Offline: dryer time-anchor correct, batch/single parity maintained, FIFO replay ordering, no `navigator.onLine` misuse.

---

## NOT COVERED (honest scope boundary)
- Exhaustive logic-bug coverage of all 102K LoC (only highest-risk subsystems hunted).
- Unused Prisma columns (Prisma `select *` makes this low-signal).
- Unused API endpoints vs client callers (200+ endpoints; noisy to match — deferred).
- Runtime/load/perf, penetration testing, and per-role curl 403/200 (no low-priv creds).
- Empty dev-DB tables are NOT findings (empty = not-exercised-in-dev, not dead).
