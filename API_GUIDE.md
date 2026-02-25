# DigiLog API Guide

**Base URL:** `http://localhost:3000/api` (dev) | `http://43.205.32.23/api` (production)
**Swagger UI:** `http://43.205.32.23/docs`

All endpoints require `Authorization: Bearer <token>` header unless marked "No auth".

**Total Endpoints: 90**
**Last Updated:** 2026-02-25 (v2.2.2)

> **v2.2.0 adds 8 new endpoints** for the public user account creation request flow (2 public + 6 admin).
> **v2.2.1** — No API changes. Frontend code quality improvements (file split, search debounce).
> **v2.2.2** — No API changes. Fixed runtime `h.map` crash on `/request-account` (BUG-014). Added `Array.isArray` guard + HTTP status check on roles fetch.

---

## Authentication

| Method | Endpoint | Auth | Reauth | Description |
|--------|----------|------|--------|-------------|
| POST | `/api/auth/login` | No | — | Login with username/password (rate limited: 10/min) |
| POST | `/api/auth/logout` | Yes | — | Logout and invalidate session |
| POST | `/api/auth/beacon-logout` | No | — | Logout via sendBeacon (tab close, token in body) |
| GET | `/api/auth/me` | Yes | — | Get current user profile |
| PUT | `/api/auth/profile` | Yes | — | Update own profile (fullName, email, department, photoUrl) |
| POST | `/api/auth/change-password` | Yes | — | Change own password |
| POST | `/api/auth/verify` | Yes | — | Re-authenticate with password (returns verification token) |
| POST | `/api/auth/forgot-password` | No | — | Submit password reset request (rate limited: 5/5min) |

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |

---

## Users

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/users` | SUPER_ADMIN, ADMIN | — | List users (paginated, filterable by role/status/search) |
| GET | `/api/users/stats` | SUPER_ADMIN, ADMIN | — | User count stats by status |
| POST | `/api/users` | SUPER_ADMIN, ADMIN | CREATE_USER | Create user |
| GET | `/api/users/:id` | SUPER_ADMIN, ADMIN | — | Get user by ID |
| PUT | `/api/users/:id` | SUPER_ADMIN, ADMIN | UPDATE_USER | Update user |
| DELETE | `/api/users/:id` | SUPER_ADMIN | DELETE_USER | Delete user |
| POST | `/api/users/bulk-delete` | SUPER_ADMIN | BULK_DELETE_USERS | Bulk delete users |
| POST | `/api/users/:id/enable` | SUPER_ADMIN, ADMIN | ENABLE_USER | Enable user account |
| POST | `/api/users/:id/disable` | SUPER_ADMIN, ADMIN | DISABLE_USER | Disable user account |
| POST | `/api/users/:id/unlock` | SUPER_ADMIN, ADMIN | UNLOCK_USER | Unlock locked account |
| POST | `/api/users/:id/reset-password` | SUPER_ADMIN, ADMIN | RESET_PASSWORD | Admin password reset |
| GET | `/api/users/reset-requests` | SUPER_ADMIN, ADMIN | — | List password reset requests |
| GET | `/api/users/reset-requests/pending` | SUPER_ADMIN, ADMIN | — | List pending reset requests |
| POST | `/api/users/reset-requests/:id/process` | SUPER_ADMIN, ADMIN | PROCESS_RESET_REQUEST | Process reset request |

---

## User Account Creation Requests (`/api/user-requests`)

### Public Endpoints (no auth)

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|-----------|-------------|
| GET | `/api/user-requests/roles` | No | 10/min | Active roles for form dropdown |
| POST | `/api/user-requests` | No | 5/min | Submit account creation request |

### Admin Endpoints (requires `USER_CREATE` permission)

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/user-requests` | USER_CREATE | — | List requests (paginated, filterable by status/search) |
| GET | `/api/user-requests/pending/count` | USER_CREATE | — | Pending count for badge |
| GET | `/api/user-requests/:id` | USER_CREATE | — | Request detail |
| POST | `/api/user-requests/:id/approve` | USER_CREATE | APPROVE_USER_REQUEST | Approve request (creates user with temp password) |
| POST | `/api/user-requests/:id/reject` | USER_CREATE | REJECT_USER_REQUEST | Reject request with mandatory reason |
| POST | `/api/user-requests/:id/password-viewed` | USER_CREATE | — | Mark temp password as viewed |

