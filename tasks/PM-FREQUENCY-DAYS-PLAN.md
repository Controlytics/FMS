

### Phase 5 (FE) - DONE (2026-08-26)

- **All-or-nothing series refusal** (owner decision) landed in `pm-import.ts`
  first, since it is a backend correctness fix: guards for EVERY bucket are now
  pre-flighted BEFORE any write, and one blocked year refuses that row's whole
  series with a message naming the year. A bucket left empty after filtering
  refused seeds is skipped entirely - otherwise the hard-replace would wipe the
  existing entries and repopulate with nothing. 4 new tests.
- `listEntries` + the XLSX export now carry `frequencyDays` / `anchorDate` /
  `seriesId` (the `/entries` response schema is `additionalProperties: true`, so
  nothing is stripped).
- **PM Schedules table**: new Frequency column - a themed pill
  (Monthly / Quarterly / ...) with the anchor date in its tooltip, `--` for a
  one-off (never "0 days", which would read as a real frequency).
- **Create dialog**: a Repeat select (`FREQUENCY_OPTIONS`, multiples of 30 only,
  so an operator cannot type a value that will only be refused on submit), a
  **live preview of the first 6 generated dates**, and an inline overlap warning
  naming the exact usable tolerance.
- `previewDates()` deliberately mirrors `pm-recurrence.ts` (add whole months to
  the ANCHOR, clamp into short months). A preview that disagreed with what gets
  saved would be worse than no preview.
- **Recurring create bypasses the "overwrite" path.** That path stages a pending
  EDIT on ONE entry, which cannot express replacing a multi-year series -
  offering it would quietly do something other than what was asked. The server
  checks every covered year and 409s naming them.

**Verified in the real browser** (Playwright, logged in as superadmin):
- Frequency column renders; legacy rows show `--`.
- Anchor 31 Jan + monthly previews **1/31 -> 2/28 -> 3/31 -> 4/30 -> 5/31 -> 6/30**
  - the clamp-and-recover is visible to the operator before saving, and matches
  the backend unit test exactly.
- Tolerance 15 at frequency 30 raises the amber overlap warning naming 13 days.
- Console clean: the only error is the expected 409 from a session-conflict
  login, no React warnings.

**BUG found and fixed during the browser pass.** The added Repeat field +
preview + warning made the create dialog taller than the viewport, pushing
**Cancel / Create schedule off-screen** - Playwright could not click Cancel
("element is outside of the viewport"). On a tablet in landscape the dialog
would have been impossible to submit or dismiss. Fixed with
`max-h-[90vh] flex flex-col` on the shell, `overflow-y-auto` on the body and
`shrink-0` on the footer, so the actions stay pinned. Re-verified: Cancel clicks.

Web suite **663/663**, web `tsc` 0, API `tsc` 0, pm-schedules **121/121**.


### Phase 6 - DONE (2026-08-26)

Two new modules + 22 tests. pm-schedules suite **143/143**; `tsc` 0.

**`pm-rollover.ts`** - `rolloverSeries()`, registered on the in-process
node-cron at **03:30**, deliberately after the 03:00 overdue sweep so the sweep
never observes a half-extended series mid-write. It walks the horizon forward:
each day it tops up every live series with occurrences that have come into
range, creating the next year's `PmSchedule` row when needed.

Three invariants, each with a test:
- **Idempotent** - months are keyed `(scheduleId, month)`, the same key the DB
  enforces, and re-checked against the DB immediately before insert so a manual
  trigger overlapping the cron cannot double-create a PM task.
- **Never clobbers** - if a different series already owns a year for that AHU,
  the year is left completely untouched and reported in `skippedYears`.
  Extending must never overwrite.
- **Never guesses** - a series row with no `anchorDate` is skipped loudly rather
  than back-deriving an anchor from the last entry, which would silently shift
  every future date.

Approval treatment: workflow ON forces `PENDING_REVIEW` (and carries no
approval across); workflow OFF inherits the latest entry's status, so a
SUPER_ADMIN-uploaded series keeps generating usable tasks instead of silently
stalling in PENDING once the original window runs out.

**`pm-supersede.ts`** - called from `pm-import.ts` after a recurring row lands.
The hard-replace only touches years the NEW file covers; a previous series that
ran further into the future would keep generating tasks from a schedule the
operator has already replaced. This ends it.

