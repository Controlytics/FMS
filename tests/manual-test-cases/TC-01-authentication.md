# TC-01: Authentication — Test Cases

## Overview
- **Module**: Authentication & Session Management
- **API Endpoints**: 8
- **Frontend Pages**: /login, /forgot-password, /change-password, /profile
- **Permissions**: Public (login, forgot-password, beacon-logout), Authenticated (all others)
- **Rate Limits**: Login 10/min per IP, Forgot Password 5/5min per IP

---

## Positive Test Cases

### TC-01-P01: Login with Valid Credentials
- **Priority**: High
- **Preconditions**: User `superadmin` exists with password `Admin@123`, account is ENABLED
- **Test Data**: `{ "username": "superadmin", "password": "Admin@123" }`
- **Steps**:
  1. Send POST /api/auth/login with valid username and password
  2. Verify response status is 200
  3. Verify response contains `token`, `user`, `expiresIn`
  4. Verify `user.username` equals `superadmin` (default seed user)
  5. Verify `user.role` equals `SUPER_ADMIN`
- **Expected Result**: 200 OK with JWT token, user object (id, username, fullName, role, forcePasswordChange, isTemporaryPassword), and expiresIn string

### TC-01-P02: Get Current User Profile (GET /me)
- **Priority**: High
- **Preconditions**: Valid JWT token from TC-01-P01
- **Test Data**: Authorization header with Bearer token
- **Steps**:
  1. Send GET /api/auth/me with valid Authorization header
  2. Verify response status is 200
  3. Verify response contains id, username, fullName, email, role, status, permissions array
- **Expected Result**: 200 OK with full user profile including permissions array

### TC-01-P03: Update Own Profile
- **Priority**: Medium
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "fullName": "System Administrator Updated", "department": "IT Operations" }`
- **Steps**:
  1. Send PUT /api/auth/profile with updated fields
  2. Verify response status is 200
  3. Verify updated fields are reflected in response
  4. Send GET /api/auth/me to confirm changes persisted
- **Expected Result**: 200 OK with updated profile data

### TC-01-P04: Change Password Successfully
- **Priority**: High
- **Preconditions**: Valid JWT token, know current password
- **Test Data**: `{ "currentPassword": "Admin@123", "newPassword": "NewPass@123", "confirmPassword": "NewPass@123" }`
- **Steps**:
  1. Send POST /api/auth/change-password with current and new passwords
  2. Verify response status is 200 with `{ success: true, message: "Password changed successfully" }`
  3. Verify old token still works for remaining session
  4. Logout and login with new password to confirm change
- **Expected Result**: 200 OK, password updated, can login with new credentials

### TC-01-P05: Logout Successfully
- **Priority**: High
- **Preconditions**: Valid JWT token
- **Test Data**: None (uses Authorization header)
- **Steps**:
  1. Send POST /api/auth/logout with valid Authorization header
  2. Verify response status is 200 with `{ success: true }`
  3. Attempt to use the same token for GET /api/auth/me
  4. Verify the token is now invalid (401)
- **Expected Result**: 200 OK, session terminated, token invalidated

### TC-01-P06: Beacon Logout (Tab Close Scenario)
- **Priority**: Medium
- **Preconditions**: Valid JWT token obtained from login
- **Test Data**: `{ "token": "<jwt_token>" }`
- **Steps**:
  1. Send POST /api/auth/beacon-logout with token in request body
  2. Verify response status is 200 with `{ success: true }`
  3. Attempt GET /api/auth/me with that token
  4. Verify 401 response (session terminated)
- **Expected Result**: 200 OK, session terminated via beacon mechanism

### TC-01-P07: Re-authenticate for Sensitive Operations
- **Priority**: High
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "password": "Admin@123" }`
- **Steps**:
  1. Send POST /api/auth/verify with current password
  2. Verify response status is 200
  3. Verify response contains `verificationToken`
  4. Verify verificationToken is a valid JWT string