**Notes:**
- Approve creates the user in the system with `forcePasswordChange: true` and returns a one-time temp password
- Temp password is 16 chars (upper+lower+digits+special), generated with `crypto.randomBytes`
- `isPasswordViewed` flag prevents re-display of temp password after admin acknowledges
- Duplicate detection checks both `users` table and pending creation requests
- Role hierarchy enforced: admin cannot approve creation of users with higher-level roles

---

## Roles

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/roles` | SUPER_ADMIN, ADMIN | — | List all roles |
| GET | `/api/roles/active` | Any | — | List active roles (for dropdowns) |
| GET | `/api/roles/:name` | SUPER_ADMIN, ADMIN | — | Get role by name |
| GET | `/api/roles/permissions/all` | SUPER_ADMIN | — | List all available permissions |
| GET | `/api/roles/:name/creatable` | SUPER_ADMIN, ADMIN | — | Get roles this role can create |
| POST | `/api/roles` | SUPER_ADMIN | CREATE_ROLE | Create custom role |
| PUT | `/api/roles/:name` | SUPER_ADMIN | UPDATE_ROLE | Update role |
| DELETE | `/api/roles/:name` | SUPER_ADMIN | DELETE_ROLE | Delete role |

---

## Entity Management (`/api/assets`)

All entity endpoints use `requirePermission()` (checks role.permissions JSON array in DB).

### Entity Templates

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/templates` | ASSET_VIEW | — | List templates (paginated, searchable, filterable by isActive) |
| GET | `/api/assets/templates/:id` | ASSET_VIEW | — | Get single template with full schema + instance count |
| POST | `/api/assets/templates` | ASSET_TEMPLATE_MANAGE | CREATE_ASSET_TEMPLATE | Create template (auto-creates v1 snapshot) |
| PUT | `/api/assets/templates/:id` | ASSET_TEMPLATE_MANAGE | UPDATE_ASSET_TEMPLATE | Update template (increments version, creates snapshot) |
| DELETE | `/api/assets/templates/:id` | ASSET_TEMPLATE_MANAGE | DELETE_ASSET_TEMPLATE | Soft-delete template (isActive=false) |
| GET | `/api/assets/templates/:id/versions` | ASSET_VIEW | — | List template version history (descending) |

**Template fields:** `name`, `description`, `category`, `icon`, `attributeSchema`, `telemetrySchema`, `expectedIdentifiers`, `expectedRelationships`, `statusLifecycle`, `alarmRules`, `checklistSchema`, `maxParentConnections`, `maxConnections`

**checklistSchema** — Array of checklist question items. Each item has:
- `question` (required, string) — The question text
- `questionType` (required, enum) — One of 14 types: `PASS_FAIL`, `YES_NO`, `YES_NO_NA`, `MCQ`, `MULTI_SELECT`, `TEXT`, `NUMERIC`, `DROPDOWN`, `PHOTO`, `DATE_TIME`, `SIGNATURE`, `YES_NO_COMMENT`, `CALCULATED`, `CONDITIONAL`
- `required` (boolean) — Whether an answer is mandatory
- `section` (string) — Grouping label
- `description` (string) — Help text
- `options` (string[]) — Choices for MCQ, MULTI_SELECT, DROPDOWN types
- `numericUnit` (string) — Unit label for NUMERIC type
- `numericMin`, `numericMax` (number) — Range constraints for NUMERIC type
- `passCriteria` (string) — Pass description for PASS_FAIL type
- `expression` (string) — Formula for CALCULATED type
- `conditionField`, `conditionValue` (string) — Trigger for CONDITIONAL type

