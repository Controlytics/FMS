# EG-05: Entity Instances — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: admin / Admin@123 (SUPER_ADMIN)
- **Prerequisite**: At least one entity template must exist (run TC-04 first)
- **Tools**: curl, jq

## Setup
```bash
API="http://localhost:3000/api"

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","force":true}' | jq -r '.token')

get_vtoken() {
  curl -s -X POST "$API/auth/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"Admin@123"}' | jq -r '.verificationToken'
}

# Get a template ID (use the first available)
TMPL_ID=$(curl -s -X GET "$API/assets/templates?page=1&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
echo "Template ID: $TMPL_ID"
```

---

## Test Execution

### Test: TC-05-P01 — Create Instance from Template

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

INST_ID=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Sensor-001\",
    \"description\": \"Main lab temperature sensor\",
    \"templateId\": \"$TMPL_ID\",
    \"attributes\": {
      \"serialNumber\": \"SN-001\",
      \"maxTemp\": 150.0,
      \"sampleRate\": 60,
      \"isCalibrated\": true,
      \"location\": \"Lab A\"
    }
  }" | tee /dev/stderr | jq -r '.data.id')

echo "Instance ID: $INST_ID"
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/assets
2. Click "Add Entity" button
3. Select template from dropdown
4. Fill in Name: Sensor-001
5. Fill in attributes (serialNumber, maxTemp, etc.)
6. Save

**Expected Result:**
- API: 201 with `{"success":true,"data":{"id":"...","name":"Sensor-001","templateId":"...","templateVersion":N}}`
- UI: Entity appears in tree

**Pass/Fail:**
- [ ] Response status 201
- [ ] `templateId` matches
- [ ] `attributes` stored correctly

---

### Test: TC-05-P02 — Create Instance with Parent

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

CHILD_ID=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Sub-Sensor-001a\",
    \"templateId\": \"$TMPL_ID\",
    \"parentId\": \"$INST_ID\",
    \"attributes\": {
      \"serialNumber\": \"SN-001a\",
      \"maxTemp\": 100.0,
      \"sampleRate\": 30,
      \"location\": \"Lab A\"
    }
  }" | tee /dev/stderr | jq -r '.data.id')

echo "Child ID: $CHILD_ID"

# Verify parent-child
curl -s -X GET "$API/assets/instances/$INST_ID/children" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].name'
```

**Expected Result:**
- Child created with parentId set
- GET children of parent returns child

**Pass/Fail:**
- [ ] Child response has `parentId` = parent ID
- [ ] GET children returns "Sub-Sensor-001a"

---

### Test: TC-05-P03 — List Instances with Pagination

**API (curl):**
```bash
curl -s -X GET "$API/assets/instances?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '{total, page, limit, totalPages, count: (.data | length)}'

# Filter by template
curl -s -X GET "$API/assets/instances?templateId=$TMPL_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'
```

**Expected Result:**
- Paginated: `{"total":N,"page":1,"limit":10,"totalPages":N}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] Pagination fields present
- [ ] Filter by templateId works

---

### Test: TC-05-P04 — Get Instance Tree

**API (curl):**
```bash
curl -s -X GET "$API/assets/instances/tree" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0:3] | .[] | {id, name, parentId}'
```

**Expected Result:**
- Flat array (not `{data:[...]}`)
- Each item has id, name, parentId, template

**Pass/Fail:**
- [ ] Response is array (not paginated object)
- [ ] Items have parentId for tree building

---

### Test: TC-05-P05 — Get Instance by ID

**API (curl):**
```bash
curl -s -X GET "$API/assets/instances/$INST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{name, status, templateId, attributes, parentId}'
```

**Expected Result:**
- Full instance detail with template, relationships, identifiers

**Pass/Fail:**
- [ ] Response status 200
- [ ] All fields present

---

### Test: TC-05-P06 — Update Instance Attributes

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X PUT "$API/assets/instances/$INST_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"attributes":{"serialNumber":"SN-001-REV2","maxTemp":200.0},"description":"Updated sensor"}' | jq .

# Verify
curl -s -X GET "$API/assets/instances/$INST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.attributes.serialNumber, .description'
```

**Expected Result:**
- Update: `{"success":true,"data":{...}}`
- serialNumber = "SN-001-REV2"

**Pass/Fail:**
- [ ] Attributes updated
- [ ] Description updated
- [ ] Persistence confirmed

---

### Test: TC-05-P07 — Change Instance Status

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X PATCH "$API/assets/instances/$INST_ID/status" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"ACTIVE"}' | jq .
```

**Expected Result:**
- `{"success":true,"data":{"status":"ACTIVE",...}}`

**Pass/Fail:**
- [ ] Status changed to ACTIVE
- [ ] Response status 200

---

### Test: TC-05-P08 — Delete Instance (Cascade)

**API (curl):**
```bash
# Create a parent and 2 children for deletion test
VTOKEN=$(get_vtoken)
DEL_PARENT=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Delete Parent\",\"templateId\":\"$TMPL_ID\"}" | jq -r '.data.id')

VTOKEN=$(get_vtoken)
curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Delete Child 1\",\"templateId\":\"$TMPL_ID\",\"parentId\":\"$DEL_PARENT\"}" > /dev/null

VTOKEN=$(get_vtoken)
curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Delete Child 2\",\"templateId\":\"$TMPL_ID\",\"parentId\":\"$DEL_PARENT\"}" > /dev/null

# Delete parent (cascade)
VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/assets/instances/$DEL_PARENT" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .
```

**Expected Result:**
- `{"success":true,"deactivatedCount":3}`

**Pass/Fail:**
- [ ] deactivatedCount = 3 (parent + 2 children)
- [ ] All three instances isActive=false

---

### Test: TC-05-N01 — Create from Non-Existent Template

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ghost","templateId":"00000000-0000-0000-0000-000000000000"}'
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

### Test: TC-05-N04 — Create with Non-Existent Parent

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Orphan\",\"templateId\":\"$TMPL_ID\",\"parentId\":\"00000000-0000-0000-0000-000000000000\"}"
```

**Expected Result:**
- HTTP 404 — parent not found

**Pass/Fail:**
- [ ] Response status 404

---

### Test: TC-05-N06 — Delete as VIEWER

**API (curl):**
```bash
# Login as viewer (create if needed)
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer05","fullName":"Viewer 05","email":"v05@test.com","role":"VIEWER","password":"Viewer@123","confirmPassword":"Viewer@123"}' > /dev/null 2>&1

V_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"viewer05","password":"Viewer@123"}' | jq -r '.token')

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X DELETE "$API/assets/instances/$INST_ID" \
  -H "Authorization: Bearer $V_TOKEN"
```

**Expected Result:**
- HTTP 403

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-05-N08 — Missing Required Fields

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Missing name and templateId"}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error details list missing fields

---

## Cleanup
```bash
echo "Instances are soft-deleted. Key IDs used:"
echo "Main instance: $INST_ID"
echo "Child instance: $CHILD_ID"
```


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

