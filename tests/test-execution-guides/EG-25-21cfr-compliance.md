# EG-25: 21 CFR Part 11 Compliance -- Execution Guide

## Overview

This execution guide validates DigiLog's compliance with the FDA's 21 CFR Part 11 regulation for electronic records and electronic signatures. Each test maps to a specific regulatory section and verifies that the system meets the requirements for closed systems, signature manifestations, signature/record linking, general requirements, electronic signature components, and controls for identification codes/passwords.

## Prerequisites

- **App URL**: http://34.232.224.0
- **API Base**: http://34.232.224.0/api (remote) or http://localhost:3000/api (from server)
- **SUPER_ADMIN Credentials**: superadmin / Admin@123
- **Additional Users**: Create or use users at various role levels (ADMIN, SUPERVISOR, OPERATOR, VIEWER)
- **Browser**: Chrome or Firefox with DevTools open (Network tab, Application tab for localStorage/sessionStorage)
- **Tools**: curl, jq, psql (for DB verification), a second browser or incognito window for session tests
- **Database**: `digilog_db` on PostgreSQL 18 (localhost:5432)
- **Incognito/Second Browser**: Required for session conflict, single-tab, and concurrent login tests

## Setup: Obtain Auth Tokens

```bash
# Store API base URL
API="http://34.232.224.0/api"

# Login as SUPER_ADMIN
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq -r '.token')
echo "SUPER_ADMIN Token: $TOKEN"

# Login as a non-SUPER_ADMIN user (e.g., ADMIN or OPERATOR) for audit-visible actions
ADMIN_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"operator1","password":"YourPassword123"}' | jq -r '.token')
echo "Non-SA Token: $ADMIN_TOKEN"
```

## Setup: Create Test Users (if needed)

```bash
# Create an OPERATOR-level test user for compliance testing
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "cfr_tester",
    "fullName": "CFR Test User",
    "email": "cfr_tester@test.com",
    "password": "Admin@123",
    "role": "OPERATOR",
    "_currentPassword": "Admin@123"
  }' | jq .

# Create a second test user for dual-session tests
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "cfr_tester2",
    "fullName": "CFR Test User 2",
    "email": "cfr_tester2@test.com",
    "password": "Admin@123",
    "role": "VIEWER",
    "_currentPassword": "Admin@123"
  }' | jq .
```

---

## Section 1: Test Execution -- Positive Tests

---

### Test: TC-25-P01 -- Audit Trail SHA-256 Checksum on Record Creation
**Regulation:** SS11.10(e) -- Use of secure, computer-generated, time-stamped audit trails

**How to Execute:**
1. Login as a non-SUPER_ADMIN user (e.g., OPERATOR) in the browser at http://34.232.224.0/login
2. Perform an auditable action (e.g., update own profile via /profile)
3. Login as SUPER_ADMIN and navigate to http://34.232.224.0/audit
4. Find the audit record for the action performed
5. Click on the record to see full details including the `integrityValid` field

**API Alternative (curl):**
```bash
# Step 1: Perform an action as non-SA user to generate audit record
curl -s -X PUT "$API/auth/profile" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"CFR Audit Test User"}' | jq .

# Step 2: Query audit trail to find the record
curl -s -X GET "$API/audit?limit=5&sortBy=timestamp&sortOrder=desc" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0]'
```

**DB Verification:**
```sql
SELECT id, action, checksum, "signatureMeaning", timestamp
FROM audit_trail
ORDER BY "createdAt" DESC LIMIT 5;
```

**Expected Result:**
- API: Status 200. Each audit record contains a `checksum` field (64-character hex SHA-256 hash)
- API: Each record contains `integrityValid: true` (checksum re-verification passes on read)
- DB: `checksum` column is populated with a 64-character hex string for every record

**Pass/Fail Criteria:**
- [ ] Audit record created for non-SUPER_ADMIN action
- [ ] `checksum` field is a 64-character hex string (SHA-256)
- [ ] `integrityValid` is `true` in API response
- [ ] Checksum is deterministic (same fields produce same hash)

---

### Test: TC-25-P02 -- Audit Trail Read-Time Integrity Verification
**Regulation:** SS11.10(e) -- Audit trail integrity verification

**How to Execute:**
1. Login as SUPER_ADMIN at http://34.232.224.0/login
2. Navigate to http://34.232.224.0/audit
3. Open any audit record detail view
4. Verify the integrity badge shows "Valid" or equivalent

**API Alternative (curl):**
```bash
# Get a specific audit record with full details including integrity check
# First, get the latest audit record ID
AUDIT_ID=$(curl -s -X GET "$API/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

# Fetch the detail view which includes checksum verification
curl -s -X GET "$API/audit/$AUDIT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, action, checksum, integrityValid}'
```

**Expected Result:**
- API: Status 200 with `integrityValid: true`
- The `checksum` field matches the recomputed SHA-256 hash of `{timestamp, userId, action, targetType, targetId, afterValue}`

**Pass/Fail Criteria:**
- [ ] Response status is 200
- [ ] `integrityValid` field is present and equals `true`
- [ ] `checksum` field is present (64-char hex)
- [ ] Detail view includes `previousChecksum` field (nullable, for future hash chaining)

---

### Test: TC-25-P03 -- Audit Trail Immutability (Database Trigger)
**Regulation:** SS11.10(e) -- Records shall not be obscured, modified, or deleted

**How to Execute:**
1. Connect to the database via psql
2. Attempt to update an audit trail record directly
3. Verify the `audit_trail_no_update` trigger prevents the modification
4. Attempt to delete an audit trail record directly
5. Verify the `audit_trail_no_delete` trigger prevents the deletion

**DB Verification:**
```sql
-- Verify triggers exist
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_table = 'audit_trail';

-- Attempt direct UPDATE (should fail)
UPDATE audit_trail SET action = 'TAMPERED' WHERE id = 1;
-- Expected: ERROR from audit_trail_no_update trigger

-- Attempt direct DELETE (should fail)
DELETE FROM audit_trail WHERE id = 1;
-- Expected: ERROR from audit_trail_no_delete trigger
```

**Expected Result:**
- DB: Two triggers exist: `audit_trail_no_update` and `audit_trail_no_delete`
- DB: Direct UPDATE raises an error
- DB: Direct DELETE raises an error
- Note: SUPER_ADMIN delete via API temporarily disables trigger in a transaction

**Pass/Fail Criteria:**
- [ ] `audit_trail_no_update` trigger exists and blocks UPDATE
- [ ] `audit_trail_no_delete` trigger exists and blocks DELETE
- [ ] Triggers are ENABLED during normal operation
- [ ] Only the API (with SUPER_ADMIN) can delete records via atomic trigger toggle

---

### Test: TC-25-P04 -- SUPER_ADMIN Audit Exemption
**Regulation:** SS11.10(e) -- System owner exemption (business requirement)

**How to Execute:**
1. Login as SUPER_ADMIN at http://34.232.224.0/login
2. Perform several actions (create user, change config, etc.)
3. Navigate to http://34.232.224.0/audit
4. Verify no records appear with `userRole: "SUPER_ADMIN"`

**API Alternative (curl):**
```bash
# Perform action as SUPER_ADMIN (should NOT create audit record)
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Search audit for SUPER_ADMIN entries (should find none)
curl -s -X GET "$API/audit?limit=100" \
  -H "Authorization: Bearer $TOKEN" | jq '[.data[] | select(.userRole == "SUPER_ADMIN")] | length'
```

**Expected Result:**
- API: The jq filter returns `0` -- no SUPER_ADMIN records in audit trail
- DB: No records exist with `user_role = 'SUPER_ADMIN'`

**DB Verification:**
```sql
SELECT COUNT(*) as super_admin_audit_count
FROM audit_trail
WHERE user_role = 'SUPER_ADMIN';
-- Expected: 0
```

**Pass/Fail Criteria:**
- [ ] No audit records with `userRole: "SUPER_ADMIN"` exist
- [ ] SUPER_ADMIN actions are silently excluded (no errors)
- [ ] Non-SUPER_ADMIN actions in the same timeframe ARE logged

---

### Test: TC-25-P05 -- RBAC with 6 Default Roles and 39+ Permissions
**Regulation:** SS11.10(d) -- Limiting system access to authorized individuals

**How to Execute:**
1. Login as SUPER_ADMIN at http://34.232.224.0/login
2. Navigate to http://34.232.224.0/config/role-privileges
3. Verify 6 default roles are listed with their hierarchy levels
4. Verify each role has distinct permission sets

**API Alternative (curl):**
```bash
# List all roles
curl -s -X GET "$API/roles" \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | {name, hierarchyLevel, permissionCount: (.permissions | length)}'

# Get all available permissions
curl -s -X GET "$API/roles/permissions/all" \
  -H "Authorization: Bearer $TOKEN" | jq '. | length'
```

**Expected Result:**
- API: 6 default roles returned: SUPER_ADMIN (level 6), ADMIN (level 5), SUPERVISOR (level 4), MAINTENANCE (level 3), OPERATOR (level 2), VIEWER (level 1)
- API: 39+ total permissions available
- Each role has appropriate permissions for its level

