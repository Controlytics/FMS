# TC-25: 21 CFR Part 11 Compliance -- Test Cases

## Overview
- **Module**: 21 CFR Part 11 Regulatory Compliance (Cross-Cutting)
- **Regulation**: FDA 21 CFR Part 11 — Electronic Records; Electronic Signatures
- **Scope**: This test suite validates DigiLog's compliance with all applicable sections of 21 CFR Part 11, covering closed system controls (SS11.10), signature manifestations (SS11.50), signature/record linking (SS11.70), general signature requirements (SS11.100), electronic signature components (SS11.200), and ID code/password controls (SS11.300).
- **Key Implementation Details**:
  - SHA-256 checksummed audit trail entries with read-time integrity verification
  - ElectronicSignature model with full non-repudiation fields (signer identity, role, meaning, IP, user agent, record hash, signature hash)
  - 52+ reauth actions across 14+ categories requiring password re-verification before critical operations (includes Phase 2 filter operations)
  - RBAC with 6 default roles, 52+ granular permissions, dynamic role management (includes FILTER_VIEW, FILTER_MANAGE, FILTER_OPERATE)
  - Session management: single active session, 24h absolute timeout, configurable idle timeout, sliding window
  - Password policy: configurable complexity, history tracking, expiry, account lockout
  - Atomic transactions on all entity mutations with soft-delete preservation
  - SUPER_ADMIN audit exemption (regulatory design decision)

---

## Positive Test Cases

### TC-25-P01: Audit Trail Entry SHA-256 Checksum Generation
- **Priority**: High
- **Regulation**: SS11.10(e) — Audit trail integrity
- **Preconditions**: Authenticated as ADMIN user. System is operational with at least one prior audit record.
- **Test Data**: ADMIN credentials (not SUPER_ADMIN, as SUPER_ADMIN actions are exempt from audit logging).
- **Steps**:
  1. Login as ADMIN user.
  2. Perform a user-management action (e.g., create a new user) to generate an audit record.
  3. Send GET /api/audit?action=CREATE_USER&limit=1&sortBy=timestamp&sortOrder=desc.
  4. Note the returned record's `id` and `checksum` field.
  5. Verify the `checksum` is a 64-character hexadecimal string (SHA-256 output).
  6. Send GET /api/audit/{id} and verify `integrityValid: true`.
- **Expected Result**: Every audit record has a SHA-256 checksum computed from {timestamp, userId, action, targetType, targetId, afterValue} with deterministic key sorting. Read-time verification confirms integrity.

### TC-25-P02: Audit Trail Read-Time Integrity Verification
- **Priority**: High
- **Regulation**: SS11.10(e) — Use of secure, computer-generated, time-stamped audit trails
- **Preconditions**: Multiple audit records exist from non-SUPER_ADMIN users.
- **Test Data**: None required.
- **Steps**:
  1. Send GET /api/audit?limit=50.
  2. For each record in the response, verify the `integrityValid` field is `true`.
  3. Pick 5 records at random and send GET /api/audit/{id} for each.
  4. Verify each individual response includes `integrityValid: true`.
  5. Verify each record contains: id, timestamp, userId, userName, userRole, action, targetType, targetId, beforeValue, afterValue, checksum, ipAddress, userAgent, sessionId.
- **Expected Result**: All records pass read-time SHA-256 recomputation check. The system recomputes the checksum from stored fields and compares against the stored checksum on every read.

### TC-25-P03: Tampered Audit Record Detection
- **Priority**: High
- **Regulation**: SS11.10(e) — Records cannot be altered without detection
- **Preconditions**: Direct database access available. At least one audit record exists from a non-SUPER_ADMIN user.
- **Test Data**: Valid audit record ID obtained from GET /api/audit.
- **Steps**:
  1. Send GET /api/audit and pick a record, noting its `id` and `integrityValid: true`.
  2. Directly modify the `after_value` column in the `audit_trail` table via SQL: `UPDATE audit_trail SET after_value = '{"tampered": true}'::jsonb WHERE id = <record_id>;`
  3. Send GET /api/audit/{id}.
  4. Verify `integrityValid` is now `false`.
  5. Revert the database change.
- **Expected Result**: The checksum mismatch is detected. The record is flagged as `integrityValid: false`, proving tamper detection works.

### TC-25-P04: Audit Trail Captures Before and After Values
- **Priority**: High
- **Regulation**: SS11.10(e) — Record changes with before and after values
- **Preconditions**: Authenticated as ADMIN. An existing user account to modify.
- **Test Data**: Test user account with known attribute values.
- **Steps**:
  1. Send GET /api/users to identify a test user and note their current `displayName`.
  2. Send PUT /api/users/{id} with a new `displayName` value (include reauth password if required).
  3. Send GET /api/audit?action=UPDATE_USER&limit=1&sortBy=timestamp&sortOrder=desc.
  4. Verify the returned record contains `beforeValue` with the old displayName.
  5. Verify the returned record contains `afterValue` with the new displayName.
  6. Verify `timestamp` is present and accurate (within a few seconds of the action).
- **Expected Result**: Audit record captures both previous and new state, enabling full reconstruction of the change history.

### TC-25-P05: Audit Trail Non-Repudiation (IP Address and User Agent)
- **Priority**: High
- **Regulation**: SS11.10(e), SS11.10(g) — Authority checks and accountability
- **Preconditions**: Authenticated as ADMIN.
- **Test Data**: None.
- **Steps**:
  1. Perform any auditable action (e.g., create a user).
  2. Send GET /api/audit?action=CREATE_USER&limit=1&sortBy=timestamp&sortOrder=desc.
  3. Verify the record contains a non-null `ipAddress` field (e.g., "127.0.0.1" or public IP).
  4. Verify the record contains a non-null `userAgent` field (e.g., browser/curl user agent string).
  5. Verify the record contains `userId`, `userName`, `userRole`, and `sessionId`.
- **Expected Result**: Full non-repudiation data captured: who (userId/userName/userRole), when (timestamp), from where (ipAddress, userAgent), and session context (sessionId).

### TC-25-P06: Electronic Signature Creation on Checklist Review
- **Priority**: High
- **Regulation**: SS11.50 — Signature manifestations
- **Preconditions**: An entity with a checklist template exists. A checklist review is available for submission.
- **Test Data**: Entity ID with checklist, reviewer credentials.
- **Steps**:
  1. Navigate to the entity's checklist page (/checklist/:entityId).
  2. Complete all checklist items.
  3. Submit the checklist with electronic signature (triggers SUBMIT_CHECKLIST_WITH_SIGNATURE reauth).
  4. Enter password for re-authentication when prompted.
  5. Query the `electronic_signatures` table in the database.
  6. Verify the signature record contains: `signerFullName` (SS11.50(a)), `signedAt` (SS11.50(b)), `meaning` (SS11.50(c) -- e.g., "Performed By"), `signerRole`, `signerUserId`.
  7. Verify `reAuthVerified` is `true` and `reAuthMethod` is "password".
