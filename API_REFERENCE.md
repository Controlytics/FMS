# DigiLog — API Reference

**Base URL:** `https://<server-ip>:3000/api` (Fastify direct; reverse proxy is optional / customer-choice after Phase 4 of the windows-friendly-rewrite)
**Authentication:** JWT Bearer token (header: `Authorization: Bearer <token>`)
**Content-Type:** `application/json`

## Authentication

### Login
```
POST /api/auth/login
Body: { username, password, force? }
Response: { token, user: { id, username, fullName, role, forcePasswordChange }, expiresIn }
```
`force: true` terminates any existing session for this user.

### Logout
```
POST /api/auth/logout
Auth: Bearer token
Response: { success: true }
```

### Refresh Token
```
POST /api/auth/refresh
Auth: Bearer token
Response: { token, expiresIn }
```

### Re-authenticate (for sensitive operations)
```
POST /api/auth/verify
Auth: Bearer token
Body: { password }
Response: { verified: true, verificationToken }
```
Verification token valid for 5 minutes, used in `x-reauth-password` header.

### Get Current User
```
GET /api/auth/me
Auth: Bearer token
Response: { id, username, fullName, email, role, permissions[], scope }
```

### Change Password
```
POST /api/auth/change-password
Auth: Bearer token
Body: { currentPassword, newPassword }
Reauth: CHANGE_PASSWORD
```

### Forgot Password
```
POST /api/auth/forgot-password
Body: { username }
Response: 200 always (prevents user enumeration)
```

---

## Users

### List Users
```
GET /api/users?page=1&limit=20&search=john&status=ENABLED
Permission: USER_READ
Response: { data: User[], total, page, limit, totalPages }
```

### Create User
```
POST /api/users
Permission: USER_CREATE
Reauth: CREATE_USER
Body: { username, fullName, email, password, role, department? }
```

### Update User
```
PUT /api/users/:id
Permission: USER_UPDATE
Reauth: UPDATE_USER
Body: { fullName?, email?, role?, department?, status? }
```

### Delete User
```
DELETE /api/users/:id
Permission: USER_DELETE
Reauth: DELETE_USER
```

### Enable/Disable/Unlock
```
POST /api/users/:id/enable     Permission: USER_ENABLE_DISABLE, Reauth: ENABLE_USER
POST /api/users/:id/disable    Permission: USER_ENABLE_DISABLE, Reauth: DISABLE_USER
POST /api/users/:id/unlock     Permission: USER_UNLOCK, Reauth: UNLOCK_USER
```

### Password Reset Requests
```
GET  /api/users/reset-requests                    Permission: USER_RESET_PASSWORD
GET  /api/users/reset-requests/pending             Permission: USER_RESET_PASSWORD
POST /api/users/reset-requests/:id/process         Permission: USER_RESET_PASSWORD, Reauth
Body: { action: "approve"|"reject", remarks? }
```

---

## Roles

```
GET    /api/roles                      Permission: ROLE_MANAGE
GET    /api/roles/active               Public (for dropdowns)
GET    /api/roles/:name                Permission: ROLE_MANAGE
POST   /api/roles                      Permission: ROLE_MANAGE, Reauth: CREATE_ROLE
PUT    /api/roles/:name                Permission: ROLE_MANAGE, Reauth: UPDATE_ROLE
DELETE /api/roles/:name                Permission: ROLE_MANAGE, Reauth: DELETE_ROLE
GET    /api/roles/permissions/all      Permission: ROLE_MANAGE
```

---

## Configuration

### Static Config (per key)
```
GET /api/config/<key>                  Permission: CONFIG_READ
PUT /api/config/<key>                  Permission: CONFIG_UPDATE

Keys: password-policy, login-security, session, datetime, pagination,
      branding, user-id, report-settings, tablet-access, cleaning-profile-assignment,
      alarm-columns, audit-templates, action-reauth
```