**Pass/Fail Criteria:**
- [ ] 6 default roles exist with correct hierarchy levels
- [ ] SUPER_ADMIN is level 6 (highest)
- [ ] VIEWER is level 1 (lowest)
- [ ] Total permissions count is 39 or greater
- [ ] Permissions are stored as JSON array in role record

---

### Test: TC-25-P06 -- requirePermission Authorization Enforcement
**Regulation:** SS11.10(d) -- Access limited to authorized individuals; SS11.10(g) -- Authority checks

**How to Execute:**
1. Login as a VIEWER user (lowest permissions)
2. Attempt to access entity template management (requires ASSET_TEMPLATE_MANAGE)
3. Verify access is denied with 403 response

**API Alternative (curl):**
```bash
# Login as VIEWER
VIEWER_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester2","password":"Admin@123","force":true}' | jq -r '.token')

# Attempt to create an entity template (requires ASSET_TEMPLATE_MANAGE)
curl -s -X POST "$API/assets/templates" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Unauthorized Template","type":"TEST"}' | jq .
```

**Expected Result:**
- API: Status 403 with `{"error":"FORBIDDEN","message":"Permission denied","requiredPermission":"ASSET_TEMPLATE_MANAGE","yourRole":"VIEWER"}`

**Pass/Fail Criteria:**
- [ ] Response status is 403
- [ ] Error message indicates FORBIDDEN
- [ ] `requiredPermission` field names the missing permission
- [ ] `yourRole` field shows the user's actual role

---

### Test: TC-25-P07 -- Single Active Session Enforcement
**Regulation:** SS11.10(d) -- System access controls; SS11.200(a) -- Unique identification

**How to Execute:**
1. Login as `cfr_tester` in Browser 1 at http://34.232.224.0/login
2. Open a second browser (or incognito) and attempt to login as `cfr_tester` again
3. Observe the session conflict dialog
4. If forced login, verify the first session is terminated

**API Alternative (curl):**
```bash
# Login session 1
SESSION1=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123"}' | jq -r '.token')

# Attempt login session 2 (should get SESSION_CONFLICT)
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123"}' | jq .

# Force login session 2 (terminates session 1)
SESSION2=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123","force":true}' | jq -r '.token')

# Verify session 1 is now invalid
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $SESSION1" | jq .
```

**DB Verification:**
```sql
SELECT id, user_id, is_active, termination_reason, created_at
FROM sessions
WHERE user_id = (SELECT id FROM users WHERE username = 'cfr_tester')
ORDER BY created_at DESC LIMIT 3;
```

**Expected Result:**
- API: Second login without `force:true` returns `SESSION_CONFLICT` error with `activeSession` details
- API: Second login with `force:true` succeeds, first session becomes invalid
- API: Using session 1 token after force login returns `SESSION_INVALID`
- DB: First session shows `is_active: false`, `termination_reason: 'new_login'`

**Pass/Fail Criteria:**
- [ ] Second login without force returns SESSION_CONFLICT
- [ ] Second login with force succeeds and returns new token
- [ ] First session token returns 401 after force login
- [ ] DB shows terminated session with reason

---

### Test: TC-25-P08 -- 24-Hour Absolute Session Timeout
**Regulation:** SS11.10(d) -- Automatic session termination

**How to Execute:**
1. Login and note the session creation time
2. Verify the `absoluteExpiresAt` is set (implicit 24h from creation)
3. Note: This test requires either waiting 24 hours or manipulating DB timestamps

**API Alternative (curl):**
```bash
# Login and check session
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123","force":true}' | jq .
```

**DB Verification:**
```sql
-- Check session timestamps
SELECT id, user_id, is_active,
       created_at,
       expires_at,
       last_active_at,
       (created_at + interval '24 hours') as absolute_timeout,
       termination_reason
FROM sessions
WHERE is_active = true
ORDER BY created_at DESC LIMIT 5;

-- Simulate: Set session creation to 25 hours ago to trigger absolute timeout
-- WARNING: Only do this in test environments
UPDATE sessions
SET created_at = NOW() - interval '25 hours'
WHERE user_id = (SELECT id FROM users WHERE username = 'cfr_tester')
AND is_active = true;

-- Then verify next API call returns 401 SESSION_EXPIRED
```

**Expected Result:**
- DB: Active sessions have `created_at` timestamp
- Auth plugin enforces: `Date.now() - session.createdAt > 24 * 60 * 60 * 1000` triggers session termination
- Session terminated with reason `absolute_timeout`

**Pass/Fail Criteria:**
- [ ] Sessions have `created_at` timestamp recorded
- [ ] Auth plugin calculates 24h absolute timeout from creation
- [ ] Expired sessions return 401 with `SESSION_EXPIRED` error
- [ ] Termination reason is set to `absolute_timeout`

---

### Test: TC-25-P09 -- Session Sliding Window Extension
**Regulation:** SS11.10(d) -- Configurable session management

**How to Execute:**
1. Login as any user
2. Make an API call and note the session `expiresAt` before and after
3. Verify the session expiry extends on each authenticated request

**API Alternative (curl):**
```bash
# Login
TOKEN_SLIDE=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123","force":true}' | jq -r '.token')

# Check current session state
psql -d digilog_db -c "SELECT expires_at, last_active_at FROM sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1;"

# Make another request (this should extend expiresAt)
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN_SLIDE" | jq .

# Check session state again -- expiresAt should have moved forward
psql -d digilog_db -c "SELECT expires_at, last_active_at FROM sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1;"
```

**DB Verification:**
```sql
-- Check session config for duration
SELECT config_value->>'sessionDurationHours' as session_hours
FROM system_config
WHERE config_key = 'session';

-- Verify session sliding window
SELECT id, last_active_at, expires_at,
       expires_at - last_active_at as remaining_time
FROM sessions
WHERE is_active = true
ORDER BY last_active_at DESC LIMIT 3;
```

**Expected Result:**
- DB: `expires_at` moves forward by `sessionDurationHours` on each request
- DB: `last_active_at` is updated to current time on each request
- The session duration is configurable (default: 8 hours)

**Pass/Fail Criteria:**
- [ ] `last_active_at` updates on each authenticated request
- [ ] `expires_at` extends based on session duration config
- [ ] Session duration is configurable via system config
- [ ] Sliding window does not extend beyond absolute 24h timeout

---

### Test: TC-25-P10 -- Password Policy Configuration
**Regulation:** SS11.300(b) -- Ensure password uniqueness, aging, recall

**How to Execute:**
1. Login as SUPER_ADMIN at http://34.232.224.0/login
2. Navigate to http://34.232.224.0/config/password-policy
3. Verify all password policy fields are configurable
4. Note the current settings

**API Alternative (curl):**
```bash
# Get current password policy
curl -s -X GET "$API/config/password-policy" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- API: Status 200 with password policy configuration including:
```json
{
  "minLength": 8,
  "requireUppercase": true,
  "requireLowercase": true,
  "requireNumbers": true,
  "requireSpecialChars": true,
  "maxAgeDays": 90,
  "historyCount": 5,
  "minUppercase": 1,
  "minLowercase": 1,
  "minNumbers": 1,
  "minSpecialChars": 1
}
```

**Pass/Fail Criteria:**
- [ ] Password policy is configurable (not hardcoded)
- [ ] Minimum length enforcement is present
- [ ] Character complexity requirements are present (upper, lower, number, special)
- [ ] Password age/expiry configuration is present (`maxAgeDays`)
- [ ] Password history depth is configurable (`historyCount`)

---

### Test: TC-25-P11 -- Password History Enforcement
**Regulation:** SS11.300(b) -- Ensure password uniqueness

**How to Execute:**
1. Login as `cfr_tester` and change password to `NewPass@123`
2. Change password again to `NewPass@456`
3. Attempt to change password back to `NewPass@123`
4. Verify the system rejects the previously used password

**API Alternative (curl):**
```bash
# Login as cfr_tester
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Admin@123","force":true}' | jq -r '.token')

# Change password to NewPass@123
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Admin@123","newPassword":"NewPass@123","confirmPassword":"NewPass@123"}' | jq .

# Login again with new password
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"NewPass@123","force":true}' | jq -r '.token')

# Change password to NewPass@456
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"NewPass@123","newPassword":"NewPass@456","confirmPassword":"NewPass@456"}' | jq .

# Login again
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"NewPass@456","force":true}' | jq -r '.token')

# Attempt to reuse NewPass@123 (should fail)
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"NewPass@456","newPassword":"NewPass@123","confirmPassword":"NewPass@123"}' | jq .
```

**DB Verification:**
```sql
SELECT ph.user_id, ph.created_at, LEFT(ph.password_hash, 20) as hash_prefix
FROM password_history ph
JOIN users u ON ph.user_id = u.id
WHERE u.username = 'cfr_tester'
ORDER BY ph.created_at DESC
LIMIT 10;
```

**Expected Result:**
- API: Reusing a previous password returns 400 with error indicating password was recently used
- DB: `password_history` table contains hashed entries for each previous password

**Pass/Fail Criteria:**
- [ ] Password history entries are created on each password change
- [ ] System rejects passwords found in history (up to `historyCount`)
- [ ] Password hashes are stored (not plaintext)
- [ ] History depth matches configured `historyCount` value

---

### Test: TC-25-P12 -- Password Expiry Enforcement
**Regulation:** SS11.300(b) -- Password aging

**How to Execute:**
1. Check the current password policy for `maxAgeDays`
2. Verify that users have `passwordExpiresAt` set
3. Verify the auth plugin checks password expiry and forces change

**DB Verification:**
```sql
-- Check user password expiry timestamps
SELECT username, password_changed_at, password_expires_at,
       force_password_change,
       CASE
         WHEN password_expires_at < NOW() THEN 'EXPIRED'
         ELSE 'VALID'
       END as password_status
