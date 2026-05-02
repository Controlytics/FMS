# Resume State — Step 8 Decision-Tape Architecture (2026-05-02)

Self-contained resume note. Read this and you have everything needed to pick up.

## Where we are

**Worktree:** `C:\Users\hello\21cfrlogbook-DigitalFMS\.worktrees\phase5-verification`
**Branch:** `feature/phase5-verification`
**HEAD:** `5a6b5c4`
**Working tree:** clean

## Step 8 phase status

| Phase | Status | Commit | Pushed |
|---|---|---|---|
| 8.0 — Server tape generator + TAPE_PARALLEL flag | DONE | `fe79997` | YES |
| 8.1 — FE action-renderer skeleton + shared types + M4/M6 | DONE | `6c257a3` | NO |
| 8.2 — Full per-action-type renderers + ActionDialog + M1 fix | DONE | `5a6b5c4` | NO |
| 8.3 — Offline replay tape-versioning | NEXT | — | — |
| 8.4 — Cutover (TAPE_PARALLEL ON, FE consumes tape, delete graph walker) | PENDING | — | — |
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

## Tracked deferred follow-ups

| ID | Description | Defer to |
|---|---|---|
| **M3** | `tapeVersion = profileVersion * 1000 + filterEventCount` overflows when filterEventCount >= 1000 | 8.4 cutover |
| **B7.2 M1** | Pre-existing `advanceBatch:422` closure-stale guard | future cleanup |
| **B7.4 #2** | `DryingFiltersPanel` 15s SWR poller doesn't surface `equipmentGroupSyncWarning` | future cleanup |
| **L5** | Browser visual smoke of Version History page | future test pass |

## Phase 8.3 plan (NEXT)

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
- Tighten M3 (`tapeVersion` formula)
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
3. Confirm HEAD is `5a6b5c4`: `git -C ... log --oneline -5`
4. Read `tasks/PLAN-2026-05-02-step8-decision-tape.md` for full Phase 8.3+ detail
5. Dispatch implementer subagent for Phase 8.3 with the plan above as context

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
