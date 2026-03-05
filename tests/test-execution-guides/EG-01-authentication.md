# EG-01: Authentication — Execution Guide

## Prerequisites
- **App URL**: http://3.108.185.106
- **API Base**: http://localhost:3000/api (from server) or http://3.108.185.106/api (external)
- **Default Credentials**: admin / Test@12345 (SUPER_ADMIN)
- **Tools**: curl, browser (Chrome/Firefox), second browser/incognito for session tests
- **Test User**: Create `locktest` user for lockout testing (TC-01-N03)

## Setup
```bash
# Store base URL as variable
API="http://localhost:3000/api"

# Login and store token for subsequent tests
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq -r '.token')

echo "Token: $TOKEN"
```

---

## Test Execution

### Test: TC-01-P01 — Login with Valid Credentials

**API (curl):**
```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/login
2. Enter username: `admin`
3. Enter password: `Test@12345`
4. Click "Sign In"
5. Observe redirect to dashboard

**Expected Result:**
- API: `{"success":true,"token":"eyJ...","user":{"id":"...","username":"admin","fullName":"...","role":"SUPER_ADMIN","forcePasswordChange":false,"isTemporaryPassword":false},"expiresIn":"8h"}`
- UI: Redirect to / (dashboard), sidebar visible, user avatar in top-right

**Pass/Fail:**
- [ ] Response status 200
- [ ] Response contains `token` (JWT format: xxx.yyy.zzz)
- [ ] `user.role` equals `SUPER_ADMIN`
- [ ] `expiresIn` is present

---

### Test: TC-01-P02 — Get Current User Profile

**API (curl):**
```bash
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: `{"id":"...","username":"admin","fullName":"...","email":"...","role":"SUPER_ADMIN","status":"ENABLED","permissions":[...]}`
- `permissions` is a non-empty array of permission strings

**Pass/Fail:**
- [ ] Response status 200
- [ ] Contains `id`, `username`, `fullName`, `email`, `role`, `status`
- [ ] `permissions` array is present and non-empty

---

### Test: TC-01-P03 — Update Own Profile

**API (curl):**
```bash
curl -s -X PUT "$API/auth/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"System Administrator Updated","department":"IT Operations"}' | jq .
```

**Browser Steps:**
1. Click user avatar/profile icon in top-right
2. Navigate to /profile
3. Change Full Name to "System Administrator Updated"
4. Change Department to "IT Operations"
5. Save changes

**Expected Result:**
- API: `{"id":"...","username":"admin","fullName":"System Administrator Updated","department":"IT Operations","role":"SUPER_ADMIN"}`
- UI: Profile page shows updated values

**Verify persistence:**
```bash
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq '.fullName, .department'
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] `fullName` updated to "System Administrator Updated"
- [ ] `department` updated to "IT Operations"
- [ ] GET /me confirms persisted changes

---

### Test: TC-01-P04 — Change Password Successfully

**API (curl):**
```bash
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Test@12345","newPassword":"NewPass@123","confirmPassword":"NewPass@123"}' | jq .
```

**Expected Result:**
- API: `{"success":true,"message":"Password changed successfully"}`

**Verify by logging in with new password:**
```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"NewPass@123"}' | jq '.success'
```

**IMPORTANT: Change password back after test:**
```bash
NEW_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"NewPass@123","force":true}' | jq -r '.token')

curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $NEW_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"NewPass@123","newPassword":"Test@12345","confirmPassword":"Test@12345"}' | jq .
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] `success` is true
- [ ] Can login with new password
- [ ] Password reverted to original

---

### Test: TC-01-P05 — Logout Successfully

**API (curl):**
```bash
# Get a fresh token for this test
LOGOUT_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

# Logout
curl -s -X POST "$API/auth/logout" \
  -H "Authorization: Bearer $LOGOUT_TOKEN" | jq .

# Verify token is invalid
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/auth/me" \
  -H "Authorization: Bearer $LOGOUT_TOKEN"
```

**Expected Result:**
- Logout: `{"success":true}`
- Subsequent /me: 401 Unauthorized

**Pass/Fail:**
- [ ] Logout returns 200 with `success: true`
- [ ] Token is invalidated (401 on subsequent use)

---

### Test: TC-01-P06 — Beacon Logout

