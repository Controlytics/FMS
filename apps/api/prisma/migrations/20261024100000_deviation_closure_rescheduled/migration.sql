-- 2026-10-24 (operator decision "Close as Rescheduled"): an overdue PM visit
-- moved to a new date whose window has not closed closes its open deviation as
-- RESCHEDULED (pm-deviations.ts closeDeviationIfRescheduled). Until then a date
-- change never touched the deviation and the visit stayed "Overdue" on My Tasks.
-- Additive only; same pattern as 20261019090000_block_change_notification_types.
ALTER TYPE "deviation_closure_kind" ADD VALUE IF NOT EXISTS 'RESCHEDULED';
