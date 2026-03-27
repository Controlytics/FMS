# 21 CFR Part 11 Compliant Logbook - Backend Documentation

## System Architecture Overview

The backend follows a layered architecture with API Gateway/Routes, Middleware Layer, Service Layer, and Data Access Layer. PostgreSQL is used as the database. The system implements complete role-based access control with audit trail for all users except Super Admin.

**Architecture Layers:**

1. **API Gateway / Routes** - Auth Routes, Users Routes, Config Routes, Assets Routes, Audit Routes, Backup Routes
2. **Middleware Layer** - Auth Check, Role Check, Audit Logger, Session Validator, Rate Limiter
3. **Service Layer** - Auth Service, User Service, Config Service, Asset Service, Audit Service, Backup Service
4. **Data Access Layer** - PostgreSQL Database containing Users, Password History, Audit Trail, Config, Assets, Field ID Configuration, Backups tables

---

## 1. Database Schema

### 1.1 Users Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Unique identifier |
| user_id | VARCHAR(50) | UNIQUE, NOT NULL | User login ID (6-50 characters) |
| password_hash | VARCHAR(255) | NOT NULL | Hashed password |
| full_name | VARCHAR(100) | NOT NULL | User's full name |
| email | VARCHAR(100) | Valid email format | User email address |
| department | VARCHAR(50) | | User department |
| role | VARCHAR(20) | NOT NULL, CHECK constraint | SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER |
| status | VARCHAR(20) | DEFAULT 'ENABLED' | ENABLED, DISABLED, LOCKED, EXPIRED |
| failed_login_attempts | INT | DEFAULT 0 | Count of consecutive failed logins |
| last_failed_login | TIMESTAMP | | Last failed login attempt time |
| lockout_until | TIMESTAMP | | Temporary lockout expiry time |
| password_changed_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last password change |
| password_expires_at | TIMESTAMP | | Password expiry date |
| force_password_change | BOOLEAN | DEFAULT FALSE | Force password change on next login |
| is_temporary_password | BOOLEAN | DEFAULT FALSE | Indicates if using temporary password |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Record creation time |
| created_by | VARCHAR(50) | | Creator user ID |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |
| updated_by | VARCHAR(50) | | Last updater user ID |
| last_login | TIMESTAMP | | Last successful login |

**Indexes:** user_id, role, status, email

### 1.2 Password History Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| user_id | VARCHAR(50) | FOREIGN KEY REFERENCES users(user_id) | User reference |
| password_hash | VARCHAR(255) | NOT NULL | Historical password hash |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | When password was set |

**Index:** user_id, created_at DESC

**Trigger:** Cleanup trigger maintains only last N passwords based on configuration

**Important Rules:**
- Last N passwords (configurable count) cannot be reused
- Temporary password cannot be used as new password
- New password must be different from current temporary password

### 1.3 Audit Trail Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| timestamp | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Action timestamp |
| user_id | VARCHAR(50) | NOT NULL | Acting user ID |
| user_role | VARCHAR(20) | NOT NULL | User role at time of action |
| action | VARCHAR(50) | NOT NULL | Action performed |
| target_type | VARCHAR(50) | | Type of target (user, asset, config) |
| target_id | VARCHAR(100) | | Target identifier |
| previous_value | JSONB | | Value before change |
| new_value | JSONB | | Value after change |
| ip_address | VARCHAR(45) | | Client IP address |
| user_agent | TEXT | | Client user agent |
| session_id | VARCHAR(100) | | Session identifier |
| details | JSONB | | Additional details |
| checksum | VARCHAR(64) | NOT NULL | SHA-256 integrity checksum |

**Constraint:** CHECK (user_role != 'SUPER_ADMIN') - Ensures Super Admin actions are never logged

**Indexes:** timestamp DESC, user_id, action, target_type/target_id composite

**Valid Actions:** USER_CREATED, USER_UPDATED, USER_DELETED, USER_ENABLED, USER_DISABLED, PASSWORD_RESET, PASSWORD_CHANGED, ROLE_ASSIGNED, LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, SESSION_TIMEOUT, ACCOUNT_LOCKED, ACCOUNT_UNLOCKED, CONFIG_CHANGED, ASSET_CREATED, ASSET_MODIFIED, ASSET_DELETED, APPROVAL_REQUESTED, APPROVAL_GRANTED, APPROVAL_REJECTED, DATA_VIEWED, DATA_EXPORTED, UNAUTHORIZED_ACTION_ATTEMPT, BACKUP_CREATED, BACKUP_RESTORED

