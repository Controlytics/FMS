-- Phase 5b.5: DB-side invariants that Prisma cannot express
--
-- Audit 2026-05-04 fix data-layer C2: these invariants are now ALSO installed
-- by the dedicated migration `20260504190000_compliance_invariants`. This
-- file remains as defense-in-depth for `prisma db push` workflows that bypass
-- migrations (typically dev). Operators should rely on the migration as the
-- authoritative installer.
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

-- ─── Invariant 3: AssetRelationship bidirectional pair must exist (Step 2) ──
-- Every (source, target, type) row implies a (target, source, INVERSE(type)) row
-- must also exist. Enforced as a deferred constraint trigger so create-pair
-- transactions can insert both rows without ordering games.
CREATE OR REPLACE FUNCTION inverse_relationship_type(rt relationship_type_enum)
RETURNS relationship_type_enum AS $$
BEGIN
  RETURN CASE rt
    WHEN 'CONTAINS' THEN 'CONTAINED_IN'
    WHEN 'CONTAINED_IN' THEN 'CONTAINS'
    WHEN 'CONNECTED_TO' THEN 'CONNECTED_TO'
    WHEN 'FEEDS' THEN 'FED_BY'
    WHEN 'FED_BY' THEN 'FEEDS'
    WHEN 'DEPENDS_ON' THEN 'DEPENDED_ON_BY'
    WHEN 'DEPENDED_ON_BY' THEN 'DEPENDS_ON'
    WHEN 'BACKS_UP' THEN 'BACKED_UP_BY'
    WHEN 'BACKED_UP_BY' THEN 'BACKS_UP'
    WHEN 'MONITORS' THEN 'MONITORED_BY'
    WHEN 'MONITORED_BY' THEN 'MONITORS'
    WHEN 'CUSTOM' THEN 'CUSTOM'
  END::relationship_type_enum;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION check_asset_relationship_pair() RETURNS TRIGGER AS $$
DECLARE
  inv_type relationship_type_enum;
  pair_exists BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    inv_type := inverse_relationship_type(NEW.relationship_type);
    SELECT EXISTS (
      SELECT 1 FROM asset_relationships
      WHERE source_asset_id = NEW.target_asset_id
        AND target_asset_id = NEW.source_asset_id
        AND relationship_type = inv_type
    ) INTO pair_exists;
    IF NOT pair_exists THEN
      RAISE EXCEPTION 'AssetRelationship bidirectional pair invariant violated: (% -> % via %) requires inverse (% -> % via %)',
        NEW.source_asset_id, NEW.target_asset_id, NEW.relationship_type,
        NEW.target_asset_id, NEW.source_asset_id, inv_type
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    inv_type := inverse_relationship_type(OLD.relationship_type);
    -- Only complain if the inverse still exists. The pair-delete transaction
    -- removes both; the second delete sees no inverse and passes.
    SELECT EXISTS (
      SELECT 1 FROM asset_relationships
      WHERE source_asset_id = OLD.target_asset_id
        AND target_asset_id = OLD.source_asset_id
        AND relationship_type = inv_type
    ) INTO pair_exists;
    IF pair_exists THEN
      RAISE EXCEPTION 'Cannot delete AssetRelationship without its inverse pair: (% -> % via %) inverse (% -> % via %) still present',
        OLD.source_asset_id, OLD.target_asset_id, OLD.relationship_type,
        OLD.target_asset_id, OLD.source_asset_id, inv_type
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asset_relationship_pair ON asset_relationships;
CREATE CONSTRAINT TRIGGER trg_asset_relationship_pair
  AFTER INSERT OR DELETE ON asset_relationships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_asset_relationship_pair();

-- ─── Invariant 4: audit_trail no-delete trigger ────────────────────────────
-- C3 follow-up — referenced by tests + admin delete-audit endpoint
-- (audit/routes.ts disables before bulk delete + re-enables after).
CREATE OR REPLACE FUNCTION block_audit_trail_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail rows are immutable. Use the admin delete endpoint which temporarily disables this trigger under audit.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_trail_no_delete ON audit_trail;
CREATE TRIGGER audit_trail_no_delete
  BEFORE DELETE ON audit_trail
  FOR EACH ROW EXECUTE FUNCTION block_audit_trail_delete();

