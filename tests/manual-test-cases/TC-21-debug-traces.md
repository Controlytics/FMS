# TC-21: Debug Traces — Test Cases

## Overview
- **Module**: Pipeline Debug Traces
- **API Endpoints**: 4 (GET /, GET /stats, GET /:id, PUT /entity/:entityId/toggle)
- **Frontend Pages**: /debug
- **Permissions**: READ_DEBUG_TRACE (list, stats, detail), MANAGE_DEBUG_TRACE (toggle)
- **Trace Statuses**: SUCCESS, SUCCESS_WITH_WARNINGS, FAILED, DLQ
- **Pipeline Stages**: Device Validation, Message Validation, Rule Chain Resolution, Rule Chain Output, Data Persistence, Audit Trail, Event Emission
- **Prefix**: /api/debug/traces

---

## Positive Test Cases

### TC-21-P01: Enable Tracing for an Entity
- **Priority**: High
- **Preconditions**: Logged in with MANAGE_DEBUG_TRACE permission, entity exists with a device token
- **Test Data**: Entity UUID
- **Steps**:
  1. Send PUT /api/debug/traces/entity/:entityId/toggle
  2. Verify response status is 200
  3. Verify response contains `entityId` and `traceEnabled: true`
  4. Verify an audit log entry was created for CONFIG_CHANGED
- **Expected Result**: 200 OK with traceEnabled=true, IngestionSystemConfig record created with key `pipeline.trace_entity.<entityId>`

### TC-21-P02: Send Telemetry and Verify Trace Created
- **Priority**: High
- **Preconditions**: Tracing enabled for entity (TC-21-P01), entity has device token
- **Test Data**: Telemetry payload `{"temperature": 25.5, "humidity": 60}`
- **Steps**:
  1. Send POST /api/data/telemetry with device token and telemetry payload
  2. Wait 3 seconds for pipeline to process
  3. Send GET /api/debug/traces?entityId=:entityId&pageSize=1
  4. Verify a trace record appears with the entity ID
  5. Verify `finalStatus` is "SUCCESS" or "SUCCESS_WITH_WARNINGS"
  6. Verify `transport` is "HTTP"
  7. Verify `messageType` is "POST_TELEMETRY"
  8. Verify `payloadSize` > 0
  9. Verify `totalDurationMs` > 0
- **Expected Result**: Trace record created showing all pipeline stages for the telemetry message

### TC-21-P03: List Traces with Pagination
- **Priority**: High
- **Preconditions**: Multiple trace records exist
- **Test Data**: page=1, pageSize=5
- **Steps**:
  1. Send GET /api/debug/traces?page=1&pageSize=5
  2. Verify response status is 200
  3. Verify response contains `data` (array), `total` (integer), `page` (1), `limit` (5), `totalPages`
  4. Verify data array has at most 5 items
  5. Verify traces are ordered by time DESC (newest first)
  6. Send GET with page=2 and verify different records (if total > 5)
- **Expected Result**: 200 OK with paginated trace list, standard pagination envelope

### TC-21-P04: Filter Traces by Status
- **Priority**: High
- **Preconditions**: Traces with different statuses exist
- **Test Data**: `?status=SUCCESS`
- **Steps**:
  1. Send GET /api/debug/traces?status=SUCCESS
  2. Verify all returned traces have `finalStatus` = "SUCCESS"
  3. Repeat with status=FAILED and verify all have finalStatus=FAILED
  4. Repeat with status=DLQ
  5. Repeat with status=SUCCESS_WITH_WARNINGS
- **Expected Result**: Only traces matching the specified status are returned

### TC-21-P05: Filter Traces by Transport
- **Priority**: Medium
- **Preconditions**: Traces from HTTP and/or MQTT exist
- **Test Data**: `?transport=HTTP`
- **Steps**:
  1. Send GET /api/debug/traces?transport=HTTP
  2. Verify all returned traces have `transport` matching "HTTP" (case-insensitive)
  3. If MQTT traces exist, repeat with transport=MQTT
- **Expected Result**: Only traces from the specified transport protocol are returned

### TC-21-P06: Filter Traces by Entity ID
- **Priority**: Medium
- **Preconditions**: Traces exist for a known entity
- **Test Data**: `?entityId=<entity-uuid-or-partial>`
- **Steps**:
  1. Send GET /api/debug/traces?entityId=<entity-uuid>
  2. Verify all returned traces match the entity ID or entity name (ILIKE search)
  3. Verify traces from other entities are not included
- **Expected Result**: Traces filtered to match the specified entity (supports partial match)

### TC-21-P07: Filter Traces by Date Range
- **Priority**: Medium
- **Preconditions**: Traces exist across multiple dates
- **Test Data**: `?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z`
- **Steps**:
  1. Send GET /api/debug/traces?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z
  2. Verify all returned traces have `time` within the specified range
- **Expected Result**: Only traces within the date range are returned