- **Expected Result**: Electronic signature is created with all three manifestation components required by SS11.50: printed name, date/time, and meaning.

### TC-25-P07: Electronic Signature Record Hash Linking (SS11.70)
- **Priority**: High
- **Regulation**: SS11.70 — Signatures linked to respective records
- **Preconditions**: An electronic signature exists (from TC-25-P06).
- **Test Data**: Record ID of the signed checklist review.
- **Steps**:
  1. Query the `electronic_signatures` table for the record from TC-25-P06.
  2. Verify `recordType` is set (e.g., "checklist" or "alarm").
  3. Verify `recordId` matches the checklist review ID.
  4. Verify `recordHash` is a 64-character SHA-256 hex string (hash of the record content at signing time).
  5. Verify `signatureHash` is a 64-character SHA-256 hex string (hash of recordHash + signerUserId + signedAt).
  6. Verify the linked record (checklist review) still exists and matches the hash.
- **Expected Result**: The signature is cryptographically bound to the specific record via `recordHash` and `signatureHash`, ensuring the signed record cannot be altered without breaking the link.

### TC-25-P08: Reauth Enforcement on User Management Operations
- **Priority**: High
- **Regulation**: SS11.100 — Electronic signatures require verification
- **Preconditions**: Authenticated as ADMIN. Reauth is enabled for User Management actions (default configuration).
- **Test Data**: ADMIN credentials for reauth. Test user to create/update/delete.
- **Steps**:
  1. Send POST /api/users (create user) WITHOUT `_currentPassword` or `x-reauth-password` header.
  2. Verify response is 401 with `{ error: "REAUTH_REQUIRED", action: "CREATE_USER" }`.
  3. Resend POST /api/users WITH `_currentPassword` field containing the ADMIN's current password.
  4. Verify response is 201 (user created successfully).
  5. Repeat steps 1-4 for UPDATE_USER (PUT /api/users/{id}) and DELETE_USER (DELETE /api/users/{id}).
  6. Repeat for ENABLE_USER, DISABLE_USER, UNLOCK_USER, RESET_PASSWORD, PROCESS_RESET_REQUEST.
- **Expected Result**: All 9 User Management reauth actions require password re-verification before execution. Operations without reauth are rejected with 401 REAUTH_REQUIRED.

### TC-25-P09: Reauth Enforcement on Entity Management Operations
- **Priority**: High
- **Regulation**: SS11.100 — Electronic signatures for critical operations
- **Preconditions**: Authenticated user with entity management permissions. Reauth enabled for Entity Management category.
- **Test Data**: Valid entity template and instance data.
- **Steps**:
  1. Attempt POST /api/assets/templates (create template) without reauth password.
  2. Verify 401 REAUTH_REQUIRED with `action: "CREATE_ASSET_TEMPLATE"`.
  3. Retry with `_currentPassword` -- verify 201 success.
  4. Repeat for: UPDATE_ASSET_TEMPLATE, DELETE_ASSET_TEMPLATE, CREATE_ASSET, UPDATE_ASSET, DELETE_ASSET, CREATE_ASSET_RELATIONSHIP, DELETE_ASSET_RELATIONSHIP, CREATE_ASSET_IDENTIFIER, DELETE_ASSET_IDENTIFIER.
- **Expected Result**: All 10 Entity Management reauth actions enforce password re-verification.

### TC-25-P10: Reauth Enforcement on Configuration Changes
- **Priority**: High
- **Regulation**: SS11.100 — Verification before system changes
- **Preconditions**: Authenticated as ADMIN or SUPER_ADMIN. Reauth enabled for Configuration category.
- **Test Data**: Configuration update payloads.
- **Steps**:
  1. Attempt PUT /api/config/password-policy without reauth password.
  2. Verify 401 REAUTH_REQUIRED with `action: "UPDATE_PASSWORD_POLICY"`.
  3. Retry with `x-reauth-password` header containing valid password.
  4. Verify 200 success.
  5. Repeat for: UPDATE_LOGIN_SECURITY, UPDATE_SESSION_CONFIG, UPDATE_DATETIME_CONFIG, UPDATE_USERID_CONFIG, UPDATE_BRANDING, UPDATE_ROLE_CONFIG.
- **Expected Result**: All 7 Configuration reauth actions enforce password re-verification.

### TC-25-P11: Reauth Enforcement on Alarm Operations
- **Priority**: High
- **Regulation**: SS11.100 — Verification before safety-critical actions
- **Preconditions**: At least one ACTIVE alarm exists. Authenticated user with ALARM_MANAGE permission. Reauth enabled for Alarms category.
- **Test Data**: Active alarm ID.
- **Steps**:
  1. Send POST /api/queries/alarms/{id}/acknowledge without reauth password.
  2. Verify 401 REAUTH_REQUIRED with `action: "ACKNOWLEDGE_ALARM"`.
  3. Retry with `_currentPassword` -- verify 200 success (alarm acknowledged).
  4. Create another active alarm or use one with ACKNOWLEDGED status.
  5. Send POST /api/queries/alarms/{id}/clear without reauth password.
  6. Verify 401 REAUTH_REQUIRED with `action: "CLEAR_ALARM"`.
  7. Retry with `_currentPassword` -- verify 200 success.
- **Expected Result**: Both ACKNOWLEDGE_ALARM and CLEAR_ALARM require password re-verification.

### TC-25-P12: Configurable Reauth Per Action and Per Role
- **Priority**: High
- **Regulation**: SS11.100(a) — Authority to use electronic signatures
- **Preconditions**: Authenticated as SUPER_ADMIN. Access to action-reauth configuration.
- **Test Data**: Action-reauth configuration payload.
- **Steps**:
  1. Send GET /api/config/action-reauth to view current configuration.
  2. Verify the response is a JSON object mapping action names to arrays of role names.
  3. Send PUT /api/config/action-reauth to disable reauth for CREATE_USER for ADMIN role (remove "ADMIN" from the CREATE_USER array).
  4. Login as ADMIN.
  5. Send POST /api/users to create a user WITHOUT reauth password.
  6. Verify 201 success (reauth is no longer required for ADMIN on CREATE_USER).
  7. Re-enable reauth for ADMIN on CREATE_USER via PUT /api/config/action-reauth.
- **Expected Result**: SUPER_ADMIN can configure which roles require reauth for which actions. When disabled, the action proceeds without password re-verification.

### TC-25-P13: Two-Component Authentication (Username + Password)
- **Priority**: High
- **Regulation**: SS11.200(a) — Two-component electronic signature
- **Preconditions**: Valid user account exists.
- **Test Data**: username: admin, password: Admin@123 (or current password).
- **Steps**:
  1. Send POST /api/auth/login with `{ "username": "superadmin", "password": "Admin@123" }`.
  2. Verify response contains `token` (JWT) and `user` object.
  3. Verify the JWT contains claims: `sub` (userId), `username`, `role`, `sessionId`.
  4. Verify the session is created in the DB with `isActive: true`.
  5. Confirm login fails with correct username but wrong password (401).
  6. Confirm login fails with wrong username but correct password (401).
