# PM schedules: many irregular visits per AHU per year

**Drafted + implemented** 2026-08-27 · branch `RFID`

## The concept (operator, 2026-08-27)

One upload covers a whole year. The same AHU appears **many times** in that file
with **irregular gaps** — some around 30 days, some more, some less. The dates
are supplied explicitly; the system does not generate them.

**The rule:** an AHU's next visit must not fall inside the previous visit's
tolerance window. Two PM tasks must never be satisfiable by one cleaning.

### Not the thing we reverted

The 2026-08-26 feature (reverted 2026-08-27 in `798fa2b`) **generated** dates
from a fixed 30-day-multiple frequency. This is the opposite: every date is
uploaded, gaps are irregular, and the system's job is to **validate**, not to
generate. Nothing from `pm-recurrence.ts` / `pm-rollover.ts` / `pm-supersede.ts`
comes back.

## Decisions taken (operator, 2026-08-27)

1. **Separation rule = windows must not overlap.**
   For consecutive entries `a`, `b` of one AHU sorted by `plannedDate`:
   **violation iff `b.windowStart <= a.windowEnd`.**
   Chosen over the literal "next date after previous date + tolerance" because
   the next visit's own BACKWARD tolerance can otherwise reach into the previous
   window — a cleaning in the overlap would credit both tasks, which is the
   thing being prevented. Windows are symmetric today
   (`plannedDate ± toleranceDays`, `pm-import.ts:185`).
2. **Existing violations are grandfathered**, flagged in the UI, not blocked.

## What is already true (verified, not remembered)

- Multiple visits per AHU per year **already work** — 15 schedules / 86 entries
  live, mostly 6 per AHU, tolerances 3–25 days.
- `PmSchedule` is one row per (`entityId`, `year`, `version`);
  `PmScheduleEntry` holds `plannedDate`, `toleranceDays`, `windowStart`,
  `windowEnd`.
- The UI uses `month` only as a **display label** (`detail.tsx:94`,
  `index.tsx:296`) — not as a grid key. That makes this change much smaller than
  it first looks.

## The three blockers

1. **`@@unique([scheduleId, month])`** caps an AHU at one visit per calendar
   month, 12 a year.
2. **Silent data loss on upload.** `pm-import.ts:235` `byMonth.set(p.month, p)`
   — "last wins per month". Two March dates for one AHU: the earlier is
   **discarded with no error**. The "less days gap" case hits this immediately.
3. **No separation validation anywhere** — and it is already violated live:

   | AHU | Visit | Next | Gap | Overlap |
   |---|---|---|---|---|
   | AHU-0A | 18 Sep (tol 15) | 19 Oct (tol 20) | 31d | 29 Sep – 3 Oct |
   | AHU-0A | 19 Oct (tol 20) | 20 Nov (tol 20) | 32d | 31 Oct – 8 Nov |
   | AHU-0A | 20 Nov (tol 20) | 21 Dec (tol 25) | 31d | 26 Nov – 10 Dec |

   Gaps of 31–32 days: the *dates* look fine, the *tolerances* overlap. This is
   why a gap-only rule is not enough.

## Implementation plan

### 1. Validation core — `pm-schedules/pm-separation.ts` (pure, no I/O)
- `checkSeparation(entries) -> Violation[]`, entries = `{ plannedDate,
  toleranceDays, rowNum?, id? }`.
- Sort by `plannedDate`; compare each consecutive pair; report
  `{ prev, next, overlapStart, overlapEnd }`.
- Also reports exact duplicate `plannedDate` (belt and braces with the new
  unique index).
- Pure so it is shared by import, single-create, edit and the UI badge, and so
  the rule cannot drift between them — the same mistake the date-range work hit
  when the rule lived in two places.

### 2. Migration — swap the unique constraint
- Drop `pm_schedule_entries_schedule_id_month_key`, add
  `@@unique([scheduleId, plannedDate])`.
- Hand-author per `apps/api/CLAUDE.md` (migrate diff → review → author →
  `npm run db:verify-migrations` must PASS). **Check first** that no schedule
  has two entries on the same date, or the index creation fails.
