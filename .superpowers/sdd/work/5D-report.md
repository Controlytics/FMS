# Phase 5D — Permissions Tab Tree Rebuild Report

**Status:** COMPLETE — all deliverables shipped, tests pass, lint clean.

## Save/Load Contract

Unchanged. Load path: `SWR /api/config/roles/${role}` → `data.permissions` (Record<featureId, boolean>). Save path: `api.put(\`/api/config/roles/${role}\`, { permissions })` — same Record<featureId, boolean> shape. `PermissionsTabHandle.save()`, `PermissionsTabProps`, `forwardRef/useImperativeHandle`, dirty/saving state, `togglePermission`, role-selection card, stats cards, and security notice are all preserved verbatim.

## Coverage Test Result

**All 8 assertions pass** (`permissions-tab-coverage.test.ts`):

- covers every FEATURE_PRIVILEGES id (no missing) ✓
- produces no extra ids not in FEATURE_PRIVILEGES ✓
- produces no duplicate ids ✓
- total count equals FEATURE_PRIVILEGES.length (98) ✓
- **other (catch-all) is empty — all FP ids are covered by the tree** ✓
- every group has at least one page group and at least one node ✓
- fpNodeIds consistent with pageGroup nodes ✓
- every node with reauthAction has a string reauthAction ✓

## Catch-All ("Other Permissions") Section

**Not needed.** The catch-all `other` array is empty — all 98 FEATURE_PRIVILEGES ids are covered by PERMISSION_TREE nodes. The catch-all section is implemented in the UI but hidden when `otherNodes.length === 0`. The test asserts this invariant holds.

## Reauth Badges

Nodes with a `reauthAction` on the tree node show a small `🔒 re-auth` amber pill badge inline next to the label. It is purely presentational — it reads `node.reauthAction` from the tree for display only and does not affect the save map or permission toggle logic.

## Architecture

Three files changed/created:

1. **`apps/web/src/routes/config/roles-components/permission-tree-grouping.ts`** (new) — Pure `.ts` helper. Exports `groupFeaturePrivilegesByTree()` and associated types. Walks `PERMISSION_TREE` in sidebar order, collects FP-backed nodes (those whose id ∈ FEATURE_PRIVILEGES), sub-groups by `page`, appends any uncovered FP ids to `other`.

2. **`apps/web/src/routes/config/roles-components/__tests__/permissions-tab-coverage.test.ts`** (new) — 8-assertion coverage test (pure, no React/DOM).

3. **`apps/web/src/routes/config/roles-components/permissions-tab.tsx`** (modified) — Replaces flat `FEATURE_PRIVILEGE_CATEGORIES` iteration with `groupFeaturePrivilegesByTree()` tree iteration. Memoized via `useMemo([], [])`. Per-sidebar-group Enable All / Disable All (`toggleGroup`). Page sub-headers shown when a group spans multiple pages. Reauth badges. All CATEGORY_COLORS constants removed (no longer needed). Light theme + existing checkbox visual style preserved.
