# EG-21: Debug Traces — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (superadmin / Admin@123) who has READ_DEBUG_TRACE and MANAGE_DEBUG_TRACE permissions
- **Secondary Account**: User without debug trace permissions for negative tests
- **Tools**: curl, jq, browser
- **Setup**: Entity with device token. Must have sent at least some telemetry data.
- **Base URL**: http://localhost:3000

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Get an entity with a device token
ENTITY_ID=$(curl -s -X GET "http://localhost:3000/api/assets/instances?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Token: $TOKEN"
echo "Entity ID: $ENTITY_ID"

# Get device token (generate if needed)
DEVICE_TOKEN=$(curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')

echo "Device Token: $DEVICE_TOKEN"
```

---

## Test Execution

### Test: TC-21-P01 — Enable Tracing for Entity

**Browser Steps:**
1. Navigate to http://34.232.224.0/debug
2. Find the entity in the entity filter or settings
3. Toggle tracing ON for the entity
4. Verify toggle indicates "Enabled"

**API (curl):**
```bash
curl -s -X PUT "http://localhost:3000/api/debug/traces/entity/$ENTITY_ID/toggle" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "entityId": "<uuid>",
    "traceEnabled": true
  }
  ```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] traceEnabled is true
- [ ] Audit log entry created

---

### Test: TC-21-P02 — Send Telemetry and Verify Trace

**API (curl):**
```bash
# Send telemetry
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'

# Wait for pipeline
sleep 3

# Check for trace
curl -s -X GET "http://localhost:3000/api/debug/traces?entityId=$ENTITY_ID&pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0] | {finalStatus, transport, messageType, payloadSize, totalDurationMs}'
```

**Expected Result:**
- Trace created with:
  - finalStatus: "SUCCESS" or "SUCCESS_WITH_WARNINGS"
  - transport: "HTTP"
  - messageType: "POST_TELEMETRY"
  - payloadSize > 0
  - totalDurationMs > 0

**Pass/Fail:**
- [ ] Trace record exists for this entity
- [ ] finalStatus indicates success
- [ ] transport is "HTTP"
- [ ] messageType is "POST_TELEMETRY"

---

### Test: TC-21-P03 — List Traces with Pagination

**Browser Steps:**
1. Navigate to http://34.232.224.0/debug
2. Verify trace list displays with pagination controls
3. Click next page to verify pagination works

**API (curl):**
```bash
# Page 1
curl -s -X GET "http://localhost:3000/api/debug/traces?page=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, page, limit, totalPages, dataCount: (.data | length)}'

# Page 2 (if exists)
curl -s -X GET "http://localhost:3000/api/debug/traces?page=2&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '{page, dataCount: (.data | length)}'
```

**Expected Result:**
- Standard pagination envelope: data, total, page, limit, totalPages
- Data array <= pageSize
- Page 2 has different records

**Pass/Fail:**
- [ ] Pagination envelope correct
- [ ] Data ordered by time DESC
- [ ] Page 2 returns different records

---

### Test: TC-21-P04 — Filter by Status

**API (curl):**
```bash
# SUCCESS
curl -s -X GET "http://localhost:3000/api/debug/traces?status=SUCCESS&pageSize=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].finalStatus'

# FAILED
curl -s -X GET "http://localhost:3000/api/debug/traces?status=FAILED&pageSize=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].finalStatus'

# DLQ
curl -s -X GET "http://localhost:3000/api/debug/traces?status=DLQ&pageSize=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].finalStatus'

# SUCCESS_WITH_WARNINGS
curl -s -X GET "http://localhost:3000/api/debug/traces?status=SUCCESS_WITH_WARNINGS&pageSize=3" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].finalStatus'
```

**Pass/Fail:**
- [ ] SUCCESS filter returns only SUCCESS traces
- [ ] FAILED filter returns only FAILED traces
- [ ] Each status filter returns only matching records

---

### Test: TC-21-P05 — Filter by Transport

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/debug/traces?transport=HTTP&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].transport'
```

**Pass/Fail:**
- [ ] All returned traces have transport matching HTTP (case-insensitive)

---

### Test: TC-21-P06 — Filter by Entity ID

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/debug/traces?entityId=$ENTITY_ID&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {entityId, entityName}'
```

**Pass/Fail:**
- [ ] All results match the entity ID or entity name

---

### Test: TC-21-P07 — Filter by Date Range

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/debug/traces?from=2026-03-01T00:00:00Z&to=2026-03-05T23:59:59Z&pageSize=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | .time'
```

**Pass/Fail:**
- [ ] All traces have time within the specified range

---

### Test: TC-21-P08 — Get Trace Detail