**Access:** Viewable by ALL authenticated users (all roles)

### 1.4 Field ID Configuration Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| field_id | VARCHAR(50) | UNIQUE, NOT NULL | Field identifier (FLD_MODULE_SEQ) |
| default_name | VARCHAR(100) | NOT NULL | Original field name |
| display_name | VARCHAR(100) | NOT NULL | Current display name |
| module | VARCHAR(50) | NOT NULL | Module the field belongs to |
| description | TEXT | | Field description |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |
| updated_by | VARCHAR(50) | | Super Admin who updated |

**Field ID Structure:** FLD_[MODULE]_[SEQUENCE]

**Default Field ID Entries:**

| Field ID | Default Name | Module |
|----------|--------------|--------|
| FLD_USER_001 | User ID | User Management |
| FLD_USER_002 | Full Name | User Management |
| FLD_USER_003 | Email | User Management |
| FLD_USER_004 | Department | User Management |
| FLD_USER_005 | Role | User Management |
| FLD_USER_006 | Status | User Management |
| FLD_ASSET_001 | Building Name | Asset Management |
| FLD_ASSET_002 | Block Name | Asset Management |
| FLD_ASSET_003 | Area Name | Asset Management |
| FLD_ASSET_004 | Device Name | Asset Management |
| FLD_ASSET_005 | Serial Number | Asset Management |
| FLD_ATTR_001 | Attribute Name | Attributes |
| FLD_TELE_001 | Telemetry Name | Telemetry |

**Update Behavior:**
- Only Super Admin can update field display names
- Changes propagate throughout entire application
- NOT recorded in audit trail (Super Admin action)

### 1.5 System Configuration Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| config_key | VARCHAR(100) | UNIQUE, NOT NULL | Configuration key |
| config_value | JSONB | NOT NULL | Configuration values |
| config_type | VARCHAR(50) | NOT NULL | Configuration category |
| requires_reauth | BOOLEAN | DEFAULT FALSE | Requires re-authentication |
| updated_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last update time |
| updated_by | VARCHAR(50) | | Updater user ID |

**Default Configurations:**

| Config Key | Config Type | Requires Re-Auth | Default Values |
|------------|-------------|------------------|----------------|
| password_policy | security | Yes | minLength: 8, maxLength: 128, requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true, minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecialChars: 1, preventReuseCount: 12, cannotBeUserId: true, cannotContainUserId: true, tempPasswordCannotBeNewPassword: true |
| password_expiry | security | Yes | enabled: true, maxAgeDays: 90, warningDays: 14 |
| login_security | security | Yes | maxFailedAttempts: 5, lockoutDurationMinutes: 30, lockoutType: TEMPORARY |
| session_config | security | Yes | autoLogoutEnabled: true, idleTimeoutMinutes: 15, warningMinutes: 2 |
| datetime_format | display | No | dateFormat: DD/MM/YYYY, timeFormat: 24-hour, timezone: UTC |

### 1.6 Sessions Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| user_id | VARCHAR(50) | FOREIGN KEY | User reference |
| session_token | VARCHAR(256) | UNIQUE, NOT NULL | Session token |
| ip_address | VARCHAR(45) | | Client IP |
| user_agent | TEXT | | Client user agent |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Session start |
| last_activity | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Last activity |
| expires_at | TIMESTAMP | NOT NULL | Session expiry |
| is_active | BOOLEAN | DEFAULT TRUE | Session active status |

**Indexes:** session_token, user_id, is_active/expires_at composite

### 1.7 Password Reset Requests Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| user_id | VARCHAR(50) | FOREIGN KEY | User requesting reset |
| status | VARCHAR(20) | DEFAULT 'PENDING' | PENDING, APPROVED, REJECTED, COMPLETED |
| requested_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Request time |
| processed_at | TIMESTAMP | | Processing time |
| processed_by | VARCHAR(50) | | Admin who processed |
| notes | TEXT | | Processing notes |

**Request Routing Rules:**
- Regular Users → Request visible to Admin AND Super Admin
- Admin Users → Request visible to Super Admin ONLY