### Entity Instances

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/instances` | ASSET_VIEW | — | List instances (paginated, filterable) |
| GET | `/api/assets/instances/tree` | ASSET_VIEW | — | Get flat array for tree building (all active instances) |
| GET | `/api/assets/instances/:id` | ASSET_VIEW | — | Get single instance with template info |
| POST | `/api/assets/instances` | ASSET_CREATE | CREATE_ASSET | Create instance (validates attributes, enforces connection limits) |
| PUT | `/api/assets/instances/:id` | ASSET_UPDATE | UPDATE_ASSET | Update instance |
| PATCH | `/api/assets/instances/:id/status` | ASSET_UPDATE | UPDATE_ASSET | Update instance status only |
| DELETE | `/api/assets/instances/:id` | ASSET_DELETE | DELETE_ASSET | Cascade soft-delete (marks descendants inactive) |
| GET | `/api/assets/instances/:id/children` | ASSET_VIEW | — | Get direct children |

### Entity Relationships

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/relationships` | ASSET_VIEW | — | List relationships (filterable by assetId, type) |
| POST | `/api/assets/relationships` | ASSET_RELATIONSHIP_MANAGE | CREATE_ASSET_RELATIONSHIP | Create relationship (auto-creates inverse, enforces maxConnections, cycle detection for CONTAINS) |
| DELETE | `/api/assets/relationships/:id` | ASSET_RELATIONSHIP_MANAGE | DELETE_ASSET_RELATIONSHIP | Delete relationship (deletes both sides) |

### Entity Identifiers

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/identifiers` | ASSET_VIEW | — | List identifiers (filterable by assetId) |
| GET | `/api/assets/identifiers/lookup/:value` | ASSET_VIEW | — | Lookup by identifier value (globally unique) |
| POST | `/api/assets/identifiers` | ASSET_IDENTIFIER_MANAGE | CREATE_ASSET_IDENTIFIER | Create identifier |
| DELETE | `/api/assets/identifiers/:id` | ASSET_IDENTIFIER_MANAGE | DELETE_ASSET_IDENTIFIER | Delete identifier |

---

## Configuration

### Security & Session Config

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/password-policy` | SUPER_ADMIN, ADMIN | — | Get password policy |
| PUT | `/api/config/password-policy` | SUPER_ADMIN, ADMIN | UPDATE_PASSWORD_POLICY | Update password policy |
| GET | `/api/config/login-security` | SUPER_ADMIN, ADMIN | — | Get login security settings |
| PUT | `/api/config/login-security` | SUPER_ADMIN, ADMIN | UPDATE_LOGIN_SECURITY | Update login security |
| GET | `/api/config/session` | SUPER_ADMIN, ADMIN | — | Get session config |
| PUT | `/api/config/session` | SUPER_ADMIN, ADMIN | UPDATE_SESSION_CONFIG | Update session config |

### DateTime & Pagination Config

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/datetime` | SUPER_ADMIN, ADMIN | Get datetime config (admin view) |
| PUT | `/api/config/datetime` | SUPER_ADMIN, ADMIN | Update datetime config |
| GET | `/api/config/datetime/current` | Any | Get effective datetime format (public) |
| GET | `/api/config/pagination` | SUPER_ADMIN, ADMIN | Get pagination config (admin view) |
| PUT | `/api/config/pagination` | SUPER_ADMIN, ADMIN | Update pagination config |
| GET | `/api/config/pagination/current` | Any | Get effective pagination options (public) |

### User ID Config

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/user-id` | SUPER_ADMIN, ADMIN | — | Get user ID config |
| PUT | `/api/config/user-id` | SUPER_ADMIN | UPDATE_USERID_CONFIG | Update user ID config |
| GET | `/api/config/user-id/next` | SUPER_ADMIN, ADMIN | — | Get next auto-generated ID |
| POST | `/api/config/user-id/validate` | SUPER_ADMIN, ADMIN | — | Validate a user ID against rules |