Removed: future, unexecuted entries of the OLD series in years the new one does
not cover. **Retained as evidence** (each with a test): anything on or before
today, anything with a `PmExecution`, anything with a `Deviation`, and anything
skipped or completed-late with a justification. A schedule still holding
retained rows stays ACTIVE so they keep rendering; only a fully-emptied one is
ARCHIVED (never deleted - the record of what was planned survives).

Supersede failures are swallowed deliberately: it is cleanup, not the
operator's requested action, and the new schedule is already committed and
correct. Failing the upload over it would be the worse outcome; the next run
catches the stale year.

**Verified live:** the API boots with the new cron wired and reports
`jobRunner: running`.

**Not added (deliberate):** a manual `POST /rollover` trigger. The deviation
sweep has one, so there is precedent, but nothing asked for it and it would
need its own permission + reauth decisions. Worth considering if operators ever
need to force a rollover rather than wait for 03:30.

A test bug was found and fixed while writing these: one assertion captured a
live reference to `mock.calls` and then indexed with its (since-grown) length.


### Phase 7 - DONE (2026-08-26) - the compliance-critical one

The double-credit is closed. One predicate, `cycleCreditsEntry()` in
`pm-shared.ts`, now decides whether a cleaning counts toward a given PM
occurrence, and BOTH surfaces call it - My Tasks (`pm-due-tasks.ts`) in JS and
the overdue sweep (`pm-deviations.ts`) as the SQL form of the same rule. They
describe the same fact on two screens; if they disagree an inspector gets two
stories about one PM.

    BOUND to this entry      -> counts from windowStart, NO upper bound.
                                The deliberate "perform the missed PM late" path.
    BOUND to another entry   -> never counts here, not even inside this window.
    UNBOUND (null / legacy)  -> counts ONLY inside [windowStart, windowEnd].

What changed: the old rule credited any PM cleaning completed after an entry's
windowStart. Because tasks stack, one September cleaning also satisfied an unmet
August task - two PM tasks and two deviations closed by one job, asserting a
preventive maintenance that never happened.

`pm-credit-binding.test.ts` (12 tests) pins it, including the invariant stated
plainly: sweeping every combination of binding x date, **at most one** stacked
task is ever credited by a single cycle.

pm-schedules suite **155/155**; `tsc` 0.

**TRANSITIONAL GAP - Phase 8 must land with this.** Nothing writes
`CleaningCycle.pmScheduleEntryId` yet; the column exists (Phase 2) but only the
Phase 8 reason gate sets it. So between Phase 7 and Phase 8 an overdue task or
deviation cannot be cleared at all: a late clean no longer credits it, and the
explicit paths that would (perform-late / skip-with-reason) are not built. This
is the intended END state minus its other half. It exists only in the working
tree - nothing is committed or deployed - but **these two phases must ship
together**; do not release Phase 7 alone.


### Phase 8 - DONE, backend (2026-08-26)

The reason gate. **This closes the Phase 7 transitional gap** - something now
writes `CleaningCycle.pmScheduleEntryId`, so overdue tasks are clearable again,
but only by an explicit, justified operator action.

**New modules**
- `pm-pending-context.ts` - "does this AHU still owe an earlier PM?" Returns
  `currentEntry` + `overdueEntries`. An entry stops being outstanding when it is
  resolved either way: a BOUND cleaning completed for every counted filter, or
  `skippedAt` was set with a justification. Honours the per-AHU filter-set mode
  (a DISABLED AHU owes nothing).
- `pm-task-gate.ts` - `resolvePmGate()` + `applyPmGate()`.

**The two paths**
- `completeLate` -> the cycle binds to the OLD entry (that is the task being
  performed) and `lateReason/By/At` are recorded. The deviation is NOT closed
  here: starting is not finishing, and the sweep closes it when the bound
  cleaning actually completes.
- `skips[]` -> each old entry gets `skippedAt/By/ByName/skipReason` and its
  deviation closes with `closureKind = SKIPPED` + the reason, `completedBy` left
  NULL. Never marked complete - the PM did not happen. The cycle binds to the
  CURRENT entry.

