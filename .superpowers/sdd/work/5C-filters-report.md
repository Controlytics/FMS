# Phase 5C — Filters Page RBAC Refactor Report

**File:** `apps/web/src/routes/filter-management/filter-list.tsx`  
**Commit:** `feat(rbac): Filters page button gating via useCan() (Phase 5C)`  
**Date:** 2026-06-30  

## Changes Made

- Replaced `import { useAuth } from '@/hooks/use-auth'` with `import { useCan } from '@/hooks/use-can'`
- Removed `const { user } = useAuth()`, `const isSuperAdmin`, `const perms`, `const hasPerm` (all 4 locals gone)
- Added `const can = useCan()`
- Replaced 11 flag consts to use `can('<node-id>')` per mapping table below
- Replaced inline ad-hoc `hasPerm('ASSET_DELETE')` at block-delete button with `can('filters.hierarchy_delete')`
- Left `ExportMenu` and `SendForReviewButton` ungated (no `filters.export` node exists; gating a missing node returns `false` for all non-SA users — that would be a regression)

## Button → Gate Mapping

| Button / Flag | Old Check | Node ID | New Gate | Status |
|---|---|---|---|---|
| `canCreate` (Create Block) | `hasPerm('FILTER_HIERARCHY_CREATE')` | `filters.hierarchy_create` | `['ASSET_CREATE','FILTER_CREATE','FILTER_HIERARCHY_CREATE']` | CHANGED — broader: adds ASSET_CREATE and FILTER_CREATE |
| `canBulkUpload` (Bulk Upload) | `hasPerm('FILTER_BULK_UPLOAD')` | `filters.bulk_upload` | `['ASSET_CREATE','FILTER_BULK_UPLOAD']` | CHANGED — broader: adds ASSET_CREATE |
| `canCreateFilter` (Create Filter) | `hasPerm('FILTER_CREATE') \|\| hasPerm('ASSET_CREATE')` | `filters.create` | `['ASSET_CREATE','FILTER_CREATE','FILTER_HIERARCHY_CREATE']` | CHANGED — broader: adds FILTER_HIERARCHY_CREATE |
| `canEditFilter` (Edit Filter row action) | `hasPerm('FILTER_EDIT') \|\| hasPerm('ASSET_UPDATE')` | `filters.edit` | `['ASSET_UPDATE','FILTER_EDIT','FILTER_HIERARCHY_EDIT']` | CHANGED — broader: adds FILTER_HIERARCHY_EDIT |
| `canDeleteFilter` (Delete Filter row action) | `hasPerm('FILTER_DELETE') \|\| hasPerm('ASSET_DELETE')` | `filters.delete` | `['ASSET_DELETE','FILTER_DELETE','FILTER_HIERARCHY_DELETE']` | CHANGED — broader: adds FILTER_HIERARCHY_DELETE |
| `canEditHierarchy` (Edit block/area/AHU + diagramPerms) | `hasPerm('FILTER_HIERARCHY_EDIT') \|\| hasPerm('ASSET_UPDATE')` | `filters.hierarchy_edit` | `['ASSET_UPDATE','FILTER_EDIT','FILTER_HIERARCHY_EDIT']` | CHANGED — broader: adds FILTER_EDIT |
| `canDeleteHierarchy` (diagramPerms hierarchy delete) | `hasPerm('FILTER_HIERARCHY_DELETE') \|\| hasPerm('ASSET_DELETE')` | `filters.hierarchy_delete` | `['ASSET_DELETE','FILTER_DELETE','FILTER_HIERARCHY_DELETE']` | CHANGED — broader: adds FILTER_DELETE |
| `canRetire` (Retire, bulk retire) | `hasPerm('FILTER_RETIRE')` | `filters.retire` | `['FILTER_RETIRE']` | SAME |
| `canReplace` (Replace, bulk replace) | `hasPerm('FILTER_REPLACE')` | `filters.replace` | `['FILTER_REPLACE']` | SAME |
| `canStatusUpdate` (Update Status, bulk status) | `hasPerm('FILTER_STATUS_UPDATE')` | `filters.status_update` | `['FILTER_STATUS_UPDATE']` | SAME |
| `canRfid` (RFID tag row action) | `hasPerm('FILTER_RFID_MANAGE')` | `filters.rfid_manage` | `['FILTER_RFID_MANAGE']` | SAME |
| Delete block button (inline, L~1452) | `hasPerm('ASSET_DELETE')` | `filters.hierarchy_delete` | `['ASSET_DELETE','FILTER_DELETE','FILTER_HIERARCHY_DELETE']` | CHANGED — broader: adds FILTER_DELETE and FILTER_HIERARCHY_DELETE |
| ExportMenu | ungated | (no `filters.export` node) | — | LEFT UNGATED — `filters.export` absent; gating it would deny all non-SA users |
| SendForReviewButton | ungated | (no `filters.export` node) | — | LEFT UNGATED — `filters.export` absent; gating it would deny all non-SA users |

## Notes

- All "CHANGED" deltas are **corrections/broadenings** — no user loses a button they already had. Every change reflects the permission tree correctly representing which permissions the backend already accepts for these operations.
- `diagramPerms` at L1293 (`{ canCreate, canEditHierarchy, canDeleteHierarchy }`) automatically picks up the new `can()` values — no change needed to that line.
- TypeScript check (`npx tsc -p apps/web/tsconfig.json --noEmit`) returned clean.