- **Expected Result**: Authentication requires both components (username AND password). Neither alone is sufficient.

### TC-25-P14: Session Binding to JWT Token
- **Priority**: High
- **Regulation**: SS11.200(a)(2) — Subsequent executions under continuous session
- **Preconditions**: Authenticated session exists.
- **Test Data**: Valid JWT token.
- **Steps**:
  1. Login and extract the JWT token.
  2. Decode the JWT and verify it contains a `sessionId` claim.
  3. Query the DB for the Session record matching that `sessionId`.
  4. Verify the Session record has `isActive: true` and valid `expiresAt`.
  5. Use the JWT for multiple API calls and verify each succeeds (continuous session).
  6. Manually deactivate the session in the DB: `UPDATE "Session" SET "isActive" = false WHERE id = '<sessionId>'`.
  7. Use the same JWT for an API call.
  8. Verify 401 SESSION_INVALID -- JWT alone is not sufficient without active DB session.
- **Expected Result**: JWT is bound to a server-side session. Token validity depends on both JWT integrity AND active session record. This is not purely stateless JWT.

### TC-25-P15: Single Active Session Per User
- **Priority**: High
- **Regulation**: SS11.200(a)(1) — Unique identification code
- **Preconditions**: Valid user credentials.
- **Test Data**: Same credentials used from two different clients.
- **Steps**:
  1. Login as "admin" from Client A -- save TOKEN_A.
  2. Login as "admin" from Client B -- save TOKEN_B.
  3. Send GET /api/auth/me with TOKEN_B -- verify 200 OK.
  4. Send GET /api/auth/me with TOKEN_A -- verify 401 SESSION_INVALID.
  5. Query the Session table: verify only one active session exists for this user.
- **Expected Result**: New login terminates the previous session. Only one active session per user at any time, preventing session sharing.

### TC-25-P16: Password Change Terminates All Other Sessions
- **Priority**: High
- **Regulation**: SS11.200(a), SS11.300(b) — Session control on credential change
- **Preconditions**: User logged in.
- **Test Data**: Current password and new password.
- **Steps**:
  1. Login as test user and save TOKEN.
  2. Send POST /api/auth/change-password with `{ "currentPassword": "<current>", "newPassword": "<new>", "confirmPassword": "<new>" }`.
  3. Verify 200 success with a new token in the response.
  4. Use the OLD TOKEN to call GET /api/auth/me.
  5. Verify 401 SESSION_INVALID.
  6. Login with the new password -- verify success.
- **Expected Result**: Password change calls terminateOtherSessions(), invalidating all prior sessions. User must re-authenticate with the new password.

### TC-25-P17: Absolute 24-Hour Session Timeout
- **Priority**: High
- **Regulation**: SS11.10(d) — Limit access to authorized individuals
- **Preconditions**: Active session with known session ID.
- **Test Data**: Session ID from database.
- **Steps**:
  1. Login and obtain the session ID from the JWT or database.
  2. Update the session's `createdAt` in the DB to 25 hours ago: `UPDATE "Session" SET "createdAt" = NOW() - INTERVAL '25 hours' WHERE id = '<session-id>';`
  3. Send GET /api/auth/me with the token.
  4. Verify 401 with error "SESSION_EXPIRED" and message containing "maximum duration".
  5. Check the Session record: `terminationReason` should be "absolute_timeout".
- **Expected Result**: Sessions are hard-terminated after 24 hours regardless of activity. The 24h limit (MAX_ABSOLUTE_SESSION_MS) is enforced server-side in the auth plugin.

### TC-25-P18: Session Sliding Window Extension
- **Priority**: High
- **Regulation**: SS11.10(d) — Controlled access during active use
- **Preconditions**: Active session. Session duration configured (default 8h).
- **Test Data**: Valid JWT token.
- **Steps**:
  1. Login and note the session `expiresAt` from the database.
  2. Wait 30 seconds.
  3. Send GET /api/auth/me.
  4. Re-query the Session record in the database.
  5. Verify `expiresAt` has been extended (new value = now + sessionDurationHours).
  6. Verify `lastActiveAt` has been updated to the current time.
- **Expected Result**: Each authenticated request extends the session expiry by the configured duration. Active users are not forced to re-login within the absolute 24h limit.

### TC-25-P19: Idle Timeout with Warning and Auto-Logout
- **Priority**: High
- **Regulation**: SS11.10(d) — System to preclude unauthorized access
- **Preconditions**: Browser session active. Session config: autoLogoutEnabled=true, idleTimeoutMinutes=2 (testable value), warningMinutes=1.
- **Test Data**: Session configuration via PUT /api/config/session.
- **Steps**:
  1. Configure session settings: `{ "autoLogoutEnabled": true, "idleTimeoutMinutes": 2, "warningMinutes": 1 }`.
  2. Login in the browser.
  3. Remain idle (no mouse/keyboard/scroll/touch) for 1 minute.
  4. Verify the idle warning dialog appears with a 60-second countdown.
  5. Do NOT interact -- allow countdown to reach 0.
  6. Verify auto-logout occurs and user is redirected to the login page.
  7. Verify the session is terminated in the database.
- **Expected Result**: Idle timeout with progressive warning protects against unattended terminals. System auto-logs out the user after the configured idle period.

### TC-25-P20: Password Complexity Enforcement
- **Priority**: High
- **Regulation**: SS11.300(b) — Ensure uniqueness and prevent unauthorized use
- **Preconditions**: Password policy configured with all complexity requirements enabled.
- **Test Data**: Password policy: `{ "minLength": 8, "requireUppercase": true, "requireLowercase": true, "requireNumbers": true, "requireSpecialChars": true }`.
- **Steps**:
  1. Configure password policy via PUT /api/config/password-policy with the above settings.
  2. Attempt to create a user with password "short" -- verify rejection (too short).
  3. Attempt with password "alllowercase1!" -- verify rejection (no uppercase).
  4. Attempt with password "ALLUPPERCASE1!" -- verify rejection (no lowercase).
  5. Attempt with password "NoNumbers!Aa" -- verify rejection (no numbers).
  6. Attempt with password "NoSpecial1Aa" -- verify rejection (no special characters).
  7. Attempt with password "Valid@Pass1" -- verify success.
- **Expected Result**: Password complexity rules are enforced on user creation, password change, and password reset. All configured requirements must be met.

