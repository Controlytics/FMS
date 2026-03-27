# EG-17: Data Retention — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN account (admin / Admin@123)
- **Secondary Account**: An ADMIN or OPERATOR account for negative permission tests
- **Tools**: curl, jq (optional), browser
- **Setup**: At least one entity with telemetry data in TimescaleDB. Generate device token and send some telemetry first if needed.
- **Base URL**: http://localhost:3000

## Authentication Setup
```bash
# Get JWT token for SUPER_ADMIN
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')

echo "Token: $TOKEN"

# Get a non-SUPER_ADMIN token (create user first if needed)
VIEWER_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer_user","password":"Viewer@123"}' | jq -r '.token')
```

---

## Test Execution

### Test: TC-17-P01 — Get Default Retention Configuration

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "telemetry": { "retentionDays": 365, "compressionAfterDays": 7 },
    "attributes": { "retentionDays": 730 },
    "events": { "retentionDays": 365 },
    "traces": { "retentionHours": 48 },
    "checklists": { "retentionDays": 2555 },
    "autoEnabled": false,
    "requiresArchive": true
  }
  ```
- DB: If no custom config exists, `SELECT * FROM "SystemConfig" WHERE "configKey" = 'retention'` returns empty

**Pass/Fail:**
- [ ] Response status is 200
- [ ] Default values match for all 5 data types
- [ ] autoEnabled is false, requiresArchive is true

---

### Test: TC-17-P02 — Update Retention Configuration

**Browser Steps:**
1. Navigate to http://3.108.185.106/config/retention
2. Modify telemetry retention days to 180
3. Modify compression after days to 14
4. Toggle autoEnabled ON
5. Save changes
6. Verify the updated values persist after page reload

**API (curl):**
```bash
curl -s -X PUT http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": { "retentionDays": 180, "compressionAfterDays": 14 },
    "attributes": { "retentionDays": 365 },
    "events": { "retentionDays": 90 },
    "traces": { "retentionHours": 72 },
    "checklists": { "retentionDays": 1825 },
    "autoEnabled": true,
    "requiresArchive": false
  }' | jq .
```

**Verify persistence:**
```bash
curl -s -X GET http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 200 OK with updated values
- DB: `SELECT "configValue" FROM "SystemConfig" WHERE "configKey" = 'retention'` shows updated JSON

**Pass/Fail:**
- [ ] PUT returns 200 with updated values
- [ ] GET confirms persistence
- [ ] telemetry.retentionDays is 180
- [ ] autoEnabled is true

---

### Test: TC-17-P03 — Archive Data (Stub Response)

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/archive \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "telemetry",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-06-01T00:00:00Z"
  }' | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "status": "archived",
    "rowsArchived": 0,
    "message": "Archive destination not configured. Configure S3/Azure Blob in system settings."
  }
  ```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] status is "archived"
- [ ] rowsArchived is 0
- [ ] Message mentions archive destination

---

### Test: TC-17-P04 — Execute Retention (Delete Old Data)

**API (curl):**
```bash
# First, check what data exists
curl -s -X GET "http://localhost:3000/api/queries/telemetry/stats?entityId=<ENTITY_ID>" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Execute retention
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "telemetry",
    "olderThanDays": 365,
    "confirmed": true
  }' | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "deleted": 0,
    "dataType": "telemetry",
    "olderThanDays": 365
  }
  ```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] deleted is an integer >= 0
- [ ] dataType matches "telemetry"

---

### Test: TC-17-P05 — Execute Retention for Each Data Type

**API (curl):**
```bash
# Attributes
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"attributes","olderThanDays":730,"confirmed":true}' | jq .

# Events
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"events","olderThanDays":365,"confirmed":true}' | jq .

# Traces
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"traces","olderThanDays":2,"confirmed":true}' | jq .

# Checklists
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"checklists","olderThanDays":2555,"confirmed":true}' | jq .
```

**Expected Result:**
- All return 200 with `deleted` count for each respective TimescaleDB table

**Pass/Fail:**
- [ ] attributes returns 200
- [ ] events returns 200
- [ ] traces returns 200
- [ ] checklists returns 200

---

### Test: TC-17-P06 — Execute Range Deletion With Entity Scope

**API (curl):**
```bash
# Get an entity ID first
ENTITY_ID=$(curl -s -X GET "http://localhost:3000/api/assets/instances?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Entity ID: $ENTITY_ID"

# Execute range deletion scoped to entity
curl -s -X POST http://localhost:3000/api/retention/execute-range \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"dataType\": \"telemetry\",
    \"from\": \"2025-01-01T00:00:00Z\",
    \"to\": \"2025-03-01T00:00:00Z\",
    \"entityId\": \"$ENTITY_ID\",
    \"confirmed\": true
  }" | jq .
```

**Expected Result:**
- API: 200 OK with `deleted`, `dataType`, `from`, `to`

**Pass/Fail:**
- [ ] Response status is 200
- [ ] Only data for the specified entity in the date range is deleted

---

### Test: TC-17-P07 — Delete Specific Keys for an Entity

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/delete-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"dataType\": \"telemetry\",
    \"entityId\": \"$ENTITY_ID\",
    \"keys\": [\"temperature\"],
    \"confirmed\": true
  }" | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "deleted": 5,
    "deletedLatest": 1,
    "dataType": "telemetry",
    "keys": ["temperature"]
  }
  ```

