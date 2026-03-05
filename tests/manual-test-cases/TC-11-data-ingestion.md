# TC-11: Data Ingestion -- Test Cases

## Overview
- **Module**: Data Ingestion
- **API Endpoints**: 8+ (POST /telemetry, POST /attributes, GET /attributes, POST /checklist, POST /binary, POST /event, POST /rpc, GET /rpc/response/:requestId)
- **Frontend Pages**: Entity telemetry tab (/assets)
- **Auth**: Device token (Bearer) for telemetry/attributes/binary/event; User JWT for checklist/rpc
- **Transport**: HTTP (Bearer token), MQTT (username=access_token, topics: digilog/v1/<uns-path>/telemetry)
- **Pipeline Stages**: 3 (Device Validation, IP allowlist, rate limiting), 6 (Schema Validation), 7 (Rule Chain), 8 (Alarm/Notification), 9 (Persistence), 10 (Audit), 11 (Event Emission)
- **Rate Limit**: Configurable per device (maxDataRatePerMin field in DeviceCredential, 60s window)

---

## Positive Test Cases

### TC-11-P01: HTTP Telemetry with Valid Device Token
- **Priority**: High
- **Preconditions**: A DeviceCredential exists and is active. Entity and template exist.
- **Test Data**: Device access token, telemetry payload `{"temperature": 25.5, "humidity": 60}`
- **Steps**:
  1. Send POST /api/data/telemetry with device token in Authorization header.
  2. Send JSON body with key-value telemetry data.
  3. Verify response: `{ success: true, messageId: "<uuid>" }`.
  4. Wait 2-3 seconds for pipeline processing.
  5. Verify data appears in ts_telemetry table and latest_telemetry table.
- **Expected Result**: Telemetry accepted, messageId returned, data persisted in TimescaleDB.

### TC-11-P02: HTTP Telemetry with Batch (Array) Payload
- **Priority**: High
- **Preconditions**: Device credential active.
- **Test Data**: Array payload `[{"temperature": 25.5}, {"temperature": 26.0}]`
- **Steps**:
  1. Send POST /api/data/telemetry with array body.
  2. Verify response: `{ success: true, messageIds: ["id1", "id2"] }`.
  3. Verify both data points are persisted.
- **Expected Result**: Batch telemetry accepted, multiple messageIds returned.

### TC-11-P03: HTTP Attribute Submission
- **Priority**: High
- **Preconditions**: Device credential active.
- **Test Data**: `{"firmware_version": "2.1.0", "serial_number": "SN-12345"}`
- **Steps**:
  1. Send POST /api/data/attributes with device token.
  2. Verify response: `{ success: true, messageId: "<uuid>" }`.
  3. Verify attributes appear in ts_attributes table.
- **Expected Result**: Attributes accepted and persisted.

### TC-11-P04: GET Shared Attributes via Device Token
- **Priority**: Medium
- **Preconditions**: Device credential active. Entity has attributes set.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/data/attributes with device token.
  2. Verify response contains the entity's attributes and customAttributes merged.
- **Expected Result**: Entity attributes returned as key-value object.

### TC-11-P05: Submit Device Event
- **Priority**: Medium
- **Preconditions**: Device credential active.
- **Test Data**: `{"event": "REBOOT", "data": {"reason": "scheduled_maintenance"}, "timestamp": 1709654400000}`
- **Steps**:
  1. Send POST /api/data/event with device token.
  2. Verify response: `{ success: true, messageId: "<uuid>" }`.
  3. Verify event recorded in ts_device_events table.
- **Expected Result**: Event accepted and persisted.

### TC-11-P06: Submit Checklist Response (User JWT)
- **Priority**: High
- **Preconditions**: User authenticated with CHECKLIST_SUBMIT permission. Entity exists with template.
- **Test Data**: `{"entityId": "<entity-uuid>", "responses": {"q1": "Yes", "q2": "No"}, "remarks": "All checks passed"}`
- **Steps**:
  1. Send POST /api/data/checklist with user JWT (not device token).
  2. Verify response: `{ success: true, messageId: "<uuid>" }`.
  3. Verify checklist stored in ts_checklist_responses and ChecklistReview.
- **Expected Result**: Checklist accepted, audit trail entry created (DATA_CHECKLIST_SUBMITTED).

### TC-11-P07: Telemetry with Multiple Keys
- **Priority**: Medium
- **Preconditions**: Device credential active.
- **Test Data**: `{"temperature": 25.5, "humidity": 60, "pressure": 1013.25, "flow_rate": 45.2}`
- **Steps**:
  1. Send POST /api/data/telemetry with multi-key payload.
  2. Verify all 4 keys appear in latest_telemetry table.
- **Expected Result**: All telemetry keys persisted atomically.

### TC-11-P08: Send RPC Request to Device (User JWT)
- **Priority**: Medium
- **Preconditions**: User JWT, entity exists with UNS mapping, MQTT broker active.
- **Test Data**: `{"entityId": "<entity-uuid>", "method": "getStatus", "params": {}, "timeout": 30}`
- **Steps**:
  1. Send POST /api/data/rpc with user JWT.
  2. Verify response: `{ success: true, requestId: "<uuid>" }`.
- **Expected Result**: RPC request published to MQTT, requestId returned.