-- ─── Invariant 5: asset_instances ↔ typed-table mirror (2026-08-10) ────────
-- Keeps `asset_instances` and the typed hierarchy tables (blocks / areas / ahus
-- / filters) in lockstep, both directions.
--
-- WHY THIS IS HERE. These two triggers are defined ONLY in the baseline
-- migration, so any database whose baseline SQL never actually executed —
-- adopted via `migrate resolve --applied`, or built by `db push` + seed —
-- silently ends up without them. `digilog_db` was in exactly that state until
-- 2026-08-10: 3 of 5 triggers, and the missing mirror meant
-- `filterService.create` FAILED. That service inserts into `filters` only and
-- then creates the FilterDetails sidecar whose FK targets `asset_instances`,
-- relying on the reverse mirror to have created that row in the same txn
-- (see filter.service.ts:52-54). Without the trigger:
--     ERROR: insert or update on table "filter_details" violates foreign key
--            constraint "filter_details_asset_instance_id_fkey"
-- So this is not a nice-to-have sync — it is load-bearing for filter creation.
--
-- The migration remains the authoritative installer (see the file header); this
-- copy is defense-in-depth for the non-migration paths.
--
-- ⚠️ The two function bodies below are VERBATIM from
-- `prisma/migrations/00000000000000_baseline/migration.sql` (only `CREATE
-- FUNCTION` → `CREATE OR REPLACE FUNCTION`, for idempotency). If you change one,
-- change the other — a divergence here mirrors data incorrectly on exactly the
-- databases that already went wrong once.
--
-- ⚠️ ORDER MATTERS WHEN INSTALLING ONTO AN EXISTING DATABASE. If the two sides
-- have already drifted, arming the mirror lets whichever side is written next
-- overwrite the other. Reconcile first, in the correct direction, THEN apply.
-- (2026-08-10: 16 filters had a stale `lastCleaningDate` on the
-- `asset_instances` side; `filters` was authoritative.)