### Public Config (no auth)
```
GET /api/config/password-policy/current
GET /api/config/datetime/current
GET /api/config/pagination/current
GET /api/config/branding
GET /api/config/report-settings/current
GET /api/config/alarm-columns/current
GET /api/config/audit-templates/current
GET /api/config/action-reauth/check?action=CREATE_USER
GET /api/config/action-reauth/my-actions
GET /api/config/tablet-access/my-features
GET /api/config/registry/manifest
GET /api/config/field-ids
```

### Role & User Config
```
GET /api/config/roles/:role            Permission: CONFIG_READ
PUT /api/config/roles/:role            Permission: CONFIG_UPDATE, Reauth
GET /api/config/users/:userId          Permission: CONFIG_READ
PUT /api/config/users/:userId          Permission: CONFIG_UPDATE
GET /api/config/my-config              Public
```

---

## Assets

### Templates
```
GET    /api/assets/templates           Permission: ASSET_VIEW
POST   /api/assets/templates           Permission: ASSET_TEMPLATE_CREATE, Reauth
PUT    /api/assets/templates/:id       Permission: ASSET_TEMPLATE_UPDATE, Reauth
DELETE /api/assets/templates/:id       Permission: ASSET_TEMPLATE_DELETE, Reauth
```

### Template Kinds (admin-editable lookup, Step 1 of architectural refactor)
```
GET    /api/template-kinds             Permission: ASSET_VIEW
POST   /api/template-kinds             Permission: CONFIG_UPDATE
PUT    /api/template-kinds/:code       Permission: CONFIG_UPDATE  (code is immutable; updates label/description/sortOrder/isActive)
DELETE /api/template-kinds/:code       Permission: CONFIG_UPDATE  (rejected with 409 SYSTEM_KIND for system kinds; rejected with 409 IN_USE if any AssetTemplate references this kind)
```
System kinds seeded by `prisma/seed.ts`: BLOCK · AREA · AHU · FILTER · EQUIPMENT · OTHER. Their `code` is the stable identifier the Filter Management / Cleaning Operations / Mobile pages compare against; admins can rename `label` but not `code`.

### Instances
```
GET    /api/assets/instances           Permission: ASSET_VIEW
GET    /api/assets/instances/:id       Permission: ASSET_VIEW
POST   /api/assets/instances           Permission: ASSET_CREATE, Reauth
PUT    /api/assets/instances/:id       Permission: ASSET_UPDATE, Reauth
DELETE /api/assets/instances/:id       Permission: ASSET_DELETE, Reauth
```

### Relationships
```
GET    /api/assets/relationships       Permission: ASSET_VIEW
POST   /api/assets/relationships       Permission: ASSET_RELATIONSHIP_CREATE, Reauth
DELETE /api/assets/relationships/:id   Permission: ASSET_RELATIONSHIP_DELETE, Reauth
```

### Identifiers (RFID, QR, Barcode)
```
GET    /api/assets/identifiers         Permission: ASSET_VIEW
POST   /api/assets/identifiers         Permission: ASSET_IDENTIFIER_CREATE, Reauth
DELETE /api/assets/identifiers/:id     Permission: ASSET_IDENTIFIER_DELETE, Reauth
```

---

## Filter Operations

### Filter State
```
GET /api/filters/:id/current-state     Permission: ASSET_READ
Response: { filter, currentStage, nextActions[], pendingChecklist?, cycle? }
```

### Cleaning Cycle
```
POST /api/filters/:id/start-cycle      Permission: FILTER_OPERATE, Reauth: START_CLEANING_CYCLE
Body: { cleaningReasonKey, cleaningJustification?, equipmentGroupId? }

POST /api/filters/:id/advance          Permission: FILTER_OPERATE
Body: { remarks? }

POST /api/filters/:id/bypass           Permission: FILTER_OPERATE
Body: { reason, remarks }

POST /api/filters/:id/submit-checklist Permission: FILTER_OPERATE, Reauth: SUBMIT_CHECKLIST
Body: { answers: { [questionId]: answer },
        offlinePerformedAt?: ISO timestamp,         // Phase 5b.1: regulatory time
        clientOpId?: UUID,                          // idempotent replay
        expectedProfileVersions?: { [profileId]: int } }  // Phase A.1: drift detection

Response 409 SCHEMA_DRIFT (Phase A.1) — body.details.drift = [{ profileId, expected, current }]
when client's expectedProfileVersions don't match the cycle's pinned versions.

GET  /api/checklist-profiles/:id/versions          List archived versions
GET  /api/checklist-profiles/:id/versions/:n       Fetch immutable snapshot at version n
```