- **Expected Result**: 200 OK with 5-minute verification token

### TC-01-P08: Forgot Password Request
- **Priority**: Medium
- **Preconditions**: User `superadmin` exists
- **Test Data**: `{ "username": "superadmin" }`
- **Steps**:
  1. Send POST /api/auth/forgot-password with valid username
  2. Verify response status is 200
  3. Verify response message is generic (prevents user enumeration)
- **Expected Result**: 200 OK with message "If the user ID exists, a password reset request has been submitted."

### TC-01-P09: Force Login (Terminate Existing Session)
- **Priority**: Medium
- **Preconditions**: User already logged in from another client
- **Test Data**: `{ "username": "superadmin", "password": "Admin@123", "force": true }`
- **Steps**:
  1. Login from Client A, get token_A
  2. Attempt login from Client B without force flag
  3. Expect SESSION_CONFLICT error
  4. Login from Client B with `"force": true`
  5. Verify Client B gets a new token
  6. Verify token_A is now invalid
- **Expected Result**: Force login terminates previous session and issues new token

### TC-01-P10: Forgot Password for Non-Existent User
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: `{ "username": "nonexistent_user_xyz" }`
- **Steps**:
  1. Send POST /api/auth/forgot-password with non-existent username
  2. Verify response status is 200 (same as valid user)
  3. Verify response message is the same generic message
- **Expected Result**: 200 OK with same message to prevent user enumeration

---

## Negative Test Cases

### TC-01-N01: Login with Invalid Username
- **Priority**: High
- **Preconditions**: None
- **Test Data**: `{ "username": "invalid_user_xyz", "password": "Admin@123" }`
- **Steps**:
  1. Send POST /api/auth/login with non-existent username
  2. Verify response status is 401
  3. Verify error message does not reveal whether username exists
- **Expected Result**: 401 with generic "Invalid credentials" error

### TC-01-N02: Login with Wrong Password
- **Priority**: High
- **Preconditions**: User `superadmin` exists
- **Test Data**: `{ "username": "superadmin", "password": "WrongPassword123" }`
- **Steps**:
  1. Send POST /api/auth/login with valid username, wrong password
  2. Verify response status is 401
  3. Verify response includes `attemptsRemaining` field
- **Expected Result**: 401 with error and attemptsRemaining count

### TC-01-N03: Account Lockout After 5 Failed Attempts
- **Priority**: High
- **Preconditions**: Create test user `locktest` with known password, account ENABLED
- **Test Data**: `{ "username": "locktest", "password": "WrongPassword" }` x5
- **Steps**:
  1. Attempt login with wrong password 5 times consecutively
  2. Track `attemptsRemaining` decreasing (4, 3, 2, 1, 0)
  3. Attempt 6th login with CORRECT password
  4. Verify account is LOCKED and cannot login even with correct password
- **Expected Result**: After 5 failures, account status becomes LOCKED, login returns locked account error

### TC-01-N04: Access Protected Endpoint Without Token
- **Priority**: High
- **Preconditions**: None
- **Test Data**: No Authorization header
- **Steps**:
  1. Send GET /api/auth/me without Authorization header
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized

### TC-01-N05: Access Protected Endpoint with Expired/Invalid Token
- **Priority**: High
- **Preconditions**: None
- **Test Data**: `Authorization: Bearer invalid.jwt.token`
- **Steps**:
  1. Send GET /api/auth/me with malformed JWT
  2. Verify response status is 401
- **Expected Result**: 401 Unauthorized with invalid token error

### TC-01-N06: Rate Limiting on Login (11th Request in 1 Minute)
- **Priority**: High
- **Preconditions**: None
- **Test Data**: Any valid/invalid login payload, sent 11 times within 60 seconds
- **Steps**:
  1. Send POST /api/auth/login 10 times rapidly (any credentials)
  2. Send 11th request within the same minute
  3. Verify 11th request returns 429 Too Many Requests
