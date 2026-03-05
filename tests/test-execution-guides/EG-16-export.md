# EG-16: Data Export -- Execution Guide

## Prerequisites
- **App URL**: http://3.108.185.106
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: admin / Test@12345
- **Data Required**: Entity with telemetry, attributes, and/or checklist data. Alarms in the system.
- **TimescaleDB**: ts_telemetry, ts_attributes, ts_checklist_responses tables should have data.

## Setup

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq -r '.token')

# Find entity with telemetry data
ENTITY_ID=$(sudo -u postgres psql -t -A digilog_db -c "SELECT entity_id FROM latest_telemetry LIMIT 1;")
echo "Entity ID: $ENTITY_ID"

# Set date range (last 7 days)
FROM_DATE=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "From: $FROM_DATE"
echo "To: $TO_DATE"
```

---

## Test Execution

### Test: TC-16-P01 -- Export Telemetry as CSV

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE" \
  -H "Authorization: Bearer $TOKEN" \
  -D /dev/stderr -o /tmp/telemetry-export.csv 2>&1 | head -5

echo "---CSV content (first 10 lines)---"
head -10 /tmp/telemetry-export.csv
```

**Expected Result:**
- Response headers include:
  - `Content-Type: text/csv`
  - `Content-Disposition: attachment; filename="telemetry-..."`
- CSV has header: `time,entity_id,key,value_num,value_str,value_bool,value_json,uns_path,source,source_ip`
- Data rows follow

**Pass/Fail:**
- [ ] Content-Type is text/csv
- [ ] Content-Disposition header present
- [ ] CSV has correct columns
- [ ] Data rows present

---

### Test: TC-16-P02 -- Export Telemetry as JSON

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:3]'
```

**Expected Result:**
```json
[
  {
    "time": "2026-03-05T10:00:00.000Z",
    "entity_id": "uuid",
    "key": "temperature",
    "value_num": 25.5,
    "value_str": null,
    "value_bool": null,
    "value_json": null,
    "uns_path": "site/area/device",
    "source": "http",
    "source_ip": "127.0.0.1"
  }
]
```

**Pass/Fail:**
- [ ] Response is JSON array
- [ ] Each record has time, entity_id, key, value columns
- [ ] Data matches expected telemetry

---

### Test: TC-16-P03 -- Export Telemetry with Key Filter

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE&format=json&keys=temperature" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].key' | sort -u
```

**Expected Result:**
- Only "temperature" key in results

**Pass/Fail:**
- [ ] Only specified keys present in output

---

### Test: TC-16-P04 -- Export Alarms as CSV

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/alarms?from=$FROM_DATE&to=$TO_DATE" \
  -H "Authorization: Bearer $TOKEN" \
  -D /dev/stderr -o /tmp/alarms-export.csv 2>&1 | head -3

head -5 /tmp/alarms-export.csv
```

**Expected Result:**
- CSV file with alarm columns

**Pass/Fail:**
- [ ] Content-Type is text/csv
- [ ] CSV has alarm data columns

---

### Test: TC-16-P05 -- Export Alarms as JSON

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/alarms?from=$FROM_DATE&to=$TO_DATE&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:3]'
```

**Expected Result:**
- JSON array of alarm objects

**Pass/Fail:**
- [ ] Response is array
- [ ] Each alarm has id, entityId, alarmType, severity, status

---

### Test: TC-16-P06 -- Export Alarms with Status Filter

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/alarms?from=$FROM_DATE&to=$TO_DATE&status=ACTIVE&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].status'
```

**Pass/Fail:**
- [ ] All exported alarms have status ACTIVE

---

### Test: TC-16-P09 -- Export Attribute History

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/attributes/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:3]'
```

**Expected Result:**
- JSON array of attribute history records with time, scope, key, value columns

**Pass/Fail:**
- [ ] Response is array
- [ ] Each record has time, entity_id, scope, key, value columns

---

### Test: TC-16-P11 -- Export Checklist Responses

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/checklist/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:3]'
```

**Expected Result:**
- JSON array with merged PG + TSDB data including review_status, checked_by fields

**Pass/Fail:**
- [ ] Response is array
- [ ] Records include review_status from PG merge
- [ ] Records include checklist_id, submitted_by, answers

---

### Test: TC-16-P12 -- Export Status Endpoint (Stub)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/status/some-job-id" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "status": "not_implemented",
  "message": "Async exports will be available in a future update"
}
```

**Pass/Fail:**
- [ ] status is "not_implemented"
- [ ] Message about future availability

---

### Test: TC-16-P13 -- Export with No Data in Range

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=2030-01-01T00:00:00Z&to=2030-01-02T00:00:00Z&format=json" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Empty array `[]`

**Pass/Fail:**
- [ ] Response is empty array
- [ ] No error

---

### Test: TC-16-N02 -- Invalid Date Range (from > to)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=2026-03-05T00:00:00Z&to=2026-03-01T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "error": "INVALID_DATE_RANGE",
  "message": "from must be before to"
}
```

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error: INVALID_DATE_RANGE

---

### Test: TC-16-N03 -- Date Range Exceeding Maximum

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=2025-01-01T00:00:00Z&to=2026-03-05T00:00:00Z" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "error": "INVALID_DATE_RANGE",
  "message": "Date range exceeds maximum of 90 days"
}
```

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions maximum days

---

### Test: TC-16-N04 -- Invalid Date Format

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=not-a-date&to=also-not-a-date" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 400 error for invalid date format

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions invalid date

---

### Test: TC-16-N06 -- Export Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/export/telemetry/$ENTITY_ID?from=$FROM_DATE&to=$TO_DATE"
```

**Expected Result:**
- 401

**Pass/Fail:**
- [ ] Response status 401
