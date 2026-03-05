# EG-04: Entity Templates — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: admin / Test@12345 (SUPER_ADMIN)
- **Tools**: curl, jq

## Setup
```bash
API="http://localhost:3000/api"

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

get_vtoken() {
  curl -s -X POST "$API/auth/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"Test@12345"}' | jq -r '.verificationToken'
}
```

---

## Test Execution

### Test: TC-04-P01 — Create Template with All Attribute Types

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

TEMPLATE_ID=$(curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Temperature Sensor",
    "description": "IoT temperature sensor template with all attribute types",
    "category": "Sensor",
    "attributeSchema": [
      { "name": "serialNumber", "type": "TEXT", "required": true },
      { "name": "calibrationDate", "type": "DATE", "required": true },
      { "name": "lastServiceDate", "type": "DATETIME", "required": false },
      { "name": "maxTemp", "type": "FLOAT", "required": true },
      { "name": "sampleRate", "type": "INTEGER", "required": true },
      { "name": "isCalibrated", "type": "BOOLEAN", "required": false },
      { "name": "location", "type": "DROPDOWN", "required": true, "options": ["Lab A", "Lab B", "Warehouse"] },
      { "name": "datasheet", "type": "URL", "required": false },
      { "name": "certificate", "type": "FILE", "required": false }
    ],
    "maxParentConnections": 1,
    "maxConnections": 10
  }' | jq -r '.data.id')

echo "Template ID: $TEMPLATE_ID"
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/assets/templates
2. Click "Create Template"
3. Fill in Name: Temperature Sensor, Category: Sensor
4. Add 9 attributes with each type (TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE)
5. Set Max Parent Connections: 1, Max Connections: 10
6. Save — may trigger reauth

**Expected Result:**
- API: 201 with `{"success":true,"data":{"id":"...","name":"Temperature Sensor","version":1,"attributeSchema":[...9 items]}}`
- UI: Template appears in template list

**Pass/Fail:**
- [ ] Response status 201
- [ ] 9 attribute types preserved
- [ ] `version` equals 1
- [ ] `category` equals "Sensor"

---

### Test: TC-04-P02 — Create Template with Telemetry Schema

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

FLOW_ID=$(curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Flow Meter",
    "description": "Industrial flow meter with telemetry",
    "category": "Equipment",
    "telemetrySchema": [
      { "key": "temperature", "type": "FLOAT", "unit": "celsius" },
      { "key": "pressure", "type": "FLOAT", "unit": "bar" },
      { "key": "flowRate", "type": "INTEGER", "unit": "L/min" },
      { "key": "isOnline", "type": "BOOLEAN" },
      { "key": "statusMsg", "type": "STRING" }
    ]
  }' | jq -r '.data.id')

echo "Flow Meter ID: $FLOW_ID"
```

**Expected Result:**
- 201 with 5 telemetry schema entries

**Pass/Fail:**
- [ ] Response status 201
- [ ] `telemetrySchema` array has 5 items
- [ ] Types: FLOAT, INTEGER, BOOLEAN, STRING present

---

### Test: TC-04-P03 — Create Template with Alarm Rules

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

PRESSURE_ID=$(curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Pressure Vessel",
    "category": "Equipment",
    "telemetrySchema": [
      { "key": "pressure", "type": "FLOAT", "unit": "psi" }
    ],
    "alarmRules": [
      { "name": "High Pressure", "type": "HIGH", "telemetryKey": "pressure", "threshold": 150, "severity": "WARNING" },
      { "name": "Critical Pressure", "type": "HIGH_HIGH", "telemetryKey": "pressure", "threshold": 200, "severity": "CRITICAL" },
      { "name": "Low Pressure", "type": "LOW", "telemetryKey": "pressure", "threshold": 20, "severity": "ALARM" }
    ]
  }' | jq -r '.data.id')

echo "Pressure Vessel ID: $PRESSURE_ID"
```

**Expected Result:**
- 201 with 3 alarm rules

**Pass/Fail:**
- [ ] Response status 201
- [ ] `alarmRules` has 3 entries
- [ ] Severities: WARNING, CRITICAL, ALARM

---

### Test: TC-04-P04 — Create Template with Status Lifecycle

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

