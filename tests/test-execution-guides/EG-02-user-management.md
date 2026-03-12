# EG-02: User Management — Execution Guide

## Prerequisites
- **API Base**: `http://localhost:3000/api`
- **Credentials**: admin / Admin@123 (SUPER_ADMIN)
- **Required Role**: SUPER_ADMIN or ADMIN for all user management operations
- **Tools**: curl, jq

## Setup
```bash
API="http://localhost:3000/api"

# Login and get token
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","force":true}' | jq -r '.token')

# Helper: Get verification token
get_vtoken() {
  curl -s -X POST "$API/auth/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password":"Admin@123"}' | jq -r '.verificationToken'
}
```

---

## Test Execution

### Test: TC-02-P01 — List Users with Pagination

**API (curl):**
```bash
curl -s -X GET "$API/users?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/users
2. Observe user table with columns: Username, Full Name, Email, Role, Status
3. Check pagination controls at bottom

**Expected Result:**
- API: `{"data":[...],"total":N,"page":1,"limit":10,"totalPages":N}`
- UI: Table with user rows, pagination controls

**Pass/Fail:**
- [ ] Response status 200
- [ ] `data` is an array
- [ ] `total`, `page`, `limit`, `totalPages` present as integers

---

### Test: TC-02-P02 — Get User Statistics

**API (curl):**
```bash
curl -s -X GET "$API/users/stats" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: `{"total":N,"enabled":N,"disabled":N,"locked":N,"expired":N}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] All 5 fields present as integers
- [ ] `total` >= `enabled` + `disabled` + `locked` + `expired`

---

### Test: TC-02-P03 — Create User with All Fields

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser01",
    "fullName": "Test User One",
    "email": "test01@company.com",
    "department": "Quality Assurance",
    "role": "OPERATOR",
    "password": "TestUser@123",
    "confirmPassword": "TestUser@123"
  }' | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/users/create
2. Fill in Username: testuser01
3. Fill in Full Name: Test User One
4. Fill in Email: test01@company.com
5. Select Role: OPERATOR
6. Fill in Department: Quality Assurance
7. Set Password: TestUser@123
8. Confirm Password: TestUser@123
9. Submit — may trigger reauth dialog

**Expected Result:**
- API: 201 with `{"id":"<uuid>","username":"testuser01","fullName":"Test User One","email":"test01@company.com","role":"OPERATOR","status":"ENABLED"}`
- Save the user ID: `USER_ID=<returned_id>`

**Pass/Fail:**
- [ ] Response status 201
- [ ] User created with all provided fields
- [ ] `status` is ENABLED by default

---

### Test: TC-02-P04 — Get User by ID

**API (curl):**
```bash
# Replace USER_ID with actual ID from TC-02-P03
USER_ID="<paste_id_here>"

curl -s -X GET "$API/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Full user object with `failedLoginAttempts`, `forcePasswordChange`, `isTemporaryPassword`, `createdAt`, `updatedAt`

**Pass/Fail:**
- [ ] Response status 200
- [ ] All fields present
- [ ] `forcePasswordChange` is true (newly created user)

---

### Test: TC-02-P05 — Update User Fields

**API (curl):**
```bash
VTOKEN=$(get_vtoken)

curl -s -X PUT "$API/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Updated Test User",
    "department": "Engineering",
    "role": "SUPERVISOR"
  }' | jq .
```

**Verify persistence:**
```bash
curl -s -X GET "$API/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{fullName, department, role}'
```

**Expected Result:**
- `fullName`: "Updated Test User"
- `department`: "Engineering"
- `role`: "SUPERVISOR"

**Pass/Fail:**
- [ ] Response status 200
- [ ] Fields updated correctly
- [ ] GET confirms persistence

---

### Test: TC-02-P06 — Delete User

**API (curl):**
```bash
# Create a throwaway user first
VTOKEN=$(get_vtoken)
DEL_USER=$(curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"deletetest","fullName":"Delete Me","email":"del@test.com","role":"VIEWER","password":"Delete@123","confirmPassword":"Delete@123"}' | jq -r '.id')

echo "User to delete: $DEL_USER"

# Delete the user
VTOKEN=$(get_vtoken)
curl -s -X DELETE "$API/users/$DEL_USER" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify gone
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/users/$DEL_USER" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result:**
- Delete: `{"success":true}`
- GET after delete: 404

**Pass/Fail:**
- [ ] Delete returns 200 with success
- [ ] GET returns 404 after deletion

---

### Test: TC-02-P07 — Bulk Delete Users

**API (curl):**
```bash
# Create 2 users
VTOKEN=$(get_vtoken)
ID1=$(curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"bulk01","fullName":"Bulk One","email":"bulk01@test.com","role":"VIEWER","password":"Bulk@12345","confirmPassword":"Bulk@12345"}' | jq -r '.id')

VTOKEN=$(get_vtoken)
ID2=$(curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"bulk02","fullName":"Bulk Two","email":"bulk02@test.com","role":"VIEWER","password":"Bulk@12345","confirmPassword":"Bulk@12345"}' | jq -r '.id')

