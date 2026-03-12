# EG-06: Entity Relationships — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: admin / Admin@123 (SUPER_ADMIN)
- **Prerequisite**: At least 3 entity instances must exist (run TC-05 first)
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

# Get template ID and create 3 test instances
TMPL_ID=$(curl -s -X GET "$API/assets/templates?page=1&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

VTOKEN=$(get_vtoken)
INST_A=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Rel-Entity-A\",\"templateId\":\"$TMPL_ID\"}" | jq -r '.data.id')

VTOKEN=$(get_vtoken)
INST_B=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Rel-Entity-B\",\"templateId\":\"$TMPL_ID\"}" | jq -r '.data.id')

VTOKEN=$(get_vtoken)
INST_C=$(curl -s -X POST "$API/assets/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Rel-Entity-C\",\"templateId\":\"$TMPL_ID\"}" | jq -r '.data.id')

echo "Instance A: $INST_A"
echo "Instance B: $INST_B"
echo "Instance C: $INST_C"
```

---

## Test Execution

### Test: TC-06-P01 — Create CONTAINS Relationship

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceAssetId\": \"$INST_A\",
    \"targetAssetId\": \"$INST_B\",
    \"relationshipType\": \"CONTAINS\"
  }" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "data": { "id": "...", "sourceAssetId": "<A>", "targetAssetId": "<B>", "relationshipType": "CONTAINS" },
  "inverse": { "id": "...", "sourceAssetId": "<B>", "targetAssetId": "<A>", "relationshipType": "CONTAINED_IN" },
  "connectionInfo": { "source": { "used": 1, "allowed": 0, "remaining": "unlimited" }, "target": { ... } }
}
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] Forward relationship is CONTAINS
- [ ] Inverse is CONTAINED_IN (auto-created)
- [ ] `connectionInfo` present

---

### Test: TC-06-P02 — Create FEEDS Relationship

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceAssetId\": \"$INST_A\",
    \"targetAssetId\": \"$INST_C\",
    \"relationshipType\": \"FEEDS\"
  }" | jq '{data_type: .data.relationshipType, inverse_type: .inverse.relationshipType}'
```

**Expected Result:**
- `data_type: "FEEDS"`, `inverse_type: "FED_BY"`

**Pass/Fail:**
- [ ] Forward: FEEDS
- [ ] Inverse: FED_BY

---

### Test: TC-06-P05 — Create CONNECTED_TO (Symmetric)

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceAssetId\": \"$INST_B\",
    \"targetAssetId\": \"$INST_C\",
    \"relationshipType\": \"CONNECTED_TO\"
  }" | jq '{data_type: .data.relationshipType, inverse_type: .inverse.relationshipType}'
```

**Expected Result:**
- Both forward and inverse are CONNECTED_TO

**Pass/Fail:**
- [ ] Forward: CONNECTED_TO
- [ ] Inverse: CONNECTED_TO (symmetric)

---

### Test: TC-06-P06 — List Relationships by Entity

**API (curl):**
```bash
curl -s -X GET "$API/assets/relationships?assetId=$INST_A" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {type: .relationshipType, source: .sourceAsset.name, target: .targetAsset.name}'
```

**Expected Result:**
- Array of relationships involving Entity A

**Pass/Fail:**
- [ ] Response status 200
- [ ] All relationships involve INST_A as source or target

---

### Test: TC-06-P07 — List Relationships by Type

**API (curl):**
```bash
curl -s -X GET "$API/assets/relationships?type=CONTAINS" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].relationshipType'
```

**Expected Result:**
- All entries have `relationshipType: "CONTAINS"`

**Pass/Fail:**
- [ ] All returned relationships are CONTAINS

---

### Test: TC-06-P08 — Delete Relationship (Both Sides)

**API (curl):**
```bash
# Get a relationship ID for INST_B->INST_C (CONNECTED_TO)
REL_ID=$(curl -s -X GET "$API/assets/relationships?assetId=$INST_B&type=CONNECTED_TO" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

echo "Deleting relationship: $REL_ID"

VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/assets/relationships/$REL_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify both sides gone
curl -s -X GET "$API/assets/relationships?assetId=$INST_B&type=CONNECTED_TO" \
  -H "Authorization: Bearer $TOKEN" | jq 'length'
```

**Expected Result:**
- Delete: `{"success":true}`
- Remaining CONNECTED_TO count: 0

**Pass/Fail:**
- [ ] Delete returns success
- [ ] Both forward and inverse deleted

---

### Test: TC-06-N01 — Circular CONTAINS (Cycle Detection)

**API (curl):**
```bash
# A CONTAINS B already exists. Create B CONTAINS C
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceAssetId\":\"$INST_B\",\"targetAssetId\":\"$INST_C\",\"relationshipType\":\"CONTAINS\"}" > /dev/null

# Now attempt C CONTAINS A (creates cycle: A->B->C->A)
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceAssetId\":\"$INST_C\",\"targetAssetId\":\"$INST_A\",\"relationshipType\":\"CONTAINS\"}"
```

**Expected Result:**
- HTTP 400 or 409 — cycle detected

**Pass/Fail:**
- [ ] Cycle detected and blocked
- [ ] Error message mentions cycle/circular

---

### Test: TC-06-N03 — Self-Referencing Relationship

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceAssetId\":\"$INST_A\",\"targetAssetId\":\"$INST_A\",\"relationshipType\":\"CONTAINS\"}"
```

**Expected Result:**
- HTTP 400 — cannot self-reference

**Pass/Fail:**
- [ ] Self-referencing blocked
- [ ] Response status 400

---

### Test: TC-06-N04 — Duplicate Relationship

**API (curl):**
```bash
# A CONTAINS B already exists — try again
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceAssetId\":\"$INST_A\",\"targetAssetId\":\"$INST_B\",\"relationshipType\":\"CONTAINS\"}"
```

**Expected Result:**
- HTTP 409 — duplicate

**Pass/Fail:**
- [ ] Duplicate blocked
- [ ] Response status 409

---

### Test: TC-06-N05 — Non-Existent Entity

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/assets/relationships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sourceAssetId\":\"00000000-0000-0000-0000-000000000000\",\"targetAssetId\":\"$INST_A\",\"relationshipType\":\"CONTAINS\"}"
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

## Cleanup
```bash
echo "Test entities: A=$INST_A, B=$INST_B, C=$INST_C"
echo "Relationships will be cleaned up when instances are soft-deleted"
```
