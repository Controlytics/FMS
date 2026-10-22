-- Must-exist check for scripts/verify-migrations.ps1 (D-DB-1, 2026-10-22).
--
-- READ-ONLY. Run against the scratch DB built purely from migrations. Prints
-- one line per migration-only object the application relies on that the
-- migrations do NOT produce exactly as below; no output = all present.
--
-- Why this exists beside the catalog comparison: comparing scratch with the
-- reference only catches DIVERGENCE. A migration that drops
-- audit_trail_no_delete, once `migrate deploy`ed to the dev DB as well, leaves
-- both sides identical and the comparison passes. These objects must come out
-- of the migrations whatever the reference DB holds.
--
-- What relies on each one:
--   asset_instances_active_name_key  one ACTIVE filter / hierarchy node per name
--                                    (case-insensitive); retired names reusable.
--   idx_cleaning_cycles_one_in_progress_per_filter
--                                    one IN_PROGRESS cleaning cycle per filter.
--   asset_identifiers_one_per_asset  one identifier (RFID tag) per asset (2026-10-22;
--                                    not @unique in schema.prisma on purpose).
--   filter_events_cycle_type_at_idx  cycle performer lookup; INCLUDE cannot be
--                                    expressed in schema.prisma (2026-10-22).
--   audit_trail_no_delete +          21 CFR §11: audit rows cannot be deleted
--   block_audit_trail_delete()       (the hard-delete endpoint disables it inside
--                                    its own transaction; at rest it is enabled).
--   trg_filter_event_consistency     a filter event's cycle belongs to its filter.
--   trg_asset_relationship_pair      CONTAINS / CONTAINED_IN rows come in pairs.
--   trg_mirror_asset_instance_iud,   asset_instances <-> typed filters mirror.
--   trg_mirror_typed_to_asset_instance
--
-- Changing one of these objects ON PURPOSE (in a new migration) means changing
-- its expected definition here in the same commit.
SET search_path = public, pg_catalog;

WITH expected(kind, name, def) AS (VALUES
  ('index', 'asset_instances_active_name_key',
   'CREATE UNIQUE INDEX asset_instances_active_name_key ON public.asset_instances USING btree (lower((name)::text)) WHERE is_active'),
  ('index', 'idx_cleaning_cycles_one_in_progress_per_filter',
   'CREATE UNIQUE INDEX idx_cleaning_cycles_one_in_progress_per_filter ON public.cleaning_cycles USING btree (filter_id) WHERE (status = ''IN_PROGRESS''::cleaning_cycle_status)'),
  ('index', 'asset_identifiers_one_per_asset',
   'CREATE UNIQUE INDEX asset_identifiers_one_per_asset ON public.asset_identifiers USING btree (asset_id)'),
  ('index', 'filter_events_cycle_type_at_idx',
   'CREATE INDEX filter_events_cycle_type_at_idx ON public.filter_events USING btree (cycle_id, event_type, performed_at DESC) INCLUDE (performed_by)'),
  ('trigger', 'audit_trail_no_delete',
   'CREATE TRIGGER audit_trail_no_delete BEFORE DELETE ON public.audit_trail FOR EACH ROW EXECUTE FUNCTION block_audit_trail_delete()'),
  ('trigger', 'trg_filter_event_consistency',
   'CREATE TRIGGER trg_filter_event_consistency BEFORE INSERT OR UPDATE OF cycle_id, filter_id ON public.filter_events FOR EACH ROW EXECUTE FUNCTION check_filter_event_consistency()'),
  ('trigger', 'trg_asset_relationship_pair',
   'CREATE CONSTRAINT TRIGGER trg_asset_relationship_pair AFTER INSERT OR DELETE ON public.asset_relationships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_asset_relationship_pair()'),
  ('trigger', 'trg_mirror_asset_instance_iud',
   'CREATE TRIGGER trg_mirror_asset_instance_iud AFTER INSERT OR DELETE OR UPDATE ON public.asset_instances FOR EACH ROW EXECUTE FUNCTION fn_mirror_asset_instance()'),
  ('trigger', 'trg_mirror_typed_to_asset_instance',
   'CREATE TRIGGER trg_mirror_typed_to_asset_instance AFTER INSERT OR DELETE OR UPDATE ON public.filters FOR EACH ROW EXECUTE FUNCTION fn_mirror_typed_to_asset_instance()')
),
actual AS (
  SELECT 'index' AS kind, c.relname::text AS name, pg_get_indexdef(i.indexrelid) AS def, 'O' AS enabled
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relnamespace = 'public'::regnamespace
  UNION ALL
  SELECT 'trigger', t.tgname::text, pg_get_triggerdef(t.oid), t.tgenabled::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
)
SELECT 'REQUIRED ' || e.kind || ' ' || e.name || ': ' ||
       CASE
         WHEN a.name IS NULL THEN 'MISSING from the migrated schema'
         WHEN a.def <> e.def THEN 'definition differs - expected [' || e.def || '] got [' || a.def || ']'
         ELSE 'present but DISABLED (tgenabled=' || a.enabled || ')'
       END
FROM expected e
LEFT JOIN actual a ON a.kind = e.kind AND a.name = e.name
WHERE a.name IS NULL OR a.def <> e.def OR a.enabled <> 'O'

UNION ALL
-- The trigger's function must still refuse the delete. A body rewritten to
-- RETURN OLD keeps the trigger "present and enabled" while it guards nothing.
SELECT 'REQUIRED function block_audit_trail_delete(): ' ||
       CASE WHEN p.oid IS NULL THEN 'MISSING from the migrated schema'
            ELSE 'body no longer raises an exception' END
FROM (SELECT 1) one
LEFT JOIN pg_proc p ON p.oid = to_regprocedure('public.block_audit_trail_delete()')
WHERE p.oid IS NULL OR p.prosrc !~* 'RAISE\s+EXCEPTION';
