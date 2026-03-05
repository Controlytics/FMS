# EG-09: Audit Trail -- Execution Guide

## Prerequisites
- **App URL**: http://3.108.185.106
- **API Base**: http://localhost:3000/api (from server) or http://3.108.185.106/api (remote)
- **SUPER_ADMIN Credentials**: admin / Test@12345
- **Additional User**: Create or use an ADMIN-level user for non-SUPER_ADMIN audit generation
- **Browser**: Chrome or Firefox with DevTools open (Network tab)
- **Tools**: curl, psql (for DB verification)

## Setup: Obtain Auth Token

```bash
# Login as SUPER_ADMIN
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq -r '.token')

echo "Token: $TOKEN"
```

## Setup: Generate Audit Records (if needed)

Login as a non-SUPER_ADMIN user to generate visible audit records:
```bash
# Login as an ADMIN or OPERATOR user to create audit entries
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"YourPassword123"}' | jq -r '.token')
```

---

## Test Execution

### Test: TC-09-P01 -- List Audit Records with Default Pagination

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/audit \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Status 200 with JSON:
```json
{
  "data": [
    {
      "id": 1,
      "userId": "operator1",
      "userRole": "OPERATOR",
      "action": "LOGIN",
      "targetType": null,
      "targetId": null,
      "beforeValue": null,
      "afterValue": { ... },
      "reason": null,
      "signatureMeaning": null,
      "ipAddress": "127.0.0.1",
      "timestamp": "2026-03-05T10:00:00.000Z",
      "integrityValid": true
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 20,
  "totalPages": 2
}
```

**Pass/Fail:**
- [ ] Response status is 200
- [ ] `data` is an array
- [ ] `page` is 1, `limit` is 20
- [ ] Each record has `integrityValid` field
- [ ] No records with `userRole: "SUPER_ADMIN"` appear

---

### Test: TC-09-P02 -- List Audit Records with Custom Pagination

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?page=2&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Status 200 with `page: 2`, `limit: 5`, data array with up to 5 items.

**Pass/Fail:**
- [ ] `page` is 2
- [ ] `limit` is 5
- [ ] `data` array length <= 5
- [ ] `totalPages` equals ceil(total / 5)

---

### Test: TC-09-P03 -- Filter Audit Records by Action Type

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?action=LOGIN" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Status 200. Every record in `data` has `"action": "LOGIN"`.

**Pass/Fail:**
- [ ] All returned records have action=LOGIN
- [ ] `total` reflects only LOGIN records

---

### Test: TC-09-P04 -- Filter Audit Records by User ID

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?userId=operator1" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Status 200. Every record in `data` has `"userId": "operator1"`.

**Pass/Fail:**
- [ ] All returned records have the correct userId
- [ ] No records from other users appear

---

### Test: TC-09-P05 -- Filter Audit Records by Date Period (Today)

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?period=today" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].timestamp'
```

**Expected Result:**
- All timestamps are from today's date.

**Pass/Fail:**
- [ ] All timestamps are >= today midnight
- [ ] No records from previous days

---

### Test: TC-09-P06 -- Filter Audit Records by Custom Date Range

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?startDate=2026-03-01T00:00:00Z&endDate=2026-03-05T23:59:59Z" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- All records have timestamps between March 1 and March 5, 2026.

**Pass/Fail:**
- [ ] All timestamps within range
- [ ] `total` reflects filtered count

---

### Test: TC-09-P07 -- Filter Audit Records by Target Type

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?targetType=USER" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].targetType'
```

**Expected Result:**
- All returned records have `targetType: "USER"`.

**Pass/Fail:**
- [ ] All records have targetType=USER

---

### Test: TC-09-P08 -- Search Audit Records Across Fields

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?search=LOGIN" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Records where "LOGIN" appears in userId, action, targetType, targetId, or userRole.

**Pass/Fail:**
- [ ] At least one record returned
- [ ] Search term matches at least one field in each record

---