**Password Reset Rules:**
- Admin provides TEMPORARY password only
- User MUST change password on first login after reset
- Temporary password CANNOT be used as new password
- Last N passwords (configurable) cannot be reused

### 1.8 Asset Management Tables

**Buildings Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Building name |
| location | VARCHAR(200) | Building location |
| floors | INT | Number of floors |
| area_sqft | DECIMAL(12,2) | Total area |
| status | VARCHAR(20) | Active/Inactive |
| created_at, created_by | | Creation metadata |
| updated_at, updated_by | | Update metadata |

**Blocks Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| building_id | UUID | Foreign key to buildings |
| name | VARCHAR(100) | Block name |
| floor | INT | Floor number |
| block_type | VARCHAR(50) | Block type |
| status | VARCHAR(20) | Active/Inactive |

**Areas Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| block_id | UUID | Foreign key to blocks |
| name | VARCHAR(100) | Area name |
| classification | VARCHAR(50) | Area classification |
| capacity | INT | Area capacity |
| status | VARCHAR(20) | Active/Inactive |

**Devices Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| area_id | UUID | Foreign key to areas |
| name | VARCHAR(100) | Device name |
| device_type | VARCHAR(50) | Device type |
| serial_number | VARCHAR(100) | Serial number |
| calibration_date | DATE | Last calibration |
| next_calibration_date | DATE | Next calibration due |
| status | VARCHAR(20) | Active/Inactive |

**Attributes Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR(100) | Attribute name |
| data_type | VARCHAR(50) | Data type |
| unit | VARCHAR(50) | Unit of measurement |
| min_value | DECIMAL | Minimum allowed value |
| max_value | DECIMAL | Maximum allowed value |
| status | VARCHAR(20) | Active/Inactive |

**Telemetry Table:**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| device_id | UUID | Foreign key to devices |
| name | VARCHAR(100) | Telemetry name |
| frequency_seconds | INT | Data collection frequency |
| data_type | VARCHAR(50) | Data type |
| status | VARCHAR(20) | Active/Inactive |

### 1.9 Asset Approval Requests Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| asset_type | VARCHAR(50) | CHECK constraint | BUILDING, BLOCK, AREA, DEVICE, ATTRIBUTE, TELEMETRY |
| action_type | VARCHAR(20) | CHECK constraint | CREATE, MODIFY, DELETE |
| asset_id | UUID | | Target asset ID (NULL for CREATE) |
| asset_data | JSONB | NOT NULL | Asset details |
| justification | TEXT | NOT NULL | Reason for request |
| status | VARCHAR(20) | DEFAULT 'PENDING' | PENDING, APPROVED, REJECTED |
| requested_by | VARCHAR(50) | NOT NULL | Maintenance user ID |
| requested_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Request time |
| reviewed_by | VARCHAR(50) | | Supervisor user ID |
| reviewed_at | TIMESTAMP | | Review time |
| review_notes | TEXT | | Review comments |

### 1.10 Backups Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PRIMARY KEY | Unique identifier |
| backup_name | VARCHAR(100) | NOT NULL | Backup display name |
| file_path | VARCHAR(500) | NOT NULL | Backup file location |
| file_size | BIGINT | | Backup file size in bytes |
| includes_user_data | BOOLEAN | DEFAULT TRUE | User data included |
| includes_config | BOOLEAN | DEFAULT TRUE | Configuration included |
| includes_assets | BOOLEAN | DEFAULT TRUE | Asset data included |
| includes_audit_trail | BOOLEAN | DEFAULT TRUE | Audit trail included |
| includes_telemetry | BOOLEAN | DEFAULT TRUE | Telemetry data included |
| created_at | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP | Backup creation time |
| created_by | VARCHAR(50) | NOT NULL | Creator user ID |
| status | VARCHAR(20) | DEFAULT 'COMPLETED' | PENDING, COMPLETED, FAILED |

**Access:** Admin and Super Admin only

---

## 2. API Endpoints

### 2.1 Authentication APIs

| Endpoint | Method | Description | Access |
|----------|--------|-------------|--------|
| /api/auth/login | POST | User login | Public |
| /api/auth/logout | POST | User logout | Authenticated |
| /api/auth/refresh | POST | Refresh token | Authenticated |
| /api/auth/change-password | POST | Change password | Authenticated |
| /api/auth/forgot-password | POST | Request password reset | Public |
| /api/auth/verify | POST | Re-authenticate for sensitive operations | Authenticated |

