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


---

## Phase 2: Digital Filter Management System Test Cases

### TC-05-P11: Create Cleaning Profile with Pipeline
- **Priority**: High
- **Preconditions**: Logged in with FILTER_MANAGE permission
- **Test Data**:
  ```json
  {
    "name": "Standard Wash Profile",
    "description": "Standard cleaning pipeline for HEPA filters",
    "stages": [
      { "type": "STAGE", "name": "WASH_IN", "order": 1 },
      { "type": "CHECKLIST", "name": "Pre-dry check", "order": 2 },
      { "type": "STAGE", "name": "DRY_IN", "order": 3 },
      { "type": "STAGE", "name": "STORAGE_IN", "order": 4 }
    ]
  }
  ```
- **Steps**:
  1. Send POST /api/cleaning-profiles with pipeline data (reauth required)
  2. Verify response status 201
  3. Verify stages are stored with correct order
  4. Verify CHECKLIST nodes are between STAGE nodes
- **Expected Result**: 201 Created with cleaning profile containing visual pipeline stages

### TC-05-P12: Create Filter Profile (Link Filter to Cleaning Profile)
- **Priority**: High
- **Preconditions**: Cleaning profile exists, filter entity instance exists
- **Test Data**:
  ```json
  {
    "name": "HEPA Filter Profile",
    "cleaningProfileId": "<cleaning-profile-uuid>",
    "filterType": "HEPA",
    "description": "Profile for HEPA filter cleaning"
  }
  ```
- **Steps**:
  1. Send POST /api/filter-profiles with profile data (reauth required)
  2. Verify response status 201
  3. Verify cleaningProfileId is linked
- **Expected Result**: 201 Created with filter profile linked to cleaning profile

### TC-05-P13: Start Cleaning Cycle on Filter
- **Priority**: High
- **Preconditions**: Filter instance exists with assigned filter profile and cleaning profile
- **Test Data**: Filter instance ID
- **Steps**:
  1. Send POST /api/filters/:id/start-cycle
  2. Verify response status 200
  3. Verify cycle is created with status ACTIVE
  4. Verify current stage is the first STAGE node in the pipeline
  5. Send GET /api/filters/:id/current-state to verify state
- **Expected Result**: 200 OK, cleaning cycle started, filter state shows first stage

### TC-05-P14: Advance Filter Through Pipeline Stage
- **Priority**: High
- **Preconditions**: Active cleaning cycle exists at a STAGE node
- **Test Data**: Filter instance ID
- **Steps**:
  1. Send GET /api/filters/:id/current-state to confirm current stage
  2. Send POST /api/filters/:id/advance
  3. Verify response shows next stage or next checklist node
  4. If next node is CHECKLIST, verify advance is blocked until checklist is submitted
- **Expected Result**: 200 OK, filter advances to next pipeline node

### TC-05-P15: Submit Checklist at Checklist Node
- **Priority**: High
- **Preconditions**: Filter is at a CHECKLIST node in the pipeline
- **Test Data**:
  ```json
  {
    "answers": [
      { "questionId": "<q1-uuid>", "value": "Yes", "type": "BOOLEAN" },
      { "questionId": "<q2-uuid>", "value": "25.5", "type": "NUMBER" },
      { "questionId": "<q3-uuid>", "value": "Clean and dry", "type": "TEXT" }
    ]
  }
  ```
- **Steps**:
  1. Send POST /api/filters/:id/submit-checklist with answers
  2. Verify response status 200
  3. Verify checklist is marked as completed
  4. Send POST /api/filters/:id/advance to proceed past the checklist
  5. Verify filter advances to next stage
- **Expected Result**: 200 OK, checklist submitted, advance unblocked

### TC-05-P16: Bypass Stage with Deviation
- **Priority**: High
- **Preconditions**: Active cleaning cycle, filter at a STAGE node, reauth required
- **Test Data**:
  ```json
  {
    "reason": "Equipment malfunction - dryer offline",
    "deviationNotes": "Maintenance ticket #MT-2026-042 filed"
  }
  ```
- **Steps**:
  1. Send POST /api/filters/:id/bypass with deviation reason (reauth required)
  2. Verify response status 200
  3. Verify stage is bypassed and filter moves to next node
  4. Verify bypass event is audit-logged
  5. Check GET /api/filter/events for BYPASS event entry
- **Expected Result**: 200 OK, stage bypassed with deviation reason recorded

### TC-05-P17: Complete Cleaning Cycle (Auto-Complete at END)
- **Priority**: High
- **Preconditions**: Filter is at the last STAGE before END node
- **Test Data**: Filter instance ID
- **Steps**:
  1. Advance filter through remaining stages
  2. When last STAGE leads to END node, verify cycle auto-completes
  3. Send GET /api/filters/:id/current-state
  4. Verify cycle status is COMPLETED
  5. Check GET /api/filter/cycles for completed cycle record
- **Expected Result**: Cycle auto-completes when reaching END node, cycle record shows COMPLETED status

