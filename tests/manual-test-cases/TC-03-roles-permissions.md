# TC-03: Roles & Permissions — Test Cases

## Overview
- **Module**: Role Management & Permission System
- **API Endpoints**: 8
- **Frontend Pages**: /config/roles, /config/role-privileges
- **Permissions**: ROLE_MANAGE (required for all except /active)
- **Reauth Actions**: CREATE_ROLE, UPDATE_ROLE, DELETE_ROLE
- **Default Roles**: SUPER_ADMIN (level 6), ADMIN (5), SUPERVISOR (4), MAINTENANCE (3), OPERATOR (2), VIEWER (1)

---

## Positive Test Cases

### TC-03-P01: List All Roles
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN (has ROLE_MANAGE permission)
- **Test Data**: None
- **Steps**:
  1. Send GET /api/roles
  2. Verify response is an array of role objects
  3. Verify each role has id, name, displayName, hierarchyLevel, permissions, color, isSystem, isActive
  4. Verify default roles are present (SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER)
- **Expected Result**: 200 OK with array of at least 6 default roles ordered by hierarchy level

### TC-03-P02: List Active Roles (Any Authenticated User)
- **Priority**: High
- **Preconditions**: Logged in as any authenticated user
- **Test Data**: None
- **Steps**:
  1. Send GET /api/roles/active
  2. Verify response is an array with minimal role fields
  3. Verify only active roles are returned
- **Expected Result**: 200 OK with array of active roles (id, name, displayName, hierarchyLevel, color)

### TC-03-P03: Get Role by Name
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: Role name `OPERATOR`
- **Steps**:
  1. Send GET /api/roles/OPERATOR
  2. Verify response contains full role details including permissions array
- **Expected Result**: 200 OK with OPERATOR role object, hierarchyLevel = 2

### TC-03-P04: List All Available Permissions
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/roles/permissions/all
  2. Verify response contains permissions array
  3. Each permission has key, label, category
  4. Verify at least 39+ permissions are returned
- **Expected Result**: 200 OK with `{ permissions: [{ key, label, category }, ...] }`

### TC-03-P05: Create Custom Role
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, verification token obtained
- **Test Data**: `{ "name": "QUALITY_INSPECTOR", "displayName": "Quality Inspector", "description": "Quality control role", "hierarchyLevel": 3, "permissions": ["ASSET_VIEW", "ASSET_CREATE", "DATA_VIEW"], "color": "#10B981" }`
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/roles with role data
  3. Verify response `{ success: true, data: {...} }`
  4. Send GET /api/roles/QUALITY_INSPECTOR to confirm
- **Expected Result**: 200 OK with created role, visible in role list

### TC-03-P06: Update Role Permissions
- **Priority**: High
- **Preconditions**: Custom role exists, verification token obtained
- **Test Data**: `{ "permissions": ["ASSET_VIEW", "ASSET_CREATE", "ASSET_UPDATE", "DATA_VIEW", "DATA_EXPORT"], "description": "Updated quality control role" }`
- **Steps**:
  1. Obtain verification token
  2. Send PUT /api/roles/QUALITY_INSPECTOR with updated data
  3. Verify response `{ success: true }`
  4. GET /api/roles/QUALITY_INSPECTOR to verify new permissions
- **Expected Result**: 200 OK, role updated with new permissions

### TC-03-P07: Delete Custom Role
- **Priority**: High
- **Preconditions**: Custom role exists with no assigned users, verification token obtained
- **Test Data**: DELETE /api/roles/QUALITY_INSPECTOR
- **Steps**:
  1. Ensure no users are assigned to the role
  2. Obtain verification token
  3. Send DELETE /api/roles/QUALITY_INSPECTOR
  4. Verify response `{ success: true }`
  5. GET /api/roles/QUALITY_INSPECTOR returns 404
- **Expected Result**: 200 OK, role deleted

### TC-03-P08: Get Creatable Roles for Hierarchy
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: GET /api/roles/ADMIN/creatable
- **Steps**:
  1. Send GET /api/roles/ADMIN/creatable
  2. Verify response is an array of roles
  3. Verify all returned roles have hierarchyLevel <= ADMIN's level (5)