### TC-25-P21: Password History Prevention
- **Priority**: High
- **Regulation**: SS11.300(b) — Password controls
- **Preconditions**: Password policy configured with `passwordHistoryCount: 3`. User account exists.
- **Test Data**: Current password and 4 different new passwords.
- **Steps**:
  1. Configure password policy: `{ "passwordHistoryCount": 3 }`.
  2. Login as test user (password: "Original@Pass1").
  3. Change password to "NewPass@123".
  4. Change password to "NewPass@456".
  5. Attempt to change password back to "Original@Pass1" -- verify rejection (in last 3 history).
  6. Attempt to change to "NewPass@123" -- verify rejection (in last 3 history).
  7. Change password to "NewPass@789" (this pushes "Original@Pass1" out of the 3-password window).
  8. Now attempt "Original@Pass1" -- verify success (no longer within history count).
- **Expected Result**: Users cannot reuse any of the last N passwords (configurable via passwordHistoryCount). The PasswordHistory model tracks previous hashes.

### TC-25-P22: Password Expiry with Forced Change
- **Priority**: High
- **Regulation**: SS11.300(b) — Periodic revision of passwords
- **Preconditions**: Password policy has expiry configured. User account exists.
- **Test Data**: Password with expired `passwordExpiresAt`.
- **Steps**:
  1. Configure password policy with password expiry (e.g., 90 days).
  2. In the database, set a user's `passwordExpiresAt` to a past date: `UPDATE "User" SET "passwordExpiresAt" = NOW() - INTERVAL '1 day' WHERE id = '<user-id>';`
  3. Login as that user.
  4. Attempt to access GET /api/users.
  5. Verify 403 response with error "PASSWORD_EXPIRED" and message "Your password has expired."
  6. Verify only /api/auth/change-password, /api/auth/logout, /api/auth/me, and /api/config/password-policy are accessible.
  7. Change the password via POST /api/auth/change-password.
  8. Verify full access is restored.
- **Expected Result**: Expired passwords trigger forcePasswordChange. The server blocks all non-password-change endpoints until the user updates their password.

### TC-25-P23: Force Password Change on First Login
- **Priority**: High
- **Regulation**: SS11.300(b) — Initial password management
- **Preconditions**: Newly created user account with default/admin-set password.
- **Test Data**: New user credentials.
- **Steps**:
  1. As ADMIN, create a new user with forcePasswordChange=true (default for new users).
  2. Login as the new user.
  3. Attempt to access GET /api/users.
  4. Verify 403 with error "FORCE_PASSWORD_CHANGE".
  5. Change password via POST /api/auth/change-password.
  6. Verify GET /api/users now returns 200 (or 403 for permission, not for forced change).
- **Expected Result**: New users must change their password before accessing any system functionality. Only change-password, logout, and me endpoints are accessible during forced change.

### TC-25-P24: Account Lockout After Failed Attempts
- **Priority**: High
- **Regulation**: SS11.300(d) — Unauthorized use detection and reporting
- **Preconditions**: Login security configured with maxAttempts (e.g., 5). Valid user account exists.
- **Test Data**: Valid username, wrong password.
- **Steps**:
  1. Configure login security: `{ "maxAttempts": 5, "lockoutDurationMinutes": 30 }`.
  2. Attempt login with correct username and wrong password -- repeat 5 times.
  3. Verify each response includes `attemptsRemaining` (4, 3, 2, 1, 0).
  4. On the 5th failure, verify the response indicates account lockout.
  5. Attempt login with the CORRECT password.
  6. Verify 401 -- account is locked regardless of correct credentials.
  7. As ADMIN, send POST /api/users/{id}/unlock to unlock the account.
  8. Attempt login with correct password -- verify success.
- **Expected Result**: Account is locked after N failed attempts. Lockout persists until explicitly unlocked by an administrator.

### TC-25-P25: User Enumeration Prevention on Login
- **Priority**: High
- **Regulation**: SS11.300(d) — Protection against unauthorized access attempts
- **Preconditions**: None.
- **Test Data**: Non-existent username, any password.
- **Steps**:
  1. Send POST /api/auth/login with `{ "username": "nonexistent_user_xyz", "password": "AnyPassword@1" }`.
  2. Note the response body and status code.
  3. Send POST /api/auth/login with `{ "username": "superadmin", "password": "WrongPassword@1" }`.
  4. Note the response body and status code.
  5. Compare both responses: verify the error messages are identical (e.g., "Invalid credentials").
  6. Verify both return `attemptsRemaining` in the response (even for non-existent users).
- **Expected Result**: The system returns identical error responses for invalid username and invalid password, preventing attackers from enumerating valid usernames.

### TC-25-P26: RBAC Permission-Based Access Control
- **Priority**: High
- **Regulation**: SS11.10(d) — Limiting system access to authorized individuals
- **Preconditions**: Multiple user accounts with different roles exist.
- **Test Data**: Users with VIEWER, OPERATOR, ADMIN roles.
- **Steps**:
  1. Login as VIEWER (lowest permission level).
  2. Attempt GET /api/assets/instances -- verify 200 (ASSET_VIEW is available).
  3. Attempt POST /api/assets/instances (create entity) -- verify 403 (no ASSET_CREATE permission).
  4. Login as OPERATOR.
  5. Attempt POST /api/users -- verify 403 (no USER_CREATE permission).
  6. Login as ADMIN.
  7. Attempt POST /api/users -- verify 201 (has USER_CREATE permission, with reauth).
  8. Verify each role's accessible endpoints match their configured permissions.
- **Expected Result**: The RBAC system enforces granular permissions. `requirePermission()` checks the role's permissions JSON array from the database. Users can only perform actions their role explicitly permits.

### TC-25-P27: Dynamic Role Management with Permission Control
- **Priority**: High
- **Regulation**: SS11.10(g) — Authority checks
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: New role definition with specific permissions.
- **Steps**:
  1. Send POST /api/roles to create a custom role: `{ "name": "QA_TESTER", "displayName": "QA Tester", "hierarchyLevel": 3, "permissions": ["ASSET_VIEW", "AUDIT_READ"], "color": "#00ff00" }`.
  2. Create a user with the QA_TESTER role.
  3. Login as the QA_TESTER user.
  4. Verify GET /api/assets/instances returns 200 (ASSET_VIEW granted).
  5. Verify GET /api/audit returns 200 (AUDIT_READ granted).
  6. Verify POST /api/assets/instances returns 403 (ASSET_CREATE not granted).
  7. As SUPER_ADMIN, update the role to add ASSET_CREATE.
  8. Login again as QA_TESTER and verify POST /api/assets/instances now returns 201.
- **Expected Result**: Roles are dynamic and stored in the database. Permission changes take effect immediately on the next request (roles fetched from DB on each permission check).

### TC-25-P28: Soft Delete Preserves Audit Trail
- **Priority**: High
- **Regulation**: SS11.10(e) — Records cannot be destroyed
- **Preconditions**: An entity instance exists with associated audit records.
- **Test Data**: Entity instance ID.
- **Steps**:
  1. Create an entity instance (generates CREATE_ASSET audit record).
  2. Update the entity (generates UPDATE_ASSET audit record).
  3. Delete the entity via DELETE /api/assets/instances/{id} (with reauth).
  4. Verify the entity is soft-deleted: `isActive: false` in the database.
  5. Send GET /api/audit?targetId={entity-id}.
  6. Verify all three audit records (CREATE, UPDATE, DELETE) still exist and are intact.
  7. Verify all records have `integrityValid: true`.
