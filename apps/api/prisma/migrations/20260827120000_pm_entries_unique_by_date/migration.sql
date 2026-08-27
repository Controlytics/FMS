-- PM schedules: allow many irregular visits per AHU per year.
--
-- `pm_schedule_entries_schedule_id_month_key` capped an AHU at ONE visit per
-- calendar month (12 a year). Operators upload a whole year in one file in which
-- the same AHU appears many times with irregular gaps -- some near a month, some
-- shorter -- so the month key was the wrong grain, and the importer silently
-- collapsed same-month rows ("last wins") rather than reporting them.
--
-- The date is the real identity of a visit, so the uniqueness moves there.
-- `month` is KEPT: it is a display label on the schedule detail page and in the
-- export, and dropping it would touch four more files for no gain.
--
-- Safe to build: verified zero (schedule_id, planned_date) duplicates in
-- digilog_db before authoring this.
--
-- Ordering matters -- the new index is created BEFORE the old constraint is
-- dropped, so the table is never briefly unconstrained.

CREATE UNIQUE INDEX IF NOT EXISTS "pm_schedule_entries_schedule_id_planned_date_key"
  ON "pm_schedule_entries" ("schedule_id", "planned_date");

-- Prisma may materialise `@@unique` either as a table CONSTRAINT or as a bare
-- unique INDEX depending on when it was created. Drop both spellings: dropping
-- only the constraint leaves the index in place, still silently enforcing
-- one-visit-per-month. (Observed exactly that on digilog_db.)
ALTER TABLE "pm_schedule_entries"
  DROP CONSTRAINT IF EXISTS "pm_schedule_entries_schedule_id_month_key";

DROP INDEX IF EXISTS "pm_schedule_entries_schedule_id_month_key";