**Login Request:** userId, password

**Login Response (Success):** success, token, user (userId, fullName, role, forcePasswordChange, isTemporaryPassword), expiresIn

**Login Response (Temporary Password):** forcePasswordChange: true, isTemporaryPassword: true - User must change password before proceeding

**Login Error Handling:**

| Condition | Error Code | Response | Attempts Count |
|-----------|------------|----------|----------------|
| User ID does not exist | INVALID_CREDENTIALS | "Invalid user ID or password." | NOT included |
| Wrong password (user exists) | INVALID_CREDENTIALS | "Invalid user ID or password." | Included (attemptsRemaining: X) |
| Account locked | ACCOUNT_LOCKED | "Account locked due to multiple failed attempts." | NOT included |
| Account disabled | ACCOUNT_DISABLED | "Your account has been disabled." | NOT included |
| Password expired | PASSWORD_EXPIRED | "Your password has expired." | NOT included |
| Temporary password login | TEMPORARY_PASSWORD_REQUIRED | Redirect to password change | NOT included |

**Security Note:** For non-existent User IDs, the response message is identical to wrong password BUT does NOT include the attemptsRemaining count. This prevents attackers from:
- Identifying valid User IDs through error message differences
- Enumerating valid accounts in the system
- The failed attempt counter is NOT incremented for non-existent users

**Change Password Request:** currentPassword, newPassword, confirmPassword

**Change Password Validation:**
- New password must meet all policy requirements
- New password cannot be same as temporary password
- New password cannot match last N passwords (configurable)
- New password cannot be same as User ID or contain User ID

**Forgot Password Flow:**
1. User submits userId
2. System creates password reset request
3. Request routed to Admin (regular users) or Super Admin only (Admin users)
4. Admin provides TEMPORARY password
5. User logs in with temporary password
6. User MUST change password immediately (cannot skip)
7. Temporary password cannot be the new password

### 2.2 User Management APIs

| Endpoint | Method | Description | Access | Audit |
|----------|--------|-------------|--------|-------|
| /api/users | POST | Create user | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users | GET | List users | Super Admin, Admin | No |
| /api/users/:userId | GET | Get user details | Super Admin, Admin | No |
| /api/users/:userId | PUT | Update user | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users/:userId | DELETE | Delete user | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users/:userId/enable | POST | Enable account | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users/:userId/disable | POST | Disable account | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users/:userId/unlock | POST | Unlock account | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/users/:userId/reset-password | POST | Reset password | Super Admin, Admin | Super Admin: No, Admin: Yes |

**User Creation Rules:**
- User ID must be unique (6-50 characters)
- Password must meet policy requirements
- Admin provides TEMPORARY password only
- forcePasswordChange is MANDATORY (always true)
- isTemporaryPassword is set to true
- Super Admin can create all roles
- Admin can create Admin and below

**Password Reset Rules:**
- Reset provides TEMPORARY password only
- User MUST change password on first login
- Temporary password CANNOT be used as new password
- Last N passwords (configurable count) cannot be reused
- Admin password reset requests go to Super Admin only

**Query Parameters for List:** role, status, search, page, limit

### 2.3 Configuration APIs

| Endpoint | Method | Description | Access | Re-Auth Required |
|----------|--------|-------------|--------|------------------|
| /api/config/password-policy | GET/PUT | Password policy | Super Admin, Admin | Yes (PUT) |
| /api/config/password-expiry | GET/PUT | Password expiry | Super Admin, Admin | Yes (PUT) |
| /api/config/login-security | GET/PUT | Login security | Super Admin, Admin | Yes (PUT) |
| /api/config/session | GET/PUT | Session settings | Super Admin, Admin | Yes (PUT) |
| /api/config/datetime | GET/PUT | Date/time format | Super Admin, Admin | No |
| /api/config/field-ids | GET | Get field ID names | All Users | No |
| /api/config/field-ids/:fieldId | PUT | Update field name | Super Admin ONLY | No |