CREATE OR REPLACE FUNCTION public.fn_mirror_asset_instance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_kind TEXT;
  v_parent_kind TEXT;
  v_block_id UUID;
  v_area_id UUID;
  v_ahu_id UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT template_kind INTO v_kind FROM asset_templates WHERE id = OLD.template_id;
    DELETE FROM blocks  WHERE id = OLD.id;
    DELETE FROM areas   WHERE id = OLD.id;
    DELETE FROM ahus    WHERE id = OLD.id;
    DELETE FROM filters WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT template_kind INTO v_kind FROM asset_templates WHERE id = NEW.template_id;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT t.template_kind INTO v_parent_kind
    FROM asset_instances i
    JOIN asset_templates t ON i.template_id = t.id
    WHERE i.id = NEW.parent_id;
  END IF;

  IF v_kind = 'BLOCK' THEN
    DELETE FROM areas WHERE id = NEW.id;
    DELETE FROM ahus WHERE id = NEW.id;
    DELETE FROM filters WHERE id = NEW.id;
    INSERT INTO blocks (id, name, description, status, attributes, custom_attributes,
                        is_active, created_at, updated_at, created_by, updated_by)
    VALUES (NEW.id, NEW.name, NEW.description, NEW.status, NEW.attributes, NEW.custom_attributes,
            NEW.is_active, NEW.created_at, NEW.updated_at, NEW.created_by, NEW.updated_by)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
      attributes = EXCLUDED.attributes, custom_attributes = EXCLUDED.custom_attributes,
      is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

  ELSIF v_kind = 'AREA' THEN
    DELETE FROM blocks WHERE id = NEW.id;
    DELETE FROM ahus WHERE id = NEW.id;
    DELETE FROM filters WHERE id = NEW.id;
    v_block_id := CASE WHEN v_parent_kind = 'BLOCK' THEN NEW.parent_id ELSE NULL END;
    INSERT INTO areas (id, block_id, name, description, status, attributes, custom_attributes,
                       is_active, created_at, updated_at, created_by, updated_by)
    VALUES (NEW.id, v_block_id, NEW.name, NEW.description, NEW.status, NEW.attributes,
            NEW.custom_attributes, NEW.is_active, NEW.created_at, NEW.updated_at,
            NEW.created_by, NEW.updated_by)
    ON CONFLICT (id) DO UPDATE SET
      block_id = EXCLUDED.block_id, name = EXCLUDED.name, description = EXCLUDED.description,
      status = EXCLUDED.status, attributes = EXCLUDED.attributes,
      custom_attributes = EXCLUDED.custom_attributes, is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;

  ELSIF v_kind = 'AHU' THEN
    DELETE FROM blocks WHERE id = NEW.id;
    DELETE FROM areas WHERE id = NEW.id;
    DELETE FROM filters WHERE id = NEW.id;
    v_area_id := CASE WHEN v_parent_kind = 'AREA' THEN NEW.parent_id ELSE NULL END;
    v_block_id := CASE WHEN v_parent_kind = 'BLOCK' THEN NEW.parent_id ELSE NULL END;
    INSERT INTO ahus (id, area_id, block_id, name, description, status, attributes,
                      custom_attributes, is_active, created_at, updated_at, created_by, updated_by)
    VALUES (NEW.id, v_area_id, v_block_id, NEW.name, NEW.description, NEW.status,
            NEW.attributes, NEW.custom_attributes, NEW.is_active, NEW.created_at,
            NEW.updated_at, NEW.created_by, NEW.updated_by)
    ON CONFLICT (id) DO UPDATE SET
      area_id = EXCLUDED.area_id, block_id = EXCLUDED.block_id, name = EXCLUDED.name,
      description = EXCLUDED.description, status = EXCLUDED.status,
      attributes = EXCLUDED.attributes, custom_attributes = EXCLUDED.custom_attributes,
      is_active = EXCLUDED.is_active, updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

  ELSIF v_kind = 'FILTER' THEN
    DELETE FROM blocks WHERE id = NEW.id;
    DELETE FROM areas WHERE id = NEW.id;
    DELETE FROM ahus WHERE id = NEW.id;
    v_ahu_id := CASE WHEN v_parent_kind = 'AHU' THEN NEW.parent_id ELSE NULL END;
    INSERT INTO filters (id, ahu_id, name, description, status, attributes, custom_attributes,
                         is_active, created_at, updated_at, created_by, updated_by)
    VALUES (NEW.id, v_ahu_id, NEW.name, NEW.description, NEW.status, NEW.attributes,
            NEW.custom_attributes, NEW.is_active, NEW.created_at, NEW.updated_at,
            NEW.created_by, NEW.updated_by)
    ON CONFLICT (id) DO UPDATE SET
      ahu_id = EXCLUDED.ahu_id, name = EXCLUDED.name, description = EXCLUDED.description,
      status = EXCLUDED.status, attributes = EXCLUDED.attributes,
      custom_attributes = EXCLUDED.custom_attributes, is_active = EXCLUDED.is_active,
      updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;

  ELSE
    DELETE FROM blocks WHERE id = NEW.id;
    DELETE FROM areas WHERE id = NEW.id;
    DELETE FROM ahus WHERE id = NEW.id;
    DELETE FROM filters WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_mirror_typed_to_asset_instance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_tmpl UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    DELETE FROM asset_instances WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT id INTO v_tmpl FROM asset_templates
    WHERE template_kind = 'FILTER' AND is_active = true
    ORDER BY created_at ASC LIMIT 1;
  IF v_tmpl IS NULL THEN
    RAISE EXCEPTION 'No active FILTER asset_template to mirror filter % into asset_instances', NEW.id;
  END IF;
  INSERT INTO asset_instances
    (id, name, description, template_id, template_version, status, attributes,
     telemetry_config, custom_attributes, parent_id, is_active,
     created_at, updated_at, created_by, updated_by)
  VALUES
    (NEW.id, NEW.name, NEW.description, v_tmpl, 1, NEW.status, NEW.attributes,
     '{}'::jsonb, NEW.custom_attributes, NEW.ahu_id, NEW.is_active,
     NEW.created_at, NEW.updated_at, NEW.created_by, NEW.updated_by)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
    attributes = EXCLUDED.attributes, custom_attributes = EXCLUDED.custom_attributes,
    parent_id = EXCLUDED.parent_id, is_active = EXCLUDED.is_active,
    updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_asset_instance_iud ON asset_instances;
CREATE TRIGGER trg_mirror_asset_instance_iud
  AFTER INSERT OR DELETE OR UPDATE ON asset_instances
  FOR EACH ROW EXECUTE FUNCTION public.fn_mirror_asset_instance();

DROP TRIGGER IF EXISTS trg_mirror_typed_to_asset_instance ON filters;
CREATE TRIGGER trg_mirror_typed_to_asset_instance
  AFTER INSERT OR DELETE OR UPDATE ON filters
  FOR EACH ROW EXECUTE FUNCTION public.fn_mirror_typed_to_asset_instance();

-- Confirmation log (visible when run via psql)
\echo 'Invariants applied: idx_cleaning_cycles_one_in_progress_per_filter + trg_filter_event_consistency + trg_asset_relationship_pair + audit_trail_no_delete + trg_mirror_asset_instance_iud + trg_mirror_typed_to_asset_instance'
