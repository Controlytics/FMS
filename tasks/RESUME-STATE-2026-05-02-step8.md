# Resume State — Step 8 Decision-Tape Architecture (2026-05-02)

Self-contained resume note. Read this and you have everything needed to pick up.

## Where we are

**Worktree:** `C:\Users\hello\21cfrlogbook-DigitalFMS\.worktrees\phase5-verification`
**Branch:** `feature/phase5-verification`
**HEAD:** `42c6afc`
**Working tree:** clean

## Step 8 phase status

| Phase | Status | Commit | Pushed |
|---|---|---|---|
| 8.0 — Server tape generator + TAPE_PARALLEL flag | DONE | `fe79997` | YES |
| 8.1 — FE action-renderer skeleton + shared types + M4/M6 | DONE | `6c257a3` | YES |
| 8.2 — Full per-action-type renderers + ActionDialog + M1 fix | DONE | `5a6b5c4` | YES |
| 8.3 — Offline replay tape-versioning | DONE | `723799b..42c6afc` (5 commits) | YES |
| 8.4 — Cutover (TAPE_PARALLEL ON, FE consumes tape, delete graph walker) | NEXT (HIGH RISK) | — | — |
| 8.5 — APK rebuild + tablet field QA | PENDING (needs physical tablets) | — | — |

## What 8.0/8.1/8.2 shipped

### 8.0 (commit fe79997, pushed)
- New module `apps/api/src/modules/filter-operations/tape/` with pure-function `generateTape()` + 7 Action types (ADVANCE_TO_STAGE, SUBMIT_CHECKLIST, SUBMIT_DRYER_READINGS, SET_DRYER_DURATION, BYPASS_STAGE, TERMINATE_CYCLE, COMPLETE_CYCLE)
- 20 unit tests + 8 parity tests
- `TAPE_PARALLEL=true` env flag wraps the new fields into `getCurrentState()` response (`actions[]` + `tapeVersion`); default OFF
- Fastify route schema extended at `apps/api/src/modules/filter-operations/routes.ts:96-104`

### 8.1 (commit 6c257a3, NOT pushed)
- **Shared types extracted**: `packages/shared/src/types/action-tape.ts` — server module re-exports from `@digilog/shared` via shim at `apps/api/src/modules/filter-operations/tape/types.ts`
- **FE skeleton**: `apps/web/src/lib/action-tape/` with `ActionRenderer.tsx`, `types.ts`, `components/base-action-button.tsx`, 7 stub components, `ActionTapeRenderer` wrapper
- **11 vitest tests** for the dispatcher
- **M4 fix**: `beforeEach(() => { nextId = 0; })` in `tape-generator.test.ts:114-119`
- **M6 fix**: `Promise.all([findMany, count])` in `filter-operations.service.ts:706-722`

