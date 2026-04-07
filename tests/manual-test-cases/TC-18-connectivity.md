# TC-18: Connectivity — Test Cases

## Overview
- **Module**: Entity Connectivity Management
- **API Endpoints**: 6 (GET /:entityId, POST /:entityId/test, GET /:entityId/snippets, POST /:entityId/token, DELETE /:entityId/token, GET /:entityId/history)
- **Frontend Pages**: /assets (Connectivity tab in entity detail panel)
- **Permissions**: ASSET_VIEW (GET status, test, snippets, history), SUPER_ADMIN/ADMIN (token generate/revoke)
- **Prefix**: /api/connectivity

---

## Positive Test Cases

### TC-18-P01: Get Entity Connectivity Status
- **Priority**: High
- **Preconditions**: Logged in with ASSET_VIEW permission, entity exists with a device credential
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send GET /api/connectivity/:entityId
  2. Verify response status is 200
  3. Verify response contains `connectivity` object with status, lastActivityAt, protocol, sourceIp
  4. Verify response contains `credential` object with token, isActive, allowedIps, maxDataRatePerMin, allowedTopics
  5. Verify response contains `unsPath` string (ISA-95 path)
  6. Verify response contains `topics` array
- **Expected Result**: 200 OK with full connectivity status, credential info, UNS path, and MQTT topics

### TC-18-P02: Get Connectivity for Entity Without Credentials
- **Priority**: Medium
- **Preconditions**: Logged in, entity exists but has no device credential configured
- **Test Data**: Entity UUID with no DeviceCredential record
- **Steps**:
  1. Send GET /api/connectivity/:entityId
  2. Verify response status is 200
  3. Verify `connectivity.status` is "UNKNOWN"
  4. Verify `credential` is null
  5. Verify `topics` is an empty array
- **Expected Result**: 200 OK with UNKNOWN status and null credential

### TC-18-P03: Generate New Device Token
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, entity exists
- **Test Data**: Entity UUID
- **Steps**:
  1. Send POST /api/connectivity/:entityId/token with empty body
  2. Verify response status is 200
  3. Verify response contains `token` (64-character hex string)
  4. Verify response contains `createdAt` timestamp
  5. Save the token for subsequent tests
  6. Verify GET /api/connectivity/:entityId now shows credential.isActive = true
- **Expected Result**: 200 OK with new 64-char hex device token and createdAt timestamp

### TC-18-P04: Generate Custom Device Token
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, entity exists
- **Test Data**: `{ "customToken": "my-custom-device-token-12345678" }`
- **Steps**:
  1. Send POST /api/connectivity/:entityId/token with customToken in body
  2. Verify response status is 200
  3. Verify response `token` matches the custom token provided
  4. Use the custom token to send telemetry and verify it works
- **Expected Result**: 200 OK with the custom token stored as the access token

### TC-18-P05: Test Entity Connectivity
- **Priority**: High
- **Preconditions**: Entity has a device credential, connectivity status exists
- **Test Data**: Entity UUID
- **Steps**:
  1. Send POST /api/connectivity/:entityId/test with empty body
  2. Verify response status is 200
  3. Verify response contains `reachable` (boolean)
  4. Verify response contains `protocol` (HTTP/MQTT or null)
  5. Verify response contains `lastActivityAt` (timestamp or null)
  6. Verify response contains `tokenStatus` (ACTIVE, NEVER_USED, REVOKED, or NOT_CONFIGURED)
- **Expected Result**: 200 OK with reachability status; reachable=true only when status=ONLINE AND tokenStatus=ACTIVE

### TC-18-P06: Get Connection Code Snippets (All 4 Languages)
- **Priority**: High
- **Preconditions**: Entity exists with a device credential
- **Test Data**: Entity UUID
- **Steps**:
  1. Send GET /api/connectivity/:entityId/snippets
  2. Verify response status is 200
  3. Verify response contains `snippets.python` with requests library code
  4. Verify response contains `snippets.nodejs` with fetch-based code
  5. Verify response contains `snippets.curl` with curl commands
  6. Verify response contains `snippets.arduino` with WiFi + HTTPClient code
  7. Verify all snippets contain the entity name in comments
  8. Verify all snippets contain the UNS path in comments
  9. Verify token is masked (shows only last 8 chars as hint)
- **Expected Result**: 200 OK with 4 code snippets, each containing entity-specific URLs, masked token, and UNS path

### TC-18-P07: Verify ONLINE After Sending Data
- **Priority**: High
- **Preconditions**: Entity has a device token, entity has tracing enabled or connectivity tracking active
- **Test Data**: Device token for the entity
- **Steps**:
  1. Note initial connectivity status via GET /api/connectivity/:entityId
  2. Send telemetry data via POST /api/data/telemetry with device token
  3. Wait 2 seconds for pipeline processing
  4. Check connectivity status again via GET /api/connectivity/:entityId
  5. Verify `connectivity.status` is "ONLINE"
  6. Verify `connectivity.lastActivityAt` is recent (within last minute)
  7. Verify `connectivity.protocol` is "HTTP"