**Pass/Fail:**
- [ ] deleted count is an integer >= 0
- [ ] deletedLatest count is an integer >= 0
- [ ] "humidity" key data for the same entity is NOT affected

---

### Test: TC-17-P08 — Delete Specific History Records

**API (curl):**
```bash
# First get some history to find exact timestamps
curl -s -X GET "http://localhost:3000/api/queries/telemetry/history?entityId=$ENTITY_ID&keys=humidity&from=2025-12-01T00:00:00Z&to=2025-12-02T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[:2]'

# Then delete specific records
curl -s -X POST http://localhost:3000/api/retention/delete-records \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"dataType\": \"telemetry\",
    \"entityId\": \"$ENTITY_ID\",
    \"records\": [
      { \"time\": \"2025-12-01T10:00:00Z\", \"key\": \"humidity\" },
      { \"time\": \"2025-12-01T10:05:00Z\", \"key\": \"humidity\" }
    ],
    \"confirmed\": true
  }" | jq .
```

**Expected Result:**
- API: 200 OK with `deleted` matching the number of matching records

**Pass/Fail:**
- [ ] deleted count matches submitted record count
- [ ] Other records for the same entity/key at different timestamps are intact

---

### Test: TC-17-P09 — Execute Range Deletion for Alarms

**API (curl):**
```bash
# Check current alarms
curl -s -X GET "http://localhost:3000/api/queries/alarms?limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# Delete alarms in range
curl -s -X POST http://localhost:3000/api/retention/execute-range \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "alarms",
    "from": "2025-01-01T00:00:00Z",
    "to": "2025-06-01T00:00:00Z",
    "confirmed": true
  }' | jq .
```

**Expected Result:**
- API: 200 OK, alarms in the Prisma Alarm table within the range are deleted

**Pass/Fail:**
- [ ] deleted count is an integer >= 0
- [ ] Alarms outside the range remain intact

---

### Test: TC-17-N01 — Get Retention Config as Non-SUPER_ADMIN

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" -X GET http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $VIEWER_TOKEN"
```

**Expected Result:**
- API: 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-17-N02 — Update With Missing Required Fields

**API (curl):**
```bash
curl -s -X PUT http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": { "retentionDays": 180 },
    "attributes": { "retentionDays": 365 }
  }' | jq .
```

**Expected Result:**
- API: 400 Bad Request with schema validation error listing missing fields

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error mentions required properties

---

### Test: TC-17-N03 — Update With Zero/Negative Days

**API (curl):**
```bash
curl -s -X PUT http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": { "retentionDays": 0, "compressionAfterDays": -1 },
    "attributes": { "retentionDays": 365 },
    "events": { "retentionDays": 365 },
    "traces": { "retentionHours": 48 },
    "checklists": { "retentionDays": 2555 },
    "autoEnabled": false,
    "requiresArchive": true
  }' | jq .
```

**Expected Result:**
- API: 400 Bad Request — minimum: 1 constraint violated

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error references minimum value violation

---

### Test: TC-17-N04 — Execute Without Confirmation

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"telemetry","olderThanDays":365,"confirmed":false}' | jq .
```

**Expected Result:**
- API: 400 with `error: "CONFIRMATION_REQUIRED"`

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error code is CONFIRMATION_REQUIRED
- [ ] No data was deleted

---

### Test: TC-17-N05 — Execute With Invalid Data Type

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"invalid_type","olderThanDays":365,"confirmed":true}' | jq .
```

**Expected Result:**
- API: 400 Bad Request — enum validation failure

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error references invalid enum value

---

### Test: TC-17-N06 — Archive With Invalid Data Type (traces)

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/archive \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"traces","from":"2025-01-01T00:00:00Z","to":"2025-06-01T00:00:00Z"}' | jq .
```

**Expected Result:**
- API: 400 Bad Request — "traces" is not in the VALID_ARCHIVE_DATA_TYPES enum

**Pass/Fail:**
- [ ] Response status is 400

---

### Test: TC-17-N07 — Delete Keys Without Confirmation

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/retention/delete-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"dataType\":\"telemetry\",\"entityId\":\"$ENTITY_ID\",\"keys\":[\"temperature\"],\"confirmed\":false}" | jq .
```

**Expected Result:**
- API: 400 with CONFIRMATION_REQUIRED

**Pass/Fail:**
- [ ] Response status is 400
- [ ] No keys deleted

---

### Test: TC-17-N08 — Delete Records Exceeding Maximum (501)

**API (curl):**
```bash
# Generate 501 records
RECORDS=$(python3 -c "
import json
records = [{'time': f'2025-12-01T{i//60:02d}:{i%60:02d}:00Z', 'key': 'temp'} for i in range(501)]
print(json.dumps(records))
")

curl -s -X POST http://localhost:3000/api/retention/delete-records \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"dataType\":\"telemetry\",\"entityId\":\"$ENTITY_ID\",\"records\":$RECORDS,\"confirmed\":true}" | jq .
```

**Expected Result:**
- API: 400 Bad Request — records array exceeds maxItems of 500

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Error references maxItems constraint

---

## Cleanup
```bash
# Restore default retention config
curl -s -X PUT http://localhost:3000/api/config/retention \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": { "retentionDays": 365, "compressionAfterDays": 7 },
    "attributes": { "retentionDays": 730 },
    "events": { "retentionDays": 365 },
    "traces": { "retentionHours": 48 },
    "checklists": { "retentionDays": 2555 },
    "autoEnabled": false,
    "requiresArchive": true
  }' | jq .
```


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