- **Expected Result**: Soft delete sets `isActive: false` but does not remove the entity record or any associated audit trail entries. Full history is preserved.

### TC-25-P29: Atomic Transaction Integrity on Entity Operations
- **Priority**: High
- **Regulation**: SS11.10(a) — Accuracy and completeness of records
- **Preconditions**: Entity instance with child entities exists.
- **Test Data**: Parent entity with 2+ child entities.
- **Steps**:
  1. Create a parent entity.
  2. Create 3 child entities under the parent (via parentId).
  3. Send DELETE /api/assets/instances/{parentId} (with reauth).
  4. Verify the parent and all 3 children are soft-deleted (isActive: false).
  5. Verify the cascade is atomic: all 4 entities are deleted in a single transaction.
  6. Check audit records: verify DELETE_ASSET entries exist for all 4 entities.
- **Expected Result**: Cascade soft-delete is wrapped in a Prisma transaction. Either all entities are deactivated or none are (atomicity). Dependent records in 6 related tables are also cleaned.

### TC-25-P30: Audit Deletion is Itself Audit-Logged
- **Priority**: High
- **Regulation**: SS11.10(e) — Audit trail of audit trail operations
- **Preconditions**: Authenticated as SUPER_ADMIN. At least one audit record exists.
- **Test Data**: Audit record ID to delete.
- **Steps**:
  1. Send GET /api/audit and pick a record ID.
  2. Send DELETE /api/audit/{id} as SUPER_ADMIN.
  3. Verify 200 success.
  4. Note: Since SUPER_ADMIN actions are exempt from audit logging, the deletion audit log entry is created BEFORE execution (special handling).
  5. Send GET /api/audit?action=AUDIT_RECORD_DELETED.
  6. Verify an AUDIT_RECORD_DELETED entry exists documenting the deletion.
- **Expected Result**: Audit record deletion creates a meta-audit entry before the actual deletion occurs, ensuring the act of deleting audit records is itself tracked.

### TC-25-P31: Rate Limiting on Authentication Endpoints
- **Priority**: High
- **Regulation**: SS11.300(d) — Protect against unauthorized use
- **Preconditions**: None.
- **Test Data**: Any credentials.
- **Steps**:
  1. Send POST /api/auth/login 11 times in rapid succession (within 1 minute).
  2. Verify the first 10 requests return 200 or 401 (valid responses).
  3. Verify the 11th request returns 429 Too Many Requests.
  4. Send POST /api/auth/forgot-password 6 times in rapid succession (within 5 minutes).
  5. Verify the first 5 requests return 200 or 400 (valid responses).
  6. Verify the 6th request returns 429 Too Many Requests.
- **Expected Result**: Login is rate-limited to 10 requests per minute. Forgot-password is rate-limited to 5 requests per 5 minutes. Rate limiting protects against brute-force attacks.

### TC-25-P32: Secure Password Hashing (bcrypt)
- **Priority**: High
- **Regulation**: SS11.300(b) — Password confidentiality
- **Preconditions**: Direct database access.
- **Test Data**: Any user account.
- **Steps**:
  1. Query the `users` table: `SELECT password_hash FROM users WHERE username = 'admin';`
  2. Verify the `password_hash` starts with "$2b$" (bcrypt identifier).
  3. Verify the hash is 60 characters long (standard bcrypt output).
  4. Verify the plain-text password is NOT stored anywhere in the database.
  5. Create two users with the same password -- verify their hashes differ (bcrypt uses random salt).
- **Expected Result**: Passwords are stored as bcrypt hashes with random salt. Plain-text passwords never appear in the database, logs, or API responses.

### TC-25-P33: Unique User ID Enforcement
- **Priority**: High
- **Regulation**: SS11.300(a) — Unique to one individual
- **Preconditions**: Authenticated as ADMIN.
- **Test Data**: Two user creation payloads with the same username.
- **Steps**:
  1. Create user with username "testuser01".
  2. Attempt to create another user with the same username "testuser01".
  3. Verify the second attempt returns a 409 Conflict or 400 error indicating duplicate username.
  4. Verify the user ID format follows the configurable pattern (via /api/config/user-id).
- **Expected Result**: Usernames are globally unique. The system prevents duplicate ID codes, ensuring each electronic signature is uniquely attributable.

### TC-25-P34: Backup Integrity with Checksums
- **Priority**: Medium
- **Regulation**: SS11.10(c) — Protection of records for accurate retrieval
- **Preconditions**: Authenticated as ADMIN with EXPORT_BACKUP permission. Reauth enabled for Backup category.
- **Test Data**: ADMIN credentials for reauth.
- **Steps**:
  1. Send GET /api/backup/export with reauth password.
  2. Verify the backup file is downloaded.
  3. Inspect the backup contents for checksum information.
  4. Send POST /api/backup/validate with the backup file.
  5. Verify the backup passes validation (checksums match).
  6. Manually alter the backup file contents.
  7. Send POST /api/backup/validate with the altered backup.
  8. Verify validation fails (checksum mismatch detected).
- **Expected Result**: Backup files include integrity checksums. Validation detects any modification to the backup data.

### TC-25-P35: Single-Tab Enforcement via localStorage Heartbeat
- **Priority**: Medium
- **Regulation**: SS11.10(d) — Limit system access
- **Preconditions**: Logged in via browser.
- **Test Data**: None.
- **Steps**:
  1. Login in browser Tab 1 -- verify dashboard loads.
  2. Open a new tab (Tab 2) to the same app URL.
  3. Verify Tab 2 detects the existing session and shows "Duplicate Tab" warning.
  4. Verify Tab 2 offers "Take Over" option.
  5. Click "Take Over" in Tab 2.
  6. Verify Tab 1 detects it is no longer the active tab.
- **Expected Result**: useSingleTab hook enforces single-tab usage via localStorage heartbeat (1s interval, 3s timeout). This prevents a single authenticated session from being used across multiple browser tabs simultaneously.

### TC-25-P36: SUPER_ADMIN Audit Exemption
- **Priority**: High
- **Regulation**: SS11.10(e) — 21 CFR Part 11 SUPER_ADMIN exemption (by design)
- **Preconditions**: Authenticated as SUPER_ADMIN.
- **Test Data**: None.
- **Steps**:
  1. Login as SUPER_ADMIN.
  2. Perform various actions: create a user, update a config, delete a role.
  3. Send GET /api/audit?period=today as SUPER_ADMIN.
  4. Verify NO audit records with `userRole: "SUPER_ADMIN"` appear in the results.
  5. Verify the audit module code checks `if (entry.userRole === 'SUPER_ADMIN') return;` to skip logging.
- **Expected Result**: SUPER_ADMIN actions are intentionally exempt from audit logging. This is a documented regulatory design decision for the system administrator role.