### Cycle & Event History
```
GET /api/filters/cycles                Permission: ASSET_READ
GET /api/filters/cycles/:cycleId       Permission: ASSET_READ
GET /api/filters/events                Permission: ASSET_READ
GET /api/filters/events/:eventId       Permission: ASSET_READ
```

---

## Cleaning Profiles

```
GET    /api/filter-cleaning-profiles           Permission: ASSET_READ
GET    /api/filter-cleaning-profiles/:id       Permission: ASSET_READ
POST   /api/filter-cleaning-profiles           Permission: FILTER_MANAGE, Reauth
PUT    /api/filter-cleaning-profiles/:id       Permission: FILTER_MANAGE, Reauth
DELETE /api/filter-cleaning-profiles/:id       Permission: FILTER_MANAGE, Reauth
POST   /api/filter-cleaning-profiles/:id/validate Permission: FILTER_MANAGE
```

---

## PM Schedules

```
GET    /api/pm-schedules                       Permission: PM_READ
GET    /api/pm-schedules/:id                   Permission: PM_READ
POST   /api/pm-schedules                       Permission: PM_CREATE, Reauth
PUT    /api/pm-schedules/:id                   Permission: PM_UPDATE, Reauth
DELETE /api/pm-schedules/:id                   Permission: PM_DELETE, Reauth

GET    /api/pm-schedules/:id/entries           Permission: PM_READ
POST   /api/pm-schedules/:id/entries           Permission: PM_CREATE
PUT    /api/pm-schedules/:id/entries/:entryId  Permission: PM_UPDATE
```

---

## Report Templates

```
GET    /api/report-templates                   Permission: REPORT_TEMPLATE_READ
GET    /api/report-templates/:id               Permission: REPORT_TEMPLATE_READ
POST   /api/report-templates                   Permission: REPORT_TEMPLATE_CREATE, Reauth
PUT    /api/report-templates/:id               Permission: REPORT_TEMPLATE_UPDATE, Reauth
DELETE /api/report-templates/:id               Permission: REPORT_TEMPLATE_DELETE, Reauth
```

---

## Reports

```
GET    /api/reports                             Permission: REPORT_VIEW
GET    /api/reports/:id                         Permission: REPORT_VIEW
POST   /api/reports                             Permission: REPORT_GENERATE
DELETE /api/reports/:id                         Permission: REPORT_DELETE
GET    /api/reports/:id/export?format=pdf       Permission: REPORT_VIEW
```

---

## Audit Trail

```
GET    /api/audit?page=1&limit=20&search=&period=7d&action=CREATED
Permission: AUDIT_READ
Response: { data: AuditEntry[], total, page, limit }

Filters: period (1d,7d,30d,90d), startDate, endDate, search, userId,
         action, targetType, targetId
Sort: timestamp, action, userId, userRole
```

---

## Backup

```
GET  /api/backup/export?format=json|sql|csv|bak
Permission: CONFIG_UPDATE, Reauth: EXPORT_BACKUP
Response: File download

POST /api/backup/restore
Permission: CONFIG_UPDATE, Reauth: RESTORE_BACKUP
Body: multipart/form-data (backup file)

POST /api/backup/validate
Permission: CONFIG_UPDATE
Body: multipart/form-data (backup file)
```

---

## Notifications

