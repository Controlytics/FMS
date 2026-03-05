# TC-02: User Management — Test Cases

## Overview
- **Module**: User Management (CRUD, Status, Password Reset)
- **API Endpoints**: 14
- **Frontend Pages**: /users, /users/create, /users/:id, /users/reset-requests
- **Permissions**: USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD
- **Reauth Actions**: CREATE_USER, UPDATE_USER, DELETE_USER, BULK_DELETE_USERS, ENABLE_USER, DISABLE_USER, UNLOCK_USER, RESET_PASSWORD, PROCESS_RESET_REQUEST

---

## Positive Test Cases

### TC-02-P01: List Users with Pagination
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, at least 1 user exists
- **Test Data**: Query params `?page=1&limit=10`
- **Steps**:
  1. Send GET /api/users?page=1&limit=10
  2. Verify response has `data` array, `total`, `page`, `limit`, `totalPages`
  3. Verify each user object contains id, username, fullName, email, role, status, createdAt
- **Expected Result**: 200 OK with paginated user list

### TC-02-P02: Get User Statistics
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/users/stats
  2. Verify response contains total, enabled, disabled, locked, expired counts
- **Expected Result**: 200 OK with `{ total, enabled, disabled, locked, expired }` all as integers

### TC-02-P03: Create User with All Fields
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, verification token obtained
- **Test Data**: `{ "username": "testuser01", "fullName": "Test User One", "email": "test01@company.com", "department": "Quality Assurance", "role": "OPERATOR", "password": "TestUser@123", "confirmPassword": "TestUser@123" }`
- **Steps**:
  1. Obtain verification token via POST /api/auth/verify
  2. Send POST /api/users with all fields and X-Verification-Token header
  3. Verify response status is 201
  4. Verify response contains the created user with all fields
- **Expected Result**: 201 Created with user object

### TC-02-P04: Get User by ID
- **Priority**: High
- **Preconditions**: User created in TC-02-P03
- **Test Data**: User ID from TC-02-P03
- **Steps**:
  1. Send GET /api/users/:id with the created user's ID
  2. Verify all fields are present including failedLoginAttempts, forcePasswordChange
- **Expected Result**: 200 OK with complete user details

### TC-02-P05: Update User Fields
- **Priority**: High
- **Preconditions**: User exists, verification token obtained
- **Test Data**: `{ "fullName": "Updated Test User", "department": "Engineering", "role": "SUPERVISOR" }`
- **Steps**:
  1. Obtain verification token
  2. Send PUT /api/users/:id with updated fields
  3. Verify response reflects updated values
  4. GET /api/users/:id to confirm persistence
- **Expected Result**: 200 OK with updated user data

### TC-02-P06: Delete User
- **Priority**: High
- **Preconditions**: User exists (not self), verification token obtained
- **Test Data**: User ID to delete
- **Steps**:
  1. Obtain verification token
  2. Send DELETE /api/users/:id
  3. Verify response `{ success: true }`
  4. GET /api/users/:id returns 404
- **Expected Result**: 200 OK, user permanently deleted

### TC-02-P07: Bulk Delete Users
- **Priority**: Medium
- **Preconditions**: Multiple test users created, verification token obtained
- **Test Data**: `{ "userIds": ["<uuid1>", "<uuid2>"] }`
- **Steps**:
  1. Create 2 test users
  2. Obtain verification token
  3. Send POST /api/users/bulk-delete with both user IDs
  4. Verify response includes `deletedCount` and `deletedUsers`
- **Expected Result**: 200 OK with `{ success: true, deletedCount: 2, deletedUsers: [...] }`

### TC-02-P08: Disable User Account
- **Priority**: High
- **Preconditions**: ENABLED user exists, verification token obtained
- **Test Data**: User ID
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/users/:id/disable
  3. Verify response `{ success: true }`
  4. GET /api/users/:id — verify status is DISABLED
  5. Attempt login as disabled user — verify login fails
- **Expected Result**: 200 OK, user status changed to DISABLED, login blocked

### TC-02-P09: Enable User Account
- **Priority**: High
- **Preconditions**: DISABLED user exists (from TC-02-P08), verification token obtained
- **Test Data**: User ID
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/users/:id/enable
  3. Verify response `{ success: true }`
  4. GET /api/users/:id — verify status is ENABLED
- **Expected Result**: 200 OK, user status changed to ENABLED

### TC-02-P10: Unlock Locked User
- **Priority**: High
- **Preconditions**: User locked via 5 failed login attempts, verification token obtained
- **Test Data**: `{ "newPassword": "TempUnlock@123" }`
- **Steps**:
  1. Lock a user by failing 5 login attempts
  2. Obtain admin verification token
  3. Send POST /api/users/:id/unlock with temporary password
  4. Verify response message mentions temporary password
  5. Login as unlocked user with temporary password
  6. Verify forcePasswordChange is true
- **Expected Result**: 200 OK, account unlocked with temp password, user must change on next login

### TC-02-P11: Admin Reset Password
- **Priority**: High
- **Preconditions**: User exists, admin verification token obtained
- **Test Data**: `{ "newPassword": "ResetPass@123" }`
- **Steps**:
  1. Obtain verification token
  2. Send POST /api/users/:id/reset-password with new password
  3. Verify response `{ success: true }`
  4. Login as user with new password — verify forcePasswordChange
- **Expected Result**: 200 OK, password reset, user must change on next login