**API (curl):**
```bash
# Get a fresh token
BEACON_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

# Beacon logout (no auth header, token in body)
curl -s -X POST "$API/auth/beacon-logout" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$BEACON_TOKEN\"}" | jq .

# Verify invalidated
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/auth/me" \
  -H "Authorization: Bearer $BEACON_TOKEN"
```

**Expected Result:**
- Beacon logout: `{"success":true}`
- Token invalidated: 401

**Pass/Fail:**
- [ ] Beacon logout returns 200
- [ ] Token is invalidated

---

### Test: TC-01-P07 — Re-authenticate for Sensitive Operations

**API (curl):**
```bash
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

curl -s -X POST "$API/auth/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"Test@12345"}' | jq .
```

**Expected Result:**
- API: `{"success":true,"verificationToken":"eyJ..."}`
- verificationToken is a JWT string valid for 5 minutes

**Pass/Fail:**
- [ ] Response status 200
- [ ] `success` is true
- [ ] `verificationToken` is a valid JWT string (xxx.yyy.zzz format)

---

### Test: TC-01-P08 — Forgot Password Request

**API (curl):**
```bash
curl -s -X POST "$API/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin"}' | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/forgot-password
2. Enter username: `admin`
3. Submit the form

**Expected Result:**
- API: `{"success":true,"message":"If the user ID exists, a password reset request has been submitted."}`
- UI: Success message displayed

**Pass/Fail:**
- [ ] Response status 200
- [ ] Generic message returned (no user enumeration leak)

---

### Test: TC-01-P09 — Force Login

**API (curl):**
```bash
# Login from "Client A"
TOKEN_A=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')
echo "Token A: $TOKEN_A"

# Attempt login from "Client B" without force
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq .
# Should get SESSION_CONFLICT

# Force login from "Client B"
TOKEN_B=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')
echo "Token B: $TOKEN_B"

# Verify Token A is invalid
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN_A"
```

**Expected Result:**
- Non-force login: 409 SESSION_CONFLICT with activeSession details
- Force login: 200 with new token
- Old token: 401 (session terminated)

**Pass/Fail:**
- [ ] Non-force returns SESSION_CONFLICT
- [ ] Force login succeeds with new token
- [ ] Previous token is invalidated

---

### Test: TC-01-P10 — Forgot Password for Non-Existent User

**API (curl):**
```bash
curl -s -X POST "$API/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"username":"nonexistent_user_xyz_12345"}' | jq .
```

**Expected Result:**
- Same 200 response and same message as valid user (TC-01-P08)

**Pass/Fail:**
- [ ] Response status 200
- [ ] Message is identical to valid user response

---

### Test: TC-01-N01 — Login with Invalid Username

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"invalid_user_xyz","password":"Test@12345"}'
```

**Expected Result:**
- HTTP 401 with generic error

**Pass/Fail:**
- [ ] Response status 401
- [ ] Error message is generic (does not confirm username existence)

---

### Test: TC-01-N02 — Login with Wrong Password

**API (curl):**
```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"WrongPassword123"}' | jq .
```

**Expected Result:**
- HTTP 401 with `attemptsRemaining` field

**Pass/Fail:**
- [ ] Response status 401
- [ ] Response contains `attemptsRemaining` (integer)

---

### Test: TC-01-N03 — Account Lockout After 5 Failed Attempts

**Setup — Create test user first:**
```bash
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

VTOKEN=$(curl -s -X POST "$API/auth/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"Test@12345"}' | jq -r '.verificationToken')

curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Verification-Token: $VTOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"locktest","fullName":"Lock Test User","email":"locktest@test.com","role":"OPERATOR","password":"LockTest@123","confirmPassword":"LockTest@123"}' | jq .
```

**API (curl) — Execute lockout:**
```bash
for i in {1..5}; do
  echo "--- Attempt $i ---"
  curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"locktest","password":"WrongPassword"}' | jq '{error, attemptsRemaining}'
done

# 6th attempt with CORRECT password
echo "--- Attempt 6 (correct password) ---"
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"locktest","password":"LockTest@123"}' | jq .
```

**Expected Result:**
- Attempts 1-5: 401 with decreasing attemptsRemaining (4,3,2,1,0)
- Attempt 6: Account LOCKED error even with correct password