### TC-05-P18: List Cleaning Cycles
- **Priority**: Medium
- **Preconditions**: At least one cleaning cycle exists
- **Test Data**: Query params `?page=1&limit=10`
- **Steps**:
  1. Send GET /api/filter/cycles?page=1&limit=10
  2. Verify paginated response with cycle records
  3. Each cycle has id, filterId, status, startedAt, completedAt, stages
- **Expected Result**: 200 OK with paginated list of cleaning cycles

### TC-05-P19: List Filter Events
- **Priority**: Medium
- **Preconditions**: Filter operations have been performed
- **Test Data**: Query params `?page=1&limit=10`
- **Steps**:
  1. Send GET /api/filter/events?page=1&limit=10
  2. Verify paginated response with event records
  3. Events include CYCLE_STARTED, STAGE_ADVANCED, CHECKLIST_SUBMITTED, BYPASS, CYCLE_COMPLETED
- **Expected Result**: 200 OK with paginated list of filter events

### TC-05-P20: Get Filter Current State
- **Priority**: High
- **Preconditions**: Filter exists with or without active cycle
- **Test Data**: Filter instance ID
- **Steps**:
  1. Send GET /api/filters/:id/current-state
  2. Verify response includes current cycle info (if active), current stage, next actions
  3. If no active cycle, verify state shows no cycle
- **Expected Result**: 200 OK with complete filter state and available next actions

### TC-05-P21: Create PM Schedule for Filter
- **Priority**: Medium
- **Preconditions**: Filter instance exists, logged in with FILTER_MANAGE permission
- **Test Data**:
  ```json
  {
    "name": "Monthly HEPA Inspection",
    "filterId": "<filter-uuid>",
    "frequency": "MONTHLY",
    "description": "Monthly preventive maintenance inspection"
  }
  ```
- **Steps**:
  1. Send POST /api/pm-schedules with schedule data (reauth required)
  2. Verify response status 201
  3. Send GET /api/pm-schedules to verify it appears in list
- **Expected Result**: 201 Created with PM schedule

### TC-05-P22: Create Checklist Profile with Typed Questions
- **Priority**: Medium
- **Preconditions**: Logged in with FILTER_MANAGE permission
- **Test Data**:
  ```json
  {
    "name": "Pre-Wash Checklist",
    "questions": [
      { "text": "Is the filter free of visible debris?", "type": "BOOLEAN", "required": true },
      { "text": "Measured differential pressure (Pa)", "type": "NUMBER", "required": true },
      { "text": "Filter condition notes", "type": "TEXT", "required": false },
      { "text": "Filter condition rating", "type": "SELECT", "options": ["Good", "Fair", "Poor"], "required": true },
      { "text": "Defects observed", "type": "MULTI_SELECT", "options": ["Tears", "Discoloration", "Odor", "Deformation"], "required": false }
    ]
  }
  ```
- **Steps**:
  1. Send POST /api/checklist-profiles with questions
  2. Verify all 5 question types are stored correctly
  3. Verify required flags are preserved
- **Expected Result**: 201 Created with checklist profile containing all question types

### TC-05-N09: Advance Without Completing Pending Checklist
- **Priority**: High
- **Preconditions**: Filter at a CHECKLIST node with pending checklist
- **Test Data**: Filter instance ID
- **Steps**:
  1. Verify filter is at CHECKLIST node via GET /api/filters/:id/current-state
  2. Send POST /api/filters/:id/advance WITHOUT submitting checklist first
  3. Verify response is 400 with error about pending checklist
- **Expected Result**: 400 — cannot advance past checklist node without completing checklist

### TC-05-N10: Start Cycle on Filter with Active Cycle
- **Priority**: High
- **Preconditions**: Filter already has an active cleaning cycle
- **Test Data**: Filter instance ID with active cycle
- **Steps**:
  1. Send POST /api/filters/:id/start-cycle
  2. Verify response is 400 or 409 — filter already has active cycle
- **Expected Result**: 400/409 — cannot start new cycle while one is active

### TC-05-N11: Bypass Without FILTER_OPERATE Permission
- **Priority**: High
- **Preconditions**: Logged in as VIEWER (no FILTER_OPERATE)
- **Test Data**: Filter instance ID
- **Steps**:
  1. Send POST /api/filters/:id/bypass with reason
  2. Verify response is 403
- **Expected Result**: 403 Forbidden

### TC-05-N12: Bulk Filter Upload via CSV
- **Priority**: Medium
- **Preconditions**: Logged in with FILTER_MANAGE permission
- **Test Data**: CSV file with filter data columns
- **Steps**:
  1. Prepare CSV with columns: name, filterType, location, templateId
  2. Upload via bulk upload endpoint
  3. Verify filters are created from CSV data
  4. Test with invalid CSV (missing required columns) — verify error
- **Expected Result**: Bulk creation from CSV succeeds, invalid CSV returns validation errors