---

## Negative Test Cases

### TC-25-N01: Access Protected Endpoint Without Authentication
- **Priority**: High
- **Regulation**: SS11.10(d) — Limiting access to authorized individuals
- **Preconditions**: No authentication token.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/users without Authorization header.
  2. Verify 401 with `{ error: "UNAUTHORIZED", message: "Missing token" }`.
  3. Send GET /api/audit without Authorization header.
  4. Verify 401.
  5. Send POST /api/assets/instances without Authorization header.
  6. Verify 401.
- **Expected Result**: All protected endpoints reject unauthenticated requests with 401 Unauthorized.

### TC-25-N02: Access Endpoint with Expired JWT
- **Priority**: High
- **Regulation**: SS11.10(d), SS11.200 — Token security
- **Preconditions**: An expired or invalid JWT.
- **Test Data**: Manually crafted expired JWT or JWT signed with wrong secret.
- **Steps**:
  1. Send GET /api/auth/me with `Authorization: Bearer expired.jwt.token`.
  2. Verify 401 with error "TOKEN_EXPIRED" or "Invalid or expired token".
  3. Send GET /api/auth/me with `Authorization: Bearer malformed_token`.
  4. Verify 401.
  5. Send GET /api/auth/me with `Authorization: Bearer ` (empty token after Bearer).
  6. Verify 401.
- **Expected Result**: Invalid, expired, or malformed tokens are all rejected.

### TC-25-N03: Bypass Reauth by Omitting Password
- **Priority**: High
- **Regulation**: SS11.100 — Signature verification bypass attempt
- **Preconditions**: Authenticated as ADMIN. Reauth enabled for CREATE_USER.
- **Test Data**: Valid user creation payload WITHOUT _currentPassword.
- **Steps**:
  1. Send POST /api/users with a valid user body but no `_currentPassword` field and no `x-reauth-password` header.
  2. Verify 401 with `{ error: "REAUTH_REQUIRED", message: "This action requires password re-authentication.", action: "CREATE_USER" }`.
  3. Attempt with `_currentPassword: ""` (empty string).
  4. Verify rejection (empty password fails bcrypt verification).
  5. Attempt with `_currentPassword: "wrong_password"`.
  6. Verify 401 with `{ error: "REAUTH_FAILED", message: "Incorrect password. Please try again." }`.
- **Expected Result**: Reauth cannot be bypassed. Empty passwords, missing passwords, and wrong passwords all fail. The enforceReauth function validates via bcrypt comparison.

### TC-25-N04: Bypass RBAC with Lower-Privilege Role
- **Priority**: High
- **Regulation**: SS11.10(d), SS11.10(g) — Authority checks
- **Preconditions**: Authenticated as VIEWER role.
- **Test Data**: VIEWER user credentials.
- **Steps**:
  1. Login as VIEWER.
  2. Send POST /api/assets/instances (create entity) -- verify 403.
  3. Send PUT /api/assets/instances/{id} (update entity) -- verify 403.
  4. Send DELETE /api/assets/instances/{id} (delete entity) -- verify 403.
  5. Send POST /api/users (create user) -- verify 403.
  6. Send PUT /api/config/password-policy -- verify 403.
  7. Send POST /api/roles -- verify 403.
- **Expected Result**: VIEWER cannot perform any write operations. The `requirePermission` and `requireRole` decorators enforce role-based access. 403 Forbidden on all unauthorized attempts.

### TC-25-N05: Attempt to Reuse Password Within History Window
- **Priority**: High
- **Regulation**: SS11.300(b) — Password reuse prevention
- **Preconditions**: Password history count set to 3. User has changed password twice.
- **Test Data**: User's current and previous passwords.
- **Steps**:
  1. Set passwordHistoryCount to 3 via PUT /api/config/password-policy.
  2. User has password history: Pass1 -> Pass2 -> Pass3 (current).
  3. Attempt POST /api/auth/change-password with newPassword = "Pass1".
  4. Verify rejection with error indicating password was recently used.
  5. Attempt with newPassword = "Pass2".
  6. Verify rejection.
  7. Attempt with newPassword = "Pass3" (same as current).
  8. Verify rejection (cannot reuse current password).
- **Expected Result**: All passwords within the history window are rejected. The PasswordHistory model tracks bcrypt hashes of previous passwords.

### TC-25-N06: Attempt to Use Disabled Account Token
- **Priority**: High
- **Regulation**: SS11.10(d) — Access revocation
- **Preconditions**: User has an active session. ADMIN can disable accounts.
- **Test Data**: Test user JWT token.
- **Steps**:
  1. Login as test user, save TOKEN.
  2. As ADMIN, send POST /api/users/{id}/disable to disable the test user.
  3. Use TOKEN to send GET /api/auth/me.
  4. Verify 401 with error "ACCOUNT_INACTIVE" and message "Account is not active".
- **Expected Result**: Disabling an account immediately revokes access even if a valid session exists. The auth plugin checks user status on every request.

### TC-25-N07: Attempt to Tamper with Audit Checksum Field
- **Priority**: High
- **Regulation**: SS11.10(e) — Checksum integrity
- **Preconditions**: Direct database access. Valid audit record exists.
- **Test Data**: Audit record ID.
- **Steps**:
  1. Get an audit record ID from GET /api/audit.
  2. Note the current `checksum` value.
  3. Update the checksum in the DB to a different hash: `UPDATE audit_trail SET checksum = 'aaaa...aaaa' WHERE id = <id>;`
  4. Send GET /api/audit/{id}.
  5. Verify `integrityValid: false`.
  6. Revert the checksum.
- **Expected Result**: Altering the checksum itself is also detected because the recomputed hash will not match the tampered checksum. Both data tampering and checksum tampering are caught.

### TC-25-N08: Attempt to Access Endpoints During Forced Password Change
- **Priority**: High
- **Regulation**: SS11.300(b) — First-login password management
- **Preconditions**: User with `forcePasswordChange: true`.
- **Test Data**: User credentials for a force-password-change user.
- **Steps**:
  1. Login as a user with `forcePasswordChange: true`.
  2. Attempt GET /api/users -- verify 403 FORCE_PASSWORD_CHANGE.
  3. Attempt GET /api/assets/instances -- verify 403 FORCE_PASSWORD_CHANGE.
  4. Attempt POST /api/audit -- verify 403 FORCE_PASSWORD_CHANGE.
  5. Verify GET /api/auth/me returns 200 (allowed during force change).
  6. Verify POST /api/auth/change-password returns 200 (allowed).
  7. Verify POST /api/auth/logout returns 200 (allowed).
  8. Verify GET /api/config/password-policy returns 200 (allowed, needed by password change form).
- **Expected Result**: Only 4 endpoints are accessible during forced password change. All other endpoints return 403. The whitelist is enforced server-side in the auth plugin.