- **Expected Result**: After sending data, entity shows as ONLINE with recent lastActivityAt and correct protocol

### TC-18-P08: Revoke Device Token
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN or ADMIN, entity has an active device credential
- **Test Data**: Entity UUID
- **Steps**:
  1. Send DELETE /api/connectivity/:entityId/token
  2. Verify response status is 200
  3. Verify response contains `revoked: true`
  4. Verify GET /api/connectivity/:entityId shows credential.isActive = false
  5. Verify connectivity status changes to OFFLINE
  6. Attempt to send telemetry with the revoked token and verify it fails
- **Expected Result**: 200 OK, token revoked, status set to OFFLINE, subsequent data sends rejected

### TC-18-P09: Get Connection History
- **Priority**: Medium
- **Preconditions**: Entity has connection/disconnection events in ts_device_events
- **Test Data**: Entity UUID, period query parameter
- **Steps**:
  1. Send GET /api/connectivity/:entityId/history
  2. Verify response status is 200
  3. Verify response is an array of events with `time`, `eventType`, `details`
  4. Verify eventType values are "CONNECTED" or "DISCONNECTED"
  5. Test with period=7d and period=30d query parameters
  6. Verify events are ordered by time DESC
- **Expected Result**: 200 OK with array of connection history events sorted by time descending

### TC-18-P10: Token Regeneration Replaces Existing Token
- **Priority**: Medium
- **Preconditions**: Entity already has an active device credential
- **Test Data**: Entity UUID
- **Steps**:
  1. Note the current token from GET /api/connectivity/:entityId
  2. Send POST /api/connectivity/:entityId/token to generate new token
  3. Verify the new token differs from the old one
  4. Verify old token no longer works for telemetry
  5. Verify new token works for telemetry
- **Expected Result**: New token replaces old; old token becomes invalid for data ingestion

---

## Negative Test Cases

### TC-18-N01: Get Connectivity for Non-Existent Entity
- **Priority**: High
- **Preconditions**: Logged in with ASSET_VIEW permission
- **Test Data**: Non-existent UUID: `00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Send GET /api/connectivity/00000000-0000-0000-0000-000000000000
  2. Verify response returns connectivity with status "UNKNOWN" and null credential
- **Expected Result**: 200 OK with UNKNOWN status (no 404 since it returns defaults)

### TC-18-N02: Get Snippets for Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: Logged in with ASSET_VIEW permission
- **Test Data**: Non-existent UUID
- **Steps**:
  1. Send GET /api/connectivity/00000000-0000-0000-0000-000000000000/snippets
  2. Verify response status is 404
  3. Verify error is "NOT_FOUND"
- **Expected Result**: 404 Not Found — entity does not exist

### TC-18-N03: Generate Token Without Admin Role
- **Priority**: High
- **Preconditions**: Logged in as OPERATOR (not SUPER_ADMIN or ADMIN)
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send POST /api/connectivity/:entityId/token with OPERATOR token
  2. Verify response status is 403
- **Expected Result**: 403 Forbidden — token generation requires SUPER_ADMIN or ADMIN role

### TC-18-N04: Revoke Token for Entity Without Credential
- **Priority**: Medium
- **Preconditions**: Entity exists but has no device credential
- **Test Data**: Entity UUID with no DeviceCredential
- **Steps**:
  1. Send DELETE /api/connectivity/:entityId/token
  2. Verify response status is 404
  3. Verify error message indicates no device credential found
- **Expected Result**: 404 Not Found — no credential to revoke

### TC-18-N05: Generate Token for Non-Existent Entity
- **Priority**: Medium
- **Preconditions**: Logged in as ADMIN
- **Test Data**: Non-existent entity UUID
- **Steps**:
  1. Send POST /api/connectivity/00000000-0000-0000-0000-000000000000/token
  2. Verify response status is 404
  3. Verify error is "NOT_FOUND"
- **Expected Result**: 404 Not Found — entity does not exist

### TC-18-N06: Access Connectivity Without Authentication
- **Priority**: High
- **Preconditions**: No JWT token
- **Test Data**: Valid entity UUID
- **Steps**:
  1. Send GET /api/connectivity/:entityId without Authorization header
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized — missing token

### TC-18-N07: Custom Token Too Short
- **Priority**: Low
- **Preconditions**: Logged in as ADMIN, entity exists
- **Test Data**: `{ "customToken": "short" }` (less than minLength 8)
- **Steps**:
  1. Send POST /api/connectivity/:entityId/token with customToken "short"
  2. Verify response status is 400
  3. Verify error references minLength constraint
- **Expected Result**: 400 Bad Request — customToken must be at least 8 characters


---

## Phase 2 Notes

- Connectivity management applies to filter entities. Filters with IoT sensors can have device tokens for telemetry data ingestion.
- Filter entities support the same connectivity features: token generation, MQTT/HTTP data transport, code snippets, and connection history.
- The AHU dashboard relies on device connectivity to display real-time filter status.


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