**Password Policy Configuration:**
- minLength (8-32)
- maxLength (32-128)
- requireUppercase, minUppercase
- requireLowercase, minLowercase
- requireNumbers, minNumbers
- requireSpecialChars, minSpecialChars
- preventReuseCount (1-24) - Last N passwords cannot be reused
- cannotBeUserId (true/false)
- cannotContainUserId (true/false)
- tempPasswordCannotBeNewPassword (always true)

**Login Security Configuration:**
- maxFailedAttempts (3-10)
- lockoutType: TEMPORARY or PERMANENT
- lockoutDurationMinutes (15-1440) - For temporary lockout

**Session Configuration:**
- autoLogoutEnabled (true/false)
- idleTimeoutMinutes (5-60)
- warningMinutes (1-5)

**Date/Time Format Configuration:**
- dateFormat: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MMM-YYYY, MMM DD, YYYY
- timeFormat: 12-hour, 24-hour
- timezone: All timezones

**Field ID Name Update (Super Admin Only):**
- Updates display_name for specified field_id
- Change propagates throughout entire application
- NOT recorded in audit trail

### 2.4 Password Reset Request APIs

| Endpoint | Method | Description | Access |
|----------|--------|-------------|--------|
| /api/password-reset-requests | GET | Get pending requests | Super Admin, Admin |
| /api/password-reset-requests/:id/process | POST | Process request | Super Admin, Admin |

**Request Visibility:**
- Admin sees requests from non-Admin users only
- Super Admin sees all requests including Admin requests

**Process Request:**
- action: APPROVE or REJECT
- newPassword: Temporary password (required for APPROVE)
- forcePasswordChange: Always true (mandatory)
- notes: Processing notes

**Important:** Password provided is TEMPORARY only. User must change on first login.

### 2.5 Asset Management APIs

**Asset Request Endpoints (Maintenance Role):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/asset-requests | POST | Create asset request |
| /api/asset-requests/my-requests | GET | Get my requests |

**Approval Endpoints (Supervisor Role):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/asset-requests/pending | GET | Get pending approvals |
| /api/asset-requests/:id/approve | POST | Approve request |
| /api/asset-requests/:id/reject | POST | Reject request |

**Execute Approved Actions (Maintenance Role):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/asset-requests/:id/execute | POST | Execute approved request |

**Asset Read Endpoints (All Roles):**

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/assets/buildings | GET | List buildings |
| /api/assets/buildings/:id | GET | Get building details |
| /api/assets/blocks | GET | List blocks |
| /api/assets/blocks/:id | GET | Get block details |
| /api/assets/areas | GET | List areas |
| /api/assets/areas/:id | GET | Get area details |
| /api/assets/devices | GET | List devices |
| /api/assets/devices/:id | GET | Get device details |
| /api/assets/attributes | GET | List attributes |
| /api/assets/attributes/:id | GET | Get attribute details |
| /api/assets/telemetry | GET | List telemetry |
| /api/assets/telemetry/:id | GET | Get telemetry details |

### 2.6 Audit Trail APIs

| Endpoint | Method | Description | Access |
|----------|--------|-------------|--------|
| /api/audit | GET | Query audit trail | ALL authenticated users |
| /api/audit/:id | GET | Get audit record details | ALL authenticated users |
| /api/audit/export | GET | Export audit trail | ALL authenticated users |

**Query Parameters:**
- startDate: ISO date string
- endDate: ISO date string
- userId: Filter by user
- action: Filter by action type
- targetType: Filter by target type
- page: Page number
- limit: Items per page

**Export Formats:** CSV, PDF, XLSX

**Note:** Super Admin actions are NOT recorded and will not appear in audit trail

### 2.7 Manual Backup APIs

| Endpoint | Method | Description | Access | Audit |
|----------|--------|-------------|--------|-------|
| /api/backups | GET | List backups | Super Admin, Admin | No |
| /api/backups | POST | Create backup | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/backups/:id | GET | Get backup details | Super Admin, Admin | No |
| /api/backups/:id/restore | POST | Restore backup | Super Admin, Admin | Super Admin: No, Admin: Yes |
| /api/backups/:id | DELETE | Delete backup | Super Admin, Admin | Super Admin: No, Admin: Yes |

**Create Backup Request:**
- backupName: Display name for backup
- includeUserData: true/false
- includeConfig: true/false
- includeAssets: true/false
- includeAuditTrail: true/false
- includeTelemetry: true/false

**Backup Response:**
- id, backupName, filePath, fileSize, created_at, created_by, includes_*