### TC-21-P08: Get Trace Detail (Single Trace)
- **Priority**: High
- **Preconditions**: At least one trace exists
- **Test Data**: Trace ID from TC-21-P03
- **Steps**:
  1. Get a trace ID from the list endpoint
  2. Send GET /api/debug/traces/:id
  3. Verify response status is 200
  4. Verify response contains all fields: id, time, messageId, entityId, entityName, transport, messageType, payloadSize, stages, finalStatus, failedStage, errorCode, errorMessage, warnings, totalDurationMs
  5. Verify `stages` is a JSON array/object showing each pipeline stage with name, status, durationMs
  6. If status is SUCCESS, verify stages show Device Validation, Message Validation, Data Persistence, Audit Trail, Event Emission
- **Expected Result**: 200 OK with complete trace detail including stage-by-stage breakdown

### TC-21-P09: Get Pipeline Trace Statistics
- **Priority**: High
- **Preconditions**: Trace records exist from recent activity
- **Test Data**: None
- **Steps**:
  1. Send GET /api/debug/traces/stats
  2. Verify response status is 200
  3. Verify response contains `successRate1h` (number, 0-100)
  4. Verify response contains `successRate24h` (number, 0-100)
  5. Verify response contains `avgDurationMs` (number >= 0)
  6. Verify response contains `topErrors` (array of { code, count })
  7. Verify response contains `byTransport` (object with transport keys, each having total and failed counts)
- **Expected Result**: 200 OK with comprehensive statistics including success rates, average duration, top errors, and transport breakdown

### TC-21-P10: Disable Tracing for an Entity
- **Priority**: High
- **Preconditions**: Tracing currently enabled for entity (from TC-21-P01)
- **Test Data**: Same entity UUID
- **Steps**:
  1. Send PUT /api/debug/traces/entity/:entityId/toggle
  2. Verify response status is 200
  3. Verify response contains `traceEnabled: false`
  4. Send telemetry for the entity
  5. Wait 3 seconds
  6. Check traces list — verify no new trace was created for this entity
- **Expected Result**: 200 OK with traceEnabled=false, subsequent telemetry does NOT generate traces

### TC-21-P11: Filter by Error Code
- **Priority**: Medium
- **Preconditions**: Traces with error codes exist (from failed pipeline runs)
- **Test Data**: `?errorCode=ERR_VALIDATION`
- **Steps**:
  1. Send GET /api/debug/traces?errorCode=ERR_VALIDATION
  2. Verify all returned traces have errorCode containing "ERR_VALIDATION" (ILIKE match)
- **Expected Result**: Only traces with matching error codes are returned

---

## Negative Test Cases

### TC-21-N01: Access Traces Without READ_DEBUG_TRACE Permission
- **Priority**: High
- **Preconditions**: Logged in as user without READ_DEBUG_TRACE permission
- **Test Data**: Valid auth token for user without debug trace permissions
- **Steps**:
  1. Send GET /api/debug/traces with non-permitted token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — missing READ_DEBUG_TRACE permission

### TC-21-N02: Toggle Tracing Without MANAGE_DEBUG_TRACE Permission
- **Priority**: High
- **Preconditions**: Logged in as user with READ_DEBUG_TRACE but NOT MANAGE_DEBUG_TRACE
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send PUT /api/debug/traces/entity/:entityId/toggle with read-only user token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — missing MANAGE_DEBUG_TRACE permission

### TC-21-N03: Get Non-Existent Trace
- **Priority**: Medium
- **Preconditions**: Logged in with READ_DEBUG_TRACE
- **Test Data**: Non-existent UUID: `00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Send GET /api/debug/traces/00000000-0000-0000-0000-000000000000
  2. Verify response status is 404
  3. Verify error is "NOT_FOUND"
- **Expected Result**: 404 Not Found — "Trace not found"

### TC-21-N04: Filter with Invalid Status Value
- **Priority**: Low
- **Preconditions**: Logged in with READ_DEBUG_TRACE
- **Test Data**: `?status=INVALID_STATUS`
- **Steps**:
  1. Send GET /api/debug/traces?status=INVALID_STATUS
  2. Verify response status is 400
  3. Verify error references invalid enum value
- **Expected Result**: 400 Bad Request — status must be one of: SUCCESS, SUCCESS_WITH_WARNINGS, FAILED, DLQ

### TC-21-N05: Access Without Authentication
- **Priority**: High
- **Preconditions**: No JWT token
- **Test Data**: None
- **Steps**:
  1. Send GET /api/debug/traces without Authorization header
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized — missing token


---

## Phase 2 Notes

- Debug traces apply to filter entity telemetry. When tracing is enabled for a filter entity, telemetry data flows through the 10-stage pipeline and generates trace records.
- Filter operations (cycle start, advance, etc.) do NOT generate pipeline traces — they use separate API endpoints outside the data ingestion pipeline.


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