**API (curl):**
```bash
# Get a trace ID
TRACE_ID=$(curl -s -X GET "http://localhost:3000/api/debug/traces?pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Trace ID: $TRACE_ID"

# Get detail
curl -s -X GET "http://localhost:3000/api/debug/traces/$TRACE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Full trace with all fields:
  ```json
  {
    "id": "<uuid>",
    "time": "...",
    "messageId": "...",
    "entityId": "...",
    "entityName": "...",
    "transport": "HTTP",
    "messageType": "POST_TELEMETRY",
    "payloadSize": 42,
    "stages": [
      { "stage": 3, "name": "Device Validation", "status": "SUCCESS", "durationMs": 5 },
      { "stage": 6, "name": "Message Validation", "status": "SUCCESS", "durationMs": 12 },
      { "stage": 7, "name": "Rule Chain Resolution", "status": "SUCCESS", "durationMs": 30 },
      { "stage": 8, "name": "Rule Chain Output", "status": "SUCCESS", "durationMs": 2 },
      { "stage": 9, "name": "Data Persistence", "status": "SUCCESS", "durationMs": 45 },
      { "stage": 10, "name": "Audit Trail", "status": "SUCCESS", "durationMs": 8 },
      { "stage": 11, "name": "Event Emission", "status": "SUCCESS", "durationMs": 3 }
    ],
    "finalStatus": "SUCCESS",
    "totalDurationMs": 105
  }
  ```

**Pass/Fail:**
- [ ] All pipeline stage names present
- [ ] Each stage has name, status, durationMs
- [ ] totalDurationMs is sum of stage durations (approximately)

---

### Test: TC-21-P09 — Get Pipeline Statistics

**Browser Steps:**
1. Navigate to http://34.232.224.0/debug
2. Check the statistics panel at top of page
3. Verify success rates, average duration, top errors are displayed

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/debug/traces/stats \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "successRate1h": 95.5,
    "successRate24h": 92.3,
    "avgDurationMs": 120,
    "topErrors": [
      { "code": "ERR_VALIDATION", "count": 3 }
    ],
    "byTransport": {
      "HTTP": { "total": 50, "failed": 3 },
      "MQTT": { "total": 20, "failed": 1 }
    }
  }
  ```

**Pass/Fail:**
- [ ] successRate1h is 0-100
- [ ] successRate24h is 0-100
- [ ] avgDurationMs >= 0
- [ ] topErrors is an array
- [ ] byTransport has transport keys with total/failed

---

### Test: TC-21-P10 — Disable Tracing

**API (curl):**
```bash
# Disable (toggle OFF)
curl -s -X PUT "http://localhost:3000/api/debug/traces/entity/$ENTITY_ID/toggle" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Send telemetry
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 30}'

sleep 3

# Check traces — should NOT have a new trace
LATEST_TRACE=$(curl -s -X GET "http://localhost:3000/api/debug/traces?entityId=$ENTITY_ID&pageSize=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].time')

echo "Latest trace time: $LATEST_TRACE"
# Verify this is the same trace from before, not a new one
```

**Expected Result:**
- traceEnabled=false
- No new trace created after sending telemetry

**Pass/Fail:**
- [ ] Toggle returns traceEnabled=false
- [ ] No new trace record for subsequent telemetry

---

### Test: TC-21-P11 — Filter by Error Code

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/debug/traces?errorCode=ERR&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {errorCode, finalStatus}'
```

**Pass/Fail:**
- [ ] All results have errorCode containing "ERR"

---

### Test: TC-21-N01 — Access Without READ_DEBUG_TRACE

**API (curl):**
```bash
# Use a user without debug trace permissions
NO_PERM_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer_user","password":"Viewer@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/api/debug/traces \
  -H "Authorization: Bearer $NO_PERM_TOKEN"
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-21-N02 — Toggle Without MANAGE_DEBUG_TRACE

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X PUT "http://localhost:3000/api/debug/traces/entity/$ENTITY_ID/toggle" \
  -H "Authorization: Bearer $NO_PERM_TOKEN"
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-21-N03 — Get Non-Existent Trace

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/debug/traces/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 with "Trace not found"

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-21-N04 — Filter with Invalid Status

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/debug/traces?status=INVALID_STATUS" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- 400 Bad Request

**Pass/Fail:**
- [ ] Response status is 400

---

### Test: TC-21-N05 — Access Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET http://localhost:3000/api/debug/traces
```

**Expected Result:**
- 401 Unauthorized

**Pass/Fail:**
- [ ] Response status is 401


> **Phase 2 (Digital FMS):** Debug traces apply to filter entity telemetry. Filter operations (cycle start, advance) do NOT generate pipeline traces as they use separate API endpoints.


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
