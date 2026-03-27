# EG-03: Roles & Permissions — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: admin / Admin@123 (SUPER_ADMIN)
- **OPERATOR user**: For negative permission tests (create one if needed)
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
```

---

## Test Execution

### Test: TC-03-P01 — List All Roles

**API (curl):**
```bash
curl -s -X GET "$API/roles" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/config/roles
2. Observe role list with columns: Name, Display Name, Level, System, Active

**Expected Result:**
- API: Array of at least 6 roles
- Each has: `id`, `name`, `displayName`, `hierarchyLevel`, `permissions`, `color`, `isSystem`, `isActive`

**Pass/Fail:**
- [ ] Response status 200
- [ ] Array contains SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER
- [ ] Roles ordered by hierarchyLevel

---

### Test: TC-03-P02 — List Active Roles

**API (curl):**
```bash
curl -s -X GET "$API/roles/active" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Array of active roles with minimal fields (id, name, displayName, hierarchyLevel, color)

**Pass/Fail:**
- [ ] Response status 200
- [ ] Only active roles returned (no isActive=false)
- [ ] Minimal fields (no permissions array)

---

### Test: TC-03-P03 — Get Role by Name

**API (curl):**
```bash
curl -s -X GET "$API/roles/OPERATOR" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- `{"id":"...","name":"OPERATOR","displayName":"Operator","hierarchyLevel":2,"permissions":[...],"isSystem":true,"isActive":true}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] `name` equals "OPERATOR"
- [ ] `hierarchyLevel` equals 2
- [ ] `permissions` is an array

---

### Test: TC-03-P04 — List All Available Permissions

**API (curl):**
```bash
curl -s -X GET "$API/roles/permissions/all" \
  -H "Authorization: Bearer $TOKEN" | jq '.permissions | length'

curl -s -X GET "$API/roles/permissions/all" \
  -H "Authorization: Bearer $TOKEN" | jq '.permissions[:5]'
```

**Expected Result:**
- 39+ permissions, each with `key`, `label`, `category`
- Categories include: User Management, Config, Assets, Data, Alarms, etc.

**Pass/Fail:**
- [ ] Response status 200
- [ ] At least 39 permissions returned
- [ ] Each has key, label, category

---

### Test: TC-03-P05 — Create Custom Role

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QUALITY_INSPECTOR",
    "displayName": "Quality Inspector",
    "description": "Quality control and inspection role",
    "hierarchyLevel": 3,
    "permissions": ["ASSET_VIEW", "ASSET_CREATE", "DATA_VIEW"],
    "color": "#10B981"
  }' | jq .
```

**Verify creation:**
```bash
curl -s -X GET "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Create: `{"success":true,"data":{"name":"QUALITY_INSPECTOR","hierarchyLevel":3,...}}`
- Verify: Full role details

**Pass/Fail:**
- [ ] Create returns success
- [ ] Role visible in GET /api/roles
- [ ] Permissions match what was sent

---

### Test: TC-03-P06 — Update Role Permissions

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X PUT "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": ["ASSET_VIEW", "ASSET_CREATE", "ASSET_UPDATE", "DATA_VIEW", "DATA_EXPORT"],
    "description": "Updated quality control role with export access"
  }' | jq .

# Verify
curl -s -X GET "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN" | jq '.permissions'
```

**Expected Result:**
- Update: `{"success":true,"data":{...}}`
- Permissions now include DATA_EXPORT

**Pass/Fail:**
- [ ] Update returns success
- [ ] Permissions array updated correctly
- [ ] Description updated

---

### Test: TC-03-P07 — Delete Custom Role

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X DELETE "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify gone
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- Delete: `{"success":true}`
- GET: 404

**Pass/Fail:**
- [ ] Delete returns success
- [ ] Role no longer accessible

---

### Test: TC-03-P08 — Get Creatable Roles

**API (curl):**
```bash
curl -s -X GET "$API/roles/ADMIN/creatable" \
  -H "Authorization: Bearer $TOKEN" | jq '.[].name'
```

**Expected Result:**
- Array of roles with hierarchyLevel <= 5 (ADMIN level)
- SUPER_ADMIN (level 6) should NOT be in the list

**Pass/Fail:**
- [ ] Response status 200
- [ ] SUPER_ADMIN NOT in list
- [ ] ADMIN and below ARE in list

---

### Test: TC-03-N01 — Create Duplicate Role Name

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"OPERATOR","displayName":"Dup Operator","hierarchyLevel":2,"permissions":[]}'
```

**Expected Result:**
- HTTP 409 Conflict

**Pass/Fail:**
- [ ] Response status 409
- [ ] Error mentions duplicate name

---

### Test: TC-03-N02 — Create Role Without ROLE_MANAGE Permission

**API (curl):**
```bash
# Create OPERATOR user if needed, then login
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"opuser","fullName":"Op User","email":"opuser@test.com","role":"OPERATOR","password":"OpUser@123","confirmPassword":"OpUser@123"}' > /dev/null 2>&1

OP_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"opuser","password":"OpUser@123"}' | jq -r '.token')

# Attempt role listing as OPERATOR
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/roles" \
  -H "Authorization: Bearer $OP_TOKEN"
```

**Expected Result:**
- HTTP 403 Forbidden

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-03-N03 — Delete Role with Assigned Users

**API (curl):**
```bash
# Check if OPERATOR has users assigned
curl -s -X GET "$API/users?role=OPERATOR" \
  -H "Authorization: Bearer $TOKEN" | jq '.total'

# If total > 0, attempt delete
VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/roles/OPERATOR" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .
```

**Expected Result:**
- HTTP 409 with `{ error: "...", usersCount: N }`

**Pass/Fail:**
- [ ] Response status 409
- [ ] `usersCount` > 0

---

### Test: TC-03-N04 — Create Role with Hierarchy > 10

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"HIGH_ROLE","displayName":"Too High","hierarchyLevel":15,"permissions":[]}'
```

**Expected Result:**
- HTTP 400 — hierarchyLevel maximum is 10

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions hierarchy limit

---

### Test: TC-03-N05 — Create Role with Empty Name

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/roles" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"","displayName":"Empty Name","hierarchyLevel":3,"permissions":[]}'
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400

---

### Test: TC-03-N06 — Access /api/roles as VIEWER

**API (curl):**
```bash
# Create VIEWER user and login
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"vieweruser","fullName":"Viewer User","email":"viewer@test.com","role":"VIEWER","password":"Viewer@123","confirmPassword":"Viewer@123"}' > /dev/null 2>&1

V_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"vieweruser","password":"Viewer@123"}' | jq -r '.token')

curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/roles" \
  -H "Authorization: Bearer $V_TOKEN"
```

**Expected Result:**
- HTTP 403 Forbidden

**Pass/Fail:**
- [ ] Response status 403

---

### Test: TC-03-N07 — Get Non-Existent Role

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/roles/NONEXISTENT_ROLE_XYZ" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- HTTP 404

**Pass/Fail:**
- [ ] Response status 404

---

## Cleanup
```bash
# Delete test users and roles created during testing
VTOKEN=$(get_vtoken)
# Delete test roles (if any remain)
curl -s -X DELETE "$API/roles/QUALITY_INSPECTOR" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" 2>/dev/null

# Delete test users
for user in opuser vieweruser; do
  ID=$(curl -s -X GET "$API/users?search=$user" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id // empty')
  if [ -n "$ID" ]; then
    VTOKEN=$(get_vtoken)
    curl -s -X DELETE "$API/users/$ID" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-Verification-Token: $VTOKEN" > /dev/null
    echo "Deleted $user"
  fi
done
```


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