echo "IDs to delete: $ID1, $ID2"

# Bulk delete
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users/bulk-delete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userIds\":[\"$ID1\",\"$ID2\"]}" | jq .
```

**Expected Result:**
- `{"success":true,"deletedCount":2,"deletedUsers":[{"id":"...","username":"bulk01"},{"id":"...","username":"bulk02"}]}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] `deletedCount` equals 2
- [ ] `deletedUsers` contains both usernames

---

### Test: TC-02-P08 — Disable User Account

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users/$USER_ID/disable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

# Verify status
curl -s -X GET "$API/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.status'
```

**Expected Result:**
- Disable: `{"success":true}`
- Status: `"DISABLED"`

**Pass/Fail:**
- [ ] Disable returns success
- [ ] User status is DISABLED

---

### Test: TC-02-P09 — Enable User Account

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users/$USER_ID/enable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" | jq .

curl -s -X GET "$API/users/$USER_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '.status'
```

**Expected Result:**
- Enable: `{"success":true}`
- Status: `"ENABLED"`

**Pass/Fail:**
- [ ] Enable returns success
- [ ] User status is ENABLED

---

### Test: TC-02-P10 — Unlock Locked User

**API (curl):**
```bash
# First, lock a test user (5 failed attempts)
for i in {1..5}; do
  curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"testuser01","password":"WrongPassword"}' > /dev/null
done

# Unlock
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users/$USER_ID/unlock" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"TempUnlock@123"}' | jq .

# Verify can login with temp password
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser01","password":"TempUnlock@123"}' | jq '{success, user: {forcePasswordChange}}'
```

**Expected Result:**
- Unlock: `{"success":true,"message":"Account unlocked with temporary password..."}`
- Login: succeeds with `forcePasswordChange: true`

**Pass/Fail:**
- [ ] Unlock returns success
- [ ] User can login with temp password
- [ ] `forcePasswordChange` is true

---

### Test: TC-02-P11 — Admin Reset Password

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users/$USER_ID/reset-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"newPassword":"ResetPass@123"}' | jq .
```

**Expected Result:**
- `{"success":true,"message":"Password reset successfully. User must change on next login."}`

**Pass/Fail:**
- [ ] Response status 200
- [ ] Success message present

---

### Test: TC-02-N01 — Create Duplicate Username

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","fullName":"Duplicate","email":"dup@test.com","role":"OPERATOR","password":"DupTest@123","confirmPassword":"DupTest@123"}'
```

**Expected Result:**
- HTTP 409 Conflict with duplicate username error

**Pass/Fail:**
- [ ] Response status 409
- [ ] Error message mentions duplicate/existing username

---

### Test: TC-02-N03 — Create User with Weak Password

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"weakpwd","fullName":"Weak","email":"weak@test.com","role":"OPERATOR","password":"123","confirmPassword":"123"}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions password requirements

---

### Test: TC-02-N04 — Create User as OPERATOR (Insufficient Permission)

**API (curl):**
```bash
# First, create an OPERATOR user and login as them
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"operatortest","fullName":"Op Test","email":"op@test.com","role":"OPERATOR","password":"Operator@123","confirmPassword":"Operator@123"}' > /dev/null

# Login as operator (force password change first if needed)
OP_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"operatortest","password":"Operator@123"}' | jq -r '.token')

# Attempt to create user as OPERATOR
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/users" \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"shouldfail","fullName":"Should Fail","email":"fail@test.com","role":"VIEWER","password":"Fail@12345","confirmPassword":"Fail@12345"}'
```

**Expected Result:**
- HTTP 403 Forbidden

**Pass/Fail:**
- [ ] Response status 403
- [ ] Error mentions insufficient permissions

---

### Test: TC-02-N05 — Update Non-Existent User

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X PUT "$API/users/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Ghost"}'
```

**Expected Result:**
- HTTP 404 Not Found

**Pass/Fail:**
- [ ] Response status 404

---

### Test: TC-02-N06 — Delete Self

**API (curl):**
```bash
# Get own user ID
MY_ID=$(curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.id')

VTOKEN=$(get_vtoken)
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X DELETE "$API/users/$MY_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN"
```

**Expected Result:**
- HTTP 400 or 403 — cannot delete own account

**Pass/Fail:**
- [ ] Self-deletion blocked
- [ ] Appropriate error message

---

### Test: TC-02-N07 — Missing Required Fields

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"incomplete"}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR with details about missing fields

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error details list missing fields

---

### Test: TC-02-N08 — Invalid Email Format

**API (curl):**
```bash
VTOKEN=$(get_vtoken)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"bademail","fullName":"Bad Email","email":"not-an-email","role":"OPERATOR","password":"Admin@123","confirmPassword":"Admin@123"}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions email format

---

## Cleanup
```bash
# Delete test users created during testing
# List all test users
curl -s -X GET "$API/users?search=test" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[] | {id, username}'

# Delete each one (replace IDs)
# VTOKEN=$(get_vtoken)
# curl -s -X DELETE "$API/users/<id>" -H "Authorization: Bearer $TOKEN" -H "X-Verification-Token: $VTOKEN"
```