### TC-25-N09: Attempt to Use Session After Absolute Timeout
- **Priority**: High
- **Regulation**: SS11.10(d) — Session duration limits
- **Preconditions**: Active session with DB access.
- **Test Data**: Session ID.
- **Steps**:
  1. Login and get session ID.
  2. Set createdAt to 24 hours and 1 minute ago in DB.
  3. Also set expiresAt to 1 hour in the future (simulating sliding window extension).
  4. Send GET /api/auth/me.
  5. Verify 401 SESSION_EXPIRED -- the absolute timeout takes precedence over the sliding window.
- **Expected Result**: Even with a valid expiresAt (from sliding window), the absolute 24h timeout is enforced independently. The auth plugin checks `Date.now() - session.createdAt.getTime() > MAX_ABSOLUTE_SESSION_MS`.

### TC-25-N10: Attempt to Create User with Weak Password
- **Priority**: High
- **Regulation**: SS11.300(b) — Password strength
- **Preconditions**: Password policy has all complexity requirements enabled. minLength: 8.
- **Test Data**: Various weak passwords.
- **Steps**:
  1. Attempt to create user with password "12345" -- verify rejection (too short).
  2. Attempt with "abcdefgh" -- verify rejection (no uppercase, no numbers, no special).
  3. Attempt with "ABCDEFGH" -- verify rejection (no lowercase, no numbers, no special).
  4. Attempt with "Abcdefg1" -- verify rejection (no special characters).
  5. Attempt with "Abcde@1" -- verify rejection (too short, only 7 chars).
- **Expected Result**: All weak passwords are rejected with specific error messages indicating which complexity requirements are not met.

### TC-25-N11: Attempt to Login with Locked Account
- **Priority**: High
- **Regulation**: SS11.300(d) — Account lockout enforcement
- **Preconditions**: User account is locked (status: LOCKED after N failed attempts).
- **Test Data**: Locked account credentials with CORRECT password.
- **Steps**:
  1. Lock an account by exceeding the failed attempt limit (see TC-25-P24).
  2. Attempt login with the CORRECT username and CORRECT password.
  3. Verify 401 -- account is locked regardless of correct credentials.
  4. Verify the error message indicates the account is locked.
  5. Wait for any configured auto-unlock duration (if applicable) OR have admin unlock.
  6. After unlock, login with correct credentials -- verify success.
- **Expected Result**: Locked accounts cannot authenticate even with correct credentials. Only administrator unlock (POST /api/users/{id}/unlock) restores access.

### TC-25-N12: Attempt to Bypass trustProxy for IP Spoofing
- **Priority**: Medium
- **Regulation**: SS11.10(e) — Accurate IP logging for non-repudiation
- **Preconditions**: Application configured with trustProxy: 1.
- **Test Data**: Crafted X-Forwarded-For header.
- **Steps**:
  1. Send a request with header `X-Forwarded-For: 1.2.3.4, 5.6.7.8, 9.10.11.12`.
  2. Perform an auditable action.
  3. Check the audit record's `ipAddress`.
  4. Verify the IP address is the LAST trusted proxy hop (not the first, attacker-controlled value).
  5. With `trustProxy: 1`, only the rightmost-1 IP from X-Forwarded-For should be trusted.
- **Expected Result**: The trustProxy: 1 setting prevents IP spoofing. The system trusts exactly one proxy hop, so attacker-injected X-Forwarded-For values are ignored.

### TC-25-N13: Attempt to Delete Audit Records as Non-SUPER_ADMIN
- **Priority**: High
- **Regulation**: SS11.10(e) — Audit trail protection
- **Preconditions**: Authenticated as ADMIN (not SUPER_ADMIN).
- **Test Data**: Valid audit record ID.
- **Steps**:
  1. Login as ADMIN.
  2. Send DELETE /api/audit/{id}.
  3. Verify 403 Forbidden.
  4. Send POST /api/audit/bulk-delete with `{ "ids": [1, 2, 3] }`.
  5. Verify 403 Forbidden.
  6. Login as OPERATOR -- verify same 403 on both endpoints.
  7. Login as VIEWER -- verify same 403.
- **Expected Result**: Only SUPER_ADMIN can delete audit records. All other roles receive 403 Forbidden.

### TC-25-N14: Attempt to Modify Signed Record After Signature
- **Priority**: High
- **Regulation**: SS11.70 — Signatures cannot be excised or copied
- **Preconditions**: An electronic signature exists linked to a checklist review. Direct DB access.
- **Test Data**: Signed checklist review ID.
- **Steps**:
  1. Find a signed checklist review via the electronic_signatures table.
  2. Note the `recordHash` value.
  3. Directly modify the checklist review record in the database (e.g., change a response value).
  4. Recompute a hash of the modified record.
  5. Compare with the stored `recordHash`.
  6. Verify the hashes do NOT match -- the signature is no longer valid for the modified record.
- **Expected Result**: The recordHash in the electronic signature no longer matches the modified record. Any modification to a signed record breaks the cryptographic link, making the tampering detectable.

### TC-25-N15: Attempt to Forge Electronic Signature
- **Priority**: High
- **Regulation**: SS11.50, SS11.70 — Signature authenticity
- **Preconditions**: Direct database access.
- **Test Data**: Forged signature record.
- **Steps**:
  1. Attempt to insert a record into `electronic_signatures` with a fabricated `signatureHash`.
  2. The `signatureHash` should be SHA-256(recordHash + signerUserId + signedAt).
  3. Without knowing the exact values used during legitimate signing, the hash will not match.
  4. Query the signature and attempt to verify it against the linked record.
  5. Verify that the signature verification detects the mismatch.
  6. Verify that `reAuthVerified` would be false if the forger could not provide valid reauth.
- **Expected Result**: Forged signatures are detectable because the signatureHash is computed from specific inputs at signing time. Without access to the original signing context, a valid hash cannot be produced.

### TC-25-N16: Attempt to Access API with Manipulated JWT Claims
- **Priority**: High
- **Regulation**: SS11.200 — Signature component security
- **Preconditions**: Valid JWT from a VIEWER user.
- **Test Data**: JWT token with tampered role claim.
- **Steps**:
  1. Login as VIEWER and capture the JWT token.
  2. Decode the JWT, change the `role` claim from "VIEWER" to "SUPER_ADMIN".
  3. Re-encode the JWT (without the correct signing secret).
  4. Send GET /api/users with the manipulated token.
  5. Verify 401 -- JWT signature verification fails.
  6. Even if the JWT could be re-signed, verify that `requirePermission` checks the DB role, not the JWT claim.
- **Expected Result**: JWT manipulation is detected by signature verification (jose library). Additionally, the RBAC plugin fetches the user's role from the database, not from the JWT claims, providing defense in depth.