FROM users
ORDER BY username;

-- Check password policy config
SELECT config_value->>'maxAgeDays' as max_age_days
FROM system_config
WHERE config_key = 'password-policy';
```

**API Alternative (curl):**
```bash
# Check user profile for forcePasswordChange status
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TOKEN" | jq '{forcePasswordChange, isTemporaryPassword}'
```

**Expected Result:**
- DB: `password_expires_at` is set to `password_changed_at + maxAgeDays`
- Auth plugin: When `password_expires_at < now()`, sets `forcePasswordChange: true`
- User is blocked from all API calls except `/auth/change-password`, `/auth/logout`, `/auth/me`, `/config/password-policy`

**Pass/Fail Criteria:**
- [ ] `password_expires_at` is calculated from `password_changed_at + maxAgeDays`
- [ ] Expired passwords trigger `forcePasswordChange` flag
- [ ] Expired users can only access password change and logout endpoints
- [ ] API returns 403 with `PASSWORD_EXPIRED` for other endpoints

---

### Test: TC-25-P13 -- Account Lockout After Failed Attempts
**Regulation:** SS11.300(b) -- Controls for identification codes; SS11.10(d) -- Access controls

**How to Execute:**
1. Attempt to login with `cfr_tester` using wrong password 5+ times
2. Verify the account gets locked after exceeding the threshold
3. Check the lockout status in the database

**API Alternative (curl):**
```bash
# Get login security config for maxFailedAttempts
curl -s -X GET "$API/config/login-security" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Attempt failed logins (repeat until locked)
for i in $(seq 1 6); do
  echo "Attempt $i:"
  curl -s -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"cfr_tester","password":"WrongPassword!"}' | jq '{error, message, attemptsRemaining}'
  echo ""
done
```

**DB Verification:**
```sql
SELECT username, failed_login_attempts, status,
       locked_at, lockout_until
FROM users
WHERE username = 'cfr_tester';
```

**Expected Result:**
- API: Each failed attempt returns `attemptsRemaining` count
- API: After max attempts, returns `ACCOUNT_LOCKED` error
- DB: `failed_login_attempts` increments, `status` changes to `LOCKED`, `locked_at` is set

**Pass/Fail Criteria:**
- [ ] Failed attempts counter increments on each wrong password
- [ ] `attemptsRemaining` is returned in error response
- [ ] Account locks after exceeding `maxFailedAttempts`
- [ ] Locked account cannot login even with correct password
- [ ] Lock status is reflected in DB (`status = 'LOCKED'`)

---

### Test: TC-25-P14 -- Account Unlock by Administrator
**Regulation:** SS11.300(b) -- Authorized management of ID codes/passwords

**How to Execute:**
1. With `cfr_tester` locked from TC-25-P13
2. Login as SUPER_ADMIN
3. Navigate to http://34.232.224.0/users and find `cfr_tester`
4. Click Unlock button
5. Verify the user can login again

**API Alternative (curl):**
```bash
# Get user ID for cfr_tester
USER_ID=$(curl -s -X GET "$API/users" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.username=="cfr_tester") | .id')

# Unlock the user
curl -s -X POST "$API/users/$USER_ID/unlock" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_currentPassword":"Admin@123"}' | jq .

# Verify user can login again
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"NewPass@456","force":true}' | jq '{success, token}'
```

**DB Verification:**
```sql
SELECT username, failed_login_attempts, status, locked_at
FROM users
WHERE username = 'cfr_tester';
-- Expected: failed_login_attempts = 0, status = 'ENABLED', locked_at = NULL
```

**Pass/Fail Criteria:**
- [ ] ADMIN/SUPER_ADMIN can unlock a locked account
- [ ] `failed_login_attempts` resets to 0
- [ ] `status` returns to `ENABLED`
- [ ] User can login successfully after unlock

---

### Test: TC-25-P15 -- Rate Limiting on Login Endpoint
**Regulation:** SS11.10(d) -- System access controls (brute force prevention)

**How to Execute:**
1. Send 10+ rapid login requests within 1 minute
2. Verify rate limiting kicks in after 10 requests

**API Alternative (curl):**
```bash
# Send 12 rapid requests (limit is 10/minute)
for i in $(seq 1 12); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"superadmin","password":"wrong"}')
  echo "Request $i: HTTP $STATUS"
done
```

**Expected Result:**
- Requests 1-10: Normal responses (401 for wrong password)
- Requests 11+: HTTP 429 Too Many Requests

**Pass/Fail Criteria:**
- [ ] First 10 requests return normal error responses (400/401)
- [ ] Requests beyond 10 per minute return HTTP 429
- [ ] Rate limit window resets after 1 minute
- [ ] Rate limiting is per-IP (`keyGenerator: req.ip`)

---

### Test: TC-25-P16 -- Rate Limiting on Forgot Password Endpoint
**Regulation:** SS11.10(d) -- Access controls (abuse prevention)

**API Alternative (curl):**
```bash
# Send 6 rapid forgot-password requests (limit is 5/5min)
for i in $(seq 1 6); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/forgot-password" \
    -H "Content-Type: application/json" \
    -d '{"username":"cfr_tester"}')
  echo "Request $i: HTTP $STATUS"
done
```

**Expected Result:**
- Requests 1-5: HTTP 200 (always returns success to prevent enumeration)
- Request 6+: HTTP 429 Too Many Requests

**Pass/Fail Criteria:**
- [ ] First 5 requests return HTTP 200
- [ ] Requests beyond 5 per 5 minutes return HTTP 429
- [ ] Response does not leak user existence information

---

### Test: TC-25-P17 -- Electronic Signature Manifestations
**Regulation:** SS11.50(a)(b)(c) -- Signature includes printed name, date/time, and meaning

**How to Execute:**
1. Trigger an action that creates an electronic signature (e.g., alarm acknowledgment or checklist review)
2. Verify the signature contains all required SS11.50 fields

**DB Verification:**
```sql
SELECT id, record_type, record_id,
       signer_full_name,     -- SS11.50(a): printed name
       signer_role,
       signed_at,            -- SS11.50(b): date and time
       meaning,              -- SS11.50(c): meaning (e.g., "Performed By", "Checked By")
       record_hash,          -- SS11.70: record integrity
       signature_hash,       -- SS11.70: signature integrity
       re_auth_verified,
       re_auth_method,
       ip_address,
       user_agent
FROM electronic_signatures
ORDER BY signed_at DESC LIMIT 5;
```

**Expected Result:**
- DB: Each electronic signature record contains:
  - `signer_full_name` -- the printed name of the signer (SS11.50(a))
  - `signer_role` -- the role of the signer
  - `signed_at` -- timestamp of signing (SS11.50(b))
  - `meaning` -- the meaning of the signature, e.g., "Performed By", "Checked By", "Verified By" (SS11.50(c))
  - `record_hash` -- SHA-256 hash of the record being signed (SS11.70)
  - `signature_hash` -- SHA-256 hash linking signature to record (SS11.70)
  - `re_auth_verified: true` -- re-authentication was performed
  - `re_auth_method: 'password'` -- method of re-authentication

**Pass/Fail Criteria:**
- [ ] `signer_full_name` is populated (SS11.50(a))
- [ ] `signed_at` is a valid timestamp (SS11.50(b))
- [ ] `meaning` describes the purpose of the signature (SS11.50(c))
- [ ] `record_hash` is a 64-char SHA-256 hex (SS11.70)
- [ ] `signature_hash` is a 64-char SHA-256 hex (SS11.70)
- [ ] `re_auth_verified` is `true`

---

### Test: TC-25-P18 -- Signature/Record Linking via Hash
**Regulation:** SS11.70 -- Signatures shall be linked to respective electronic records

**How to Execute:**
1. Retrieve an electronic signature from the database
2. Verify that `record_hash` is the SHA-256 hash of the associated record
3. Verify that `signature_hash` links the signature to the record

**DB Verification:**
```sql
-- Verify signature-to-record linkage
SELECT es.id as signature_id,
       es.record_type,
       es.record_id,
       es.record_hash,
       es.signature_hash,
       es.signer_user_id,
       es.signed_at
FROM electronic_signatures es
ORDER BY es.signed_at DESC LIMIT 5;

-- For checklist signatures, verify the linked record exists
SELECT es.id, es.record_id, cr.id as checklist_id, cr.entity_id
FROM electronic_signatures es
LEFT JOIN checklist_reviews cr ON es.record_id = cr.id::text
WHERE es.record_type = 'checklist'
ORDER BY es.signed_at DESC LIMIT 5;

