# EG-18: Connectivity — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (admin / Admin@123), OPERATOR account for negative tests
- **Tools**: curl, jq, browser
- **Setup**: At least one entity instance created. Know its UUID.
- **Base URL**: http://localhost:3000

## Authentication Setup
```bash
# SUPER_ADMIN token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')

# Get first entity ID
ENTITY_ID=$(curl -s -X GET "http://localhost:3000/api/assets/instances?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Token: $TOKEN"
echo "Entity ID: $ENTITY_ID"
```

---

## Test Execution

### Test: TC-18-P01 — Get Entity Connectivity Status

**Browser Steps:**
1. Navigate to http://3.108.185.106/assets
2. Select an entity from the tree/list
3. Click the "Connectivity" tab in the detail panel
4. Verify it displays status (ONLINE/OFFLINE/UNKNOWN), protocol, last activity, source IP
5. Verify access token is displayed (masked)
6. Verify MQTT topics are listed

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "connectivity": {
      "entityId": "<uuid>",
      "status": "ONLINE",
      "lastActivityAt": "2026-03-05T...",
      "protocol": "HTTP",
      "sourceIp": "127.0.0.1"
    },
    "credential": {
      "token": "<64-char-hex>",
      "isActive": true,
      "maxDataRatePerMin": 600,
      "allowedIps": [],
      "allowedTopics": ["site/area/.../telemetry", ...]
    },
    "unsPath": "site/area/line/entity-name",
    "topics": ["site/area/.../telemetry", ...]
  }
  ```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] connectivity object present with status field
- [ ] credential object present (or null if no token)
- [ ] unsPath is a string
- [ ] topics is an array

---

### Test: TC-18-P02 — Get Connectivity for Entity Without Credentials

**API (curl):**
```bash
# Create a fresh entity without token, or use an entity that has no credential
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.credential'
```

**Expected Result:**
- credential is null if no DeviceCredential exists
- connectivity.status is "UNKNOWN"

**Pass/Fail:**
- [ ] credential is null
- [ ] connectivity.status is "UNKNOWN"

---

### Test: TC-18-P03 — Generate New Device Token

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "token": "a1b2c3d4e5f6...64chars",
    "createdAt": "2026-03-05T..."
  }
  ```

**Save token for later tests:**
```bash
DEVICE_TOKEN=$(curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')

echo "Device Token: $DEVICE_TOKEN"
```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] token is a 64-character hex string
- [ ] createdAt is a valid timestamp

---

### Test: TC-18-P04 — Generate Custom Device Token

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customToken": "my-custom-device-token-12345678"}' | jq .
```

**Expected Result:**
- token equals "my-custom-device-token-12345678"

**Pass/Fail:**
- [ ] token matches the custom value
- [ ] Can use custom token for data ingestion

---

### Test: TC-18-P05 — Test Entity Connectivity

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/test" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "reachable": true,
    "protocol": "HTTP",
    "lastActivityAt": "2026-03-05T...",
    "tokenStatus": "ACTIVE"
  }
  ```

**Pass/Fail:**
- [ ] reachable is boolean
- [ ] tokenStatus is one of: ACTIVE, NEVER_USED, REVOKED, NOT_CONFIGURED
- [ ] reachable=true only when status=ONLINE AND tokenStatus=ACTIVE

---

### Test: TC-18-P06 — Get Code Snippets (All 4 Languages)

**Browser Steps:**
1. Navigate to entity detail > Connectivity tab
2. Look for code snippets section
3. Verify snippets in Python, Node.js, curl, and Arduino are displayed
4. Verify the token is masked (only last 8 chars shown)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $TOKEN" | jq '.snippets | keys'
```

**Verify content of each snippet:**
```bash
# Python snippet
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.snippets.python'

# Node.js snippet
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.snippets.nodejs'

# curl snippet
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.snippets.curl'

# Arduino snippet
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.snippets.arduino'
```

**Expected Result:**
- 4 keys: python, nodejs, curl, arduino
- Each snippet contains entity name in comments
- Token is masked as `<TOKEN_ENDING_...last8chars>`

**Pass/Fail:**
- [ ] python snippet contains `import requests`
- [ ] nodejs snippet contains `require('node-fetch')`
- [ ] curl snippet contains `curl -X POST`
- [ ] arduino snippet contains `#include <WiFi.h>`
- [ ] Token is masked in all snippets

