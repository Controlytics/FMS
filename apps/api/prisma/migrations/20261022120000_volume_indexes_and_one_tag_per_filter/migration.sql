-- 2026-10-22 (operator decision): three indexes.
--
-- 1. cleaning_stage_approvals(requested_at) — every Stage Approvals list orders
--    by requested_at DESC (and the windowed list filters on it). At one year of
--    volume (1.0 M rows, digilog_perf) both were a sequential scan + sort.
--    Also declared in schema.prisma (@@index([requestedAt])).
CREATE INDEX "cleaning_stage_approvals_requested_at_idx" ON "cleaning_stage_approvals" ("requested_at");

-- 2. The cycles list's "who performed the last stage / ended the cycle" lookup
--    (filter-operations.service.ts: per cycle, latest event of a type, its
--    performed_by). Ordered by performed_at DESC with performed_by carried in
--    the index, it is a single index probe per cycle.
--    MIGRATION-ONLY: schema.prisma cannot express INCLUDE. Repeated in
--    prisma/sql/invariants.sql and asserted by scripts/verify-migrations.required.sql.
CREATE INDEX "filter_events_cycle_type_at_idx" ON "filter_events" ("cycle_id", "event_type", "performed_at" DESC) INCLUDE ("performed_by");

-- 3. One identifier per asset (D-DB-2). identifierService enforces it under
--    advisory locks since 2026-10-22; this is the database's own guarantee, so
--    a raw insert or a future unlocked write path cannot give a filter two tags.
--    MIGRATION-ONLY on purpose: a Prisma @unique on asset_id would turn the
--    AssetInstance -> AssetIdentifier relation 1:1 and change the client types.
--    Repeated in invariants.sql and asserted by verify-migrations.required.sql.
--    A database that already holds two identifiers on one asset cannot take the
--    index: refuse with the offending assets named instead of a bare 23505.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(asset_id::text || ' (' || n || ' identifiers)', ', ')
    INTO dupes
    FROM (SELECT asset_id, count(*) AS n FROM asset_identifiers GROUP BY asset_id HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION 'asset_identifiers_one_per_asset: these assets hold more than one identifier - remove the extra tag(s) first: %', dupes;
  END IF;
END $$;
CREATE UNIQUE INDEX "asset_identifiers_one_per_asset" ON "asset_identifiers" ("asset_id");
