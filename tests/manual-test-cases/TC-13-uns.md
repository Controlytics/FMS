# TC-13: Unified Namespace (UNS) -- Test Cases

## Overview
- **Module**: Unified Namespace (ISA-95 hierarchy)
- **API Endpoints**: 6 (GET /tree, GET /entity/:entityId, PUT /entity/:entityId, POST /entity/:entityId/move, POST /entity/:entityId/move/confirm, GET /search)
- **Frontend Pages**: /config/uns
- **Permissions**: GET /tree requires SUPER_ADMIN/ADMIN/SUPERVISOR role; GET /entity requires ASSET_VIEW permission; PUT override requires SUPER_ADMIN; Move requires SUPER_ADMIN/ADMIN; Search requires ASSET_VIEW
- **Reauth Actions**: OVERRIDE_UNS_PATH, UPDATE_UNS_CONFIG
- **Key Facts**: UNS paths auto-generated from entity hierarchy. Overrides persist through moves. Cascade move updates all descendant paths atomically.

---

## Positive Test Cases

### TC-13-P01: Get Full UNS Tree
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN/ADMIN/SUPERVISOR. At least one entity with a UNS mapping exists.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/uns/tree.
  2. Verify response is an array of hierarchical tree nodes.
  3. Verify tree reflects ISA-95 structure (site/area/line/cell/device levels).
- **Expected Result**: Complete UNS tree structure returned.

### TC-13-P02: Get Entity UNS Mapping
- **Priority**: High
- **Preconditions**: An entity with a UNS mapping exists.
- **Test Data**: Valid entityId with UNS mapping.
- **Steps**:
  1. Send GET /api/uns/entity/{entityId}.
  2. Verify response has id, entityId, unsPath, isOverridden, entityName, createdAt, updatedAt.
- **Expected Result**: UNS mapping details for the entity returned.

### TC-13-P03: Override Entity UNS Path (SUPER_ADMIN)
- **Priority**: High
- **Preconditions**: Authenticated as SUPER_ADMIN. Entity has existing UNS mapping.
- **Test Data**: `{"unsPath": "site/custom-area/custom-device"}`
- **Steps**:
  1. Send PUT /api/uns/entity/{entityId} with new unsPath (reauth required).
  2. Verify response has updated unsPath and `isOverridden: true`.
  3. Verify audit entry UNS_PATH_OVERRIDDEN created.
  4. Verify the entity's unsPath in AssetInstance is also updated.
- **Expected Result**: UNS path overridden, isOverridden flag set to true.

### TC-13-P04: Generate Move Impact Report
- **Priority**: Medium
- **Preconditions**: Authenticated as SUPER_ADMIN/ADMIN. Entity has children with UNS mappings.
- **Test Data**: `{"newParentId": "<target-parent-id>"}` or `{"newParentId": null}` for root.
- **Steps**:
  1. Send POST /api/uns/entity/{entityId}/move with newParentId.
  2. Verify response has `impact` array and `summary` object.
  3. Verify impact shows currentPath and newPath for each affected entity.
  4. Verify summary has totalAffected, directChildren, descendants counts.
- **Expected Result**: Impact report showing all UNS paths that would change.

### TC-13-P05: Confirm Cascade Move
- **Priority**: High
- **Preconditions**: Impact report reviewed from TC-13-P04.
- **Test Data**: `{"newParentId": "<target-parent-id>"}`
- **Steps**:
  1. Send POST /api/uns/entity/{entityId}/move/confirm (reauth required).
  2. Verify response: `{ success: true, updated: N }`.
  3. Verify all descendant UNS paths updated in UnsMapping table.
  4. Verify audit entry UNS_CONFIG_UPDATED created.
- **Expected Result**: All affected UNS paths updated atomically.

### TC-13-P06: Search UNS by Wildcard Pattern
- **Priority**: Medium
- **Preconditions**: UNS mappings exist.
- **Test Data**: `path=site/area/*`
- **Steps**:
  1. Send GET /api/uns/search?path=site/area/*.
  2. Verify response is an array of matching UNS mappings.
  3. Each result has id, entityId, unsPath, isOverridden, entityName.
- **Expected Result**: Mappings matching the wildcard pattern returned.

### TC-13-P07: Search UNS with Multi-Level Wildcard
- **Priority**: Low
- **Preconditions**: UNS mappings exist at multiple levels.
- **Test Data**: `path=site/*`
- **Steps**:
  1. Send GET /api/uns/search?path=site/*.
  2. Verify results include all entities under the "site" prefix.
- **Expected Result**: All matching paths returned.

---

## Negative Test Cases

### TC-13-N01: Get UNS Tree Without Sufficient Role
- **Priority**: High
- **Preconditions**: Authenticated as OPERATOR (not SUPER_ADMIN/ADMIN/SUPERVISOR).
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/uns/tree as OPERATOR.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-13-N02: Override UNS Path Without SUPER_ADMIN Role
- **Priority**: High
- **Preconditions**: Authenticated as ADMIN (not SUPER_ADMIN).
- **Test Data**: `{"unsPath": "site/hacked"}`
- **Steps**:
  1. Send PUT /api/uns/entity/{entityId} as ADMIN.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-13-N03: Get UNS Mapping for Non-Mapped Entity
- **Priority**: Medium
- **Preconditions**: Entity exists but has no UNS mapping.
- **Test Data**: Valid entity ID without UNS mapping.
- **Steps**:
  1. Send GET /api/uns/entity/{entityId}.
  2. Verify 404.
- **Expected Result**: 404 `{ error: "UNS mapping not found for this entity" }`.

### TC-13-N04: Override UNS Path for Non-Mapped Entity
- **Priority**: Medium
- **Preconditions**: Authenticated as SUPER_ADMIN. Entity has no UNS mapping.
- **Test Data**: `{"unsPath": "site/new-path"}`
- **Steps**:
  1. Send PUT /api/uns/entity/{entityId} for entity without mapping.
  2. Verify 404 `{ error: "UNS mapping not found for this entity" }`.
- **Expected Result**: 404 error.

### TC-13-N05: Move Entity Without Sufficient Role
- **Priority**: Medium
- **Preconditions**: Authenticated as OPERATOR.
- **Test Data**: `{"newParentId": null}`
- **Steps**:
  1. Send POST /api/uns/entity/{entityId}/move as OPERATOR.
  2. Verify 403.
- **Expected Result**: 403 Forbidden.

### TC-13-N06: Search UNS Without ASSET_VIEW Permission
- **Priority**: Medium
- **Preconditions**: Authenticated user without ASSET_VIEW permission.
- **Test Data**: `path=site/*`
- **Steps**:
  1. Send GET /api/uns/search?path=site/* without ASSET_VIEW permission.
  2. Verify 403.
- **Expected Result**: 403 Forbidden.

### TC-13-N07: Access UNS Tree Without Authentication
- **Priority**: High
- **Preconditions**: No auth token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/uns/tree without Authorization header.
  2. Verify 401.
- **Expected Result**: 401 Unauthorized.


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