### TC-11-P09: Poll RPC Response
- **Priority**: Low
- **Preconditions**: An RPC request was sent.
- **Test Data**: requestId from TC-11-P08.
- **Steps**:
  1. Send GET /api/data/rpc/response/{requestId} with user JWT.
  2. Verify response: `{ success: true, requestId: "...", response: null }` (or response data if device replied).
- **Expected Result**: Polling endpoint returns without error. Response is null if no reply yet.

### TC-11-P10: Verify Data Appears in latest_telemetry After Ingestion
- **Priority**: High
- **Preconditions**: Telemetry successfully ingested in TC-11-P01.
- **Test Data**: Entity ID from the device credential.
- **Steps**:
  1. Query GET /api/telemetry/{entityId}/latest.
  2. Verify the telemetry keys from TC-11-P01 appear with correct values.
- **Expected Result**: latest_telemetry reflects the most recent values for each key.

---

## Negative Test Cases

### TC-11-N01: Telemetry with Invalid/Missing Device Token
- **Priority**: High
- **Preconditions**: None.
- **Test Data**: Invalid token "invalid-token-12345"
- **Steps**:
  1. Send POST /api/data/telemetry with `Authorization: Bearer invalid-token-12345`.
  2. Verify response: 401 `{ error: "UNAUTHORIZED", message: "Invalid or inactive device token" }`.
- **Expected Result**: 401 Unauthorized.

### TC-11-N02: Telemetry Without Authorization Header
- **Priority**: High
- **Preconditions**: None.
- **Test Data**: No Authorization header.
- **Steps**:
  1. Send POST /api/data/telemetry without Authorization header.
  2. Verify response: 401 `{ error: "UNAUTHORIZED", message: "Missing device access token" }`.
- **Expected Result**: 401 Unauthorized.

### TC-11-N03: Telemetry with Inactive/Expired Credential
- **Priority**: High
- **Preconditions**: A DeviceCredential exists but is set to inactive (isActive: false).
- **Test Data**: Token of the inactive credential.
- **Steps**:
  1. Send POST /api/data/telemetry with the inactive credential's token.
  2. Verify response: 401 Unauthorized.
- **Expected Result**: 401 Unauthorized (resolveEntityByToken returns null for inactive).

### TC-11-N04: Checklist Submission Without User JWT (Using Device Token)
- **Priority**: High
- **Preconditions**: Device credential exists.
- **Test Data**: `{"entityId": "<uuid>", "responses": {"q1": "Yes"}}`
- **Steps**:
  1. Send POST /api/data/checklist with device token (not JWT).
  2. Verify response: 401 or 403 (CHECKLIST_SUBMIT permission check fails for device tokens).
- **Expected Result**: Rejected -- checklist requires user JWT authentication.

### TC-11-N05: Telemetry with Empty Payload
- **Priority**: Medium
- **Preconditions**: Device credential active.
- **Test Data**: Empty object `{}`
- **Steps**:
  1. Send POST /api/data/telemetry with `{}`.
  2. Verify behavior: message accepted but no meaningful data persisted (empty data object).
- **Expected Result**: Message processed (possibly with warnings). No telemetry keys created.

### TC-11-N06: Checklist for Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: User JWT with CHECKLIST_SUBMIT permission.
- **Test Data**: `{"entityId": "00000000-0000-0000-0000-000000000000", "responses": {"q1": "Yes"}}`
- **Steps**:
  1. Send POST /api/data/checklist with non-existent entityId.
  2. Verify response: 404 `{ error: "NOT_FOUND", message: "Entity not found or inactive" }`.
- **Expected Result**: 404 Not Found.

### TC-11-N07: Event Without Required 'event' Field
- **Priority**: Medium
- **Preconditions**: Device credential active.
- **Test Data**: `{"data": {"reason": "test"}}` (missing required `event` field)
- **Steps**:
  1. Send POST /api/data/event without the required `event` field.
  2. Verify response: 400 validation error.
- **Expected Result**: 400 validation error.

### TC-11-N08: Binary Upload Without File
- **Priority**: Low
- **Preconditions**: Device credential active.
- **Test Data**: Empty POST body (no multipart file).
- **Steps**:
  1. Send POST /api/data/binary with device token but no file attached.
  2. Verify response: 400 `{ error: "VALIDATION_ERROR", message: "No file uploaded" }`.
- **Expected Result**: 400 error.

### TC-11-N09: RPC Request Without User JWT
- **Priority**: Medium
- **Preconditions**: None.
- **Test Data**: `{"entityId": "<uuid>", "method": "getStatus"}`
- **Steps**:
  1. Send POST /api/data/rpc without Authorization header.
  2. Verify response: 401 Unauthorized.
- **Expected Result**: 401 Unauthorized.

### TC-11-N10: Telemetry with Type Mismatch (Schema Validation)
- **Priority**: High
- **Preconditions**: Entity template has telemetry schema with `temperature` as INTEGER or FLOAT type. Device credential maps to this entity.
- **Test Data**: `{"temperature": "not-a-number"}`
- **Steps**:
  1. Send POST /api/data/telemetry with string value for a numeric field.
  2. Wait for pipeline processing.
  3. Verify the message is rejected at Stage 6 with ERR_TYPE_MISMATCH and routed to DLQ.
- **Expected Result**: Pipeline fails at Stage 6 validation. Message sent to Dead Letter Queue.
