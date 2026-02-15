# DigiLog API Guide

Base URL: `http://localhost:3000`

All endpoints require `Authorization: Bearer <token>` unless marked **Public**.

**Interactive API Documentation:** Full OpenAPI spec with request/response models is available at [`/api/docs`](http://localhost:3000/api/docs). All endpoints include Zod-validated schemas for body, params, and query parameters.

---

## Auth

### POST /api/auth/login — **Public**
Authenticate with username and password.

**Request Body:**
```json
{ "username": "string", "password": "string" }
```

**Response 200:**
```json
{
  "success": true,
  "token": "jwt-token",
  "user": { "id", "username", "fullName", "role", "forcePasswordChange", "isTemporaryPassword" },
  "expiresIn": "8h"
}
```

**Errors:** `401 INVALID_CREDENTIALS`, `403 ACCOUNT_LOCKED`, `403 ACCOUNT_DISABLED`, `403 PASSWORD_EXPIRED`

---

### POST /api/auth/logout
End the current session.

**Response:** `{ "success": true }`

---

### GET /api/auth/me
Get the current authenticated user profile.

**Response:**
```json
{ "id", "username", "fullName", "email", "department", "role", "status", "forcePasswordChange", "isTemporaryPassword", "lastLogin", "createdAt" }
```

---

### POST /api/auth/change-password
Change the current user's password. Validates against the full password policy (length, complexity, history, cannot contain username).

**Request Body:**
```json
{ "currentPassword": "string", "newPassword": "string" }
```

**Response:** `{ "success": true, "message": "Password changed successfully" }`

**Errors:** `400 INVALID_PASSWORD`, `400 POLICY_VIOLATION` (with `violations` array)

---

### POST /api/auth/verify
Re-authenticate for sensitive operations. Returns a short-lived (5 min) verification token.

**Request Body:**
```json
{ "password": "string" }
```

**Response:** `{ "success": true, "verificationToken": "jwt-token" }`

---

## Users

> All user endpoints require `SUPER_ADMIN` or `ADMIN` role.
> Endpoints marked with **Reauth** may require `X-Verification-Token` header if configured.

### POST /api/users — **Reauth**
Create a new user. Password is temporary; user must change on first login.

**Request Body:**
```json
{
  "username": "string (6-50 chars)",
  "fullName": "string",
  "email": "string",
  "department": "string (optional)",
  "role": "ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER",
  "password": "string",
  "confirmPassword": "string",
  "status": "ENABLED | DISABLED (default ENABLED)"
}
```

**Response 201:** User object (id, username, fullName, email, department, role, status, createdAt)

---

### GET /api/users
List users with pagination and filtering.

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default 1) |
| `limit` | number | Items per page (default 20) |
| `search` | string | Search username, fullName, email |
| `role` | string | Filter by role |
| `status` | string | Filter by status |

**Response:** `{ data: User[], total, page, limit, totalPages }`

---

### GET /api/users/:id
Get user details.

---

### PUT /api/users/:id — **Reauth**
Update user details (fullName, email, department, role, status).

---

### DELETE /api/users/:id — **Reauth**
Soft-delete (disable) a user. Terminates all active sessions.

---

### POST /api/users/:id/enable — **Reauth**
Re-enable a disabled user.

---

### POST /api/users/:id/disable — **Reauth**
Disable a user and terminate all sessions.

---

### POST /api/users/:id/unlock
Unlock a locked user account. Resets failed login attempts.

---

### POST /api/users/:id/reset-password — **Reauth**
Reset a user's password with a new temporary password.

**Request Body:** `{ "newPassword": "string", "confirmPassword": "string" }`

---

## Config

> GET endpoints require `SUPER_ADMIN` or `ADMIN`.
> PUT endpoints require `SUPER_ADMIN` or `ADMIN`, and may require re-authentication.

### GET /api/config/password-policy
### PUT /api/config/password-policy — **Reauth**
Password complexity rules: minLength, maxLength, requireUppercase, requireLowercase, requireNumbers, requireSpecialChars, min counts, preventReuseCount, cannotBeUserId, cannotContainUserId.

### GET /api/config/login-security
### PUT /api/config/login-security — **Reauth**
Login lockout settings: maxFailedAttempts, lockoutType (TEMPORARY/PERMANENT), lockoutDurationMinutes.

### GET /api/config/session
### PUT /api/config/session — **Reauth**
Session/auto-logout settings: autoLogoutEnabled, idleTimeoutMinutes, warningMinutes.

### GET /api/config/datetime
### PUT /api/config/datetime
Date/time format settings: dateFormat, timeFormat, timezone.

### GET /api/config/reauth-settings (SUPER_ADMIN only)
### PUT /api/config/reauth-settings (SUPER_ADMIN only)
Configure which operations require re-authentication.