---

## 3. Middleware Layer

### 3.1 Authentication Middleware

**Function:** Validates JWT token and session for all protected routes

**Process:**
1. Extract Bearer token from Authorization header
2. Verify JWT signature and expiration
3. Check session validity in database
4. Verify user account status (ENABLED)
5. Attach user and session to request object
6. Update session last activity timestamp

**Error Responses:**
- 401 UNAUTHORIZED - Missing or invalid token
- 401 SESSION_INVALID - Session expired or invalid
- 401 ACCOUNT_INACTIVE - Account disabled/locked
- 401 TOKEN_EXPIRED - JWT expired

### 3.2 Role Authorization Middleware

**Function:** Enforces role-based access control for endpoints

**Process:**
1. Verify user is authenticated
2. Check if user role is in allowed roles list
3. If unauthorized, log attempt (except Super Admin)
4. Return 403 FORBIDDEN with details

**Unauthorized Action Response:**
- error: FORBIDDEN
- message: Permission denied
- requiredRoles: List of allowed roles
- yourRole: User's current role

### 3.3 Audit Trail Middleware

**Function:** Automatically logs actions to audit trail

**Process:**
1. Check if user is Super Admin (skip logging if true)
2. Capture original response
3. On successful response, create audit entry
4. Generate SHA-256 checksum for integrity
5. Store in audit_trail table

**Audit Entry Fields:**
- userId, userRole, action, targetType, targetId
- previousValue, newValue
- ipAddress, userAgent, sessionId
- details, checksum

### 3.4 Re-Authentication Middleware

**Function:** Requires password verification for sensitive operations

**Used For:** Password policy, login security, session config changes

**Process:**
1. Check for X-Verification-Token header
2. Verify token signature and expiration
3. Validate token belongs to current user
4. Validate token purpose matches operation
5. Allow request to proceed if valid

**Verification Token:** Valid for 5 minutes after re-authentication

---

## 4. Service Layer

### 4.1 Password Validation Service

**Functions:**
- validatePassword(password, userId) - Validates against policy
- checkPasswordHistory(password, userId) - Checks against last N passwords
- checkTemporaryPasswordReuse(newPassword, temporaryPassword) - Ensures temp password not reused
- hashPassword(password) - Hashes with bcrypt (12 rounds)
- verifyPassword(password, hash) - Verifies password against hash

**Validation Rules:**
- Minimum/maximum length
- Uppercase letter count
- Lowercase letter count
- Number count
- Special character count
- Cannot be same as User ID
- Cannot contain User ID
- Cannot match temporary password
- Cannot match last N passwords (configurable)

### 4.2 Login Security Service

**Functions:**
- authenticateUser(userId, password) - Main authentication function
- handleFailedLogin(userId, ipAddress, userAgent) - Increments failed attempts, locks if threshold reached
- handleSuccessfulLogin(userId) - Resets failed attempts, updates last login
- checkAccountLockout(userId) - Checks if account is locked/disabled/expired
- checkUserExists(userId) - Checks if user ID exists in system

**Authentication Process:**
1. Check if User ID exists in database
2. If User ID does NOT exist:
   - Return INVALID_CREDENTIALS error
   - Do NOT include attemptsRemaining in response
   - Do NOT increment any failed attempt counter
   - Response message: "Invalid user ID or password."
3. If User ID exists, verify password
4. If password is wrong:
   - Increment failed_login_attempts for this user
   - Return INVALID_CREDENTIALS error WITH attemptsRemaining
   - Response message: "Invalid user ID or password."

**Security Rationale:** Same error message for both cases prevents user enumeration attacks. The attemptsRemaining field is the only differentiator, visible only to legitimate users who mistyped their password.

**Lockout Process:**
1. Increment failed_login_attempts (only for existing users)
2. If attempts >= maxFailedAttempts:
   - Set status to LOCKED
   - If TEMPORARY lockout, set lockout_until
   - Log ACCOUNT_LOCKED action (unless Super Admin)
   - Notify administrators
3. Return lockout status and remaining attempts

**Auto-Unlock (Temporary Lockout):**
- Check lockout_until on login attempt
- If expired, reset to ENABLED status

### 4.3 Session Management Service