-- For alarm signatures, verify the linked record exists
SELECT es.id, es.record_id
FROM electronic_signatures es
WHERE es.record_type = 'alarm'
ORDER BY es.signed_at DESC LIMIT 5;
```

**Expected Result:**
- DB: `record_hash` = SHA-256(record content at time of signing)
- DB: `signature_hash` = SHA-256(record_hash + signer_user_id + signed_at)
- DB: `record_id` points to a valid record in the corresponding table
- These hashes ensure signatures cannot be copied from one record to another

**Pass/Fail Criteria:**
- [ ] `record_hash` is unique per record content
- [ ] `signature_hash` incorporates record_hash + signer + timestamp
- [ ] `record_id` references an existing record
- [ ] Changing the record would invalidate the `record_hash`

---

### Test: TC-25-P19 -- Audit Trail Hash Chain (previousChecksum)
**Regulation:** SS11.70 -- Record linking; SS11.10(e) -- Audit trail integrity

**How to Execute:**
1. Query consecutive audit records
2. Verify the `previousChecksum` field exists for hash chaining support

**DB Verification:**
```sql
-- Check consecutive audit records for hash chain fields
SELECT id, checksum,
       LAG(checksum) OVER (ORDER BY id) as previous_record_checksum,
       action, timestamp
FROM audit_trail
ORDER BY id DESC LIMIT 10;
```

**API Alternative (curl):**
```bash
# Fetch audit detail to see previousChecksum field
AUDIT_ID=$(curl -s -X GET "$API/audit?limit=1" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')

curl -s -X GET "$API/audit/$AUDIT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, checksum, previousChecksum, integrityValid}'
```

**Expected Result:**
- API: Detail response includes `previousChecksum` field (may be null in current implementation)
- DB: Each record has its own SHA-256 `checksum` for individual tamper detection
- Note: Full hash chaining (where each record's hash includes the previous) is documented as a future enhancement (see DECISIONS.md #4). Current implementation uses individual checksums per record.

**Pass/Fail Criteria:**
- [ ] `previousChecksum` field exists in the API response schema
- [ ] Individual `checksum` provides tamper evidence per record
- [ ] `integrityValid` correctly verifies each record's checksum
- [ ] Schema supports future hash chain implementation

---

### Test: TC-25-P20 -- Re-authentication for Sensitive Operations
**Regulation:** SS11.100(a) -- Ensure authenticity and integrity of records; SS11.10(g) -- Authority checks

**How to Execute:**
1. Login as ADMIN user at http://34.232.224.0/login
2. Navigate to http://34.232.224.0/users
3. Attempt to create a new user
4. Verify the re-authentication dialog appears (password prompt)
5. Enter password and confirm the operation

**API Alternative (curl):**
```bash
# Get list of actions requiring reauth
curl -s -X GET "$API/config/action-reauth" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Get actions requiring reauth for current user's role
curl -s -X GET "$API/config/action-reauth/my-actions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .

# Attempt user creation WITHOUT reauth password (should get REAUTH_REQUIRED)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"reauth_test","fullName":"Reauth Test","email":"reauth@test.com","password":"Admin@123","role":"VIEWER"}' | jq .

# Attempt user creation WITH reauth password (should succeed)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"reauth_test","fullName":"Reauth Test","email":"reauth@test.com","password":"Admin@123","role":"VIEWER","_currentPassword":"AdminPassword123"}' | jq .
```

**Expected Result:**
- API (no password): Status 401 with `{"error":"REAUTH_REQUIRED","message":"This action requires password re-authentication.","action":"CREATE_USER"}`
- API (with password): Status 200/201 with successful creation
- Config: 42+ reauth actions are configurable across 13 categories

**Pass/Fail Criteria:**
- [ ] Sensitive action without `_currentPassword` returns 401 REAUTH_REQUIRED
- [ ] Sensitive action with correct password succeeds
- [ ] Sensitive action with wrong password returns 401 REAUTH_FAILED
- [ ] 42+ reauth actions are configured
- [ ] Reauth config is per-action, per-role

---

### Test: TC-25-P21 -- Two-Component Authentication (Username + Password)
**Regulation:** SS11.200(a) -- Electronic signatures employ at least two distinct identification components

**How to Execute:**
1. Navigate to http://34.232.224.0/login
2. Verify the login form requires both username AND password
3. Attempt to login with only username (no password)
4. Attempt to login with only password (no username)

**API Alternative (curl):**
```bash
# Attempt login with only username (missing password)
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin"}' | jq .

# Attempt login with only password (missing username)
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"password":"Admin@123"}' | jq .

# Successful login requires BOTH components
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}' | jq '{success}'
```

**Expected Result:**
- API (username only): Status 400 with validation error (password required)
- API (password only): Status 400 with validation error (username required)
- API (both): Status 200 with successful login

**Pass/Fail Criteria:**
- [ ] Login requires both username AND password (two components)
- [ ] Missing username returns validation error
- [ ] Missing password returns validation error
- [ ] Both components together produce successful authentication

---

### Test: TC-25-P22 -- JWT + DB Session Binding
**Regulation:** SS11.200(a) -- Electronic signatures tied to individual; SS11.10(d) -- Immediate session invalidation

**How to Execute:**
1. Login and obtain JWT token
2. Verify the JWT is bound to a database session record
3. Deactivate the session in DB and verify the JWT is rejected

**API Alternative (curl):**
```bash
# Login and get token
TEST_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"NewPass@456","force":true}' | jq -r '.token')

# Verify token works
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '{id, username, role}'
```

**DB Verification:**
```sql
-- Verify session exists and is active
SELECT id, user_id, is_active, ip_address, created_at, expires_at
FROM sessions
WHERE is_active = true
AND user_id = (SELECT id FROM users WHERE username = 'cfr_tester')
ORDER BY created_at DESC LIMIT 1;

-- Deactivate session to test JWT rejection
UPDATE sessions
SET is_active = false, termination_reason = 'admin_terminated'
WHERE is_active = true
AND user_id = (SELECT id FROM users WHERE username = 'cfr_tester');
```

After deactivating the session:
```bash
# Verify the JWT is now rejected (session invalid)
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $TEST_TOKEN" | jq .
```

**Expected Result:**
- Before deactivation: Token works, returns user profile
- After deactivation: Returns `{"error":"SESSION_INVALID","message":"Session terminated"}`
- JWT alone is not sufficient -- requires active DB session

**Pass/Fail Criteria:**
- [ ] JWT token is bound to a DB session record
- [ ] Deactivating the session invalidates the JWT immediately
- [ ] Response error is `SESSION_INVALID` (not token expiry)
- [ ] Each login creates a new session record in DB

---

### Test: TC-25-P23 -- Terminate Other Sessions on Password Change
**Regulation:** SS11.200(a) -- Ensuring signature is bound to individual

**How to Execute:**
1. Login as `cfr_tester` in two sessions (browser + curl)
2. Change password in one session
3. Verify all other sessions are terminated

**API Alternative (curl):**
```bash
# Create session 1
S1=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"NewPass@456","force":true}' | jq -r '.token')

# Change password in session 1
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $S1" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"NewPass@456","newPassword":"Changed@789","confirmPassword":"Changed@789"}' | jq .
```

**DB Verification:**
```sql
-- Check all sessions for cfr_tester after password change
SELECT id, is_active, termination_reason, created_at
FROM sessions
WHERE user_id = (SELECT id FROM users WHERE username = 'cfr_tester')
ORDER BY created_at DESC;
-- Expected: Only the current session is active, others show termination_reason = 'password_changed'
```

**Expected Result:**
- DB: All sessions except the one that changed the password are terminated
- DB: Terminated sessions have `termination_reason: 'password_changed'`
- Other active tokens for this user will return 401 on next request

**Pass/Fail Criteria:**
- [ ] Password change terminates all other active sessions
- [ ] Current session remains active
- [ ] Terminated sessions have reason `password_changed`
- [ ] Other tokens become invalid immediately

---

### Test: TC-25-P24 -- Single-Tab Enforcement (Browser)
**Regulation:** SS11.200(a) -- Preventing concurrent use of same identity

**How to Execute:**
1. Login as `cfr_tester` in Browser Tab 1
2. Open a new tab in the SAME browser and navigate to http://34.232.224.0
3. Observe the duplicate tab detection warning
4. Verify the system uses localStorage heartbeat mechanism

**Browser Steps:**
1. Open http://34.232.224.0/login in Tab 1, login as `cfr_tester`
2. Open a new tab (Tab 2) in the same browser, navigate to http://34.232.224.0
3. Observe: Tab 2 should show a "duplicate tab" warning
4. In DevTools Application > Local Storage, verify keys:
   - `digilog_active_tab_id` -- the active tab's unique ID
   - `digilog_tab_heartbeat` -- timestamp of last heartbeat
   - `digilog_active_user_id` -- JSON with userId, username, tabId

**Expected Result:**
- Tab 2 displays a duplicate tab warning
- localStorage contains heartbeat data with 1-second intervals
- Heartbeat timeout is 3 seconds (dead tab detection)
- User can "claim" the active tab to take over

**Pass/Fail Criteria:**
- [ ] Second tab detects existing active tab via localStorage heartbeat
- [ ] Duplicate tab warning is displayed
- [ ] Heartbeat updates every 1 second
- [ ] Dead tabs (>3 seconds without heartbeat) are automatically replaced
- [ ] "Claim active tab" button takes over from the other tab

---

### Test: TC-25-P25 -- Unique User IDs
**Regulation:** SS11.300(a) -- Each user has a unique combination of identification code and password

**How to Execute:**
1. Verify user IDs are unique at the database level
2. Attempt to create a user with a duplicate username

**API Alternative (curl):**
```bash
# Get user ID config
curl -s -X GET "$API/config/user-id" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Validate a user ID
curl -s -X POST "$API/config/user-id/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin"}' | jq .

