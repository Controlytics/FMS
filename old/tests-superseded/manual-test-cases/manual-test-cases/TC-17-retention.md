# TC-17: Data Retention — Test Cases

## Overview
- **Module**: Data Retention Management
- **API Endpoints**: 7 (GET config, PUT config, POST archive, POST execute, POST execute-range, POST delete-keys, POST delete-records)
- **Frontend Pages**: /config/retention
- **Permissions**: SUPER_ADMIN (all config/execute), ADMIN (execute-range, delete-keys, delete-records)
- **Data Types**: telemetry, attributes, events, traces, checklists, alarms (execute-range only)

---

## Positive Test Cases

### TC-17-P01: Get Default Retention Configuration
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, no custom retention config set yet
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/retention with valid Authorization header
  2. Verify response status is 200
  3. Verify response contains `telemetry.retentionDays` = 365
  4. Verify response contains `telemetry.compressionAfterDays` = 7
  5. Verify response contains `attributes.retentionDays` = 730
  6. Verify response contains `events.retentionDays` = 365
  7. Verify response contains `traces.retentionHours` = 48
  8. Verify response contains `checklists.retentionDays` = 2555
  9. Verify `autoEnabled` = false and `requiresArchive` = true
- **Expected Result**: 200 OK with default retention configuration for all 5 data types plus autoEnabled/requiresArchive flags

### TC-17-P02: Update Retention Configuration
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "telemetry": { "retentionDays": 180, "compressionAfterDays": 14 },
    "attributes": { "retentionDays": 365 },
    "events": { "retentionDays": 90 },
    "traces": { "retentionHours": 72 },
    "checklists": { "retentionDays": 1825 },
    "autoEnabled": true,
    "requiresArchive": false
  }
  ```
- **Steps**:
  1. Send PUT /api/config/retention with the updated configuration body
  2. Verify response status is 200
  3. Verify all updated values are reflected in the response
  4. Send GET /api/config/retention to confirm persistence
  5. Verify the GET response matches the PUT values
- **Expected Result**: 200 OK with updated retention configuration persisted in SystemConfig table

### TC-17-P03: Archive Data (Stub Response)
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-06-01T00:00:00Z"
  }
  ```
- **Steps**:
  1. Send POST /api/retention/archive with the data
  2. Verify response status is 200
  3. Verify response contains `status` = "archived"
  4. Verify response contains `rowsArchived` = 0
  5. Verify `message` indicates archive destination not configured
- **Expected Result**: 200 OK with stub response indicating no archive destination configured

### TC-17-P04: Execute Retention — Delete Old Data
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, telemetry data older than 365 days exists in TimescaleDB
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "olderThanDays": 365,
    "confirmed": true
  }
  ```
- **Steps**:
  1. Send POST /api/retention/execute with confirmed=true
  2. Verify response status is 200
  3. Verify response contains `deleted` (integer count)
  4. Verify response contains `dataType` = "telemetry"
  5. Verify response contains `olderThanDays` = 365
- **Expected Result**: 200 OK with count of deleted rows from ts_telemetry table

### TC-17-P05: Execute Retention for Each Data Type
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: Execute for each type: telemetry, attributes, events, traces, checklists
- **Steps**:
  1. Send POST /api/retention/execute for dataType "attributes" with olderThanDays=730, confirmed=true
  2. Repeat for "events" with olderThanDays=365
  3. Repeat for "traces" with olderThanDays=2
  4. Repeat for "checklists" with olderThanDays=2555
  5. Verify all return 200 with appropriate `deleted` counts
- **Expected Result**: Each data type successfully processes deletion against its corresponding TimescaleDB table

### TC-17-P06: Execute Range Deletion — Time Range With Entity Scope
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, have an entity ID with telemetry data
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-03-01T00:00:00Z",
    "entityId": "<valid-entity-uuid>",
    "confirmed": true
  }
  ```
- **Steps**:
  1. Send POST /api/retention/execute-range with entity-scoped range
  2. Verify response status is 200
  3. Verify response contains `deleted`, `dataType`, `from`, `to`
  4. Verify other entities' telemetry data was NOT deleted
- **Expected Result**: 200 OK, only telemetry data for the specified entity within the time range is deleted

### TC-17-P07: Delete Specific Keys for an Entity
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, entity has telemetry keys "temperature" and "humidity"
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "entityId": "<valid-entity-uuid>",
    "keys": ["temperature"],
    "confirmed": true
  }
  ```
- **Steps**:
  1. Send POST /api/retention/delete-keys with the request body
  2. Verify response status is 200
  3. Verify response contains `deleted` (count from ts_telemetry)
  4. Verify response contains `deletedLatest` (count from LatestTelemetry table)
  5. Verify the "humidity" key data was NOT deleted
  6. Query telemetry to confirm "temperature" key is removed
- **Expected Result**: 200 OK, only the specified key is deleted from both time-series and latest cache tables

### TC-17-P08: Delete Specific History Records by Time and Key
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, known timestamps for specific telemetry records
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "entityId": "<valid-entity-uuid>",
    "records": [
      { "time": "2025-12-01T10:00:00Z", "key": "temperature" },
      { "time": "2025-12-01T10:05:00Z", "key": "temperature" }
    ],
    "confirmed": true
  }
  ```
