-- Phase 5b.5: DB-side invariants that Prisma cannot express
--
-- Apply after every `prisma db push`. Idempotent — safe to re-run.
-- Run via:  psql -h localhost -U digilog -d digilog_db -f apps/api/prisma/sql/invariants.sql

-- ─── Invariant 1: at most ONE IN_PROGRESS cycle per filter ─────────────────
-- The transactional re-check in startCycle is belt; this partial unique index
-- is suspenders. Prevents data corruption from buggy services or manual DB edits.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaning_cycles_one_in_progress_per_filter
  ON cleaning_cycles (filter_id)
  WHERE status = 'IN_PROGRESS';

-- ─── Invariant 2: FilterEvent.filterId must match its cycle's filterId ─────
-- Step 6 split filter cycle state off AssetInstance into FilterDetails. This
-- trigger ensures that FilterEvent rows with cycleId set always reference an
-- event for the SAME filter that owns the cycle — no cross-filter event leakage.
CREATE OR REPLACE FUNCTION check_filter_event_consistency() RETURNS TRIGGER AS $$
DECLARE
  cycle_filter_id UUID;
BEGIN
  IF NEW.cycle_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT filter_id INTO cycle_filter_id FROM cleaning_cycles WHERE id = NEW.cycle_id;
  IF cycle_filter_id IS NULL THEN
    RAISE EXCEPTION 'FilterEvent references non-existent cycle %', NEW.cycle_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF cycle_filter_id <> NEW.filter_id THEN
    RAISE EXCEPTION 'FilterEvent.filter_id (%) does not match cycle.filter_id (%) for cycle %',
      NEW.filter_id, cycle_filter_id, NEW.cycle_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_filter_event_consistency ON filter_events;
CREATE TRIGGER trg_filter_event_consistency
  BEFORE INSERT OR UPDATE OF cycle_id, filter_id ON filter_events
  FOR EACH ROW EXECUTE FUNCTION check_filter_event_consistency();

-- Confirmation log (visible when run via psql)
\echo 'Invariants applied: idx_cleaning_cycles_one_in_progress_per_filter + trg_filter_event_consistency'