# Attempt to create user with existing username (should fail)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","fullName":"Duplicate Admin","email":"dup@test.com","password":"Admin@123","role":"VIEWER","_currentPassword":"Admin@123"}' | jq .
```

**DB Verification:**
```sql
-- Verify username uniqueness constraint
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'users' AND constraint_type = 'UNIQUE';

-- Check for unique index on username
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'users' AND indexdef LIKE '%username%';
```

**Expected Result:**
- API: Duplicate username returns 400/409 error
- DB: UNIQUE constraint exists on `username` column
- User ID format is configurable via `/api/config/user-id`

**Pass/Fail Criteria:**
- [ ] Database enforces UNIQUE constraint on username
- [ ] API rejects duplicate usernames with appropriate error
- [ ] User ID format is configurable (prefix, format, auto-generation)
- [ ] Each user has a globally unique UUID (id field)

---

### Test: TC-25-P26 -- Force Password Change on First Login
**Regulation:** SS11.300(b) -- Initial password management

**How to Execute:**
1. Create a new user as SUPER_ADMIN
2. Login as the new user
3. Verify the system forces a password change before allowing other actions

**API Alternative (curl):**
```bash
# Create a new user (will have forcePasswordChange: true, isTemporaryPassword: true)
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"firstlogin_test","fullName":"First Login Test","email":"firstlogin@test.com","password":"Temp@12345","role":"OPERATOR","_currentPassword":"Admin@123"}' | jq .

# Login as new user
FIRST_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"firstlogin_test","password":"Temp@12345"}' | jq -r '.token')

# Check user state
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"firstlogin_test","password":"Temp@12345"}' | jq '.user | {forcePasswordChange, isTemporaryPassword}'

# Attempt to access any other endpoint (should get FORCE_PASSWORD_CHANGE)
curl -s -X GET "$API/users" \
  -H "Authorization: Bearer $FIRST_TOKEN" | jq .
```

**Expected Result:**
- Login response shows `forcePasswordChange: true`, `isTemporaryPassword: true`
- Accessing non-password-change endpoints returns 403 `FORCE_PASSWORD_CHANGE`
- Only `/auth/change-password`, `/auth/logout`, `/auth/me`, and `/config/password-policy` are accessible

**Pass/Fail Criteria:**
- [ ] New users have `forcePasswordChange: true`
- [ ] New users have `isTemporaryPassword: true`
- [ ] Non-allowed endpoints return 403 FORCE_PASSWORD_CHANGE
- [ ] Password change clears the force flag
- [ ] After password change, all endpoints become accessible

---

### Test: TC-25-P27 -- Backup Integrity with SHA-256 Checksum
**Regulation:** SS11.10(e) -- Backup integrity verification

**How to Execute:**
1. Login as ADMIN or SUPER_ADMIN
2. Export a database backup
3. Validate the backup file checksum

**API Alternative (curl):**
```bash
# Export backup as JSON (includes checksum in metadata)
curl -s -X GET "$API/backup/export?format=json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Reauth-Password: Admin@123" \
  -o /tmp/digilog_backup.json

# Check backup metadata (first few lines)
head -c 500 /tmp/digilog_backup.json | jq '.metadata'

# Validate backup without restoring
curl -s -X POST "$API/backup/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/digilog_backup.json" | jq .
```

**Expected Result:**
- Backup file contains `metadata.checksum` (SHA-256 of backup data)
- Backup file contains `metadata.version`, `metadata.timestamp`, `metadata.generatedBy`
- Validation endpoint confirms `checksumValid: true`

**Pass/Fail Criteria:**
- [ ] Backup metadata includes SHA-256 checksum
- [ ] Backup validation confirms checksum integrity
- [ ] Tampered backup file fails validation with `CHECKSUM_MISMATCH`
- [ ] Restore endpoint verifies checksum before proceeding

---

### Test: TC-25-P28 -- Audit Trail Timestamps (Computer-Generated)
**Regulation:** SS11.10(e) -- Computer-generated, time-stamped audit trails

**How to Execute:**
1. Perform an auditable action
2. Verify the timestamp is server-generated (not client-provided)

**DB Verification:**
```sql
-- Verify timestamps are server-generated (default: now())
SELECT id, action, timestamp,
       created_at,
       timestamp = created_at as timestamps_match
FROM audit_trail
ORDER BY id DESC LIMIT 5;

-- Verify timezone-aware timestamps (Timestamptz)
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'audit_trail' AND column_name = 'timestamp';
```

**Expected Result:**
- DB: `timestamp` column has `DEFAULT now()` -- server-generated
- DB: Column type is `timestamp with time zone` (Timestamptz)
- Timestamps cannot be set by the client (no API field for custom timestamp)

**Pass/Fail Criteria:**
- [ ] Timestamps are server-generated (not client-supplied)
- [ ] Timestamps use timezone-aware format (Timestamptz)
- [ ] No API parameter allows overriding audit timestamps
- [ ] Timestamps are consistent with server clock

---

### Test: TC-25-P29 -- Audit Trail Before/After Values
**Regulation:** SS11.10(e) -- Record of who, what, when, and why

**How to Execute:**
1. Perform a modification action (e.g., update user profile)
2. Check the audit record for before/after value capture

**API Alternative (curl):**
```bash
# Perform an update action as non-SA user
curl -s -X PUT "$API/auth/profile" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"department":"Quality Control"}' | jq .

# Find the audit record
curl -s -X GET "$API/audit?action=PROFILE_UPDATED&limit=1&sortBy=timestamp&sortOrder=desc" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[0] | {action, userId, beforeValue, afterValue, ipAddress, timestamp}'
```

**Expected Result:**
- `beforeValue`: Contains the state before the change (or null for create operations)
- `afterValue`: Contains the state after the change
- `userId`: Who made the change
- `ipAddress`: From where
- `timestamp`: When the change occurred
- `signatureMeaning`: Why (for signed actions)

**Pass/Fail Criteria:**
- [ ] `beforeValue` captures pre-change state for update operations
- [ ] `afterValue` captures post-change state
- [ ] `userId` identifies who performed the action
- [ ] `ipAddress` captures the client IP
- [ ] `timestamp` is present and accurate

---

### Test: TC-25-P30 -- Configurable Reauth Actions (42+ Actions)
**Regulation:** SS11.100(a) -- General requirements for electronic signatures

**API Alternative (curl):**
```bash
# Get full reauth configuration
curl -s -X GET "$API/config/action-reauth" \
  -H "Authorization: Bearer $TOKEN" | jq 'to_entries | length'

# Get available reauth actions with categories
curl -s -X GET "$API/config/action-reauth" \
  -H "Authorization: Bearer $TOKEN" | jq 'keys'

# Check which actions are configured for the current user's role
curl -s -X GET "$API/config/action-reauth/my-actions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

**Expected Result:**
- API: 42+ reauth actions configured across 13 categories
- Categories include: User Management, System Configuration, Entity Management, Audit, Backup, Rule Chains, UNS, Alarms, Help, Debug, etc.
- Each action maps to an array of role names that require reauth

**Pass/Fail Criteria:**
- [ ] 42 or more reauth actions are configured
- [ ] Actions span 13+ categories
- [ ] Each action is configurable per role
- [ ] `/my-actions` returns only actions relevant to current user's role

---

## Section 2: Test Execution -- Negative Tests

---

### Test: TC-25-N01 -- Unauthorized Access Without Token
**Regulation:** SS11.10(d) -- Limiting system access to authorized individuals

**API Alternative (curl):**
```bash
# Attempt to access protected endpoint without token
curl -s -X GET "$API/auth/me" | jq .

# Attempt to access audit trail without token
curl -s -X GET "$API/audit" | jq .

# Attempt to access user list without token
curl -s -X GET "$API/users" | jq .
```

**Expected Result:**
- All responses: Status 401 with `{"error":"UNAUTHORIZED","message":"Missing token"}`

**Pass/Fail Criteria:**
- [ ] All protected endpoints return 401 without Authorization header
- [ ] Error message is `Missing token`
- [ ] No data is leaked in the error response

---

### Test: TC-25-N02 -- Access with Expired/Invalid Token
**Regulation:** SS11.10(d) -- Access controls

**API Alternative (curl):**
```bash
# Use a garbage token
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer invalid.token.here" | jq .

# Use an old/expired token (if available from previous tests)
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJpYXQiOjE2MDAwMDAwMDB9.fake" | jq .
```

**Expected Result:**
- Status 401 with `{"error":"TOKEN_EXPIRED","message":"Invalid or expired token"}`

**Pass/Fail Criteria:**
- [ ] Invalid tokens return 401
- [ ] Expired tokens return 401
- [ ] Malformed tokens return 401
- [ ] No sensitive information leaked

---

### Test: TC-25-N03 -- Login with Wrong Password
**Regulation:** SS11.300(b) -- Password validation

**API Alternative (curl):**
```bash
# Attempt login with correct username, wrong password
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"WrongPassword!"}' | jq .
```

**Expected Result:**
- Status 401 with error indicating invalid credentials
- Response includes `attemptsRemaining` field
- Does NOT reveal whether username exists

