-- Add dryer_readings_submitted column to cleaning_cycles
-- Fixes: tx.cleaningCycle.update() failing with "column does not exist"
-- when dryerAction='SUBMIT_READINGS' in advance() flow.
ALTER TABLE "cleaning_cycles"
  ADD COLUMN IF NOT EXISTS "dryer_readings_submitted" BOOLEAN NOT NULL DEFAULT false;
