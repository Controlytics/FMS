# TC-04: Entity Templates — Test Cases

## Overview
- **Module**: Entity Template Management
- **API Endpoints**: 6
- **Frontend Pages**: /assets/templates
- **Permissions**: ASSET_VIEW (read), ASSET_TEMPLATE_MANAGE (create/update/delete)
- **Reauth Actions**: CREATE_ASSET_TEMPLATE, UPDATE_ASSET_TEMPLATE, DELETE_ASSET_TEMPLATE
- **Categories**: General, Equipment, Room, Building, Sensor, Vehicle, Utility, Process, Storage, Laboratory

---

## Positive Test Cases

### TC-04-P01: Create Template with All Attribute Types
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN with ASSET_TEMPLATE_CREATE permission
- **Test Data**:
  ```json
  {
    "name": "Temperature Sensor",
    "description": "IoT temperature sensor template",
    "category": "Sensor",
    "attributeSchema": [
      { "name": "serialNumber", "type": "TEXT", "required": true },
      { "name": "calibrationDate", "type": "DATE", "required": true },
      { "name": "lastServiceDate", "type": "DATETIME", "required": false },
      { "name": "maxTemp", "type": "FLOAT", "required": true },
      { "name": "sampleRate", "type": "INTEGER", "required": true },
      { "name": "isCalibrated", "type": "BOOLEAN", "required": false },
      { "name": "location", "type": "DROPDOWN", "required": true, "options": ["Lab A", "Lab B", "Warehouse"] },
      { "name": "datasheet", "type": "URL", "required": false },
      { "name": "certificate", "type": "FILE", "required": false }
    ],
    "maxParentConnections": 1,
    "maxConnections": 10
  }
  ```
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/assets/templates with template data
  3. Verify response status 201
  4. Verify all attribute types are preserved
  5. Verify version is 1
- **Expected Result**: 201 Created with template containing all 9 attribute types, version = 1

### TC-04-P02: Create Template with Telemetry Schema
- **Priority**: High
- **Preconditions**: Verification token obtained
- **Test Data**:
  ```json
  {
    "name": "Flow Meter",
    "category": "Equipment",
    "telemetrySchema": [
      { "key": "temperature", "type": "FLOAT", "unit": "celsius" },
      { "key": "pressure", "type": "FLOAT", "unit": "bar" },
      { "key": "flowRate", "type": "INTEGER", "unit": "L/min" },
      { "key": "isOnline", "type": "BOOLEAN" },
      { "key": "status", "type": "STRING" }
    ]
  }
  ```
- **Steps**:
  1. Create template with telemetry schema covering all 5 types
  2. Verify telemetry schema is stored correctly
- **Expected Result**: 201 Created with 5 telemetry keys (FLOAT, INTEGER, BOOLEAN, STRING)

### TC-04-P03: Create Template with Alarm Rules
- **Priority**: High
- **Preconditions**: Verification token obtained
- **Test Data**:
  ```json
  {
    "name": "Pressure Vessel",
    "category": "Equipment",
    "telemetrySchema": [
      { "key": "pressure", "type": "FLOAT", "unit": "psi" }
    ],
    "alarmRules": [
      { "name": "High Pressure", "type": "HIGH", "telemetryKey": "pressure", "threshold": 150, "severity": "WARNING" },
      { "name": "Critical Pressure", "type": "HIGH_HIGH", "telemetryKey": "pressure", "threshold": 200, "severity": "CRITICAL" },
      { "name": "Low Pressure", "type": "LOW", "telemetryKey": "pressure", "threshold": 20, "severity": "ALARM" }
    ]
  }
  ```
- **Steps**:
  1. Create template with alarm rules
  2. Verify alarm rules stored correctly with type, threshold, severity
- **Expected Result**: 201 Created with 3 alarm rules

### TC-04-P04: Create Template with Status Lifecycle
- **Priority**: High
- **Preconditions**: Verification token obtained
- **Test Data**:
  ```json
  {
    "name": "Production Equipment",
    "category": "Equipment",
    "statusLifecycle": [
      { "name": "NEW", "color": "#6B7280", "transitions": ["ACTIVE", "MAINTENANCE"] },
      { "name": "ACTIVE", "color": "#10B981", "transitions": ["MAINTENANCE", "DECOMMISSIONED"] },
      { "name": "MAINTENANCE", "color": "#F59E0B", "transitions": ["ACTIVE", "DECOMMISSIONED"] },
      { "name": "DECOMMISSIONED", "color": "#EF4444", "transitions": [] }
    ]
  }
  ```
- **Steps**:
  1. Create template with status lifecycle
  2. Verify status definitions and transitions stored
- **Expected Result**: 201 with 4 statuses and defined transitions

### TC-04-P05: List Templates with Pagination
- **Priority**: High
- **Preconditions**: At least one template exists
- **Test Data**: `?page=1&limit=10`
- **Steps**:
  1. Send GET /api/assets/templates?page=1&limit=10
  2. Verify paginated response with data, total, page, limit, totalPages
  3. Each template includes `_count.instances`
