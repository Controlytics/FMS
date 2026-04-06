# EG-07: Entity Identifiers — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: superadmin / Admin@123 (SUPER_ADMIN)
- **Prerequisite**: At least one entity instance must exist (run TC-05 first)
- **Tools**: curl, jq

## Setup
```bash
API="http://localhost:3000/api"

TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}' | jq -r '.token')

get_vtoken() {
  curl -s -X POST "$API/auth/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"Admin@123"}' | jq -r '.verificationToken'
}

# Get an instance ID
INST_ID=$(curl -s -X GET "$API/assets/instances?page=1&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
echo "Instance ID: $INST_ID"

# Get a second instance for cross-entity tests
INST_ID2=$(curl -s -X GET "$API/assets/instances?page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[1].id')
echo "Instance ID 2: $INST_ID2"
```

---

## Test Execution

### Test: TC-07-P01 — Create QR Identifier

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID\",
    \"identifierType\": \"QR\",
    \"identifierValue\": \"QR-SENSOR-001\",
    \"label\": \"Main QR Code\",
    \"isPrimary\": true
  }" | jq .
```

**Expected Result:**
- 201: `{"success":true,"data":{"id":"...","assetId":"...","identifierType":"QR","identifierValue":"QR-SENSOR-001","isPrimary":true}}`

**Pass/Fail:**
- [ ] Response status 201
- [ ] identifierType = "QR"
- [ ] isPrimary = true

---

### Test: TC-07-P02 — Create BARCODE Identifier

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID\",
    \"identifierType\": \"BARCODE\",
    \"identifierValue\": \"BC-123456789012\",
    \"label\": \"Asset Barcode\"
  }" | jq .
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] identifierType = "BARCODE"

---

### Test: TC-07-P03 — Create RFID Identifier

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID\",
    \"identifierType\": \"RFID\",
    \"identifierValue\": \"RFID-E2003412AB\",
    \"label\": \"RFID Tag\"
  }" | jq .
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] identifierType = "RFID"

---

### Test: TC-07-P04 — Create NFC Identifier

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID\",
    \"identifierType\": \"NFC\",
    \"identifierValue\": \"NFC-04A2D1823B2A80\",
    \"label\": \"NFC Tag\"
  }" | jq .
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] identifierType = "NFC"

---

### Test: TC-07-P05 — Create MANUAL Identifier

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID\",
    \"identifierType\": \"MANUAL\",
    \"identifierValue\": \"INV-2024-00142\",
    \"label\": \"Inventory Number\"
  }" | jq .
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] identifierType = "MANUAL"

---

### Test: TC-07-P06 — Lookup Entity by Identifier Value

**API (curl):**
```bash
curl -s -X GET "$API/assets/identifiers/lookup/QR-SENSOR-001" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Entity details linked to identifier QR-SENSOR-001

**Pass/Fail:**
- [ ] Response status 200
- [ ] Returns entity info with identifier

---

### Test: TC-07-P07 — List Identifiers by Entity

**API (curl):**
```bash
curl -s -X GET "$API/assets/identifiers?assetId=$INST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {type: .identifierType, value: .identifierValue}'
```

**Expected Result:**
- Array with 5 identifiers (QR, BARCODE, RFID, NFC, MANUAL) for this entity

**Pass/Fail:**
- [ ] Response status 200
- [ ] All 5 types present
- [ ] All linked to INST_ID

---

### Test: TC-07-P08 — List Identifiers by Type

**API (curl):**
```bash
curl -s -X GET "$API/assets/identifiers?type=QR" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].identifierType'
```

**Expected Result:**
- All returned identifiers are type QR

**Pass/Fail:**
- [ ] All entries have identifierType = "QR"

---

### Test: TC-07-P09 — Delete Identifier

**API (curl):**
```bash
# Get an identifier ID to delete (MANUAL type)
DEL_ID=$(curl -s -X GET "$API/assets/identifiers?assetId=$INST_ID&type=MANUAL" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/assets/identifiers/$DEL_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify lookup fails
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/assets/identifiers/lookup/INV-2024-00142" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- Delete: `{"success":true}`
- Lookup: 404

**Pass/Fail:**
- [ ] Delete returns success
- [ ] Lookup returns 404

---

### Test: TC-07-N01 — Duplicate identifierValue

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$INST_ID2\",
    \"identifierType\": \"BARCODE\",
    \"identifierValue\": \"QR-SENSOR-001\"
  }"
```

**Expected Result:**
- HTTP 409 — globally unique violation

**Pass/Fail:**
- [ ] Response status 409
- [ ] Error mentions duplicate/unique

---

### Test: TC-07-N02 — Invalid Identifier Type

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assetId\":\"$INST_ID\",\"identifierType\":\"BLUETOOTH\",\"identifierValue\":\"BT-001\"}"
```

**Expected Result:**
- HTTP 400

**Pass/Fail:**
- [ ] Response status 400

---

### Test: TC-07-N03 — Non-Existent Entity

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/identifiers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assetId":"00000000-0000-0000-0000-000000000000","identifierType":"QR","identifierValue":"QR-GHOST"}'
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

### Test: TC-07-N05 — Lookup Non-Existent Value

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/assets/identifiers/lookup/NONEXISTENT-VALUE-XYZ" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

## Cleanup
```bash
echo "Identifiers created during testing:"
curl -s -X GET "$API/assets/identifiers?assetId=$INST_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].identifierValue'
echo "Clean up by deleting identifiers individually if needed"
```


> **Phase 2 (Digital FMS):** Identifiers apply to filter instances for physical tracking. Filter traceability uses identifiers for retirement/replacement chains.