- **Expected Result**: 200 OK with roles that ADMIN can assign (level 5 and below)

### TC-03-P09: Update System Role (Limited Fields)
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "displayName": "Administrator (Updated)", "color": "#3B82F6" }`
- **Steps**:
  1. Obtain verification token
  2. Send PUT /api/roles/ADMIN with display updates
  3. Verify display name and color updated
  4. Verify hierarchyLevel cannot be changed for system roles
- **Expected Result**: 200 OK, displayName and color updated

### TC-03-P10: Verify Hierarchy Level Enforcement
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN (hierarchy 5)
- **Test Data**: None
- **Steps**:
  1. Login as ADMIN user
  2. GET /api/roles/ADMIN/creatable
  3. Verify SUPER_ADMIN (level 6) is NOT in the returned list
  4. Verify ADMIN (level 5) and below ARE in the list
- **Expected Result**: Creatable roles respect hierarchy — cannot assign roles above own level

---

## Negative Test Cases

### TC-03-N01: Create Role with Duplicate Name
- **Priority**: High
- **Preconditions**: Role OPERATOR exists, verification token obtained
- **Test Data**: `{ "name": "OPERATOR", "displayName": "Duplicate Operator", "hierarchyLevel": 2, "permissions": [] }`
- **Steps**:
  1. Attempt to create a role with existing name
  2. Verify response is 409 Conflict
- **Expected Result**: 409 with duplicate role name error

### TC-03-N02: Create Role as ADMIN (Need ROLE_MANAGE Permission)
- **Priority**: High
- **Preconditions**: Logged in as user without ROLE_MANAGE permission
- **Test Data**: Any valid role creation payload
- **Steps**:
  1. Login as OPERATOR or VIEWER (no ROLE_MANAGE)
  2. Attempt POST /api/roles
  3. Verify response is 403
- **Expected Result**: 403 Forbidden

### TC-03-N03: Delete Role with Assigned Users
- **Priority**: High
- **Preconditions**: Role has at least one user assigned
- **Test Data**: DELETE /api/roles/OPERATOR (if users exist with OPERATOR role)
- **Steps**:
  1. Ensure at least 1 user has the target role
  2. Obtain verification token
  3. Attempt DELETE /api/roles/OPERATOR
  4. Verify response is 409 with usersCount
- **Expected Result**: 409 Conflict with `{ error: "...", usersCount: N }`

### TC-03-N04: Create Role with Invalid Hierarchy (> 10)
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "HIGH_ROLE", "displayName": "Too High", "hierarchyLevel": 15 }`
- **Steps**:
  1. Attempt to create role with hierarchyLevel > 10
  2. Verify response is 400
- **Expected Result**: 400 validation error — hierarchyLevel max is 10

### TC-03-N05: Create Role with Empty Name
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "", "displayName": "Empty Name", "hierarchyLevel": 3 }`
- **Steps**:
  1. Attempt to create role with empty name
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR

### TC-03-N06: Access /api/roles as VIEWER (No ROLE_MANAGE)
- **Priority**: High
- **Preconditions**: Logged in as VIEWER
- **Test Data**: None
- **Steps**:
  1. Login as VIEWER
  2. Send GET /api/roles
  3. Verify response is 403
- **Expected Result**: 403 Forbidden

### TC-03-N07: Get Non-Existent Role
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: GET /api/roles/NONEXISTENT_ROLE
- **Steps**:
  1. Send GET /api/roles/NONEXISTENT_ROLE
  2. Verify response is 404
- **Expected Result**: 404 Not Found

### TC-03-N08: Create Role with Hierarchy Level 0
- **Priority**: Low
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "ZERO_LEVEL", "displayName": "Zero Level", "hierarchyLevel": 0 }`
- **Steps**:
  1. Attempt to create role with hierarchyLevel 0
  2. Verify response is 400 (minimum is 1)
- **Expected Result**: 400 validation error — hierarchyLevel min is 1