**Request/Response:**
```json
{
  "enabledOperations": ["config:password-policy", "user:create", ...],
  "availableOperations": ["config:password-policy", "config:login-security", "config:session", "user:create", "user:update", "user:delete", "user:enable", "user:disable", "user:reset-password", "node:create", "node:delete"]
}
```

### GET /api/config/field-ids
Get all field ID configurations.

### PUT /api/config/field-ids/:fieldId (SUPER_ADMIN only)
Update a field display name.

---

## Hierarchy

### GET /api/hierarchy
List root nodes or children of a parent.

**Query Params:** `parentId` (optional) — filter by parent node

### GET /api/hierarchy/tree
Get the full hierarchy tree (for small datasets).

### POST /api/hierarchy — **Reauth**
Create a new hierarchy node. Requires `NODE_CREATE` permission.

**Request Body:**
```json
{
  "name": "string",
  "nodeType": "site | area | line | cell | unit",
  "parentId": "string (optional)",
  "templateId": "string (optional)",
  "attributes": "object (optional)",
  "status": "active | inactive | maintenance | decommissioned"
}
```

### GET /api/hierarchy/:id
Get node detail with children, parent, identifiers, and links.

### GET /api/hierarchy/:id/ancestors
Get ancestor chain for breadcrumb navigation.

### PUT /api/hierarchy/:id
Update node attributes, name, or status. Requires `NODE_UPDATE` permission.

### DELETE /api/hierarchy/:id — **Reauth**
Soft-delete (decommission) a node. Requires `NODE_DELETE` permission. Cannot delete nodes with children.

### POST /api/hierarchy/:id/identifiers
Add a physical identifier (barcode, QR, RFID, NFC, serial) to a node. Requires `NODE_UPDATE` permission.

**Request Body:** `{ "type": "barcode | qr_code | rfid | nfc | serial", "value": "string" }`

---

## Templates

### GET /api/templates
List asset templates. Optional filters: `status`, `nodeType`, `search`.

### POST /api/templates
Create a new template. Requires `TEMPLATE_CREATE` permission.

**Request Body:**
```json
{
  "name": "string",
  "nodeType": "string",
  "description": "string (optional)",
  "attributeSchema": [{ "name", "type", "required", "unit", "defaultValue" }],
  "telemetrySchema": [{ "name", "type", "unit", "min", "max" }],
  "checklistSchemas": "array (optional — inline checklist definitions)",
  "expectedIdentifiers": [{ "type": "QR | RFID | Barcode | NFC | Serial", "required": true }],
  "expectedRelationships": [{ "type": "CONTAINS | CONNECTED_TO | ...", "targetType": "string (optional)" }],
  "defaultSchedules": [{ "checklistIndex": 0, "frequency": "DAILY", "toleranceBefore": 60, "toleranceAfter": 120 }],
  "statusLifecycle": ["active", "maintenance", "offline", "decommissioned"],
  "iconUrl": "string (optional)"
}
```

### GET /api/templates/:id
Get template detail with version history.

### PUT /api/templates/:id
Update a template. Creates a new version. Requires `TEMPLATE_UPDATE` permission.

### DELETE /api/templates/:id
Soft-delete (deactivate) a template. Requires `TEMPLATE_DELETE` permission.

---

## Hierarchy — Asset Links

### POST /api/hierarchy/links
Create a bidirectional relationship between two assets. Auto-creates the inverse link. Requires `NODE_UPDATE` permission.

**Request Body:**
```json
{
  "sourceId": "uuid",
  "targetId": "uuid",
  "type": "CONTAINS | CONNECTED_TO | FEEDS | DEPENDS_ON | BACKS_UP | MONITORS | CUSTOM",
  "customLabel": "string (optional, for CUSTOM type)",
  "notes": "string (optional)"
}
```

**Response 201:** `{ "forward": AssetLink, "inverse": AssetLink }`

**Errors:** `400` self-referencing, decommissioned nodes, circular CONTAINS. `404` source/target not found. `409` duplicate relationship.

---

### GET /api/hierarchy/:id/links
Get all relationships for a node (both directions).

**Response:** `{ "outgoing": AssetLink[], "incoming": AssetLink[] }`

---

### DELETE /api/hierarchy/links/:linkId
Delete a relationship and its auto-created inverse. Requires `NODE_UPDATE` permission.

**Response:** `{ "success": true }`

---

## Checklists

### POST /api/checklists/templates
Create a checklist template. Requires `TEMPLATE_CREATE` permission.