```
GET    /api/notifications?page=1&limit=20&isRead=false
GET    /api/notifications/unread-count
PUT    /api/notifications/mark-all-read
PUT    /api/notifications/:id/read
PUT    /api/notifications/:id/unread
DELETE /api/notifications/:id
```

---

## Data Ingestion (Device API)

Authentication: Device access token (`Authorization: Bearer <device-token>`)

```
POST /api/data/telemetry          Body: { temperature: 25.3, humidity: 60 }
POST /api/data/attributes         Body: { firmware: "1.2.3", location: "Room 4" }
GET  /api/data/attributes         Returns shared attributes
POST /api/data/event              Body: { eventType: "RESTART", details: {...} }
POST /api/data/checklist          Auth: JWT, Body: { answers: [...] }
POST /api/data/binary             multipart/form-data (image/binary upload)
POST /api/data/rpc                Body: { method: "reboot", params: {} }
GET  /api/data/rpc/response/:id   Poll for RPC response
```

---

## Rule Chains

```
GET    /api/rule-chains                        Permission: RULE_CHAIN_VIEW
GET    /api/rule-chains/node-types             Permission: RULE_CHAIN_VIEW
POST   /api/rule-chains                        Permission: RULE_CHAIN_CREATE, Reauth
GET    /api/rule-chains/:id                    Permission: RULE_CHAIN_VIEW
PUT    /api/rule-chains/:id                    Permission: RULE_CHAIN_UPDATE, Reauth
DELETE /api/rule-chains/:id                    Permission: RULE_CHAIN_DELETE, Reauth
POST   /api/rule-chains/:id/test               Permission: RULE_CHAIN_VIEW
```

---

## Connectivity

```
GET    /api/connectivity/:entityId             Permission: ASSET_VIEW
POST   /api/connectivity/:entityId/test        Permission: ASSET_VIEW
GET    /api/connectivity/:entityId/snippets    Permission: ASSET_VIEW
POST   /api/connectivity/:entityId/token       Permission: SUPER_ADMIN/ADMIN
DELETE /api/connectivity/:entityId/token       Permission: SUPER_ADMIN/ADMIN
GET    /api/connectivity/:entityId/history     Permission: ASSET_VIEW
```

---

## Internal Endpoints (Mosquitto dynamic-security)

Phase 1 of the windows-friendly-rewrite swapped the MQTT broker from EMQX to Mosquitto 2.0. Device auth + topic ACLs are now expressed as a `dynamic-security.json` regenerated by the API on demand and reloaded by the broker, instead of HTTP webhook callbacks.

```
POST /api/internal/mqtt/refresh-acl   Regenerate dynamic-security.json from active DeviceCredential rows.
                                       Bearer-auth via MOSQUITTO_REFRESH_TOKEN (timing-safe compare).
                                       After call, copy <repo>/mosquitto/dynamic-security.json to
                                       C:\Program Files\mosquitto\ and Restart-Service mosquitto.
```

> Legacy EMQX webhook endpoints (`/api/internal/mqtt/auth`, `/acl`, `/superuser`) remain conditionally registered when `USE_MOSQUITTO=false` to support EMQX fallback; full removal deferred to a future cleanup phase once no env still has `USE_MOSQUITTO=false` in production.

---

## WebSocket

```
WSS /ws
Auth: token query parameter
Events: entity data updates, alarm notifications, filter state changes
```

---