- `month` column KEPT (display label, and dropping it would touch export,
  approval and both UI files for no gain).

### 3. Import — `pm-import.ts`
- Delete the `byMonth` collapse; keep every row.
- Run `checkSeparation` per AHU over the whole file **before** any write, and
  reject the file with row numbers + the offending dates. Partial import would
  leave a half-valid year.
- Keep the existing execution/approved-entry replace guards untouched.

### 4. Single create + edit — `pm-schedule-crud.ts`
- Same check against the schedule's other entries; 409 with the same message
  shape as the import.
- **Also validate the pending-edit approval path**: `pendingPlannedDate` /
  `pendingToleranceDays` become live at approval, so an edit approved later
  could introduce an overlap that create-time validation never saw.

### 5. UI
- `pm-schedules/detail.tsx` — amber badge on entries that overlap their
  neighbour, naming the other date. This is what makes decision 2 workable.
- Row label falls back to the date when two entries share a month.
- Surface import rejections per row.

### 6. Export / template — `pm-export.ts`
- `Month` column stays, documented as informational.
- Template note: each date must clear the previous visit's tolerance window.

### 7. Tests
- Unit: `pm-separation.test.ts` — non-overlapping pass; the three live AHU-0A
  pairs fail; same-day duplicate fails; single entry passes; unsorted input
  handled; zero tolerance behaves (adjacent days OK, same day not).
- Import: a file with two same-month dates now imports BOTH (the old collapse is
  gone) and one with an overlap is rejected naming the rows.

### 8. Docs + memory
- `CLAUDE.md` PM section, `API_REFERENCE.md` if the import response shape
  changes, `CHANGELOG.md`, `tasks/todo.md`, memory.

## Open question deliberately left for later

**Year boundaries.** A 28 Dec visit with 25 days tolerance has a window running
into mid-January, but next year is a **separate `PmSchedule` row**, so the
December→January pair is not checked by an intra-file validation. Options when
we get there: validate the uploaded year against the adjacent years' existing
entries, or accept the gap and document it. Raise with the operator rather than
deciding silently — it only bites schedules with large tolerances near year end,
which the live data does have (21 Dec, tol 25).

---

## Implemented 2026-08-27

| Step | Result |
| --- | --- |
| `pm-separation.ts` (pure rule) | done — 13 unit tests incl. the three real AHU-0A pairs |
| `pm-separation-guard.ts` (DB layer, 409 `PM_VISIT_OVERLAP`) | done |
| Migration `20260827120000_pm_entries_unique_by_date` | applied; **drift guard PASS** |
| Import: month collapse removed, whole-file validation | done |
| create / replace / re-submit / edit-approved | all four guarded |
| Pending-edit **apply** point (the flagged gap) | guarded — checked at request AND at approval |
| UI amber badge + date-suffixed month label | done |

### Verified against the running API
| Case | Result |
| --- | --- |
| Two visits in ONE month, 26d apart, tol 3 | **all 3 rows imported**, both March rows stored (was: earlier row silently discarded) |
| 26d apart, tol 15 / 20 (the gap-only blind spot) | rejected, message names both dates, both tolerances and the exact overlap window |
| Two visits on the same date | rejected as a duplicate |
| Rejected AHU's other rows | all reported, not just the offender |
| DB: two same-month rows insert | permitted after the constraint swap (proved in a rolled-back transaction) |

Test data removed afterwards; `pm_schedules` and `pm_schedule_entries` back to
the 15 / 86 baseline exactly.

### Two things found while building
1. **Prisma `@@unique` can be a CONSTRAINT or a bare unique INDEX.** `DROP
   CONSTRAINT` alone left `..._schedule_id_month_key` in place, still enforcing
   one-per-month. The migration drops both spellings.
2. **Rejection reporting was dishonest at first** — only violating rows were
   listed, so a 3-row AHU read "0 imported, 1 skipped". Now every row of a
   rejected AHU is reported with its own reason.

### Still open
- Year-boundary pairs (see above).
- Browser click-through of the amber badge and the month-label fallback.