**Pass/Fail:**
- [ ] attemptsRemaining decreases correctly
- [ ] After 5 failures, account is locked
- [ ] Correct password does not unlock

---

### Test: TC-01-N04 — Access Protected Endpoint Without Token

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/auth/me"
```

**Expected Result:**
- HTTP 401 Unauthorized

**Pass/Fail:**
- [ ] Response status 401

---

### Test: TC-01-N05 — Access with Invalid/Expired Token

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X GET "$API/auth/me" \
  -H "Authorization: Bearer invalid.jwt.token.here"
```

**Expected Result:**
- HTTP 401 Unauthorized

**Pass/Fail:**
- [ ] Response status 401
- [ ] No server error (500)

---

### Test: TC-01-N06 — Rate Limiting on Login

**API (curl):**
```bash
for i in {1..11}; do
  echo "--- Request $i ---"
  curl -s -w "HTTP_CODE:%{http_code}\n" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"ratetest","password":"any"}'
  echo ""
done
```

**Expected Result:**
- Requests 1-10: 401 (invalid credentials)
- Request 11: 429 Too Many Requests

**Pass/Fail:**
- [ ] First 10 requests return 401
- [ ] 11th request returns 429

---

### Test: TC-01-N07 — Login with Empty Fields

**API (curl):**
```bash
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"","password":""}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error type is VALIDATION_ERROR

---

### Test: TC-01-N08 — SQL Injection in Username

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin' OR '1'='1\",\"password\":\"anything\"}"
```

**Expected Result:**
- HTTP 401 (not 200 or 500)
- No SQL error in response body

**Pass/Fail:**
- [ ] Response status is 401 (not 200 or 500)
- [ ] No SQL error messages in response

---

### Test: TC-01-N09 — XSS in Profile Fields

**API (curl):**
```bash
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

curl -s -X PUT "$API/auth/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"<script>alert(1)</script>","department":"<img src=x onerror=alert(1)>"}' | jq .
```

**Expected Result:**
- Either rejected (400) or stored as plain text (no execution)

**Pass/Fail:**
- [ ] No 500 error
- [ ] If stored, data returned as plain text string

---

### Test: TC-01-N10 — Session Conflict Detection

**API (curl):**
```bash
# Ensure session exists
TOKEN_A=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

# Attempt second login without force
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345"}' | jq .
```

**Expected Result:**
- HTTP 409 with `error: "SESSION_CONFLICT"` and `activeSession` object

**Pass/Fail:**
- [ ] Response status 409
- [ ] Error is SESSION_CONFLICT
- [ ] `activeSession` details present in response

---

### Test: TC-01-N11 — Change Password Mismatch

**API (curl):**
```bash
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Test@12345","newPassword":"NewPass@123","confirmPassword":"DifferentPass@456"}' | jq .
```

**Expected Result:**
- HTTP 400 VALIDATION_ERROR

**Pass/Fail:**
- [ ] Response status 400
- [ ] Validation error about password mismatch

---

### Test: TC-01-N12 — Change Password with Weak Password

**API (curl):**
```bash
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Test@12345","newPassword":"weak","confirmPassword":"weak"}' | jq .
```

**Expected Result:**
- HTTP 400 error describing password policy requirements

**Pass/Fail:**
- [ ] Response status 400
- [ ] Error mentions minimum length or complexity

---

### Test: TC-01-N13 — Re-authenticate with Wrong Password

**API (curl):**
```bash
curl -s -w "\nHTTP_CODE:%{http_code}\n" -X POST "$API/auth/verify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"WrongPassword123"}'
```

**Expected Result:**
- HTTP 401

**Pass/Fail:**
- [ ] Response status 401

---

### Test: TC-01-N14 — Forgot Password Rate Limiting

**API (curl):**
```bash
for i in {1..6}; do
  echo "--- Request $i ---"
  curl -s -w "HTTP_CODE:%{http_code}\n" -X POST "$API/auth/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin"}'
  echo ""
done
```

**Expected Result:**
- Requests 1-5: 200
- Request 6: 429 Too Many Requests

**Pass/Fail:**
- [ ] First 5 requests return 200
- [ ] 6th request returns 429

---

## Cleanup
```bash
# Restore admin profile if modified
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Test@12345","force":true}' | jq -r '.token')

curl -s -X PUT "$API/auth/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"System Administrator","department":""}' | jq .
```
