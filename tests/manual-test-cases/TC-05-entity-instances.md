# TC-05: Entity Instances — Test Cases

## Overview
- **Module**: Entity Instance Management
- **API Endpoints**: 8
- **Frontend Pages**: /assets (Entity Explorer with tree diagram)
- **Permissions**: ASSET_VIEW (read), ASSET_CREATE (create), ASSET_UPDATE (update/status), ASSET_DELETE (delete)
- **Reauth Actions**: CREATE_ASSET, UPDATE_ASSET, DELETE_ASSET

---

## Positive Test Cases

### TC-05-P01: Create Instance from Template
- **Priority**: High
- **Preconditions**: Template exists (e.g., "Temperature Sensor"), verification token obtained
- **Test Data**:
  ```json
  {
    "name": "Sensor-001",
    "description": "Main lab temperature sensor",
    "templateId": "<template_uuid>",
    "attributes": { "serialNumber": "SN-001", "maxTemp": 150.0, "sampleRate": 60, "isCalibrated": true, "location": "Lab A" }
  }
  ```
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/assets/instances with instance data
  3. Verify response status 201
  4. Verify instance has templateVersion matching current template version
- **Expected Result**: 201 Created with instance linked to template, attributes stored

### TC-05-P02: Create Instance with Parent (Hierarchy)
- **Priority**: High
- **Preconditions**: Parent instance exists, template allows parent connections (maxParentConnections >= 1)
- **Test Data**:
  ```json
  {
    "name": "Sub-Sensor-001a",
    "templateId": "<template_uuid>",
    "parentId": "<parent_instance_uuid>",
    "attributes": { "serialNumber": "SN-001a", "maxTemp": 100.0, "sampleRate": 30, "location": "Lab A" }
  }
  ```
- **Steps**:
  1. Create parent instance first
  2. Create child instance with parentId set
  3. Verify child has parentId in response
  4. GET /api/assets/instances/:parentId/children — verify child listed
- **Expected Result**: 201 Created, parent-child relationship established, auto-creates CONTAINS relationship

### TC-05-P03: List Instances with Pagination and Filters
- **Priority**: High
- **Preconditions**: Multiple instances exist
- **Test Data**: `?page=1&limit=10&status=ACTIVE`
- **Steps**:
  1. Send GET /api/assets/instances?page=1&limit=10
  2. Verify paginated response structure
  3. Send GET /api/assets/instances?templateId=<uuid> to filter by template
  4. Verify filtered results
- **Expected Result**: 200 OK with `{ data: [...], total, page, limit, totalPages }`

### TC-05-P04: Get Instance Tree (Flat Array)
- **Priority**: High
- **Preconditions**: At least one instance exists
- **Test Data**: None
- **Steps**:
  1. Send GET /api/assets/instances/tree
  2. Verify response is a flat array (NOT paginated object)
  3. Each item has id, name, parentId, templateId, status, template, _count.children
- **Expected Result**: 200 OK with flat array for frontend tree rendering

### TC-05-P05: Get Instance by ID (Full Detail)
- **Priority**: High
- **Preconditions**: Instance exists
- **Test Data**: Instance UUID
- **Steps**:
  1. Send GET /api/assets/instances/:id
  2. Verify response includes template info, relationships, identifiers, parent info
  3. Verify attributes match what was set during creation
- **Expected Result**: 200 OK with complete instance detail including nested objects

### TC-05-P06: Update Instance Attributes
- **Priority**: High
- **Preconditions**: Instance exists, verification token obtained
- **Test Data**: `{ "attributes": { "serialNumber": "SN-001-REV2", "maxTemp": 200.0 }, "description": "Updated sensor" }`
- **Steps**:
  1. Obtain verification token
  2. Send PUT /api/assets/instances/:id with updated data
  3. Verify response reflects updates
  4. GET instance to confirm persistence
- **Expected Result**: 200 OK with updated attributes

### TC-05-P07: Change Instance Status via Lifecycle
- **Priority**: High
- **Preconditions**: Instance has status lifecycle defined in template, verification token obtained
- **Test Data**: `{ "status": "ACTIVE" }` (assuming current status allows transition to ACTIVE)
- **Steps**:
  1. Obtain verification token
  2. Send PATCH /api/assets/instances/:id/status with new status
  3. Verify response reflects new status
