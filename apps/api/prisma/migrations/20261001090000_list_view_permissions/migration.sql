-- 2026-10-01 -- Retirement List / Replacement List get their own View permission.
--
-- DATA migration only: no table, column, index or enum changes.
--
-- Until now both pages rode on "View Filters" (ASSET_VIEW / ASSET_READ), so
-- Roles & Access -> Permissions had no View toggle to offer for either page.
-- The code now gates each page on its own permission (RETIREMENT_LIST_VIEW /
-- REPLACEMENT_LIST_VIEW). Without this backfill every existing role would lose
-- both pages the moment the new build starts.
--
-- Rule: a role gets the new permission exactly when it can see the page TODAY:
--   * it holds ASSET_VIEW or ASSET_READ (the old sidebar rule), AND
--   * its sidebar allow-list does not exclude the page (no role_configs row, or
--     an empty list, means "no allow-list" -- sidebar.tsx shows the item).
-- So effective access is unchanged; it is only expressed under a new name.
--
-- Idempotent: every statement skips rows that already carry the value.

-- 1. roles.permissions ---------------------------------------------------------
UPDATE "roles" r
SET "permissions" = r."permissions" || '["RETIREMENT_LIST_VIEW"]'::jsonb
WHERE (r."permissions" ? 'ASSET_VIEW' OR r."permissions" ? 'ASSET_READ')
  AND NOT r."permissions" ? 'RETIREMENT_LIST_VIEW'
  AND NOT EXISTS (
    SELECT 1 FROM "role_configs" rc
    WHERE rc."role" = r."name"
      AND jsonb_typeof(rc."sidebar_items") = 'array'
      AND jsonb_array_length(rc."sidebar_items") > 0
      AND NOT rc."sidebar_items" ? 'filter-retirements'
  );

UPDATE "roles" r
SET "permissions" = r."permissions" || '["REPLACEMENT_LIST_VIEW"]'::jsonb
WHERE (r."permissions" ? 'ASSET_VIEW' OR r."permissions" ? 'ASSET_READ')
  AND NOT r."permissions" ? 'REPLACEMENT_LIST_VIEW'
  AND NOT EXISTS (
    SELECT 1 FROM "role_configs" rc
    WHERE rc."role" = r."name"
      AND jsonb_typeof(rc."sidebar_items") = 'array'
      AND jsonb_array_length(rc."sidebar_items") > 0
      AND NOT rc."sidebar_items" ? 'filter-replacements'
  );

-- 2. role_configs.permissions --------------------------------------------------
-- The Permissions tab renders the STORED toggle map when one exists, and a save
-- rebuilds roles.permissions from it. A stored map without the new keys would
-- show the toggle off and strip the permission on the next save. An empty map
-- is left alone: the service then derives the toggles from roles.permissions.
UPDATE "role_configs" rc
SET "permissions" = rc."permissions" || jsonb_build_object(
  'retirement.view',
  COALESCE((SELECT r."permissions" ? 'RETIREMENT_LIST_VIEW' FROM "roles" r WHERE r."name" = rc."role"), false)
)
WHERE jsonb_typeof(rc."permissions") = 'object'
  AND rc."permissions" <> '{}'::jsonb
  AND NOT rc."permissions" ? 'retirement.view';

UPDATE "role_configs" rc
SET "permissions" = rc."permissions" || jsonb_build_object(
  'replacement.view',
  COALESCE((SELECT r."permissions" ? 'REPLACEMENT_LIST_VIEW' FROM "roles" r WHERE r."name" = rc."role"), false)
)
WHERE jsonb_typeof(rc."permissions") = 'object'
  AND rc."permissions" <> '{}'::jsonb
  AND NOT rc."permissions" ? 'replacement.view';