### Branding

| Method | Endpoint | Auth | Reauth | Description |
|--------|----------|------|--------|-------------|
| GET | `/api/config/branding` | No | — | Get branding config (public) |
| PUT | `/api/config/branding` | SUPER_ADMIN | UPDATE_BRANDING | Update branding (colors, logo, app name) |

### Role Configuration

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/roles` | SUPER_ADMIN, ADMIN | — | Get all role configs |
| GET | `/api/config/roles/:role` | SUPER_ADMIN, ADMIN | — | Get single role config (sidebar, permissions) |
| PUT | `/api/config/roles/:role` | SUPER_ADMIN | UPDATE_ROLE_CONFIG | Update role config |

### User Configuration

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/users/:userId` | SUPER_ADMIN, ADMIN | Get user-specific config |
| PUT | `/api/config/users/:userId` | SUPER_ADMIN, ADMIN | Update user-specific config |
| GET | `/api/config/my-config` | Any | Get current user's effective config |

### Field IDs

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/field-ids` | Any | List all field ID configs (customizable labels) |
| PUT | `/api/config/field-ids/:fieldId` | SUPER_ADMIN | Update field display name |

### Action Re-authentication

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/action-reauth` | SUPER_ADMIN | Get full reauth config matrix |
| PUT | `/api/config/action-reauth` | SUPER_ADMIN | Update reauth config |
| GET | `/api/config/action-reauth/check?action=X` | Any | Check if specific action requires reauth |
| GET | `/api/config/action-reauth/my-actions` | Any | Get reauth actions for current user's role |

### Audit Text Templates

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/audit-templates` | SUPER_ADMIN | Get full templates config |
| PUT | `/api/config/audit-templates` | SUPER_ADMIN | Update audit message templates |
| GET | `/api/config/audit-templates/current` | Any | Get effective templates (defaults + overrides) |

---

## Audit Trail

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/audit` | Any | Query audit trail (paginated, filterable by date/user/action/targetType) |
| GET | `/api/audit/:id` | Any | Get single record with checksum integrity verification |
| DELETE | `/api/audit/:id` | SUPER_ADMIN | Delete single audit record |
| POST | `/api/audit/bulk-delete` | SUPER_ADMIN | Bulk delete audit records |

---

## Notifications

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/notifications` | Any | List notifications (role-filtered: SUPER_ADMIN sees all, ADMIN sees non-SUPER_ADMIN, others see own) |
| GET | `/api/notifications/unread-count` | Any | Get unread count for badge |
| PUT | `/api/notifications/:id/read` | Any | Mark single as read |
| PUT | `/api/notifications/:id/unread` | Any | Mark single as unread |
| PUT | `/api/notifications/mark-all-read` | Any | Mark all as read |
| PUT | `/api/notifications/bulk-read` | Any | Bulk mark as read |
| PUT | `/api/notifications/bulk-unread` | Any | Bulk mark as unread |
| DELETE | `/api/notifications/:id` | Any | Delete single notification |
| POST | `/api/notifications/bulk-delete` | SUPER_ADMIN | Bulk delete notifications |

---

## Uploads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/uploads/photo` | Yes | Upload photo (5MB max, multipart/form-data) |
| GET | `/uploads/:filename` | No | Serve uploaded file (public, served via fastifyStatic) |

---

## Backup & Restore

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/backup/export` | SUPER_ADMIN, ADMIN | EXPORT_BACKUP | Export database backup (ZIP) |
| POST | `/api/backup/restore` | SUPER_ADMIN, ADMIN | RESTORE_BACKUP | Restore from backup |
| POST | `/api/backup/validate` | SUPER_ADMIN, ADMIN | — | Validate backup file |

---

## Response Formats

### Paginated Response
```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

