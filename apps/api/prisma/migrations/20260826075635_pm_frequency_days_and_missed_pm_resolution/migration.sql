-- PM recurring schedules (`frequency_days`) + missed-PM resolution.
--
-- Hand-authored from `prisma migrate diff --from-migrations --to-schema-datamodel`
-- (2026-08-26). Purely ADDITIVE: new enum, new nullable columns, two new
-- indexes. No column is dropped, narrowed or re-typed, so existing rows and the
-- hash-chained audit_trail are untouched.
--
-- One statement was STRIPPED from the generated diff, per the documented
-- procedure in apps/api/CLAUDE.md:
--
--     ALTER TABLE "deviations" ALTER COLUMN "deviation_number"
--       SET DEFAULT ('DEV-' || lpad((nextval('deviation_number_seq'))::text, 6, '0'));
--
-- `deviation_number_seq` is managed out-of-band in prisma/sql/, and the baseline
-- pg_dump already installs that default. Prisma re-emits it on every diff simply
-- because a dbgenerated() default is opaque to the datamodel comparison. Keeping
-- it here would be a no-op at best and, on a DB where the sequence had not yet
-- been created, a failure.

-- CreateEnum
-- How a deviation reached CLOSED. COMPLETED_LATE = the missed PM was actually
-- performed, late, with a reason. SKIPPED = a later PM was performed instead and
-- this one was justified away; the PM did NOT happen. Recording a skip as a
-- completion would assert a maintenance that never occurred (21 CFR §11).
CREATE TYPE "deviation_closure_kind" AS ENUM ('COMPLETED_LATE', 'SKIPPED');

-- AlterTable
-- Binds a cleaning cycle to the scheduled PM occurrence it is being performed
-- FOR. PM tasks stack (an unmet August entry does not stop September's from
-- generating), so without this binding a single cleaning that falls inside two
-- open tolerance windows would credit BOTH tasks and close BOTH deviations.
ALTER TABLE "cleaning_cycles" ADD COLUMN "pm_schedule_entry_id" UUID;

-- AlterTable
ALTER TABLE "deviations"
  ADD COLUMN "closure_kind" "deviation_closure_kind",
  ADD COLUMN "closure_reason" TEXT;

-- AlterTable
-- Path A (late_reason*): the operator performed this missed PM after its window
-- closed. Path B (skipped*): the operator performed a later PM instead and
-- justified skipping this one. Stored rather than derived — every other task
-- status is computed from cleaning-cycle timestamps, but a skip has no cleaning
-- behind it and needs who / when / why on the row to be a §11 record.
ALTER TABLE "pm_schedule_entries"
  ADD COLUMN "late_reason"     TEXT,
  ADD COLUMN "late_reason_at"  TIMESTAMPTZ,
  ADD COLUMN "late_reason_by"  UUID,
  ADD COLUMN "skip_reason"     TEXT,
  ADD COLUMN "skipped_at"      TIMESTAMPTZ,
  ADD COLUMN "skipped_by"      UUID,
  ADD COLUMN "skipped_by_name" VARCHAR(255);

-- AlterTable
-- NULL frequency_days = a legacy one-off schedule, behaviour unchanged.
-- Accepted values are multiples of 30 (30 days = one calendar month, so the PM
-- keeps its day-of-month). anchor_date is the first occurrence; every later one
-- is anchor + k months, never a step off the previous occurrence. series_id ties
-- together the per-year PmSchedule rows of one recurring series.
ALTER TABLE "pm_schedules"
  ADD COLUMN "anchor_date"    DATE,
  ADD COLUMN "frequency_days" INTEGER,
  ADD COLUMN "series_id"      UUID;

-- CreateIndex
CREATE INDEX "cleaning_cycles_pm_schedule_entry_id_idx" ON "cleaning_cycles"("pm_schedule_entry_id");

-- CreateIndex
CREATE INDEX "pm_schedules_series_id_idx" ON "pm_schedules"("series_id");