## Error Response Format

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Username already exists",
  "details": { "field": "username" }
}
```

Common error codes:
- `UNAUTHORIZED` (401) — missing or invalid token
- `FORBIDDEN` (403) — insufficient permissions
- `NOT_FOUND` (404) — resource doesn't exist
- `VALIDATION_ERROR` (400) — invalid request body
- `SESSION_CONFLICT` (409) — another session exists
- `INTERNAL_ERROR` (500) — server error

---

## Permission Reference (109 total — verified by `grep -cE "^\s+[A-Z_]+:\s*'" packages/shared/src/types/permissions.ts`; the list below is illustrative grouping, not exhaustive)

### User Management
`USER_CREATE`, `USER_READ`, `USER_UPDATE`, `USER_DELETE`, `USER_ENABLE_DISABLE`, `USER_UNLOCK`, `USER_RESET_PASSWORD`

### Configuration
`CONFIG_READ`, `CONFIG_UPDATE`, `FIELD_ID_UPDATE`, `ROLE_MANAGE`

### Assets
`ASSET_READ`, `ASSET_VIEW`, `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, `ASSET_TEMPLATE_CREATE`, `ASSET_TEMPLATE_UPDATE`, `ASSET_TEMPLATE_DELETE`, `ASSET_RELATIONSHIP_CREATE`, `ASSET_RELATIONSHIP_DELETE`, `ASSET_IDENTIFIER_CREATE`, `ASSET_IDENTIFIER_DELETE`, `ENTITY_ASSIGN`

### Filter Operations
`FILTER_OPERATE`, `FILTER_BYPASS`, `FILTER_BULK_UPLOAD`, `FILTER_RETIRE`, `FILTER_REPLACE`, `FILTER_STATUS_UPDATE`, `FILTER_HIERARCHY_CREATE`, `FILTER_RFID_MANAGE`

### Cleaning Profiles
`FCP_READ`, `FCP_CREATE`, `FCP_UPDATE`, `FCP_DELETE`, `CP_TOGGLE`, `CP_PAGE_CREATE`, `CP_PAGE_EDIT`, `CP_PAGE_DELETE`

### Checklists
`CHECKLIST_SUBMIT`, `CHECKLIST_CREATE`, `CHECKLIST_EDIT`, `CHECKLIST_DELETE`, `CHECKLIST_TOGGLE`

### PM Schedules
`PM_READ`, `PM_CREATE`, `PM_UPDATE`, `PM_DELETE`, `PM_EXECUTE`, `PM_APPROVE`, `PM_DOWNLOAD_TEMPLATE`, `PM_UPLOAD`, `PM_EDIT_ENTRY`, `PM_RESUBMIT`

### Reports
`REPORT_TEMPLATE_READ`, `REPORT_TEMPLATE_CREATE`, `REPORT_TEMPLATE_UPDATE`, `REPORT_TEMPLATE_DELETE`, `REPORT_GENERATE`, `REPORT_VIEW`, `REPORT_SIGN`, `REPORT_DELETE`, `REPORT_EXPORT`

### Other
`AUDIT_READ`, `AUDIT_EXPORT`, `EVENT_READ`, `CYCLE_READ`, `ALARM_VIEW`, `ALARM_ACKNOWLEDGE`, `ALARM_CLEAR`, `NOTIFICATION_VIEW`, `NOTIFICATION_CREATE`, `NOTIFICATION_UPDATE`, `NOTIFICATION_DELETE`, `NOTIFICATION_MANAGE`, `RULE_CHAIN_VIEW`, `RULE_CHAIN_CREATE`, `RULE_CHAIN_UPDATE`, `RULE_CHAIN_DELETE`, `DASHBOARD_CREATE`, `DASHBOARD_MANAGE`, `DASHBOARD_VIEW`, `DASHBOARD_ASSIGN`, `UNS_VIEW`, `UNS_MANAGE`, `READ_DEBUG_TRACE`, `MANAGE_DEBUG_TRACE`, `BLOCK_CHANGE_REQUEST`, `BLOCK_CHANGE_APPROVE`, `BACKUP_MANAGE`, `EG_VIEW`, `EG_CREATE`, `EG_EDIT`, `EG_DELETE`, `FP_READ`, `FP_CREATE`, `FP_UPDATE`, `FP_DELETE`, `FP_ASSIGN`

> **Note (MT removal 2026-04-30):** `ORG_MANAGE`, `ORG_VIEW`, `ORG_CREATE`, `ORG_DELETE` permissions and the `/api/organizations` + `/api/org-admin` + `/api/tenant-admin` route prefixes were deleted. DigiLog is now single-tenant.