**Pass/Fail Criteria:**
- [ ] Wrong password returns 401 (not 200)
- [ ] `attemptsRemaining` is provided
- [ ] Error message does not distinguish between wrong username and wrong password
- [ ] Failed attempt counter increments

---

### Test: TC-25-N04 -- Permission Escalation Attempt
**Regulation:** SS11.10(d) -- Access limited to authorized individuals; SS11.10(g) -- Authority checks

**API Alternative (curl):**
```bash
# Login as VIEWER (lowest permissions)
VIEWER_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester2","password":"Admin@123","force":true}' | jq -r '.token')

# Attempt to access SUPER_ADMIN-only endpoints
echo "--- Attempt: List all users ---"
curl -s -X GET "$API/users" \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq '{error, message}'

echo "--- Attempt: Change system config ---"
curl -s -X PUT "$API/config/password-policy" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"minLength":4}' | jq '{error, message}'

echo "--- Attempt: Delete audit record ---"
curl -s -X DELETE "$API/audit/1" \
  -H "Authorization: Bearer $VIEWER_TOKEN" | jq '{error, message}'

echo "--- Attempt: Create a role ---"
curl -s -X POST "$API/roles" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"HACKER","displayName":"Hacker Role","hierarchyLevel":99}' | jq '{error, message}'
```

**Expected Result:**
- All attempts: Status 403 with `FORBIDDEN` error
- No data modification occurs

**Pass/Fail Criteria:**
- [ ] User management endpoints return 403 for VIEWER
- [ ] Config modification endpoints return 403 for VIEWER
- [ ] Audit deletion returns 403 for VIEWER
- [ ] Role creation returns 403 for VIEWER
- [ ] No escalation of privileges is possible

---

### Test: TC-25-N05 -- Reauth with Wrong Password
**Regulation:** SS11.100(a) -- Ensuring authenticity; SS11.200(a) -- Signature verification

**API Alternative (curl):**
```bash
# Attempt a reauth-protected action with wrong password
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"reauth_fail","fullName":"Reauth Fail","email":"fail@test.com","password":"Admin@123","role":"VIEWER","_currentPassword":"WrongPassword!"}' | jq .
```

**Expected Result:**
- Status 401 with `{"error":"REAUTH_FAILED","message":"Incorrect password. Please try again."}`
- The action is NOT performed

**Pass/Fail Criteria:**
- [ ] Wrong reauth password returns 401
- [ ] Error is `REAUTH_FAILED` (not REAUTH_REQUIRED)
- [ ] The protected action is not executed
- [ ] User is not created despite valid creation data

---

### Test: TC-25-N06 -- Reauth Missing Password
**Regulation:** SS11.100(a) -- Ensuring authenticity

**API Alternative (curl):**
```bash
# Attempt a reauth-protected action without providing password
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"reauth_missing","fullName":"Reauth Missing","email":"missing@test.com","password":"Admin@123","role":"VIEWER"}' | jq .
```

**Expected Result:**
- Status 401 with `{"error":"REAUTH_REQUIRED","message":"This action requires password re-authentication.","action":"CREATE_USER"}`

**Pass/Fail Criteria:**
- [ ] Missing password returns 401 REAUTH_REQUIRED
- [ ] Response includes the `action` name that requires reauth
- [ ] The protected action is not executed

---

### Test: TC-25-N07 -- Disabled User Cannot Login
**Regulation:** SS11.10(d) -- System access controls

**How to Execute:**
1. As SUPER_ADMIN, disable a user account
2. Attempt to login as the disabled user

**API Alternative (curl):**
```bash
# Get user ID
USER_ID=$(curl -s -X GET "$API/users" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.username=="cfr_tester") | .id')

# Disable the user
curl -s -X POST "$API/users/$USER_ID/disable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_currentPassword":"Admin@123"}' | jq .

# Attempt login as disabled user (should fail)
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789"}' | jq .

# Re-enable the user for future tests
curl -s -X POST "$API/users/$USER_ID/enable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_currentPassword":"Admin@123"}' | jq .
```

**Expected Result:**
- Login attempt: Status 401/403 with error indicating account is disabled
- DB: User status shows `DISABLED`

**Pass/Fail Criteria:**
- [ ] Disabled user cannot login
- [ ] Error message indicates account is not active
- [ ] Existing sessions for disabled user are invalidated
- [ ] Re-enabled user can login again

---

### Test: TC-25-N08 -- Locked User Cannot Login Even with Correct Password
**Regulation:** SS11.300(b) -- ID code/password controls

**API Alternative (curl):**
```bash
# First lock the user by exceeding failed attempts (from TC-25-P13)
# Then attempt login with correct password
curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789"}' | jq .
```

**Expected Result:**
- Status 401/403 with `ACCOUNT_LOCKED` error
- Correct password does NOT bypass the lockout

**Pass/Fail Criteria:**
- [ ] Locked account rejects even correct passwords
- [ ] Error explicitly indicates account is locked
- [ ] Lock must be cleared by administrator (TC-25-P14)

---

### Test: TC-25-N09 -- Weak Password Rejected
**Regulation:** SS11.300(b) -- Password quality enforcement

**API Alternative (curl):**
```bash
# Re-login as cfr_tester (ensure unlocked first)
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789","force":true}' | jq -r '.token')

# Attempt password change with weak password (no special char, no uppercase)
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Changed@789","newPassword":"weak","confirmPassword":"weak"}' | jq .

# Attempt with too-short password
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Changed@789","newPassword":"Ab@1","confirmPassword":"Ab@1"}' | jq .
```

**Expected Result:**
- Status 400 with error indicating password does not meet policy requirements
- Specific validation messages for missing complexity requirements

**Pass/Fail Criteria:**
- [ ] Password shorter than `minLength` is rejected
- [ ] Password without uppercase (when required) is rejected
- [ ] Password without special characters (when required) is rejected
- [ ] Password without numbers (when required) is rejected
- [ ] Error message specifies which requirement failed

---

### Test: TC-25-N10 -- Audit Record Tamper Detection
**Regulation:** SS11.10(e) -- Detecting unauthorized record modification

**How to Execute:**
1. Directly modify an audit record's data in the database (bypass trigger for testing)
2. Verify the API reports `integrityValid: false`

**DB Verification (execute as superuser):**
```sql
-- First, get a record ID
SELECT id, action, checksum FROM audit_trail ORDER BY id DESC LIMIT 1;

-- Note the ID and checksum, then tamper with the record
-- (Must temporarily disable trigger)
BEGIN;
ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_update;
UPDATE audit_trail SET action = 'TAMPERED_ACTION' WHERE id = <ID>;
ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_update;
COMMIT;
```

**API Alternative (curl):**
```bash
# Query the tampered record via API
curl -s -X GET "$API/audit/<ID>" \
  -H "Authorization: Bearer $TOKEN" | jq '{id, action, checksum, integrityValid}'
```

**Expected Result:**
- API: `integrityValid: false` -- the recomputed checksum does not match the stored checksum
- The original checksum remains stored, proving the record was modified after creation

**Pass/Fail Criteria:**
- [ ] Tampered record shows `integrityValid: false`
- [ ] Original checksum is preserved (evidence of tampering)
- [ ] Recomputed checksum differs from stored checksum
- [ ] All non-tampered records still show `integrityValid: true`

**IMPORTANT: Revert the tampered record after testing:**
```sql
BEGIN;
ALTER TABLE audit_trail DISABLE TRIGGER audit_trail_no_update;
UPDATE audit_trail SET action = '<ORIGINAL_ACTION>' WHERE id = <ID>;
ALTER TABLE audit_trail ENABLE TRIGGER audit_trail_no_update;
COMMIT;
```

---

### Test: TC-25-N11 -- Backup Tamper Detection
**Regulation:** SS11.10(e) -- Backup integrity

**API Alternative (curl):**
```bash
# Export backup
curl -s -X GET "$API/backup/export?format=json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Reauth-Password: Admin@123" \
  -o /tmp/backup_tamper_test.json

# Tamper with the backup file
python3 -c "
import json
with open('/tmp/backup_tamper_test.json', 'r') as f:
    backup = json.load(f)
backup['data']['users'] = [{'username':'injected'}]
with open('/tmp/backup_tampered.json', 'w') as f:
    json.dump(backup, f)
"

# Attempt to validate the tampered backup
curl -s -X POST "$API/backup/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/backup_tampered.json" | jq .

# Attempt to restore the tampered backup (should fail)
curl -s -X POST "$API/backup/restore" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Reauth-Password: Admin@123" \
  -F "file=@/tmp/backup_tampered.json" | jq .
```

**Expected Result:**
- Validation: Returns `checksumValid: false`
- Restore: Fails with `CHECKSUM_MISMATCH` error

**Pass/Fail Criteria:**
- [ ] Tampered backup fails validation
- [ ] Tampered backup cannot be restored
- [ ] Error message indicates checksum mismatch
- [ ] Original (untampered) backup validates successfully

---

### Test: TC-25-N12 -- Password Reuse Prevention
**Regulation:** SS11.300(b) -- Password uniqueness

**API Alternative (curl):**
```bash
# Login as cfr_tester
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789","force":true}' | jq -r '.token')

# Attempt to change password to the current password (same password)
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $CFR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Changed@789","newPassword":"Changed@789","confirmPassword":"Changed@789"}' | jq .
```