- **Expected Result**: 429 after 10 requests within 1-minute window

### TC-01-N07: Login with Empty Fields
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: `{ "username": "", "password": "" }`
- **Steps**:
  1. Send POST /api/auth/login with empty username and password
  2. Verify response status is 400
  3. Verify validation error details
- **Expected Result**: 400 VALIDATION_ERROR with field-level error details

### TC-01-N08: SQL Injection Attempt in Username
- **Priority**: High
- **Preconditions**: None
- **Test Data**: `{ "username": "admin' OR '1'='1", "password": "anything" }`
- **Steps**:
  1. Send POST /api/auth/login with SQL injection payload
  2. Verify response is 401 (not 200 or 500)
  3. Verify no SQL error leaks in response
- **Expected Result**: 401 with generic error, no SQL injection executed

### TC-01-N09: XSS Injection in Profile Fields
- **Priority**: Medium
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "fullName": "<script>alert('xss')</script>", "department": "<img src=x onerror=alert(1)>" }`
- **Steps**:
  1. Send PUT /api/auth/profile with XSS payloads
  2. Check if data is stored (may succeed at API level)
  3. Verify GET /api/auth/me returns the data as plain text (no execution)
- **Expected Result**: Data stored as-is or rejected; no script execution in API responses

### TC-01-N10: Session Conflict Detection (Login from Second Location)
- **Priority**: High
- **Preconditions**: User already logged in
- **Test Data**: `{ "username": "superadmin", "password": "Admin@123" }`
- **Steps**:
  1. Login from Client A, receive token
  2. Attempt login from Client B with same credentials (no force flag)
  3. Verify response is 409 with SESSION_CONFLICT error
  4. Verify response includes activeSession details
- **Expected Result**: 409 with SESSION_CONFLICT error and activeSession metadata

### TC-01-N11: Change Password with Mismatched Confirmation
- **Priority**: Medium
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "currentPassword": "Admin@123", "newPassword": "NewPass@123", "confirmPassword": "DifferentPass@456" }`
- **Steps**:
  1. Send POST /api/auth/change-password with mismatched new/confirm
  2. Verify response status is 400
- **Expected Result**: 400 VALIDATION_ERROR, passwords must match

### TC-01-N12: Change Password with Weak New Password
- **Priority**: Medium
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "currentPassword": "Admin@123", "newPassword": "weak", "confirmPassword": "weak" }`
- **Steps**:
  1. Send POST /api/auth/change-password with weak password
  2. Verify response status is 400
  3. Verify error describes password policy requirements
- **Expected Result**: 400 error, password does not meet policy (min 8 chars, complexity)

### TC-01-N13: Re-authenticate with Wrong Password
- **Priority**: High
- **Preconditions**: Valid JWT token
- **Test Data**: `{ "password": "WrongPassword123" }`
- **Steps**:
  1. Send POST /api/auth/verify with incorrect password
  2. Verify response status is 401
- **Expected Result**: 401 REAUTH_FAILED

### TC-01-N14: Forgot Password Rate Limiting (6th Request in 5 Minutes)
- **Priority**: Medium
- **Preconditions**: None
- **Test Data**: `{ "username": "superadmin" }` sent 6 times within 5 minutes
- **Steps**:
  1. Send POST /api/auth/forgot-password 5 times rapidly
  2. Send 6th request within 5-minute window
  3. Verify 429 Too Many Requests
- **Expected Result**: 429 after 5 requests in 5-minute window


---

## Phase 2 Notes

- Authentication endpoints are unchanged for Phase 2. The same login/session/reauth system applies to all Digital Filter Management System operations.
- New reauth actions added for Phase 2: BYPASS_FILTER_STAGE (requires password re-verification for stage bypass with deviation).
- Filter operations (start-cycle, advance, submit-checklist) use the standard Bearer JWT authentication.
- Default login credentials: `superadmin` / `Admin@123`.