**Design decisions**
- **Only PM cleanings are gated.** A breakdown or ad-hoc clean neither satisfies
  nor is blocked by a PM task, so challenging it would be noise on unrelated
  work. With no PM reason configured at all the gate stays out of the way
  entirely.
- **Every outstanding task must be accounted for**, or the 409 is re-raised
  listing only the unanswered ones. Letting one through would leave a missed PM
  silently open behind completed work - the exact gap the gate exists to close.
- **Nothing is written during validation.** `resolvePmGate` returns a deferred
  `apply` that `start-cycle.ts` runs only after the cycle row exists, so a
  failed start can never leave a PM written off with no work behind it.
- **`apply` runs OUTSIDE the cycle transaction and its failure is swallowed** -
  loudly, with an audit row. A bookkeeping failure must not undo a cleaning the
  operator has already begun; the task simply stays outstanding, which is the
  safe direction to fail in.
- **Offline replay is EXEMPT**, mirroring the existing replacement gate: the
  tablet collected the answer at scan time and replays `bindEntryId` verbatim
  rather than re-deriving it against since-changed server state.
- **Segregation of duties.** Skipping needs its own permission `PM_TASK_SKIP`
  and its own re-auth action `SKIP_PM_TASK` on top of the normal start-cycle
  challenge. Holding FILTER_OPERATE lets an operator clean; it must not by
  itself let them write off a missed PM. Enforced on BOTH surfaces - single
  start-cycle and `bulk-operate` (checked once for the whole batch).

**Once per AHU, not once per tag** - verified by test, not assumed. The tablet
sends the same payload on all 50 items; the first writes the skip, and because
the entry is then no longer outstanding the remaining 49 sail through binding to
the current entry. Asserted: `pmScheduleEntry.update` called exactly ONCE,
`deviation.update` exactly ONCE, all 50 cycles bound to the current period.

**Shared package** (12-touchpoint rule): +1 permission (102 -> 103), +1 reauth
action (92 -> 93), +1 PERMISSION_TREE node (`pm.skip_task`, configurable), feature
privileges 83 -> 84, frozen snapshot + count tests updated. shared 333/333.

`DueOverallStatus` gains `'skipped'`, short-circuiting the cleaning-cycle
derivation - the operator has stated it will not be performed, so no evidence
should relabel it. Skipped rows route to `tasks` (not `overdue`), carrying
`skipReason` / `skippedByName` / `skippedAt` / `lateReason` for the page.

pm-schedules **179/179**; `tsc` 0; `GET /api/pm-schedules/pending-context`
verified live.

**Remaining for Phase 9 (FE):** the two dialogs on web + tablet, Skipped
rendering on My Tasks / mobile, offline caching of the pending context and
queuing of the reason, and the Deviations page closure-kind column.


### Phase 9 (FE) - DONE (2026-08-26)

**My Tasks** (`routes/my-tasks/index.tsx`)
- `skipped` status added to `STATUS_META` in **slate, not emerald** - a skipped
  PM must never read as a completed one - and to the card's top gradient.
- A skipped task shows a "Not performed as scheduled" banner with the reason and
  who/when recorded it. A completed-late task shows an amber "Completed late"
  banner with its reason. The task stays VISIBLE rather than disappearing: the
  miss and why it was accepted are exactly what an inspector needs.
- The "Overdue by N days" deviation pill is suppressed on a skipped row (it has
  been resolved, just not by performing it).

**Tablet** (`routes/mobile/mobile-operations.tsx`)
- Gate intercepts at **reason-submit**, before any mutation. That single point
  was chosen because every downstream cycle-start path (equipment dialog,
  no-equipment batch, single filter) builds from `cyclePayload` - so one
  insertion covers them all, and it is naturally asked ONCE per batch.
- Dialog offers the two intents, collects one reason per outstanding task
  (min 10 chars, Submit disabled until every box is filled), then re-enters
  `handleReasonSubmit` with the payload attached.
- Not dismissible by backdrop - an explicit choice is required, same contract as
  the checklist dialog. `max-h-[90vh]` + internal scroll + pinned footer, so the
  Phase-5 off-screen-buttons bug is not repeated.
- **Answers are cleared whenever a new reason dialog opens** (both the single
  and batch entry points), so one AHU's justification can never ride along onto
  unrelated work.