### TC-02-P12: List Password Reset Requests
- **Priority**: Medium
- **Preconditions**: At least one reset request exists (from forgot-password flow)
- **Test Data**: None
- **Steps**:
  1. Send GET /api/users/reset-requests
  2. Verify response contains `data` array with request objects
  3. Each request has id, userId, status, requestedAt
- **Expected Result**: 200 OK with list of reset requests

### TC-02-P13: Get Pending Reset Request Count
- **Priority**: Low
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/users/reset-requests/pending
  2. Verify response `{ count: <integer> }`
- **Expected Result**: 200 OK with pending count

### TC-02-P14: Process Reset Request (Approve)
- **Priority**: High
- **Preconditions**: Pending reset request exists, verification token obtained
- **Test Data**: `{ "action": "approve", "newPassword": "Approved@123", "notes": "Approved by admin" }`
- **Steps**:
  1. Get pending reset request ID
  2. Obtain verification token
  3. Send POST /api/users/reset-requests/:id/process
  4. Verify response `{ success: true }`
- **Expected Result**: 200 OK, request approved, user can login with new password

### TC-02-P15: Search Users by Name
- **Priority**: Medium
- **Preconditions**: Multiple users exist
- **Test Data**: `?search=test`
- **Steps**:
  1. Send GET /api/users?search=test
  2. Verify returned users match the search term
- **Expected Result**: 200 OK with filtered user list

### TC-02-P16: Filter Users by Status
- **Priority**: Medium
- **Preconditions**: Users with different statuses exist
- **Test Data**: `?status=ENABLED`
- **Steps**:
  1. Send GET /api/users?status=ENABLED
  2. Verify all returned users have status ENABLED
- **Expected Result**: 200 OK with only ENABLED users

---

## Negative Test Cases

### TC-02-N01: Create User with Duplicate Username
- **Priority**: High
- **Preconditions**: User `admin` exists
- **Test Data**: `{ "username": "admin", "fullName": "Duplicate", "email": "dup@test.com", "role": "OPERATOR", "password": "DupTest@123", "confirmPassword": "DupTest@123" }`
- **Steps**:
  1. Attempt to create user with existing username
  2. Verify response is 409 Conflict
- **Expected Result**: 409 with duplicate username error

### TC-02-N02: Create User with Duplicate Email
- **Priority**: High
- **Preconditions**: User with email exists
- **Test Data**: `{ "username": "newuser", "fullName": "New User", "email": "<existing_email>", "role": "OPERATOR", "password": "Test@12345", "confirmPassword": "Test@12345" }`
- **Steps**:
  1. Attempt to create user with existing email
  2. Verify response is 409
- **Expected Result**: 409 with duplicate email error

### TC-02-N03: Create User with Weak Password
- **Priority**: High
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "username": "weakpwd", "fullName": "Weak", "email": "weak@test.com", "role": "OPERATOR", "password": "123", "confirmPassword": "123" }`
- **Steps**:
  1. Attempt to create user with password not meeting policy
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR with password policy details

### TC-02-N04: Create User as Non-Admin (OPERATOR)
- **Priority**: High
- **Preconditions**: Logged in as OPERATOR role user
- **Test Data**: Any valid create user payload
- **Steps**:
  1. Login as OPERATOR user
  2. Attempt POST /api/users
  3. Verify response is 403 Forbidden
- **Expected Result**: 403 Forbidden — insufficient permissions

### TC-02-N05: Update Non-Existent User
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `PUT /api/users/00000000-0000-0000-0000-000000000000`
- **Steps**:
  1. Attempt to update a non-existent user ID
  2. Verify response is 404
- **Expected Result**: 404 Not Found

### TC-02-N06: Delete Self (Own Account)
- **Priority**: High
- **Preconditions**: Know own user ID
- **Test Data**: DELETE /api/users/:ownId
- **Steps**:
  1. Get own user ID from GET /api/auth/me
  2. Attempt DELETE /api/users/:ownId
  3. Verify response blocks self-deletion
- **Expected Result**: 400 or 403 — cannot delete own account

### TC-02-N07: Missing Required Fields on Create
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "username": "incomplete" }` (missing fullName, email, role, password, confirmPassword)
- **Steps**:
  1. Attempt POST /api/users with missing required fields
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR with field-level errors

### TC-02-N08: Invalid Email Format
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "username": "bademail", "fullName": "Bad Email", "email": "not-an-email", "role": "OPERATOR", "password": "Test@12345", "confirmPassword": "Test@12345" }`
- **Steps**:
  1. Attempt to create user with invalid email format
  2. Verify response is 400
- **Expected Result**: 400 VALIDATION_ERROR

### TC-02-N09: Invalid Role Name
- **Priority**: Medium
- **Preconditions**: Verification token obtained
- **Test Data**: `{ "username": "badrole", "fullName": "Bad Role", "email": "badrole@test.com", "role": "NONEXISTENT_ROLE", "password": "Test@12345", "confirmPassword": "Test@12345" }`
- **Steps**:
  1. Attempt to create user with non-existent role
  2. Verify response is 400 or 404
- **Expected Result**: Error — role does not exist

### TC-02-N10: Bulk Delete with Own ID Included
- **Priority**: Medium
- **Preconditions**: Know own user ID, verification token obtained
- **Test Data**: `{ "userIds": ["<own_id>", "<other_id>"] }`
- **Steps**:
  1. Include own user ID in bulk delete array
  2. Verify operation is blocked or own ID is excluded
- **Expected Result**: Error or partial success excluding self