**Functions:**
- createSession(user, ipAddress, userAgent) - Creates session and JWT
- updateSessionActivity(sessionId) - Refreshes session expiry
- invalidateSession(sessionId) - Ends single session
- invalidateAllUserSessions(userId) - Ends all user sessions
- getSessionByToken(token) - Retrieves session details

**Session Token:** 32 random bytes, hex encoded

**JWT Contents:** userId, role, sessionId

### 4.4 Temporary Password Service

**Functions:**
- setTemporaryPassword(userId, password, adminUserId) - Sets temp password with flags
- validatePasswordChange(userId, newPassword, currentTempPassword) - Validates new password is not temp password
- clearTemporaryPasswordFlag(userId) - Clears flag after successful change

**Temporary Password Rules:**
1. is_temporary_password flag set to TRUE
2. force_password_change flag set to TRUE
3. User cannot access any features until password changed
4. New password must pass all validation including:
   - Not equal to temporary password
   - Not in last N password history
   - Meet all policy requirements

### 4.5 Audit Trail Service

**Functions:**
- logAuditTrail(entry) - Creates audit record with checksum
- queryAuditTrail(filters, pagination) - Queries with filters
- generateChecksum(data) - Creates SHA-256 checksum for integrity

**Checksum Generation:**
- Combines timestamp, userId, action, targetId, newValue
- Hashed with SHA-256
- Stored with record for integrity verification

### 4.6 Field ID Service

**Functions:**
- getFieldDisplayName(fieldId) - Gets current display name
- updateFieldDisplayName(fieldId, newName, updatedBy) - Updates display name (Super Admin only)
- getAllFieldNames() - Gets all field ID mappings
- propagateFieldNameChange(fieldId, newName) - Updates all UI references

**Update Behavior:**
- Only Super Admin can update
- Change affects entire application
- NOT recorded in audit trail

### 4.7 Backup Service

**Functions:**
- createBackup(options, userId) - Creates database backup
- restoreBackup(backupId, userId) - Restores from backup
- listBackups() - Lists available backups
- deleteBackup(backupId, userId) - Removes backup file

**Backup Contents (Configurable):**
- User Data: users, password_history, sessions
- Configuration: system_configuration, field_id_configuration
- Asset Data: buildings, blocks, areas, devices, attributes, telemetry
- Audit Trail: audit_trail (if included)
- Telemetry Data: telemetry readings (if included)

---

## 5. Date/Time Formatting Service

**Functions:**
- formatDateTime(date, includeTime) - Formats date/time per configuration
- formatDateOnly(date) - Formats date only
- formatTimeOnly(date) - Formats time only
- formatAllDates(obj) - Recursively formats all dates in object

**Date Format Mappings:**
- DD/MM/YYYY → dd/MM/yyyy
- MM/DD/YYYY → MM/dd/yyyy
- YYYY-MM-DD → yyyy-MM-dd (ISO Standard)
- DD-MMM-YYYY → dd-MMM-yyyy
- MMM DD, YYYY → MMM dd, yyyy

**Time Format Mappings:**
- 12-hour → hh:mm:ss a
- 24-hour → HH:mm:ss

**Timezone:** Applies configured timezone to all date/time values

---

## 6. User Creation Rules

### 6.1 User Creation Process

1. Validate User ID uniqueness (6-50 characters)
2. Validate temporary password against policy
3. Check role creation permissions
4. Hash password with bcrypt
5. Calculate password expiry (if enabled)
6. Create user record with:
   - force_password_change: TRUE (mandatory)
   - is_temporary_password: TRUE
   - status: ENABLED (or as specified)
7. Add password to history
8. Log audit trail (Admin only, not Super Admin)

### 6.2 Role Creation Permissions

| Creator Role | Can Create |
|--------------|------------|
| SUPER_ADMIN | All roles (SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER) |
| ADMIN | ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER |

### 6.3 First Login After User Creation

1. User logs in with temporary password
2. System returns forcePasswordChange: true, isTemporaryPassword: true
3. User is redirected to mandatory password change screen
4. User enters: current (temporary) password, new password, confirm password
5. System validates:
   - New password meets all policy requirements
   - New password is NOT same as temporary password
   - New password is NOT in last N password history
6. On success:
   - Password updated
   - force_password_change set to FALSE
   - is_temporary_password set to FALSE
   - User can access application

---

## 7. Security Best Practices