### Test: TC-09-P09 -- Sort Audit Records by Action Ascending

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/audit?sortBy=action&sortOrder=asc" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[].action'
```

**Expected Result:**
- Actions are in alphabetical ascending order.

**Pass/Fail:**
- [ ] Actions sorted A-Z

---

### Test: TC-09-P10 -- Get Single Audit Record with Checksum Verification

**API (curl):**
```bash
# Get first record ID
RECORD_ID=$(curl -s -X GET "http://localhost:3000/api/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0].id')

# Get single record
curl -s -X GET "http://localhost:3000/api/audit/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Full record with all fields including checksum, previousChecksum, and `integrityValid: true`.

**Pass/Fail:**
- [ ] Response includes `checksum` field (hex string)
- [ ] Response includes `integrityValid: true`
- [ ] All fields present (id, userId, userRole, action, targetType, targetId, beforeValue, afterValue, timestamp)

---

### Test: TC-09-P11 -- Delete Single Audit Record (SUPER_ADMIN)

**API (curl):**
```bash
# Get a record to delete
RECORD_ID=$(curl -s -X GET "http://localhost:3000/api/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0].id')

echo "Deleting record: $RECORD_ID"

# Delete it
curl -s -X DELETE "http://localhost:3000/api/audit/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify it is gone
curl -s -X GET "http://localhost:3000/api/audit/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify deletion was audit-logged
curl -s -X GET "http://localhost:3000/api/audit?action=AUDIT_RECORD_DELETED&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Delete returns `{ "success": true }`
- GET returns 404
- Audit log contains AUDIT_RECORD_DELETED entry

**Pass/Fail:**
- [ ] Delete returns success: true
- [ ] GET after delete returns 404
- [ ] AUDIT_RECORD_DELETED entry exists with beforeValue containing the deleted record info

---

### Test: TC-09-P12 -- Bulk Delete Audit Records (SUPER_ADMIN)

**API (curl):**
```bash
# Get 3 record IDs
IDS=$(curl -s -X GET "http://localhost:3000/api/audit?limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq '[.data[].id]')

echo "Deleting IDs: $IDS"

# Bulk delete
curl -s -X POST http://localhost:3000/api/audit/bulk-delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"ids\": $IDS}" | jq .

# Verify AUDIT_RECORDS_BULK_DELETED entry
curl -s -X GET "http://localhost:3000/api/audit?action=AUDIT_RECORDS_BULK_DELETED&limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Bulk delete returns `{ "success": true, "count": 3 }`
- Audit log contains AUDIT_RECORDS_BULK_DELETED entry

**Pass/Fail:**
- [ ] count matches number of IDs sent
- [ ] AUDIT_RECORDS_BULK_DELETED entry created
- [ ] Individual records return 404

---

### Test: TC-09-P13 -- SUPER_ADMIN Actions Not Logged

**Browser Steps:**
1. Navigate to http://3.108.185.106/audit.
2. Review the audit table. No records should have userRole "SUPER_ADMIN".

**API (curl):**
```bash
# List all audit records and check for SUPER_ADMIN
curl -s -X GET "http://localhost:3000/api/audit?limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq '[.data[] | select(.userRole == "SUPER_ADMIN")] | length'
```

**Expected Result:**
- API: Returns 0 (no SUPER_ADMIN records in results).

**Pass/Fail:**
- [ ] Zero records with userRole=SUPER_ADMIN in response

---

### Test: TC-09-N01 -- Delete Audit Record Without CONFIG_UPDATE Permission

**API (curl):**
```bash
# Login as OPERATOR (no CONFIG_UPDATE permission)
OP_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"YourPassword123"}' | jq -r '.token')

# Attempt delete
curl -s -X DELETE http://localhost:3000/api/audit/1 \
  -H "Authorization: Bearer $OP_TOKEN" | jq .
```

**Expected Result:**
- API: 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403
- [ ] Error message indicates insufficient permissions

---

### Test: TC-09-N02 -- Bulk Delete Without CONFIG_UPDATE Permission

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/audit/bulk-delete \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": [1, 2, 3]}' | jq .
```

**Expected Result:**
- API: 403 Forbidden

**Pass/Fail:**
- [ ] Response status is 403

---

### Test: TC-09-N03 -- Get Non-Existent Audit Record

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/audit/999999 \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 404 with `{ "error": "Audit record not found" }`

**Pass/Fail:**
- [ ] Response status is 404
- [ ] Error message matches

---

### Test: TC-09-N04 -- Delete Non-Existent Audit Record

**API (curl):**
```bash
curl -s -X DELETE http://localhost:3000/api/audit/999999 \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: 404

**Pass/Fail:**
- [ ] Response status is 404

---

### Test: TC-09-N05 -- Bulk Delete with Empty IDs Array

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/audit/bulk-delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": []}' | jq .
```

**Expected Result:**
- API: 400 validation error (minItems: 1)

**Pass/Fail:**
- [ ] Response status is 400
- [ ] Validation error about minimum items

---

### Test: TC-09-N06 -- Access Audit Trail Without Authentication

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/audit | jq .
```

**Expected Result:**
- API: 401 Unauthorized

**Pass/Fail:**
- [ ] Response status is 401

---

### Test: TC-09-N07 -- Tampered Checksum Detection

**DB Verification (psql):**
```bash
# Get a record ID
RECORD_ID=$(curl -s -X GET "http://localhost:3000/api/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0].id')

# Tamper with the afterValue in the database directly
sudo -u postgres psql digilog_db -c "UPDATE audit_trail SET after_value = '{\"tampered\": true}' WHERE id = $RECORD_ID;"

# Now check via API
curl -s -X GET "http://localhost:3000/api/audit/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.integrityValid'
```

**Expected Result:**
- API: `integrityValid: false`

**Pass/Fail:**
- [ ] integrityValid is false after tampering
- [ ] Record is still accessible but flagged as tampered

---

### Test: TC-09-N08 -- Invalid Sort Field

**API (curl):**
```bash
curl -s -o /dev/null -w "%{http_code}" -X GET "http://localhost:3000/api/audit?sortBy=invalidField" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- API: 200 (falls back to timestamp sort)

**Pass/Fail:**
- [ ] Response status is 200 (not an error)
- [ ] Records sorted by timestamp desc (default fallback)

---

### Test: TC-09-N09 -- Bulk Delete with Non-Existent IDs

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/audit/bulk-delete \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ids": [999998, 999999]}' | jq .
```

**Expected Result:**
- API: `{ "success": true, "count": 0 }`

**Pass/Fail:**
- [ ] success is true
- [ ] count is 0