**Expected Result:**
- Status 400 with error indicating password was recently used or matches current

**Pass/Fail Criteria:**
- [ ] Same-as-current password is rejected
- [ ] Recently used passwords are rejected (based on history count)
- [ ] Error message clearly states the password cannot be reused
- [ ] Password history is checked against hashed values (not plaintext)

---

### Test: TC-25-N13 -- Session Hijacking Prevention (Deactivated Session)
**Regulation:** SS11.10(d) -- System access controls; SS11.200(a) -- Signature security

**API Alternative (curl):**
```bash
# Login and get a token
HIJACK_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789","force":true}' | jq -r '.token')

# Logout (deactivates session)
curl -s -X POST "$API/auth/logout" \
  -H "Authorization: Bearer $HIJACK_TOKEN" | jq .

# Attempt to use the token after logout (session hijacking attempt)
curl -s -X GET "$API/auth/me" \
  -H "Authorization: Bearer $HIJACK_TOKEN" | jq .
```

**Expected Result:**
- Status 401 with `SESSION_INVALID` -- the JWT is valid but session is terminated

**Pass/Fail Criteria:**
- [ ] Logged-out session token returns 401
- [ ] Error is `SESSION_INVALID` (DB session check catches it)
- [ ] Token cannot be reused after logout
- [ ] JWT alone is insufficient without active DB session

---

### Test: TC-25-N14 -- Inactive User Account Rejection Mid-Session
**Regulation:** SS11.10(d) -- Real-time access control enforcement

**How to Execute:**
1. Login as `cfr_tester`
2. While session is active, have SUPER_ADMIN disable the user
3. Attempt to make an API call with the still-valid JWT

**API Alternative (curl):**
```bash
# Login as cfr_tester
CFR_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"cfr_tester","password":"Changed@789","force":true}' | jq -r '.token')

# Verify token works
curl -s -X GET "$API/auth/me" -H "Authorization: Bearer $CFR_TOKEN" | jq '{username, status}'

# Get user ID and disable mid-session
USER_ID=$(curl -s -X GET "$API/users" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.username=="cfr_tester") | .id')
curl -s -X POST "$API/users/$USER_ID/disable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_currentPassword":"Admin@123"}' | jq .

# Attempt to use cfr_tester's token (should fail)
curl -s -X GET "$API/auth/me" -H "Authorization: Bearer $CFR_TOKEN" | jq .

# Re-enable for future tests
curl -s -X POST "$API/users/$USER_ID/enable" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"_currentPassword":"Admin@123"}' | jq .
```

**Expected Result:**
- After disabling: Status 401 with `ACCOUNT_INACTIVE`
- Auth plugin checks user status on EVERY request, not just login

**Pass/Fail Criteria:**
- [ ] Disabled user is rejected immediately on next API call
- [ ] Error is `ACCOUNT_INACTIVE`
- [ ] Auth check happens on every authenticated request
- [ ] Re-enabling the user restores access

---

### Test: TC-25-N15 -- Forced Password Change Blocks Other Actions
**Regulation:** SS11.300(b) -- Initial password management; SS11.10(f) -- Operational checks

**API Alternative (curl):**
```bash
# Create user with forcePasswordChange
curl -s -X POST "$API/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"force_change_test","fullName":"Force Change Test","email":"forcechange@test.com","password":"Temp@12345","role":"OPERATOR","_currentPassword":"Admin@123"}' | jq .

# Login (will have forcePasswordChange: true)
FORCE_TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"force_change_test","password":"Temp@12345"}' | jq -r '.token')

# Attempt to access various endpoints (all should return FORCE_PASSWORD_CHANGE)
echo "--- Attempt: Dashboard data ---"
curl -s -X GET "$API/users" -H "Authorization: Bearer $FORCE_TOKEN" | jq '{error}'

echo "--- Attempt: Audit trail ---"
curl -s -X GET "$API/audit" -H "Authorization: Bearer $FORCE_TOKEN" | jq '{error}'

echo "--- Attempt: Entity list ---"
curl -s -X GET "$API/assets/instances" -H "Authorization: Bearer $FORCE_TOKEN" | jq '{error}'

echo "--- Allowed: Password policy (needed to show requirements) ---"
curl -s -X GET "$API/config/password-policy" -H "Authorization: Bearer $FORCE_TOKEN" | jq '{minLength}'

echo "--- Allowed: Change password ---"
curl -s -X POST "$API/auth/change-password" \
  -H "Authorization: Bearer $FORCE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"Temp@12345","newPassword":"Permanent@12345","confirmPassword":"Permanent@12345"}' | jq .
```

**Expected Result:**
- Non-allowed endpoints: Status 403 with `FORCE_PASSWORD_CHANGE` error
- Allowed endpoints: `/auth/change-password`, `/auth/logout`, `/auth/me`, `/config/password-policy` return normally
- After password change, all endpoints become accessible

**Pass/Fail Criteria:**
- [ ] Only 4 endpoints are accessible during forced password change
- [ ] All other endpoints return 403 FORCE_PASSWORD_CHANGE
- [ ] After password change, forced flag is cleared
- [ ] User can access all permitted endpoints after changing password

---

## Section 3: Database Verification Queries

All queries should be run against the `digilog_db` database on PostgreSQL 18 (localhost:5432).

### Connection
```bash
psql -h localhost -U postgres -d digilog_db
```

### 3.1 Audit Trail Integrity Queries

```sql
-- Q1: Verify all audit records have checksums
SELECT COUNT(*) as total_records,
       COUNT(checksum) as records_with_checksum,
       COUNT(*) - COUNT(checksum) as records_without_checksum
FROM audit_trail;

-- Q2: Check for SUPER_ADMIN records (should be 0)
SELECT COUNT(*) as super_admin_records
FROM audit_trail
WHERE user_role = 'SUPER_ADMIN';

-- Q3: List recent audit records with checksums
SELECT id, action, user_id, user_role, checksum,
       LEFT(checksum, 16) as checksum_prefix,
       timestamp
FROM audit_trail
ORDER BY timestamp DESC LIMIT 10;

-- Q4: Verify audit trail immutability triggers
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'audit_trail';

-- Q5: Audit records per action type
SELECT action, COUNT(*) as count
FROM audit_trail
GROUP BY action
ORDER BY count DESC;
```

### 3.2 Session Management Queries

```sql
-- Q6: Active sessions summary
SELECT s.id, u.username, u.role,
       s.is_active, s.ip_address,
       s.created_at, s.expires_at, s.last_active_at,
       s.termination_reason
FROM sessions s
JOIN users u ON s.user_id = u.id
ORDER BY s.created_at DESC LIMIT 10;

-- Q7: Session duration configuration
SELECT config_value->>'sessionDurationHours' as session_hours,
       config_value->>'idleTimeoutMinutes' as idle_timeout_minutes
FROM system_config
WHERE config_key = 'session';

-- Q8: Terminated sessions with reasons
SELECT termination_reason, COUNT(*) as count
FROM sessions
WHERE is_active = false AND termination_reason IS NOT NULL
GROUP BY termination_reason
ORDER BY count DESC;
```

### 3.3 Password Management Queries

```sql
-- Q9: Password history depth per user
SELECT u.username, COUNT(ph.id) as history_entries
FROM users u
LEFT JOIN password_history ph ON u.id = ph.user_id
GROUP BY u.username
ORDER BY history_entries DESC;

-- Q10: Password policy configuration
SELECT config_value
FROM system_config
WHERE config_key = 'password-policy';

-- Q11: Users with password expiry status
SELECT username, role, status,
       password_changed_at,
       password_expires_at,
       force_password_change,
       is_temporary_password,
       CASE
         WHEN password_expires_at IS NULL THEN 'NO_EXPIRY'
         WHEN password_expires_at < NOW() THEN 'EXPIRED'
         ELSE 'VALID'
       END as expiry_status
FROM users
ORDER BY username;

-- Q12: Login security configuration
SELECT config_value
FROM system_config
WHERE config_key = 'login-security';
```

### 3.4 Account Lockout Queries

```sql
-- Q13: Account lockout status
SELECT username, role, status,
       failed_login_attempts,
       locked_at, lockout_until,
       CASE
         WHEN status = 'LOCKED' THEN 'LOCKED'
         WHEN failed_login_attempts > 0 THEN 'AT_RISK'
         ELSE 'CLEAR'
       END as lockout_status
FROM users
ORDER BY failed_login_attempts DESC;
```

### 3.5 Electronic Signature Queries

```sql
-- Q14: Electronic signatures with full SS11.50 fields
SELECT id, record_type, record_id,
       signer_full_name,   -- SS11.50(a)
       signer_role,
       signed_at,          -- SS11.50(b)
       meaning,            -- SS11.50(c)
       record_hash,        -- SS11.70
       signature_hash,     -- SS11.70
       re_auth_verified,
       re_auth_method
FROM electronic_signatures
ORDER BY signed_at DESC LIMIT 10;

-- Q15: Signature integrity check (record linkage)
SELECT es.id,
       es.record_type,
       es.record_id,
       LENGTH(es.record_hash) as record_hash_length,
       LENGTH(es.signature_hash) as signature_hash_length,
       es.re_auth_verified
FROM electronic_signatures es
ORDER BY es.signed_at DESC LIMIT 10;
```