### TC-25-N17: Attempt Concurrent Sessions for Same User
- **Priority**: High
- **Regulation**: SS11.200(a) — Controlled session identification
- **Preconditions**: Valid user credentials.
- **Test Data**: Same user credentials.
- **Steps**:
  1. Login as user X from Client A -- get TOKEN_A. Verify GET /api/auth/me returns 200.
  2. Login as user X from Client B -- get TOKEN_B.
  3. Immediately send GET /api/auth/me with TOKEN_A.
  4. Verify TOKEN_A returns 401 SESSION_INVALID.
  5. Query the Session table: `SELECT COUNT(*) FROM "Session" WHERE "userId" = '<user-id>' AND "isActive" = true;`
  6. Verify count is exactly 1 (only TOKEN_B's session).
- **Expected Result**: The system strictly enforces single active session per user. The second login terminates the first session, preventing session sharing or concurrent usage.

### TC-25-N18: Attempt to Skip Reauth via Header Injection
- **Priority**: Medium
- **Regulation**: SS11.100 — Reauth enforcement
- **Preconditions**: Authenticated as ADMIN. Reauth enabled for CREATE_USER.
- **Test Data**: Various header manipulation attempts.
- **Steps**:
  1. Send POST /api/users with header `x-reauth-password: wrong_password`.
  2. Verify 401 REAUTH_FAILED.
  3. Send POST /api/users with body `{ ..., "_reauthVerified": true }` (attempting to set internal flag).
  4. Verify the `_reauthVerified` flag in the body is ignored -- reauth still enforced.
  5. Send POST /api/users with header `x-reauth-password: ` (empty value).
  6. Verify rejection (empty password fails bcrypt verification).
- **Expected Result**: Reauth cannot be bypassed through header injection, body manipulation, or empty values. The enforceReauth function always performs bcrypt verification when reauth is required.

### TC-25-N19: Attempt to Access System with Expired Password Without Changing
- **Priority**: High
- **Regulation**: SS11.300(b) — Periodic password revision enforcement
- **Preconditions**: User with expired password (passwordExpiresAt in the past).
- **Test Data**: Expired user credentials.
- **Steps**:
  1. Set a user's passwordExpiresAt to yesterday in the DB.
  2. Login as the user (login itself should succeed).
  3. Attempt to access 10 different endpoints: GET /api/users, GET /api/assets/instances, POST /api/assets/templates, GET /api/audit, GET /api/notifications, PUT /api/config/branding, GET /api/roles, GET /api/data/streams, GET /api/rule-chains, GET /api/queries/telemetry/keys.
  4. Verify ALL 10 return 403 PASSWORD_EXPIRED.
  5. Verify the user is effectively locked into the password change flow.
- **Expected Result**: Expired password blocks access to all endpoints except the 4 whitelisted paths (change-password, logout, me, password-policy). The server-side check in the auth plugin automatically sets `forcePasswordChange: true` when it detects an expired password.

### TC-25-N20: Attempt to Delete SUPER_ADMIN Audit Records That Do Not Exist
- **Priority**: Medium
- **Regulation**: SS11.10(e) — SUPER_ADMIN exemption verification
- **Preconditions**: Authenticated as SUPER_ADMIN. SUPER_ADMIN has performed actions.
- **Test Data**: None.
- **Steps**:
  1. Login as SUPER_ADMIN.
  2. Perform an action (e.g., create a role).
  3. Send GET /api/audit?userRole=SUPER_ADMIN.
  4. Verify the response returns 0 records (SUPER_ADMIN actions are never logged).
  5. Verify there is no way to reconstruct SUPER_ADMIN audit records because they were never created.
- **Expected Result**: SUPER_ADMIN audit records cannot be deleted because they were never created. The `auditLog()` function returns early when `entry.userRole === 'SUPER_ADMIN'`. This exemption is a deliberate regulatory design decision.


---

## Phase 2: Filter Management 21 CFR Compliance Test Cases

### TC-25-P37: Filter Stage Bypass Requires Reauth (Electronic Signature)
- **Priority**: High
- **Regulation**: SS11.100, SS11.50 — Electronic signature for deviation
- **Preconditions**: Active cleaning cycle at a STAGE node. Reauth enabled for BYPASS_FILTER_STAGE.
- **Test Data**: Filter instance ID, bypass reason.
- **Steps**:
  1. Attempt POST /api/filters/:id/bypass WITHOUT reauth password.
  2. Verify 401 REAUTH_REQUIRED with action BYPASS_FILTER_STAGE.
  3. Retry with _currentPassword — verify 200 success.
  4. Verify audit trail entry FILTER_STAGE_BYPASSED with deviation reason.
  5. Verify the bypass event includes the signer's identity (userId, role, IP).
- **Expected Result**: Stage bypass (deviation) requires electronic signature via reauth. Full audit trail captures the deviation for regulatory compliance.

### TC-25-P38: Filter Checklist Submission Audit Trail
- **Priority**: High
- **Regulation**: SS11.10(e) — Audit trail for filter operations
- **Preconditions**: Filter at a CHECKLIST node with pending checklist.
- **Test Data**: Checklist answers.
- **Steps**:
  1. Submit checklist answers via POST /api/filters/:id/submit-checklist.
  2. Query audit trail for FILTER_CHECKLIST_SUBMITTED action.
  3. Verify audit record includes question IDs, answers, and submitter identity.
  4. Verify integrityValid is true (SHA-256 checksum).
- **Expected Result**: Checklist submissions are fully audit-logged with answer data, supporting 21 CFR Part 11 traceability.

### TC-25-P39: Filter Cleaning Cycle Traceability
- **Priority**: High
- **Regulation**: SS11.10(a), SS11.10(e) — Accuracy and completeness of records
- **Preconditions**: A completed cleaning cycle exists.
- **Test Data**: Filter instance ID.
- **Steps**:
  1. Send GET /api/filter/cycles to list cycles.
  2. Verify cycle record includes startedAt, completedAt, all stage transitions.
  3. Send GET /api/filter/events to list events.
  4. Verify complete event chain: CYCLE_STARTED, STAGE_ADVANCED (for each stage), any BYPASS events, CHECKLIST_SUBMITTED events, CYCLE_COMPLETED.
  5. Verify each event has timestamp, userId, and details.
- **Expected Result**: Complete cleaning cycle traceability from start to completion with all intermediate events recorded.

### TC-25-N21: Filter Operations Without FILTER_OPERATE Permission
- **Priority**: High
- **Regulation**: SS11.10(d) — Limiting system access
- **Preconditions**: Authenticated as VIEWER (no FILTER_OPERATE permission).
- **Test Data**: Valid filter instance ID.
- **Steps**:
  1. Attempt POST /api/filters/:id/start-cycle — verify 403.
  2. Attempt POST /api/filters/:id/advance — verify 403.
  3. Attempt POST /api/filters/:id/submit-checklist — verify 403.
  4. Attempt POST /api/filters/:id/bypass — verify 403.
  5. Attempt GET /api/filters/:id/current-state — may be 403 (requires FILTER_VIEW).
- **Expected Result**: All filter operations blocked without appropriate permissions. RBAC enforces FILTER_OPERATE for write operations and FILTER_VIEW for read operations.