**Request Body:**
```json
{
  "name": "string",
  "description": "string (optional)",
  "questions": [{ "id": "string", "type": "PASS_FAIL | MCQ | MULTI_SELECT | FILL_BLANK | DROPDOWN | NUMERIC_WITH_LIMITS | PHOTO | DATE_TIME | SIGNATURE | YES_NO_COMMENT | CALCULATED | CONDITIONAL", "label": "string", "required": true, "options": [], "limits": {} }],
  "performedByRole": "string (optional)",
  "checkedByEnabled": false,
  "checkedByRole": "string (optional)",
  "verifiedByEnabled": false,
  "verifiedByRole": "string (optional)",
  "templateId": "string (optional — link to AssetTemplate)"
}
```

**Response 201:** ChecklistTemplate object

---

### GET /api/checklists/templates
List checklist templates.

**Query Params:** `status` (optional), `search` (optional)

---

### GET /api/checklists/templates/:id
Get checklist template detail with node attachment count.

---

### PUT /api/checklists/templates/:id
Update a checklist template. Auto-increments version. Requires `TEMPLATE_UPDATE` permission.

---

### POST /api/checklists/nodes/:id
Attach a checklist template to a hierarchy node. Requires `NODE_UPDATE` permission.

**Request Body:**
```json
{
  "checklistTemplateId": "uuid",
  "enabled": true,
  "overrideApproval": false
}
```

**Response 201:** NodeChecklist object

---

### GET /api/checklists/nodes/:id
List all checklists attached to a node. Includes template detail, record count, and schedule count.

---

### POST /api/checklists/:checklistId/records
Submit a checklist record (Performed By step). Requires `APPROVAL_REQUEST` permission.

**Request Body:**
```json
{
  "responses": { "questionId": "answer value" },
  "performedSignature": "string (optional — e-signature)",
  "scheduleRef": "string (optional — schedule ID or 'AD_HOC')",
  "deviceInfo": { "type": "string", "ip": "string", "userAgent": "string" }
}
```

**Response 201:** ChecklistRecord with SHA-256 checksum. Status auto-set based on approval tiers (COMPLETED, PENDING_CHECK, or PENDING_VERIFY).

---

### GET /api/checklists/:checklistId/records
List records for a checklist, ordered by most recent first.

---

### GET /api/checklists/records/:id
Get a single checklist record with full detail (node, template, questions).

---

### POST /api/checklists/records/:id/check
Checked By approve/reject a record. Requires `APPROVAL_REVIEW` permission.

**Request Body:**
```json
{
  "action": "APPROVE | REJECT",
  "signature": "string (optional — e-signature)",
  "comments": "string (optional)"
}
```

**Errors:** `400` not in PENDING_CHECK status. `403` segregation of duties (performer cannot check).

---

### POST /api/checklists/records/:id/verify
Verified By approve/reject a record. Requires `APPROVAL_REVIEW` permission.

**Request Body:** Same as check endpoint.

**Errors:** `400` not in PENDING_VERIFY status. `403` segregation of duties (performer/checker cannot verify).

---

## Schedules

### POST /api/schedules
Create a recurring schedule for a node checklist. Starts in onboarding mode. Requires `NODE_UPDATE` permission.

**Request Body:**
```json
{
  "nodeChecklistId": "uuid",
  "frequency": "HOURLY | PER_SHIFT | DAILY | WEEKLY | MONTHLY | QUARTERLY | ANNUALLY | CUSTOM",
  "frequencyValue": "number (optional — e.g., every N hours)",
  "cronExpression": "string (optional — for CUSTOM frequency)",
  "toleranceBefore": "number (optional — minutes before due)",
  "toleranceAfter": "number (optional — minutes after due)"
}
```

**Response 201:** Schedule object

---

### GET /api/schedules/node/:id
Get all schedules for a node. Includes checklist template name. Ordered by nextDueAt ascending.

---

### PUT /api/schedules/:id
Update a schedule. Auto-recalculates `nextDueAt` if frequency changed and anchor exists. Requires `NODE_UPDATE` permission.

---

### DELETE /api/schedules/:id
Delete a schedule. Requires `NODE_UPDATE` permission.

---

## Alarms

### POST /api/alarms/rules
Create an alarm rule for a node. Requires `NODE_UPDATE` permission.

**Request Body:**
```json
{
  "nodeId": "uuid",
  "name": "string",
  "ruleType": "THRESHOLD | CHECKLIST_FIELD | SCHEDULE_MISSED | CUSTOM",
  "config": { "field": "string", "operator": "gt | gte | lt | lte | eq | neq", "value": "any", "severity": "INFO | WARNING | ALARM | CRITICAL" },
  "enabled": true
}
```

**Response 201:** AlarmRule object

---

### GET /api/alarms/rules/node/:id
Get all alarm rules for a node. Includes event count.

---

### PUT /api/alarms/rules/:id
Update an alarm rule. Auto-increments version. Requires `NODE_UPDATE` permission.

---

### GET /api/alarms/events
List alarm events with optional filters.

**Query Params:** `nodeId` (optional), `status` (optional: OPEN/ACKNOWLEDGED/CLOSED), `severity` (optional)