### 3.6 RBAC Queries

```sql
-- Q16: Role hierarchy and permissions summary
SELECT name, display_name, hierarchy_level,
       is_system, is_active,
       jsonb_array_length(permissions::jsonb) as permission_count
FROM roles
ORDER BY hierarchy_level DESC;

-- Q17: Database-level constraints verification
SELECT tc.constraint_name, tc.constraint_type, tc.table_name
FROM information_schema.table_constraints tc
WHERE tc.table_name IN ('users', 'roles', 'sessions', 'audit_trail', 'electronic_signatures')
AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY', 'FOREIGN KEY')
ORDER BY tc.table_name, tc.constraint_type;
```

### 3.7 Reauth Configuration Query

```sql
-- Q18: Action reauth configuration
SELECT config_key,
       jsonb_object_keys(config_value::jsonb) as action_name
FROM system_config
WHERE config_key = 'action-reauth'
LIMIT 50;
```

---

## Section 4: Compliance Matrix

| Test ID | Test Name | Regulation Section | SS11.10 | SS11.50 | SS11.70 | SS11.100 | SS11.200 | SS11.300 | Status |
|---------|-----------|-------------------|---------|---------|---------|----------|----------|----------|--------|
| TC-25-P01 | Audit SHA-256 Checksum Creation | SS11.10(e) | X | | | | | | |
| TC-25-P02 | Audit Read-Time Integrity | SS11.10(e) | X | | | | | | |
| TC-25-P03 | Audit Immutability (DB Trigger) | SS11.10(e) | X | | | | | | |
| TC-25-P04 | SUPER_ADMIN Audit Exemption | SS11.10(e) | X | | | | | | |
| TC-25-P05 | RBAC -- 6 Roles, 39+ Permissions | SS11.10(d) | X | | | | | | |
| TC-25-P06 | requirePermission Enforcement | SS11.10(d)(g) | X | | | | | | |
| TC-25-P07 | Single Active Session | SS11.10(d) | X | | | | X | | |
| TC-25-P08 | 24h Absolute Session Timeout | SS11.10(d) | X | | | | | | |
| TC-25-P09 | Session Sliding Window | SS11.10(d) | X | | | | | | |
| TC-25-P10 | Password Policy Configuration | SS11.300(b) | | | | | | X | |
| TC-25-P11 | Password History Enforcement | SS11.300(b) | | | | | | X | |
| TC-25-P12 | Password Expiry Enforcement | SS11.300(b) | | | | | | X | |
| TC-25-P13 | Account Lockout | SS11.300(b), SS11.10(d) | X | | | | | X | |
| TC-25-P14 | Account Unlock by Admin | SS11.300(b) | | | | | | X | |
| TC-25-P15 | Rate Limiting -- Login | SS11.10(d) | X | | | | | | |
| TC-25-P16 | Rate Limiting -- Forgot Password | SS11.10(d) | X | | | | | | |
| TC-25-P17 | Electronic Signature Manifestations | SS11.50(a)(b)(c) | | X | | | | | |
| TC-25-P18 | Signature/Record Hash Linking | SS11.70 | | | X | | | | |
| TC-25-P19 | Audit Hash Chain (previousChecksum) | SS11.70, SS11.10(e) | X | | X | | | | |
| TC-25-P20 | Re-authentication for Sensitive Ops | SS11.100(a) | | | | X | | | |
| TC-25-P21 | Two-Component Auth | SS11.200(a) | | | | | X | | |
| TC-25-P22 | JWT + DB Session Binding | SS11.200(a), SS11.10(d) | X | | | | X | | |
| TC-25-P23 | Terminate Sessions on Password Change | SS11.200(a) | | | | | X | | |
| TC-25-P24 | Single-Tab Enforcement | SS11.200(a) | | | | | X | | |
| TC-25-P25 | Unique User IDs | SS11.300(a) | | | | | | X | |
| TC-25-P26 | Force Password Change on First Login | SS11.300(b) | | | | | | X | |
| TC-25-P27 | Backup Integrity Checksum | SS11.10(e) | X | | | | | | |
| TC-25-P28 | Computer-Generated Timestamps | SS11.10(e) | X | | | | | | |
| TC-25-P29 | Before/After Value Capture | SS11.10(e) | X | | | | | | |
| TC-25-P30 | Configurable Reauth Actions (42+) | SS11.100(a) | | | | X | | | |
| TC-25-N01 | No Token -- Access Denied | SS11.10(d) | X | | | | | | |
| TC-25-N02 | Invalid/Expired Token Rejected | SS11.10(d) | X | | | | | | |
| TC-25-N03 | Wrong Password Rejected | SS11.300(b) | | | | | | X | |
| TC-25-N04 | Permission Escalation Blocked | SS11.10(d)(g) | X | | | | | | |
| TC-25-N05 | Reauth Wrong Password Rejected | SS11.100(a) | | | | X | | | |
| TC-25-N06 | Reauth Missing Password Rejected | SS11.100(a) | | | | X | | | |
| TC-25-N07 | Disabled User Cannot Login | SS11.10(d) | X | | | | | | |
| TC-25-N08 | Locked User Rejected (Even Correct PW) | SS11.300(b) | | | | | | X | |
| TC-25-N09 | Weak Password Rejected | SS11.300(b) | | | | | | X | |
| TC-25-N10 | Audit Tamper Detection | SS11.10(e) | X | | | | | | |
| TC-25-N11 | Backup Tamper Detection | SS11.10(e) | X | | | | | | |
| TC-25-N12 | Password Reuse Prevention | SS11.300(b) | | | | | | X | |
| TC-25-N13 | Session Hijacking Prevention | SS11.10(d), SS11.200(a) | X | | | | X | | |
| TC-25-N14 | Mid-Session User Deactivation | SS11.10(d) | X | | | | | | |
| TC-25-N15 | Forced Password Change Blocks Actions | SS11.300(b), SS11.10(f) | X | | | | | X | |

---

## Section 5: Regulatory Coverage Summary

### SS11.10 -- Controls for Closed Systems (18 tests)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.10(d) | Limiting system access to authorized individuals | P05, P06, P07, P08, P09, P13, P15, P16, P22, N01, N02, N04, N07, N13, N14 |
| SS11.10(e) | Secure, computer-generated, time-stamped audit trails | P01, P02, P03, P04, P19, P27, P28, P29, N10, N11 |
| SS11.10(f) | Operational system checks to enforce sequencing | N15 |
| SS11.10(g) | Authority checks to ensure authorized actions | P06, N04 |

### SS11.50 -- Signature Manifestations (1 test)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.50(a) | Printed name of signer | P17 |
| SS11.50(b) | Date and time of signing | P17 |
| SS11.50(c) | Meaning (e.g., review, approval) | P17 |

### SS11.70 -- Signature/Record Linking (2 tests)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.70 | Signatures linked to records, not transferable | P18, P19 |

### SS11.100 -- General Requirements (3 tests)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.100(a) | Ensure authenticity, integrity, confidentiality | P20, P30, N05, N06 |

### SS11.200 -- Electronic Signature Components (4 tests)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.200(a) | At least two distinct identification components | P07, P21, P22, P23, P24, N13 |

### SS11.300 -- Controls for ID Codes/Passwords (10 tests)
| Subsection | Description | Tests |
|------------|-------------|-------|
| SS11.300(a) | Unique ID codes | P25 |
| SS11.300(b) | Password uniqueness, aging, management | P10, P11, P12, P13, P14, P26, N03, N08, N09, N12, N15 |

---

## Notes

1. **SUPER_ADMIN Audit Exemption**: By design per business requirements, SUPER_ADMIN actions are not recorded in the audit trail. This is documented in `apps/api/DECISIONS.md` as Decision #5.

2. **Hash Chain vs Individual Checksums**: The current implementation uses individual SHA-256 checksums per audit record (not a chained hash where each includes the previous). This is documented in `apps/api/DECISIONS.md` as Decision #4. The `previousChecksum` field exists in the schema for future enhancement.

3. **Rate Limit Testing**: Rate limit tests may be affected by nginx proxy configuration. If testing from the server directly (localhost), use `http://localhost:3000/api`. If testing externally, use `http://34.232.224.0/api` and be aware that `trustProxy: 1` is configured.

4. **Test User Cleanup**: After testing, clean up any test users created (`cfr_tester`, `cfr_tester2`, `reauth_test`, `firstlogin_test`, `force_change_test`) to avoid leaving test data in the system.

5. **Password State**: Several tests modify the `cfr_tester` password. Track the current password state throughout testing. The sequence in this guide is: `Admin@123` -> `NewPass@123` -> `NewPass@456` -> `Changed@789`.

6. **Electronic Signatures**: Electronic signatures are created during checklist reviews and alarm acknowledgments. If no electronic signatures exist in the database, perform an alarm acknowledgment or checklist review to generate test data for TC-25-P17 and TC-25-P18.


> **Phase 2 (Digital FMS):** Filter operations comply with 21 CFR Part 11. Stage bypass requires reauth (electronic signature). Filter checklist submissions are audit-logged. Test per TC-25-P37 through TC-25-P39 and TC-25-N21. 52+ privileges and 52+ reauth actions include filter operations.


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