PROD_ID=$(curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production Equipment",
    "category": "Equipment",
    "statusLifecycle": [
      { "name": "NEW", "color": "#6B7280", "transitions": ["ACTIVE", "MAINTENANCE"] },
      { "name": "ACTIVE", "color": "#10B981", "transitions": ["MAINTENANCE", "DECOMMISSIONED"] },
      { "name": "MAINTENANCE", "color": "#F59E0B", "transitions": ["ACTIVE", "DECOMMISSIONED"] },
      { "name": "DECOMMISSIONED", "color": "#EF4444", "transitions": [] }
    ]
  }' | jq -r '.data.id')

echo "Production Equipment ID: $PROD_ID"
```

**Expected Result:**
- 201 with 4 status lifecycle entries

**Pass/Fail:**
- [ ] Response status 201
- [ ] `statusLifecycle` has 4 statuses
- [ ] Transitions are correctly defined

---

### Test: TC-04-P05 — List Templates with Pagination

**API (curl):**
```bash
curl -s -X GET "$API/assets/templates?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, page, limit, totalPages, count: (.data | length)}'
```

**Expected Result:**
- `{"total":N,"page":1,"limit":10,"totalPages":N,"count":N}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] Paginated structure present
- [ ] `data` array contains template objects

---

### Test: TC-04-P06 — Get Template by ID

**API (curl):**
```bash
curl -s -X GET "$API/assets/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{name, category, version, attrCount: (.attributeSchema | length)}'
```

**Expected Result:**
- Full template object with all schemas

**Pass/Fail:**
- [ ] Response status 200
- [ ] All fields present

---

### Test: TC-04-P07 — Update Template (Version Increment)

**API (curl):**
```bash
# Check current version
V_BEFORE=$(curl -s -X GET "$API/assets/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.version')
echo "Version before: $V_BEFORE"

VTOKEN=$(get_vtoken)
curl -s -X PUT "$API/assets/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Updated description with more details","maxConnections":20}' | jq .

# Check new version
V_AFTER=$(curl -s -X GET "$API/assets/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.version')
echo "Version after: $V_AFTER"
```

**Expected Result:**
- Version incremented from N to N+1
- Description updated

**Pass/Fail:**
- [ ] Version incremented by 1
- [ ] Description updated
- [ ] New version snapshot created

---

### Test: TC-04-P08 — Get Template Versions

**API (curl):**
```bash
curl -s -X GET "$API/assets/templates/$TEMPLATE_ID/versions" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].versionNumber'
```

**Expected Result:**
- Array of versions sorted descending (latest first)

**Pass/Fail:**
- [ ] Response status 200
- [ ] Multiple versions returned
- [ ] Each has versionNumber, snapshot, createdAt

---

### Test: TC-04-P09 — Delete Template (Soft Delete)

**API (curl):**
```bash
# Create a disposable template
VTOKEN=$(get_vtoken)
DEL_TMPL=$(curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Disposable Template","category":"General"}' | jq -r '.data.id')

# Delete it
VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/assets/templates/$DEL_TMPL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify soft-deleted
curl -s -X GET "$API/assets/templates/$DEL_TMPL" \
  -H "Authorization: Bearer $TOKEN" | jq '.isActive'
```

**Expected Result:**
- Delete: `{"success":true}`
- `isActive` is false

**Pass/Fail:**
- [ ] Delete returns success
- [ ] Template still retrievable but isActive=false

---

### Test: TC-04-N01 — Create Duplicate Template Name

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Temperature Sensor","category":"Sensor"}'
```

**Expected Result:**
- HTTP 409 Conflict

**Pass/Fail:**
- [ ] Response status 409

---

### Test: TC-04-N02 — Create Template Without Name

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"No name provided"}'
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400

---

### Test: TC-04-N04 — Update Non-Existent Template

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT "$API/assets/templates/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Ghost template"}'
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

## Cleanup
```bash
# Templates created during testing (soft-delete only)
for name in "Temperature Sensor" "Flow Meter" "Pressure Vessel" "Production Equipment"; do
  echo "Template: $name"
done
echo "Note: Templates are soft-deleted (isActive=false). No physical cleanup needed."
```
