# EG-19: QR Codes — Execution Guide

## Prerequisites
- **Credentials**: SUPER_ADMIN (admin / Admin@123), OPERATOR account for negative tests
- **Tools**: curl, jq, browser
- **Setup**: At least one entity instance created
- **Base URL**: http://localhost:3000

## Authentication Setup
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')

ENTITY_ID=$(curl -s -X GET "http://localhost:3000/api/assets/instances?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

echo "Token: $TOKEN"
echo "Entity ID: $ENTITY_ID"
```

---

## Test Execution

### Test: TC-19-P01 — Generate QR Code (Default Settings)

**Browser Steps:**
1. Navigate to http://3.108.185.106/assets
2. Select an entity from the tree/list
3. Click the "QR Code" tab
4. Click "Generate QR Code" button
5. Verify QR code image appears

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected Result:**
- API: 200 OK
  ```json
  {
    "id": "<uuid>",
    "entityId": "<entity-uuid>",
    "qrData": "http://3.108.185.106/m/<entity-uuid>?action=dashboard",
    "svgData": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"250\"...",
    "size": "MEDIUM",
    "includeLabel": false
  }
  ```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] entityId matches request
- [ ] qrData contains entity ID and action=dashboard
- [ ] svgData starts with `<svg`
- [ ] size is "MEDIUM"
- [ ] includeLabel is false

---

### Test: TC-19-P02 — Generate QR Code with Custom Size and Label

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"size": "LARGE", "includeLabel": true, "action": "checklist"}' | jq .
```

**Expected Result:**
- size is "LARGE"
- includeLabel is true
- qrData contains `?action=checklist`
- svgData width is "400" (LARGE size)

**Pass/Fail:**
- [ ] size is "LARGE"
- [ ] includeLabel is true
- [ ] qrData URL has action=checklist
- [ ] SVG contains entity name label

---

### Test: TC-19-P03 — Generate QR Code with SMALL Size

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"size": "SMALL", "action": "history"}' | jq .
```

**Expected Result:**
- size is "SMALL", qrData has `?action=history`

**Pass/Fail:**
- [ ] size is "SMALL"
- [ ] SVG width is "150"

---

### Test: TC-19-P04 — Get QR Code for Entity

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 200 OK with full QR code record including id, entityId, qrData, imagePath, svgData, size, includeLabel, createdAt, updatedAt

**Pass/Fail:**
- [ ] Response status is 200
- [ ] Contains createdAt and updatedAt timestamps
- [ ] entityId matches

---

### Test: TC-19-P05 — Get QR Code as SVG Image

**API (curl):**
```bash
curl -s -D - -X GET "http://localhost:3000/api/qr/$ENTITY_ID/svg" \
  -H "Authorization: Bearer $TOKEN" | head -20
```

**Expected Result:**
- Content-Type: image/svg+xml
- Body starts with `<svg xmlns="http://www.w3.org/2000/svg"`

**Pass/Fail:**
- [ ] Content-Type header is image/svg+xml
- [ ] Body is valid SVG

---

### Test: TC-19-P06 — Re-generate QR Code (Upsert)

**API (curl):**
```bash
# Get existing QR code id
EXISTING_ID=$(curl -s -X GET "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

echo "Existing QR ID: $EXISTING_ID"

# Re-generate with different params
NEW_QR=$(curl -s -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"size": "SMALL", "includeLabel": false, "action": "dashboard"}')

NEW_ID=$(echo "$NEW_QR" | jq -r '.id')
echo "New QR ID: $NEW_ID"

# Verify same ID (upsert behavior)
[ "$EXISTING_ID" = "$NEW_ID" ] && echo "PASS: Same ID (upserted)" || echo "FAIL: Different IDs"
```

**Pass/Fail:**
- [ ] QR code ID is the same (upsert, not duplicate)
- [ ] Updated fields reflect new parameters

---

### Test: TC-19-P07 — Delete QR Code

**API (curl):**
```bash
# Delete
curl -s -X DELETE "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify deleted
curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- Delete returns `{ "deleted": true }`
- Subsequent GET returns 404

**Pass/Fail:**
- [ ] Delete returns 200 with deleted=true
- [ ] GET after delete returns 404

---

### Test: TC-19-N01 — Generate for Non-Existent Entity

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/qr/00000000-0000-0000-0000-000000000000/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Expected Result:**
- 404 with "Entity not found"

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-19-N02 — Get QR Code for Entity Without One

**API (curl):**
```bash
# Use an entity that has no QR code (or delete the existing one first)
curl -s -X DELETE "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" 2>/dev/null

curl -s -X GET "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 with "QR code not found for this entity"

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-19-N03 — Delete Non-Existent QR Code

**API (curl):**
```bash
curl -s -X DELETE "http://localhost:3000/api/qr/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 Not Found

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-19-N04 — Generate Without Sufficient Role

**API (curl):**
```bash
# Login as OPERATOR
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator_user","password":"Operator@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-19-N05 — Delete Without Admin Role

**API (curl):**
```bash
# First re-generate QR code
curl -s -X POST "http://localhost:3000/api/qr/$ENTITY_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null

# Try delete as SUPERVISOR
SUP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"supervisor_user","password":"Supervisor@123"}' | jq -r '.token')

curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE "http://localhost:3000/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $SUP_TOKEN"
```

**Expected Result:**
- 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-19-N06 — Get SVG for Entity Without QR Code

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/qr/00000000-0000-0000-0000-000000000000/svg" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- 404 with "QR code SVG not found for this entity"

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-19-N07 — Access Without Authentication

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X GET "http://localhost:3000/api/qr/$ENTITY_ID"
```

**Expected Result:**
- 401 Unauthorized

**Pass/Fail:**
- [ ] Response status is 401


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