### 8.2 (commit 5a6b5c4, NOT pushed)
- **All 7 stubs replaced with full UIs** — instrument-readings dialog, checklist Q&A dialog, dryer-readings form, set-duration dialog, justification dialogs (BYPASS amber + TERMINATE red), immediate-submit COMPLETE
- **Shared dialog primitive**: `apps/web/src/lib/action-tape/components/action-dialog.tsx` — light theme, role=dialog, gradient header
- **`onSubmit(action, payload)` contract** with discriminated `ActionPayload` union mapping 1:1 to existing route bodies
- **Close-on-success / stay-open-on-error** semantics caught in advisor review
- **CHECKLIST payload** is object-keyed `Record<questionId, value>` (matches server's `INVALID_QUESTIONS` rejection at `filter-operations.service.ts:870-882`)
- **M1 fix**: `tape-generator.ts:298-329` — BYPASS_STAGE emit-set expanded to all pipeline STAGE nodes except current when `flowMode='BYPASS_ENABLED'`. Matches server bypass route at `filter-operations.service.ts:1548-1556`. 3 new tests.
- **Test counts**: api 38 (was 35); web 43 (was 21)

### 8.3 (commits 723799b, b86bef6, e02806d, 7449677, 42c6afc — pushed)
- **`computeTapeVersion(profileVersion, filterEventCount)`** extracted + exported from `tape-generator.ts:364`; called from both the generator (`tapeVersionOf`) and the new service guard. **Single source of truth for the formula** — drift impossible.
- **`assertTapeVersionFresh()`** helper at `filter-operations.service.ts:31-48` throws `AppError(409, 'STALE_TAPE', ..., { currentTapeVersion })`. Wired into all 4 write methods (advance / submitChecklist / bypass / terminateCycle) AFTER clientOpId dedup.
- **Optional** `tapeVersion: integer` on 4 route schemas (`routes.ts:207, 261, 309, 446`) for backward compat with pre-cutover callers in flight. 8.4 will tighten to required.
- **Shared:** `StaleTapeError` interface + barrel re-export.
- **FE api-client:** `(error as any).currentTapeVersion = err.details.currentTapeVersion` lift mirrors existing `attemptsRemaining` pattern.
- **FE offline-store:** `DB_VERSION` 2 -> 3; `tapeVersion?: number | null` on `OfflineOperation`; `queueOperation` defaults to `null` for shape consistency.
- **FE sync-engine:** carries `tapeVersion` only on `CYCLE_BOUND_OPS` ops (start-cycle / start-and-advance excluded). On 409 STALE_TAPE: marks op `failed` (no retry) + user-visible toast.
- **FE ActionRenderer:** `tapeVersion?: number` prop merged into payloads at the dispatcher seam — per-button components untouched. Wrapper `ActionTapeRenderer` plumbs the prop.
- **Tests:** api 1162 -> 1165 (+3 helper, +3 stale-tape service, +3 helper direct); web 43 -> 47 (+4 sync-engine).

## Tracked deferred follow-ups

| ID | Description | Defer to |
|---|---|---|
| **M3** | `tapeVersion = profileVersion * 1000 + filterEventCount` overflows when filterEventCount >= 1000 | 8.4 cutover |
| **8.3 I-1** | `(cycle as any).profileVersion ?? 0` casts at 4 sites in `filter-operations.service.ts` (lines 860, 1185, 1593, 1953) — fix by adding explicit `select: { id, profileVersion }` to existing `findFirst` calls in advance/submitChecklist | 8.4 cutover |
| **8.3 I-3** | STALE_TAPE toast can spam if multiple cycle-bound ops are queued for same filter — dedupe per `filterId` per drain, or short-circuit rest of filter's queued ops on first STALE_TAPE | 8.4 cutover |
| **8.3 M-3** | `OfflineOperation.tapeVersion?: number \| null` allows 3 states (undefined / null / number) — collapse to `number \| null` only when 8.4 purges leftover pre-8.3 ops | 8.4 cutover |
| **B7.2 M1** | Pre-existing `advanceBatch:422` closure-stale guard | future cleanup |
| **B7.4 #2** | `DryingFiltersPanel` 15s SWR poller doesn't surface `equipmentGroupSyncWarning` | future cleanup |
| **L5** | Browser visual smoke of Version History page | future test pass |

## Phase 8.3 plan (DONE — kept for reference)

**Goal:** Offline replay tape-versioning. IndexedDB queued ops carry the `tapeVersion` they were generated against; sync engine sends it; server validates and returns 409 STALE_TAPE if the tape moved on (e.g., another operator advanced the cycle on a different device).

**Touchpoints (to verify before editing):**
- `apps/web/src/lib/offline/` — IndexedDB schema, sync engine, replay logic
- `apps/api/src/modules/filter-operations/filter-operations.service.ts` — advance/submit-checklist/bypass/terminate routes need a `tapeVersion` body field + tapeVersion-check guard
- `apps/api/src/modules/filter-operations/routes.ts` — request schemas need `tapeVersion` field
- `packages/shared/src/types/action-tape.ts` — possibly add a `StaleTapeError` shape
- `apps/web/src/lib/api-client.ts` — surface 409 STALE_TAPE differently from generic 4xx

**New behavior:**
1. When FE submits an action, include `tapeVersion` from the most recent `getCurrentState()` snapshot in the request body
2. Server compares submitted `tapeVersion` against the freshly-computed one
3. If mismatch → 409 STALE_TAPE with body `{ code: 'STALE_TAPE', currentTapeVersion: number, message: string }`
4. FE on 409 STALE_TAPE: drop the queued op, refetch state, show toast "another operator changed this cycle"
5. Offline IndexedDB: store `tapeVersion` per queued op; replay sends it; STALE_TAPE drops the op without retry

**Acceptance criteria:**
- New tapeVersion field on 5+ filter-operations request schemas
- Server-side guard with 409 STALE_TAPE response
- FE state-management updates `tapeVersion` after every successful submit
- Offline IndexedDB schema migration (probably bumps the DB version)
- Sync engine sends `tapeVersion` on replay
- Tests: server guard (≥3), FE replay drop-on-stale (≥2), offline schema migration (≥1)

## Phase 8.4 plan (AFTER 8.3)

**HIGH RISK** — breaking change.

- Flip `TAPE_PARALLEL` default to ON
- Wire `mobile-operations.tsx` + `filter-operations.tsx` to consume `actions[]` from `getCurrentState()` and render via `ActionTapeRenderer`
- Delete the old graph-walking code paths from FE (Tier-2 walker)
- Remove old derived fields from `getCurrentState()` response (`nextAllowedStages`, `pendingChecklist`)
- **Tighten 8.3 deferred items** (I-1: remove `(cycle as any).profileVersion ?? 0` casts; I-3: dedupe STALE_TAPE toasts per filter; M-3: collapse `tapeVersion` field to `number | null` and purge pre-8.3 IDB ops)
- **Tighten M3** (`tapeVersion` formula overflow when filterEventCount >= 1000)
- **Tighten route schemas** — flip `tapeVersion` from optional to required on all 4 write routes
- Coordinated test: full smoke across mobile + desktop + cycle types

**Rollback:** `git revert` of 8.4 commit — 8.0/8.1/8.2/8.3 stay shipped, just keeps both paths active.

## Phase 8.5 plan (LAST — needs physical tablets)

- Rebuild APK with new web bundle: `cd apps/web && npx vite build && cd ../android && npx cap copy android && cd android && ./gradlew assembleDebug`
- Install on real tablet
- Field QA: full cycle (start → wash → dry → terminate; bypass; checklist; offline replay)
- Coordinated production rollout

## How to resume

1. Pull this file open
2. Confirm working tree clean: `git -C C:\Users\hello\21cfrlogbook-DigitalFMS\.worktrees\phase5-verification status`
3. Confirm HEAD is `42c6afc`: `git -C ... log --oneline -10`
4. Read `tasks/PLAN-2026-05-02-step8-decision-tape.md` for full Phase 8.4+ detail
5. **8.4 is HIGH RISK** — confirm with user before flipping TAPE_PARALLEL default and removing old graph walker. Recommend reading "Tracked deferred follow-ups" first to bundle the 8.3 fix-ups (I-1, I-3, M-3) into the 8.4 commits.

## Reference reading order

1. This file — orientation
2. `tasks/PLAN-2026-05-02-step8-decision-tape.md` — full plan
3. `packages/shared/src/types/action-tape.ts` — type contract
4. `apps/api/src/modules/filter-operations/tape/tape-generator.ts` — server tape
5. `apps/web/src/lib/action-tape/` — FE module
6. `apps/api/src/modules/filter-operations/filter-operations.service.ts` — service with TAPE_PARALLEL block at L686-791
7. `apps/web/src/lib/offline/` — what 8.3 will touch (read before editing)

## Key constraints (project rules)

- List touchpoints before editing
- Test all touchpoints after
- Find root causes, deep-fix bugs even if out of scope
- No silent test bypass
- Light theme only
- PowerShell on Windows (`npx.cmd`, ASCII only, no em-dashes)
- App runs ONLY on local Windows
- Single-tenant (MT was removed 2026-04-30)
- 106 permissions, 90 privileges, 81 reauth, 26 sidebar items, 69 Prisma models, 23 enums (per CLAUDE.md 2026-04-30)
- **No Redis dependency** — Phase 2 + Phase 4 of windows-friendly-rewrite removed it. Job queue is graphile-worker; pub/sub is in-process EventEmitter (`apps/api/src/lib/internal-bus.ts`).