**Offline** (the protected surface - touched minimally)
- New `GET /api/pm-schedules/pending-tasks-map` returns only AHUs that still owe
  a PM, keyed by AHU id.
- The tablet caches it via the EXISTING SWR + `cache()` pattern, one line beside
  the blocked-filter set - no change to the sync engine, the queue, or replay.
- `loadPendingPmTasks()` reads the live endpoint when online and the cache when
  offline. **This matters**: offline replay is exempt from the server gate (the
  answer rides in the queued payload), so without the cache an offline PM
  cleaning would slip past unasked.
- A lookup failure returns null rather than throwing - a cache miss must never
  block cleaning. The server still enforces the gate online; offline is
  best-effort by design.

**Deviations** (`routes/deviations/index.tsx`)
- SKIPPED / LATE badges beside the CLOSED status, with the reason in the
  tooltip. A deviation closed because the PM was skipped must never read the
  same as one closed because the PM was performed.
- The sweep now stamps `closureKind: 'COMPLETED_LATE'` when it auto-closes, so
  the field is not only ever set by the skip path.

Web **663/663**, web `tsc` 0, API `tsc` 0, pm-schedules **179/179**.

**Verified in the browser:** My Tasks renders (3 completed / 9 overdue / 12
tasks) with no new console errors - the only error is the expected 409 from a
session-conflict login. Existing in-window completions still show as Completed,
confirming the Phase 7 scoping did not regress the normal path.

**NOT verified end-to-end in the browser:** the skipped-row banner and the
tablet gate dialog firing against real data. Producing either requires running a
real cleaning against an AHU with an outstanding PM, which would write live
cycles, entries and deviations into the dev DB. Covered by 23 gate unit tests +
the 50-tag batch test instead. Worth one manual pass on the tablet before
release.


### Phase 10 (docs) - DONE (2026-08-26)

Live counts re-verified by grep/ls BEFORE editing (never trusted the prior
numbers): models 61, **enums 24**, **permissions 103**, **reauth 93**, modules
33, config defs 37, routes 77, feature privileges 84.

Updated: root `CLAUDE.md` (System Stats + a new feature section), `AGENTS.md`,
`CHANGELOG.md`, `API_REFERENCE.md` (2 new endpoints + the `frequencyDays` create
field), `BACKEND_GUIDE.md`, `LOCAL_SETUP_WINDOWS.md`, `apps/api/CLAUDE.md`,
`packages/shared/CLAUDE.md`, `docs/{index,OFFLINE-DEPLOYMENT-READINESS,
getting-started/*}`, `future/overview/*`, `future/qa/FEATURE_CHECKLIST.md`,
`tasks/todo.md`, and a memory note + index pointer.

**A blanket sed corrupted one line and was caught.** `apps/api/CLAUDE.md:160`
records a HISTORICAL measurement of the broken test DB ("6/23 enums"); the
sweep rewrote it to 6/24. Reverted. Historical narrative in `CHANGELOG.md`,
`tasks/CODE-REVIEW-*`, `tasks/PLAN-*`, `tasks/MIGRATION-DRIFT-*`,
`tasks/REMOVE-RULECHAIN-*` and `docs/superpowers/specs/*` was deliberately left
alone - those numbers describe what was true then. `docs/SECURITY-AUDIT-2026-07-25.md`
also matched "**83**" but that is a compliance score, not a privilege count.

---

## Final state

| | |
|---|---|
| API suite | **1459 passed**, 16 skipped, 1 known pre-existing fixture failure |
| pm-schedules | **179/179** |
| Web | **663/663** |
| Shared | **333/333** |
| Typechecks | api 0, web 0 |
| Drift guard | PASS (both DBs) |

New modules: `pm-recurrence`, `pm-rollover`, `pm-supersede`, `pm-pending-context`,
`pm-task-gate`. New test files: 7 (127 new tests).

**Open before release**
1. One manual tablet pass - the gate dialog and the skipped banner against real
   data. Unit-tested, not browser-verified.
2. `npx vite build` if the APK or the Fastify-served bundle needs the new UI
   (the Vite dev server already has it).
3. Phases 7+8 must ship TOGETHER - see the Phase 7 note.