---

### Test: TC-18-P07 — Verify ONLINE After Sending Data

**API (curl):**
```bash
# Send telemetry using device token
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'

# Wait for pipeline processing
sleep 2

# Check connectivity status
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.connectivity'
```

**Expected Result:**
- connectivity.status = "ONLINE"
- connectivity.lastActivityAt is recent
- connectivity.protocol = "HTTP"

**Pass/Fail:**
- [ ] Status changed to ONLINE
- [ ] lastActivityAt is within the last minute
- [ ] protocol is "HTTP"

---

### Test: TC-18-P08 — Revoke Device Token

**API (curl):**
```bash
# Revoke
curl -s -X DELETE "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify status
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{status: .connectivity.status, isActive: .credential.isActive}'

# Try sending data with revoked token
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 30}'
```

**Expected Result:**
- Revoke returns `{ "revoked": true }`
- Connectivity status = OFFLINE, credential.isActive = false
- Sending data with revoked token fails

**Pass/Fail:**
- [ ] revoked is true
- [ ] Status changes to OFFLINE
- [ ] Credential isActive is false
- [ ] Data send with revoked token fails

---

### Test: TC-18-P09 — Get Connection History

**API (curl):**
```bash
# Default 24h period
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/history" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 7-day period
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/history?period=7d" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 30-day period
curl -s -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID/history?period=30d" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:5]'
```

**Expected Result:**
- Array of events with time, eventType (CONNECTED/DISCONNECTED), details

**Pass/Fail:**
- [ ] Response is an array
- [ ] Events have time, eventType, details fields
- [ ] Sorted by time DESC
- [ ] Different periods return appropriate ranges

---

### Test: TC-18-P10 — Token Regeneration Replaces Existing Token

**API (curl):**
```bash
# Generate first token
FIRST_TOKEN=$(curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')

# Generate second token
SECOND_TOKEN=$(curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq -r '.token')

echo "First:  $FIRST_TOKEN"
echo "Second: $SECOND_TOKEN"

# Verify they differ
[ "$FIRST_TOKEN" != "$SECOND_TOKEN" ] && echo "PASS: Tokens differ" || echo "FAIL: Tokens same"

# Verify old token fails
curl -s -X POST http://localhost:3000/api/data/telemetry \
  -H "Authorization: Bearer $FIRST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"test": 1}'
```

**Pass/Fail:**
- [ ] Second token differs from first
- [ ] First token no longer works for data ingestion
- [ ] Second token works for data ingestion

---

### Test: TC-18-N01 — Get Connectivity for Non-Existent Entity

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/connectivity/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 200 OK with status "UNKNOWN" and credential null (returns defaults)

**Pass/Fail:**
- [ ] connectivity.status is "UNKNOWN"
- [ ] credential is null

---

### Test: TC-18-N02 — Get Snippets for Non-Existent Entity

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/connectivity/00000000-0000-0000-0000-000000000000/snippets" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-18-N03 — Generate Token Without Admin Role

**API (curl):**
```bash
# Get OPERATOR token
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator_user","password":"Operator@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-18-N04 — Revoke Token for Entity Without Credential

**API (curl):**
```bash
# Use an entity that has no device credential
curl -s -X DELETE "http://localhost:3000/api/connectivity/00000000-0000-0000-0000-000000000000/token" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 Not Found with "No device credential found for this entity"

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-18-N05 — Generate Token for Non-Existent Entity

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/connectivity/00000000-0000-0000-0000-000000000000/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404
- [ ] Error is "NOT_FOUND"

---

### Test: TC-18-N06 — Access Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/connectivity/$ENTITY_ID"
```

**Expected Result:**
- 401 Unauthorized

**Pass/Fail:**
- [ ] Response status is 401

---

### Test: TC-18-N07 — Custom Token Too Short

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customToken": "short"}' | jq .
```

**Expected Result:**
- 400 Bad Request — minLength 8 constraint

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error references minLength


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