- **Steps**:
  1. First query GET /api/queries/telemetry/history to identify specific record timestamps
  2. Send POST /api/retention/delete-records with exact time+key pairs
  3. Verify response status is 200
  4. Verify `deleted` matches the number of records submitted
  5. Re-query history to confirm those specific records are gone
- **Expected Result**: 200 OK, only the exact specified records are deleted

### TC-17-P09: Execute Range Deletion for Alarms
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN, alarms exist in the specified date range
- **Test Data**:
  ```json
  {
    "dataType": "alarms",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-06-01T00:00:00Z",
    "confirmed": true
  }
  ```
- **Steps**:
  1. Note the current alarm count via GET /api/queries/alarms
  2. Send POST /api/retention/execute-range for alarms
  3. Verify response status is 200
  4. Verify response contains `deleted` count
  5. Verify alarms outside the range are untouched
- **Expected Result**: 200 OK, alarms within the date range are deleted from the main Prisma database (not TimescaleDB)

---

## Negative Test Cases

### TC-17-N01: Get Retention Config as Non-SUPER_ADMIN
- **Priority**: High
- **Preconditions**: Logged in as ADMIN or OPERATOR
- **Test Data**: Valid JWT for non-SUPER_ADMIN user
- **Steps**:
  1. Send GET /api/config/retention with ADMIN/OPERATOR token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — retention config is restricted to SUPER_ADMIN

### TC-17-N02: Update Retention Config with Missing Required Fields
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "telemetry": { "retentionDays": 180 },
    "attributes": { "retentionDays": 365 }
  }
  ```
- **Steps**:
  1. Send PUT /api/config/retention with incomplete body (missing events, traces, checklists, autoEnabled, requiresArchive)
  2. Verify response status is 400
  3. Verify error indicates missing required properties
- **Expected Result**: 400 Bad Request — schema validation fails for missing required fields

### TC-17-N03: Update Retention Config with Zero or Negative Days
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "telemetry": { "retentionDays": 0, "compressionAfterDays": -1 },
    "attributes": { "retentionDays": 365 },
    "events": { "retentionDays": 365 },
    "traces": { "retentionHours": 48 },
    "checklists": { "retentionDays": 2555 },
    "autoEnabled": false,
    "requiresArchive": true
  }
  ```
- **Steps**:
  1. Send PUT /api/config/retention with retentionDays=0 and compressionAfterDays=-1
  2. Verify response status is 400
  3. Verify error references minimum value constraint (minimum: 1)
- **Expected Result**: 400 Bad Request — values below minimum of 1 are rejected by schema

### TC-17-N04: Execute Retention Without Confirmation
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "olderThanDays": 365,
    "confirmed": false
  }
  ```
- **Steps**:
  1. Send POST /api/retention/execute with confirmed=false
  2. Verify response status is 400
  3. Verify error code is "CONFIRMATION_REQUIRED"
  4. Verify message warns about irreversible action
- **Expected Result**: 400 Bad Request with CONFIRMATION_REQUIRED error — no data deleted

### TC-17-N05: Execute Retention with Invalid Data Type
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "dataType": "invalid_type",
    "olderThanDays": 365,
    "confirmed": true
  }
  ```
- **Steps**:
  1. Send POST /api/retention/execute with dataType "invalid_type"
  2. Verify response status is 400
  3. Verify error relates to invalid enum value
- **Expected Result**: 400 Bad Request — dataType must be one of: telemetry, attributes, events, traces, checklists

### TC-17-N06: Archive with Invalid Data Type
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "dataType": "traces",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-06-01T00:00:00Z"
  }
  ```
- **Steps**:
  1. Send POST /api/retention/archive with dataType "traces" (not in VALID_ARCHIVE_DATA_TYPES)
  2. Verify response status is 400
  3. Verify the error indicates "traces" is not a valid archive data type
- **Expected Result**: 400 Bad Request — archive only supports: telemetry, attributes, events, checklists

### TC-17-N07: Delete Keys Without Confirmation
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**:
  ```json
  {
    "dataType": "telemetry",
    "entityId": "<valid-uuid>",
    "keys": ["temperature"],
    "confirmed": false
  }
  ```
- **Steps**:
  1. Send POST /api/retention/delete-keys with confirmed=false
  2. Verify response status is 400
  3. Verify CONFIRMATION_REQUIRED error
- **Expected Result**: 400 Bad Request — confirmation required, no keys deleted

### TC-17-N08: Delete Records Exceeding Maximum (500)
- **Priority**: Low
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: Array with 501 record objects
- **Steps**:
  1. Build a records array with 501 entries of `{ "time": "...", "key": "..." }`
  2. Send POST /api/retention/delete-records
  3. Verify response status is 400
  4. Verify error references maxItems constraint
- **Expected Result**: 400 Bad Request — records array exceeds maxItems of 500


---

## Phase 2 Notes

- Retention policies apply to filter telemetry data stored in TimescaleDB. Filter telemetry (differential pressure, airflow) follows the same retention rules as other entity telemetry.
- Filter cleaning cycle records and events are stored in the main Prisma database, not TimescaleDB, and are subject to standard backup/restore, not retention policies.
- PM schedule records are retained indefinitely in the main database.


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