- **Expected Result**: 200 OK with updated status

### TC-05-P08: Delete Instance (Cascade Soft-Delete)
- **Priority**: High
- **Preconditions**: Instance with children exists, verification token obtained
- **Test Data**: Parent instance ID
- **Steps**:
  1. Create parent with 2 children
  2. Obtain verification token
  3. Send DELETE /api/assets/instances/:parentId
  4. Verify response includes `deactivatedCount`
  5. GET parent and children — verify all have isActive=false
- **Expected Result**: 200 OK with `{ success: true, deactivatedCount: 3 }` (parent + 2 children)

### TC-05-P09: Get Direct Children
- **Priority**: Medium
- **Preconditions**: Instance with children exists
- **Test Data**: Parent instance ID
- **Steps**:
  1. Send GET /api/assets/instances/:id/children
  2. Verify response is array of child instances
  3. Each child has template info and _count.children
- **Expected Result**: 200 OK with array of direct children

### TC-05-P10: Search Instances
- **Priority**: Medium
- **Preconditions**: Multiple instances exist
- **Test Data**: `?search=Sensor`
- **Steps**:
  1. Send GET /api/assets/instances?search=Sensor
  2. Verify returned instances match search term
- **Expected Result**: 200 OK with filtered results

---

## Negative Test Cases

### TC-05-N01: Create Instance from Non-Existent Template
- **Priority**: High
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "Ghost", "templateId": "00000000-0000-0000-0000-000000000000" }`
- **Steps**:
  1. Attempt creation with non-existent templateId
  2. Verify response is 404
- **Expected Result**: 404 — template not found

### TC-05-N02: Create Instance with Invalid Attribute Types
- **Priority**: High
- **Preconditions**: Template with INTEGER attribute "sampleRate" exists
- **Test Data**: `{ "name": "Bad Types", "templateId": "<id>", "attributes": { "sampleRate": "not_a_number" } }`
- **Steps**:
  1. Send POST with wrong attribute type (string instead of integer)
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR — attribute type mismatch

### TC-05-N03: Exceed maxParentConnections
- **Priority**: High
- **Preconditions**: Template has maxParentConnections=1, instance already has one parent
- **Test Data**: Attempt to create another CONTAINS relationship to same instance
- **Steps**:
  1. Create template with maxParentConnections=1
  2. Create instance with parentId (uses 1 parent slot)
  3. Attempt to create another CONTAINS relationship to this instance
  4. Verify error about max connections
- **Expected Result**: 400 or 409 — maxParentConnections exceeded

### TC-05-N04: Create Instance with Non-Existent Parent
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "Orphan", "templateId": "<id>", "parentId": "00000000-0000-0000-0000-000000000000" }`
- **Steps**:
  1. Attempt creation with non-existent parentId
  2. Verify response is 404
- **Expected Result**: 404 — parent not found

### TC-05-N05: Update Deleted (Inactive) Instance
- **Priority**: Medium
- **Preconditions**: Instance soft-deleted (isActive=false)
- **Test Data**: `{ "name": "Revived" }`
- **Steps**:
  1. Soft-delete an instance
  2. Attempt PUT /api/assets/instances/:id
  3. Verify behavior (may succeed or return 404)
- **Expected Result**: 404 or error — cannot update inactive instance

### TC-05-N06: Delete Instance as VIEWER (No ASSET_DELETE)
- **Priority**: High
- **Preconditions**: Logged in as VIEWER
- **Test Data**: Valid instance ID
- **Steps**:
  1. Login as VIEWER
  2. Attempt DELETE /api/assets/instances/:id
  3. Verify 403
- **Expected Result**: 403 Forbidden

### TC-05-N07: Status Transition Not in Lifecycle
- **Priority**: High
- **Preconditions**: Template has lifecycle [NEW -> ACTIVE -> DECOMMISSIONED], instance is in NEW status
- **Test Data**: `{ "status": "DECOMMISSIONED" }` (if NEW cannot transition directly to DECOMMISSIONED)
- **Steps**:
  1. Attempt PATCH status to a state not in allowed transitions
  2. Verify response is 400
- **Expected Result**: 400 — invalid status transition

### TC-05-N08: Create Instance Missing Required Fields
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "description": "No name or templateId" }`
- **Steps**:
  1. Attempt POST without name and templateId
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR — name and templateId required
