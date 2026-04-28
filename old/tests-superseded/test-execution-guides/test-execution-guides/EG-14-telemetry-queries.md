# EG-14: Telemetry Queries -- Execution Guide

## Prerequisites
- **App URL**: http://34.232.224.0
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: superadmin / Admin@123
- **Entity with Data**: An entity that has received telemetry data (temperature, humidity, etc.)
- **TimescaleDB**: Running with ts_telemetry, ts_attributes, ts_checklist_responses tables populated

## Setup

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')

# Find an entity with telemetry data
ENTITY_ID=$(sudo -u postgres psql -t -A digilog_db -c "SELECT entity_id FROM latest_telemetry LIMIT 1;")
echo "Entity ID: $ENTITY_ID"

# Check what telemetry keys exist
sudo -u postgres psql digilog_db -c "SELECT key, value_num, last_updated FROM latest_telemetry WHERE entity_id = '$ENTITY_ID';"
```

---

## Test Execution

### Test: TC-14-P01 -- Get Latest Telemetry

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/telemetry/$ENTITY_ID/latest" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
[
  {
    "key": "temperature",
    "valueNum": 25.5,
    "valueStr": null,
    "valueBool": null,
    "valueJson": null,
    "lastUpdated": "2026-03-05T10:00:00.000Z"
  },
  {
    "key": "humidity",
    "valueNum": 60,
    "valueStr": null,
    "valueBool": null,
    "valueJson": null,
    "lastUpdated": "2026-03-05T10:00:00.000Z"
  }
]
```

**Browser Steps:**
1. Navigate to http://34.232.224.0/assets.
2. Select the entity.
3. Click the Telemetry tab.
4. Verify latest values display.

**Pass/Fail:**
- [ ] Response is array
- [ ] Each entry has key, lastUpdated
- [ ] Numeric values in valueNum, strings in valueStr

---

### Test: TC-14-P02 -- Query Time-Series (Raw)

**API (curl):**
```bash
FROM_DATE=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
TO_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

curl -s -X GET "http://localhost:3000/api/telemetry/$ENTITY_ID/timeseries?from=$FROM_DATE&to=$TO_DATE&aggregation=none&limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "time": "2026-03-05T10:00:00.000Z",
      "key": "temperature",
      "value_num": 25.5,
      "value_str": null,
      "value_bool": null,
      "value_json": null
    }
  ],
  "meta": {
    "entityId": "...",
    "from": "...",
    "to": "...",
    "aggregation": "none",
    "interval": null,
    "totalPoints": 100,
    "aggregated": false
  }
}
```

**Pass/Fail:**
- [ ] data is array of raw records
- [ ] meta.aggregated is false
- [ ] meta.interval is null
- [ ] totalPoints matches data.length

---

### Test: TC-14-P04 -- Query with AVG Aggregation

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/telemetry/$ENTITY_ID/timeseries?from=$FROM_DATE&to=$TO_DATE&aggregation=avg&interval=1h&keys=temperature" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "data": [
    {
      "bucket": "2026-03-05T10:00:00.000Z",
      "key": "temperature",
      "value": 25.75
    }
  ],
  "meta": {
    "aggregation": "avg",
    "interval": "1 hour",
    "aggregated": true
  }
}
```

**Pass/Fail:**
- [ ] data has bucketed entries
- [ ] meta.aggregated is true
- [ ] meta.interval is "1 hour"
- [ ] Values are averaged within buckets

---

### Test: TC-14-P10 -- Get Available Telemetry Keys

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/telemetry/$ENTITY_ID/keys" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
[
  {
    "key": "temperature",
    "dataType": "FLOAT",
    "source": "http",
    "unsPath": "site/area/device",
    "updatedAt": "2026-03-05T..."
  }
]
```

**Pass/Fail:**
- [ ] Array of data stream keys
- [ ] Each has key, dataType, source

---

### Test: TC-14-P11 -- Get Current Attributes (All Scopes)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/attributes/$ENTITY_ID/all" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
[
  {
    "key": "firmware_version",
    "value": "2.1.0",
    "updatedBy": null,
    "lastUpdated": "2026-03-05T..."
  }
]
```

**Pass/Fail:**
- [ ] Array of attributes
- [ ] value field coalesced from typed columns
- [ ] lastUpdated present

---

### Test: TC-14-P12 -- Get Attribute Change History

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/attributes/$ENTITY_ID/history?from=$FROM_DATE&to=$TO_DATE&page=1&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "data": [ ... ],
  "total": 10,
  "page": 1,
  "limit": 20
}
```

**Pass/Fail:**
- [ ] Paginated response
- [ ] Each record has time, key, scope

---

### Test: TC-14-N02 -- Time-Series Without Required Parameters

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/telemetry/$ENTITY_ID/timeseries" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 400 validation error for missing from/to

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions required parameters

---

### Test: TC-14-N04 -- Invalid Attribute Scope

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/attributes/$ENTITY_ID/invalid" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Scope must be \"client\", \"server\", or \"all\"."
}
```

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error message lists valid scopes

---

### Test: TC-14-N07 -- Entity with No Telemetry Data

**API (curl):**
```bash
# Find entity without telemetry
NO_DATA_ENTITY=$(sudo -u postgres psql -t -A digilog_db -c "SELECT ai.id FROM asset_instances ai LEFT JOIN latest_telemetry lt ON ai.id = lt.entity_id WHERE lt.entity_id IS NULL AND ai.is_active = true LIMIT 1;")

curl -s -X GET "http://localhost:3000/api/telemetry/$NO_DATA_ENTITY/latest" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Empty array `[]`

**Pass/Fail:**
- [ ] Response is empty array
- [ ] No error returned


> **Phase 2 (Digital FMS):** Telemetry queries work for filter entities. Filter telemetry keys (differentialPressure, airflow, filterLoad) queryable via same endpoints. AHU dashboard uses these endpoints.


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