Returns up to 100 events, most recent first.

---

### GET /api/alarms/events/node/:id
List alarm events for a specific node.

---

### POST /api/alarms/events/:id/acknowledge
Acknowledge an open alarm event. Requires `NODE_UPDATE` permission.

**Errors:** `400` event not in OPEN status.

---

### POST /api/alarms/events/:id/close
Close an alarm event (acknowledged or open). Requires `NODE_UPDATE` permission.

**Errors:** `400` event already closed.

---

## Privileges (SUPER_ADMIN only)

### GET /api/privileges
List all active (non-revoked) delegated privileges.

---

### POST /api/privileges
Grant a delegated privilege to a role.

**Request Body:**
```json
{
  "role": "string (target role)",
  "privilege": "string (e.g., MANAGE_TEMPLATES, CREATE_INSTANCES, MANAGE_CHECKLISTS)",
  "assetType": "string (optional — restrict to specific nodeType)"
}
```

**Response 201:** DelegatedPrivilege object

**Errors:** `409` privilege already granted to this role.

---

### DELETE /api/privileges/:id
Revoke a delegated privilege (soft-delete via revokedAt timestamp).

---

## Audit

### GET /api/audit
Query the audit trail with pagination.

**Query Params:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default 1) |
| `limit` | number | Items per page (default 50) |
| `startDate` | string | ISO date filter (gte) |
| `endDate` | string | ISO date filter (lte) |
| `userId` | string | Filter by user ID |
| `action` | string | Filter by action type |
| `targetType` | string | Filter by target type |

**Response:** `{ data: AuditRecord[], total, page, limit, totalPages }`

### GET /api/audit/verify
Bulk verify audit trail checksums. Returns integrity summary.

**Query Params:** `startDate`, `endDate` (optional date range)

**Response:**
```json
{ "total": 100, "valid": 99, "invalid": 1, "invalidRecords": [{ "id", "valid", "storedChecksum", "computedChecksum" }] }
```

### GET /api/audit/:id
Get a single audit record.

### GET /api/audit/:id/verify
Verify the integrity checksum of a single audit record.

**Response:**
```json
{ "valid": true, "storedChecksum": "sha256hex", "computedChecksum": "sha256hex" }
```

---

## Health

### GET /api/health — **Public**
Health check endpoint.

**Response:** `{ "status": "ok", "timestamp": "ISO-8601" }`

---

## Re-authentication

When a SUPER_ADMIN has configured certain operations to require re-authentication:

1. Call the protected endpoint normally
2. If `403 REAUTH_REQUIRED` is returned, prompt user for password
3. Call `POST /api/auth/verify` with the password to get a `verificationToken`
4. Retry the original request with `X-Verification-Token: <token>` header

The verification token is valid for 5 minutes and is single-use per session.

---

## Roles & Permissions

| Role | Can Create Roles |
|------|-----------------|
| SUPER_ADMIN | ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER |
| ADMIN | SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER |

**Note:** SUPER_ADMIN actions are excluded from the audit trail by design.

## Audit Actions

**User & Auth:** `USER_CREATED`, `USER_UPDATED`, `USER_DELETED`, `USER_ENABLED`, `USER_DISABLED`, `PASSWORD_RESET`, `PASSWORD_CHANGED`, `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_TIMEOUT`, `ACCOUNT_LOCKED`, `ACCOUNT_UNLOCKED`

**Config:** `CONFIG_CHANGED`, `REAUTH_SETTINGS_CHANGED`

**Hierarchy & Templates:** `NODE_CREATED`, `NODE_MODIFIED`, `NODE_DELETED`, `NODE_IDENTIFIER_ADDED`, `TEMPLATE_CREATED`, `TEMPLATE_MODIFIED`, `TEMPLATE_DELETED`

**Relationships:** `LINK_CREATED`, `LINK_DELETED`

**Checklists:** `CHECKLIST_TEMPLATE_CREATED`, `CHECKLIST_TEMPLATE_MODIFIED`, `CHECKLIST_ATTACHED`, `CHECKLIST_RECORD_SUBMITTED`, `CHECKLIST_RECORD_CHECKED`, `CHECKLIST_RECORD_VERIFIED`, `CHECKLIST_RECORD_REJECTED`

**Schedules:** `SCHEDULE_CREATED`, `SCHEDULE_MODIFIED`, `SCHEDULE_DELETED`

**Alarms:** `ALARM_RULE_CREATED`, `ALARM_RULE_MODIFIED`, `ALARM_EVENT_TRIGGERED`, `ALARM_EVENT_ACKNOWLEDGED`, `ALARM_EVENT_CLOSED`

**Privileges:** `PRIVILEGE_GRANTED`, `PRIVILEGE_REVOKED`

**Security:** `UNAUTHORIZED_ACTION_ATTEMPT`