### 7.1 Environment Variables

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| JWT_SECRET | JWT signing secret (min 256 bits) |
| VERIFICATION_TOKEN_SECRET | Re-authentication token secret |
| SESSION_SECRET | Session secret |
| BCRYPT_ROUNDS | Password hashing rounds (12 recommended) |
| PORT | Server port |
| NODE_ENV | Environment (production/development) |
| ALLOWED_ORIGINS | CORS allowed origins |
| RATE_LIMIT_WINDOW_MS | Rate limit window |
| RATE_LIMIT_MAX_REQUESTS | Max requests per window |

### 7.2 Security Headers

| Header | Configuration |
|--------|---------------|
| Content-Security-Policy | default-src 'self', restrictive directives |
| Referrer-Policy | strict-origin-when-cross-origin |
| Strict-Transport-Security | max-age 1 year, includeSubDomains, preload |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | enabled |
| X-Powered-By | hidden |

### 7.3 Rate Limiting

| Limiter | Window | Max Requests |
|---------|--------|--------------|
| General API | 15 minutes | 100 requests |
| Login Attempts | 15 minutes | 10 attempts |
| Password Reset | 1 hour | 3 requests |

---

## 8. Compliance Checklist

### 21 CFR Part 11 Backend Compliance

| Requirement | Implementation | Status |
|-------------|----------------|--------|
| Unique user identification | Unique User IDs with database constraint | Compliant |
| Password complexity | Configurable policy with validation service | Compliant |
| Password history | Password history table with configurable depth | Compliant |
| Password expiration | Configurable expiry with automatic status change | Compliant |
| Temporary password restriction | Cannot be used as new password | Compliant |
| Account lockout | Configurable failed attempts with auto-lock | Compliant |
| Session timeout | Configurable idle timeout with auto-logout | Compliant |
| Audit trail | Complete action logging with checksums | Compliant |
| Audit trail access | Viewable by ALL authenticated users | Compliant |
| Super Admin exemption | Audit middleware skips SUPER_ADMIN | Compliant |
| Role-based access | Middleware enforces role permissions | Compliant |
| Record integrity | SHA-256 checksums on audit records | Compliant |
| Re-authentication | Required for sensitive config changes | Compliant |
| Password cannot be User ID | Validated in password service | Compliant |
| Restricted operations | Server-side validation of Copy/Paste/Delete | Compliant |
| Field ID configurability | Super Admin can rename fields globally | Compliant |
| Manual backup | Admin/Super Admin access with audit | Compliant |
| Super Admin all privileges | Full unrestricted access | Compliant |
| User enumeration prevention | Same error message for non-existent users | Compliant |
| Login attempt tracking | Only tracked for existing users | Compliant |

---

*Document Version: 2.0*
*Last Updated: 2026-03-07*
*Compliance Standard: 21 CFR Part 11*
*Status: All features COMPLETE — 145+ API endpoints, 30 Prisma models, 7 TimescaleDB hypertables, 1,344 tests (0 failures)*


## Phase 2 Backend Modules

### filter-operations (Prefix: /api/filters)
Core module for filter cleaning lifecycle management.
- `filter-operations.service.ts` — getCurrentState, startCycle, advance, bypass, submitChecklist, getCycles, getCycleById, getEvents, getCleaningReasons
- `routes.ts` — REST endpoints for cycle management
- `events-routes.ts` — REST endpoints for events, cycles, reasons queries
- Organization scoping via `orgWhere(ctx)` on all queries
- Transaction wrapping for startCycle (race condition prevention)
- Server-side checklist enforcement in advance()

### cleaning-profiles (Prefix: /api/filter-cleaning-profiles)
- Pipeline profile CRUD with versioning (archive old, create new version)
- Pipeline validation: START/END nodes, stage keys, checklist profiles, graph connectivity
- Transaction wrapping for update operations

### checklist-profiles (Prefix: /api/checklist-profiles)
- Profile CRUD with usage check on delete (blocks if referenced by pipeline nodes)
- Question CRUD with reorder support

### filter-profiles (Prefix: /api/filter-profiles)
- Links cleaning profiles to filter instances
- Organization scoping with fallback for global scope users

### pm-schedules (Prefix: /api/pm-schedules)
- Annual PM schedule management per AHU
- Monthly entry management with tolerance windows