### Tree Response (flat array)
```json
[
  { "id": "...", "name": "...", "parentId": null, "templateId": "...", ... },
  { "id": "...", "name": "...", "parentId": "parent-id", ... }
]
```

### Error Response
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message"
}
```

### Connection Info (in relationship responses)
```json
{
  "connectionInfo": {
    "used": 3,
    "allowed": 10,
    "remaining": 7
  }
}
```

### Common Error Codes
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `REAUTH_REQUIRED`, `REAUTH_FAILED`, `CONCURRENT_SESSION`, `TOKEN_EXPIRED`, `FORCE_PASSWORD_CHANGE`, `PASSWORD_EXPIRED`, `CONNECTION_LIMIT_REACHED`

---

## Authentication Flow

1. **Login:** `POST /api/auth/login` with `{ username, password }` → returns `{ token, user }`
2. **Use token:** Include `Authorization: Bearer <token>` on all subsequent requests
3. **Re-auth:** For sensitive actions, password sent via `_currentPassword` body field or `x-reauth-password` header
4. **Logout:** `POST /api/auth/logout` or `POST /api/auth/beacon-logout` (for tab close)

## Permission System

- **Entity routes** use `requirePermission()` — checks `role.permissions` JSON array in DB
- **Non-entity routes** use `requireRole()` — checks role name string
- **Permissions:** ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_TEMPLATE_MANAGE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE, USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD, CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE, AUDIT_READ, APPROVAL_REVIEW, APPROVAL_REQUEST

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 100 req/min per IP |
| Login | 10 req/min per IP |
| Forgot Password | 5 req/5min per IP |

---

## Example Payloads

### Create Entity Template (with checklist)
```json
POST /api/assets/templates
{
  "name": "Reactor Vessel",
  "description": "Chemical reactor vessel template",
  "category": "Equipment",
  "icon": "flask",
  "attributeSchema": [
    { "fieldName": "serialNumber", "dataType": "TEXT" },
    { "fieldName": "capacity", "dataType": "FLOAT", "numericConstraints": { "enabled": true, "min": 0, "max": 10000, "resolution": 0.1 } }
  ],
  "checklistSchema": [
    { "question": "Is the vessel clean?", "questionType": "YES_NO", "required": true, "section": "Pre-check" },
    { "question": "Rate the condition", "questionType": "MCQ", "options": ["Good", "Fair", "Poor"], "section": "Inspection" },
    { "question": "Measure temperature", "questionType": "NUMERIC", "numericUnit": "C", "numericMin": 10, "numericMax": 80, "required": true },
    { "question": "Visual inspection", "questionType": "PASS_FAIL", "passCriteria": "No visible damage" },
    { "question": "Supervisor sign-off", "questionType": "SIGNATURE", "required": true }
  ],
  "statusLifecycle": [
    { "status": "Active", "color": "#22c55e", "transitions": ["Under Maintenance", "Inactive"] },
    { "status": "Under Maintenance", "color": "#f59e0b", "transitions": ["Active", "Decommissioned"] }
  ],
  "maxParentConnections": 1,
  "maxConnections": 10
}
```

### Create Entity Instance
```json
POST /api/assets/instances
{
  "name": "Reactor-001",
  "templateId": "uuid-of-template",
  "parentId": "uuid-of-parent-or-null",
  "attributes": { "serialNumber": "RV-2024-001", "capacity": 500.5 },
  "status": "Active"
}
```

### Create Relationship
```json
POST /api/assets/relationships
{
  "sourceAssetId": "uuid-of-source",
  "targetAssetId": "uuid-of-target",
  "relationshipType": "FEEDS"
}
```
Response includes `connectionInfo: { used, allowed, remaining }` for both source and target.

### Create Identifier
```json
POST /api/assets/identifiers
{
  "assetId": "uuid-of-instance",
  "identifierType": "QR",
  "identifierValue": "RV-2024-001-QR",
  "isPrimary": true
}
```
