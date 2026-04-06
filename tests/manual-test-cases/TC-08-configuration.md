# TC-08: Configuration — Test Cases

## Overview
- **Module**: System Configuration (36+ endpoints)
- **API Endpoints**: 36+
- **Frontend Pages**: /config/* (14+ sub-pages)
- **Permissions**: CONFIG_READ (read), CONFIG_UPDATE (write), some public endpoints
- **Config Categories**: Password Policy, Login Security, Session, DateTime, Pagination, User ID, Branding, Role Config, User Config, Field IDs (78+), Action Reauth, Audit Templates, Alarm Columns
- **Config Definitions**: 23 system config definitions with auto-discovery

---

## Positive Test Cases

### TC-08-P01: Get Password Policy
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/password-policy
  2. Verify response contains password policy fields (minLength, requireUppercase, requireLowercase, requireNumbers, requireSpecial, historyCount, expiryDays)
- **Expected Result**: 200 OK with password policy configuration object

### TC-08-P02: Update Password Policy
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "minLength": 10, "requireUppercase": true, "requireNumbers": true, "requireSpecial": true, "_currentPassword": "Admin@123" }`
- **Steps**:
  1. Send PUT /api/config/password-policy with updated values
  2. Verify response `{ success: true, data: {...} }`
  3. GET password-policy to confirm persistence
- **Expected Result**: 200 OK with updated policy

### TC-08-P03: Get/Update Login Security
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "maxFailedAttempts": 3, "lockoutDuration": 30, "_currentPassword": "Admin@123" }`
- **Steps**:
  1. GET /api/config/login-security
  2. PUT with updated values
  3. Verify changes persisted
- **Expected Result**: 200 OK with login security config (maxFailedAttempts, lockoutDuration)

### TC-08-P04: Get/Update Session Configuration
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "sessionDuration": 480, "idleTimeout": 15, "absoluteTimeout": 1440, "_currentPassword": "Admin@123" }`
- **Steps**:
  1. GET /api/config/session
  2. PUT with updated session values
  3. Verify changes
- **Expected Result**: 200 OK with session config (duration, idle timeout, absolute timeout)

### TC-08-P05: Get/Update DateTime Format
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "dateFormat": "DD/MM/YYYY", "timeFormat": "HH:mm:ss", "timezone": "Asia/Kolkata" }`
- **Steps**:
  1. GET /api/config/datetime
  2. PUT with new format
  3. GET /api/config/datetime/current (public endpoint)
  4. Verify both return same values
- **Expected Result**: 200 OK, datetime format updated

### TC-08-P06: Get Current DateTime (Public Endpoint)
- **Priority**: Medium
- **Preconditions**: Any authenticated user
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/datetime/current (no admin role needed)
  2. Verify response contains datetime format config
- **Expected Result**: 200 OK — accessible to all authenticated users

### TC-08-P07: Get/Update Pagination Config
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "defaultPageSize": 25, "pageSizeOptions": [10, 25, 50, 100] }`
- **Steps**:
  1. GET /api/config/pagination
  2. PUT with updated values
  3. GET /api/config/pagination/current to verify
- **Expected Result**: 200 OK with pagination options

### TC-08-P08: Get/Update User ID Configuration
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN (CONFIG_UPDATE permission)
- **Test Data**: Various User ID format settings
- **Steps**:
  1. GET /api/config/user-id
  2. PUT with updated format (requires reauth UPDATE_USERID_CONFIG)
  3. GET /api/config/user-id/next to test auto-generation
  4. POST /api/config/user-id/validate with test IDs
- **Expected Result**: 200 OK for all operations

### TC-08-P09: Get Branding (Public Endpoint)
- **Priority**: High
- **Preconditions**: None (public)
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/branding without auth
  2. Verify response contains company name, logo, colors
- **Expected Result**: 200 OK with branding config (accessible without auth for login page)

### TC-08-P10: Update Branding
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, verification token obtained
- **Test Data**: `{ "companyName": "DigiLog Pharma Inc.", "primaryColor": "#1E40AF" }`
- **Steps**:
  1. Obtain verification token (reauth UPDATE_BRANDING)
  2. PUT /api/config/branding with updated values
  3. GET /api/config/branding to verify
- **Expected Result**: 200 OK, branding updated

### TC-08-P11: Get/Update Role Configuration
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "sidebarItems": ["dashboard", "assets", "audit"], "homeWidgets": ["stats"] }`
- **Steps**:
  1. GET /api/config/roles — list all role configs
  2. GET /api/config/roles/OPERATOR — single role config
  3. PUT /api/config/roles/OPERATOR with updated sidebar items
  4. Verify changes
- **Expected Result**: 200 OK with role-specific UI configuration

### TC-08-P12: Get My Config (Effective Configuration)
- **Priority**: Medium
- **Preconditions**: Any authenticated user
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/my-config
  2. Verify response contains sidebarItems, homeWidgets, permissions
  3. Verify config reflects user-specific or role-level fallback
- **Expected Result**: 200 OK with effective configuration for current user

### TC-08-P13: Get/Update Field ID Labels
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "displayName": "Employee Number" }` for fieldId "username"
- **Steps**:
  1. GET /api/config/field-ids — list all field labels
  2. PUT /api/config/field-ids/username with new display name
  3. Verify change
- **Expected Result**: 200 OK, field label updated

### TC-08-P14: Get/Update Action Reauth Configuration
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "DELETE_USER": ["SUPER_ADMIN", "ADMIN"], "CREATE_USER": ["ADMIN"] }`
- **Steps**:
  1. GET /api/config/action-reauth — full config
  2. PUT /api/config/action-reauth with updated matrix
  3. GET /api/config/action-reauth/check?action=DELETE_USER — verify per-action check
  4. GET /api/config/action-reauth/my-actions — get actions for current role
- **Expected Result**: 200 OK for all operations

### TC-08-P15: Get/Update Audit Templates
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "LOGIN": "User {username} logged in from {ip}" }`
- **Steps**:
  1. GET /api/config/audit-templates — admin version
  2. PUT /api/config/audit-templates with custom templates
  3. GET /api/config/audit-templates/current — public version
- **Expected Result**: 200 OK, templates updated and accessible

### TC-08-P16: Get/Update Alarm Columns Configuration
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "OPERATOR": ["severity", "entityName", "type", "status", "createdAt"] }`
- **Steps**:
  1. GET /api/config/alarm-columns — full config
  2. PUT /api/config/alarm-columns with role-specific columns
  3. GET /api/config/alarm-columns/current — current user's columns
- **Expected Result**: 200 OK, alarm columns configured per role

### TC-08-P17: Validate User ID
- **Priority**: Medium
- **Preconditions**: User ID config set
- **Test Data**: `{ "userId": "EMP001" }`
- **Steps**:
  1. POST /api/config/user-id/validate with test ID
  2. Verify response `{ valid: true/false, errors: [...] }`
- **Expected Result**: 200 OK with validation result

### TC-08-P18: Get Next User ID
- **Priority**: Medium
- **Preconditions**: User ID auto-generation enabled
- **Test Data**: None
- **Steps**:
  1. GET /api/config/user-id/next
  2. Verify response `{ autoGenerate: boolean, nextId: string | null }`
- **Expected Result**: 200 OK with next auto-generated ID

---

## Negative Test Cases

### TC-08-N01: Update Config as Non-Admin
- **Priority**: High
- **Preconditions**: Logged in as OPERATOR (no CONFIG_UPDATE)
- **Test Data**: Any config PUT payload
- **Steps**:
  1. Login as OPERATOR
  2. Attempt PUT /api/config/password-policy
  3. Verify 403
- **Expected Result**: 403 Forbidden

### TC-08-N02: Update Password Policy Without Reauth
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN, reauth required
- **Test Data**: `{ "minLength": 12 }` (no _currentPassword)
- **Steps**:
  1. PUT /api/config/password-policy without _currentPassword
  2. Verify 401 REAUTH_REQUIRED
- **Expected Result**: 401 — current password required

### TC-08-N03: Update Password Policy with Wrong Password
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "minLength": 12, "_currentPassword": "WrongPassword" }`
- **Steps**:
  1. PUT with wrong _currentPassword
  2. Verify 401 REAUTH_FAILED
- **Expected Result**: 401 REAUTH_FAILED

### TC-08-N04: Update Session with Invalid Values
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "sessionDuration": -1, "idleTimeout": 0, "_currentPassword": "Admin@123" }`
- **Steps**:
  1. Attempt to set negative/zero timeout values
  2. Verify 400
- **Expected Result**: 400 VALIDATION_ERROR — invalid values

### TC-08-N05: Read Config Without CONFIG_READ Permission
- **Priority**: High
- **Preconditions**: Logged in as user without CONFIG_READ
- **Test Data**: None
- **Steps**:
  1. Attempt GET /api/config/password-policy as VIEWER
  2. Verify 403
- **Expected Result**: 403 Forbidden

### TC-08-N06: Update Branding Without Reauth
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "companyName": "No Reauth" }` (no verification token)
- **Steps**:
  1. Attempt PUT /api/config/branding without verification token
  2. Verify reauth required behavior
- **Expected Result**: 401 or reauth-required response

### TC-08-N07: Update Non-Existent Field ID
- **Priority**: Low
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: PUT /api/config/field-ids/nonexistent_field
- **Steps**:
  1. Attempt to update field ID that does not exist
  2. Verify 404
- **Expected Result**: 404 — field ID not found

### TC-08-N08: Access Admin Config Endpoints Without Auth
- **Priority**: High
- **Preconditions**: No auth token
- **Test Data**: None
- **Steps**:
  1. Attempt GET /api/config/password-policy without Authorization header
  2. Verify 401
- **Expected Result**: 401 Unauthorized


---

## Phase 2: Filter Configuration Test Cases

### TC-08-P19: Get Filter-Related Field IDs
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/field-ids
  2. Verify response includes filter-related field IDs (78+ total field IDs)
  3. Verify filter-specific fields: filterType, mediaType, efficiencyRating, cleaningFrequency, etc.
- **Expected Result**: 200 OK with field IDs including Phase 2 filter management fields

### TC-08-P20: Verify Filter Privileges in Action Reauth Config
- **Priority**: High
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Send GET /api/config/action-reauth
  2. Verify filter-related reauth actions exist: BYPASS_FILTER_STAGE, CREATE_CLEANING_PROFILE, UPDATE_CLEANING_PROFILE, DELETE_CLEANING_PROFILE
  3. Verify each action maps to appropriate roles
- **Expected Result**: 200 OK with filter reauth actions configured

### TC-08-P21: Update Filter Reauth Configuration
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: `{ "BYPASS_FILTER_STAGE": ["SUPER_ADMIN", "ADMIN", "SUPERVISOR"] }`
- **Steps**:
  1. Send PUT /api/config/action-reauth with updated filter bypass roles
  2. Verify response includes updated configuration
  3. Login as SUPERVISOR and verify bypass requires reauth
- **Expected Result**: 200 OK, filter bypass reauth roles updated

### TC-08-P22: Verify Config Discovery Includes Filter Modules
- **Priority**: Medium
- **Preconditions**: Logged in as SUPER_ADMIN
- **Test Data**: None
- **Steps**:
  1. Verify 23 config definitions are returned from the config registry
  2. Verify filter-related sidebar items appear in role config for roles with filter permissions
- **Expected Result**: Config registry includes all 23 definitions including Phase 2 filter config