- **Expected Result**: 200 OK with paginated template list

### TC-04-P06: Get Template by ID
- **Priority**: High
- **Preconditions**: Template exists
- **Test Data**: Template ID from previous creation
- **Steps**:
  1. Send GET /api/assets/templates/:id
  2. Verify all fields are returned including schemas
- **Expected Result**: 200 OK with complete template details

### TC-04-P07: Update Template (Version Increment)
- **Priority**: High
- **Preconditions**: Template exists, verification token obtained
- **Test Data**: `{ "description": "Updated description", "maxConnections": 20 }`
- **Steps**:
  1. Note current version number
  2. Obtain verification token
  3. Send PUT /api/assets/templates/:id
  4. Verify version incremented by 1
  5. GET template to confirm changes persisted
- **Expected Result**: 200 OK, version incremented, new AssetTemplateVersion created

### TC-04-P08: Get Template Versions
- **Priority**: Medium
- **Preconditions**: Template updated at least once
- **Test Data**: Template ID
- **Steps**:
  1. Send GET /api/assets/templates/:id/versions
  2. Verify response is array of versions ordered by versionNumber desc
  3. Each version has snapshot, createdAt, createdBy
- **Expected Result**: 200 OK with array of version objects, latest first

### TC-04-P09: Delete Template (Soft Delete)
- **Priority**: High
- **Preconditions**: Template exists with no instances, verification token obtained
- **Test Data**: Template ID
- **Steps**:
  1. Obtain verification token
  2. Send DELETE /api/assets/templates/:id
  3. Verify response `{ success: true }`
  4. GET /api/assets/templates?isActive=false to see it
- **Expected Result**: 200 OK, template set to isActive=false (not physically deleted)

### TC-04-P10: Search Templates by Name
- **Priority**: Medium
- **Preconditions**: Multiple templates exist
- **Test Data**: `?search=sensor`
- **Steps**:
  1. Send GET /api/assets/templates?search=sensor
  2. Verify only matching templates returned
- **Expected Result**: 200 OK with filtered results

---

## Negative Test Cases

### TC-04-N01: Create Template with Duplicate Name
- **Priority**: High
- **Preconditions**: Template "Temperature Sensor" exists
- **Test Data**: `{ "name": "Temperature Sensor" }`
- **Steps**:
  1. Attempt to create template with existing name
  2. Verify response is 409
- **Expected Result**: 409 Conflict — duplicate name

### TC-04-N02: Create Template Without Required Name
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "description": "No name provided" }`
- **Steps**:
  1. Attempt POST with missing name field
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR

### TC-04-N03: Create Template with Invalid Attribute Type
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "Bad Type", "attributeSchema": [{ "name": "field1", "type": "INVALID_TYPE" }] }`
- **Steps**:
  1. Attempt creation with unsupported attribute type
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR — invalid type

### TC-04-N04: Update Non-Existent Template
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: PUT /api/assets/templates/00000000-0000-0000-0000-000000000000
- **Steps**:
  1. Attempt to update template with non-existent UUID
  2. Verify response is 404
- **Expected Result**: 404 Not Found

### TC-04-N05: Access Templates Without ASSET_VIEW Permission
- **Priority**: High
- **Preconditions**: Logged in as user without ASSET_VIEW permission
- **Test Data**: None
- **Steps**:
  1. Login as user without ASSET_VIEW
  2. Attempt GET /api/assets/templates
  3. Verify 403
- **Expected Result**: 403 Forbidden

### TC-04-N06: Create Template with Invalid Alarm Rule Type
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "name": "Bad Alarm", "alarmRules": [{ "name": "Bad", "type": "INVALID_ALARM_TYPE", "telemetryKey": "temp", "threshold": 100, "severity": "WARNING" }] }`
- **Steps**:
  1. Attempt creation with invalid alarm rule type
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR

### TC-04-N07: Delete Template Without ASSET_TEMPLATE_DELETE Permission
- **Priority**: High
- **Preconditions**: Logged in as user with ASSET_VIEW but not ASSET_TEMPLATE_DELETE
- **Test Data**: Valid template ID
- **Steps**:
  1. Attempt DELETE /api/assets/templates/:id
  2. Verify 403
- **Expected Result**: 403 Forbidden

### TC-04-N08: Get Template with Invalid UUID Format
- **Priority**: Low
- **Preconditions**: None
- **Test Data**: GET /api/assets/templates/not-a-uuid
- **Steps**:
  1. Send GET with malformed UUID
  2. Verify response is 400
- **Expected Result**: 400 — invalid UUID format


---

## Phase 2 Notes

- Entity templates support filter-type entities. Filter templates include AHU (Air Handling Unit) configurations.
- Template attribute types include all standard types plus support for filter-specific attributes (filter type, media type, efficiency rating).
- Templates used for filter instances follow the same versioning and lifecycle rules as standard templates.


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
