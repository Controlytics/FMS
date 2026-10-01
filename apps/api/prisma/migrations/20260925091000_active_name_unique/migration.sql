-- 2026-09-25 -- strict audit 2026-09-24 DB finding: no unique index on filter
-- names. The service layer already refuses a duplicate ACTIVE name
-- case-insensitively (instance.service / filter.service); this makes the
-- database enforce the same rule, so two concurrent creates or a raw insert
-- cannot slip a duplicate past the application check. Partial (active rows
-- only): a soft-deleted or retired row keeps its name and must not block the
-- name being used again. Expression index -> not expressible in schema.prisma;
-- the drift guard compares migrations to the live DB, so both carry it.
CREATE UNIQUE INDEX "asset_instances_active_name_key" ON "asset_instances" (lower(name)) WHERE is_active;
