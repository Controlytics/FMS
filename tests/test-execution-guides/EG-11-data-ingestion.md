# EG-11: Data Ingestion -- Execution Guide

## Prerequisites
- **App URL**: http://34.232.224.0
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: superadmin / Admin@123
- **Device Credential**: A DeviceCredential record with an active access token. You need the `accessToken` value.
- **Entity**: At least one entity instance linked to the device credential.
- **Redis**: Running on localhost:6379 (BullMQ worker must be active)
- **MQTT Broker**: EMQX running on localhost:1883 (for MQTT tests)

## Setup: Obtain Tokens

```bash
# User JWT token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Device token (get from DeviceCredential table or create one via API)
# Replace with actual device token
DEVICE_TOKEN="your-device-access-token-here"
```

## Setup: Find/Verify Device Credential

```bash
# Check device credentials exist
sudo -u postgres psql digilog_db -c "SELECT id, entity_id, access_token, is_active FROM device_credentials LIMIT 5;"

# Get a valid device token
DEVICE_TOKEN=$(sudo -u postgres psql -t -A digilog_db -c "SELECT access_token FROM device_credentials WHERE is_active = true LIMIT 1;")
ENTITY_ID=$(sudo -u postgres psql -t -A digilog_db -c "SELECT entity_id FROM device_credentials WHERE is_active = true LIMIT 1;")

echo "Device Token: $DEVICE_TOKEN"
echo "Entity ID: $ENTITY_ID"
```

---

## Test Execution

### Test: TC-11-P01 -- HTTP Telemetry with Valid Device Token

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}' | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "messageId": "msg-uuid-here"
}
```

**DB Verification (after 2-3 seconds for pipeline):**
```bash
# Check TimescaleDB for telemetry data
sudo -u postgres psql digilog_tsdb -c "SELECT time, entity_id, key, value_num FROM ts_telemetry WHERE entity_id = '$ENTITY_ID' ORDER BY time DESC LIMIT 5;"

# Check latest_telemetry in main DB
sudo -u postgres psql digilog_db -c "SELECT key, value_num, last_updated FROM latest_telemetry WHERE entity_id = '$ENTITY_ID';"
```

**Pass/Fail:**
- [ ] Response has success: true
- [ ] messageId is a valid UUID
- [ ] Data appears in ts_telemetry within 5 seconds
- [ ] latest_telemetry updated

---

### Test: TC-11-P02 -- HTTP Telemetry with Batch Payload

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"temperature": 25.5}, {"temperature": 26.0}]' | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "messageIds": ["uuid-1", "uuid-2"]
}
```

**Pass/Fail:**
- [ ] Response has messageIds array
- [ ] Array has 2 elements
- [ ] Both data points appear in ts_telemetry

---

### Test: TC-11-P03 -- HTTP Attribute Submission

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/attributes \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firmware_version": "2.1.0", "serial_number": "SN-12345"}' | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "messageId": "uuid-here"
}
```

**DB Verification:**
```bash
sudo -u postgres psql digilog_tsdb -c "SELECT time, key, value_str FROM ts_attributes WHERE entity_id = '$ENTITY_ID' ORDER BY time DESC LIMIT 5;"
```

**Pass/Fail:**
- [ ] success: true
- [ ] Attributes appear in ts_attributes table

---

### Test: TC-11-P04 -- GET Shared Attributes via Device Token

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/data/attributes \
  -H "Authorization: Bearer $DEVICE_TOKEN" | jq .
```

**Expected Result:**
- JSON object with entity's attributes and customAttributes merged.

**Pass/Fail:**
- [ ] Response is a JSON object (not array)
- [ ] Contains entity attribute fields

---

### Test: TC-11-P05 -- Submit Device Event

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/event \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event": "REBOOT", "data": {"reason": "scheduled_maintenance"}, "timestamp": 1709654400000}' | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "messageId": "uuid-here"
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] Event recorded in ts_device_events

---

### Test: TC-11-P06 -- Submit Checklist Response (User JWT)

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/checklist \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\": \"$ENTITY_ID\", \"responses\": {\"q1\": \"Yes\", \"q2\": \"No\"}, \"remarks\": \"All checks passed\"}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "messageId": "uuid-here"
}
```

**DB Verification:**
```bash
sudo -u postgres psql digilog_tsdb -c "SELECT time, checklist_id, submitted_by FROM ts_checklist_responses WHERE entity_id = '$ENTITY_ID' ORDER BY time DESC LIMIT 3;"

sudo -u postgres psql digilog_db -c "SELECT id, checklist_id, entity_id, current_step FROM checklist_reviews WHERE entity_id = '$ENTITY_ID' ORDER BY performed_at DESC LIMIT 3;"
```

**Pass/Fail:**
- [ ] success: true
- [ ] Checklist appears in ts_checklist_responses
- [ ] ChecklistReview created in PG

---

### Test: TC-11-P07 -- Telemetry with Multiple Keys

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60, "pressure": 1013.25, "flow_rate": 45.2}' | jq .
```

**DB Verification:**
```bash
sudo -u postgres psql digilog_db -c "SELECT key, value_num FROM latest_telemetry WHERE entity_id = '$ENTITY_ID' ORDER BY key;"
```

**Pass/Fail:**
- [ ] All 4 keys appear in latest_telemetry
- [ ] Values match sent data

---

### Test: TC-11-P08 -- Send RPC Request

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entityId\": \"$ENTITY_ID\", \"method\": \"getStatus\", \"params\": {}, \"timeout\": 30}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "requestId": "uuid-here"
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] requestId returned

---

### Test: TC-11-P09 -- Poll RPC Response

**API (curl):**
```bash
REQUEST_ID="the-request-id-from-P08"
curl -s -X GET "http://localhost:3000/api/data/rpc/response/$REQUEST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "requestId": "...",
  "response": null
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] response is null (no device reply) or contains response data

---

### Test: TC-11-N01 -- Telemetry with Invalid Device Token

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer invalid-token-12345" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5}' | jq .
```

**Expected Result:**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Invalid or inactive device token"
}
```

**Pass/Fail:**
- [ ] Response status 401
- [ ] Error message matches

---

### Test: TC-11-N02 -- Telemetry Without Authorization Header

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5}' | jq .
```

**Expected Result:**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Missing device access token"
}
```

**Pass/Fail:**
- [ ] Response status 401
- [ ] Message: "Missing device access token"

---

### Test: TC-11-N06 -- Checklist for Non-Existent Entity

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/checklist \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"entityId": "00000000-0000-0000-0000-000000000000", "responses": {"q1": "Yes"}}' | jq .
```

**Expected Result:**
```json
{
  "error": "NOT_FOUND",
  "message": "Entity not found or inactive"
}
```

**Pass/Fail:**
- [ ] Response status 404
- [ ] Error: NOT_FOUND

---

### Test: TC-11-N07 -- Event Without Required 'event' Field

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/event \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {"reason": "test"}}' | jq .
```

**Expected Result:**
- 400 validation error (missing required `event` field)

**Pass/Fail:**
- [ ] Response status 400
- [ ] Validation error about missing required property

---

### Test: TC-11-N09 -- RPC Request Without User JWT

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/data/rpc \
  -H "Content-Type: application/json" \
  -d '{"entityId": "some-uuid", "method": "getStatus"}' | jq .
```

**Expected Result:**
- 401 Unauthorized

**Pass/Fail:**
- [ ] Response status 401


> **Phase 2 (Digital FMS):** Data ingestion pipeline (10-stage) is unchanged. Filter telemetry (differential pressure, airflow) uses standard /api/data/telemetry endpoint. Filter operations use separate /api/filters/ endpoints.

