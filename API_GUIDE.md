# DigiLog API Guide

**Production URL:** `http://3.108.185.106`
**Swagger UI:** `http://3.108.185.106/docs`
**Base API Path:** `/api`

All endpoints require `Authorization: Bearer <token>` header unless noted otherwise.

**~170+ Total API Endpoints -- 27 Tag Groups**
**Last Updated:** 2026-03-05

---

## Table of Contents

1. [Alarms (4)](#alarms)
2. [Attributes (2)](#attributes)
3. [Audit (4)](#audit)
4. [Auth (8)](#auth)
5. [Backup (3)](#backup)
6. [Checklists (2)](#checklists)
7. [Config (33)](#config)
8. [Connectivity (6)](#connectivity)
9. [Data Ingestion (8)](#data-ingestion)
10. [Entities (8)](#entities)
11. [Entity Identifiers (4)](#entity-identifiers)
12. [Entity Relationships (3)](#entity-relationships)
13. [Entity Templates (6)](#entity-templates)
14. [Export (5)](#export)
15. [Health (1)](#health)
16. [Help (6)](#help)
17. [Internal MQTT (3)](#internal-mqtt)
18. [Notifications (9)](#notifications)
19. [QR Codes (4)](#qr-codes)
20. [Retention (4)](#retention)
21. [Roles (8)](#roles)
22. [Rule Chains (14)](#rule-chains)
23. [System Health (1)](#system-health)
24. [Telemetry (3)](#telemetry)
25. [UNS (6)](#uns)
26. [Uploads (1)](#uploads)
27. [Users (14)](#users)

---

## Alarms

4 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/alarms/` | List alarms (paginated, filterable) |
| GET | `/api/alarms/{entityId}` | Get alarms for a specific entity |
| POST | `/api/alarms/{id}/acknowledge` | Acknowledge an alarm (e-signature) |
| POST | `/api/alarms/{id}/clear` | Clear an alarm (e-signature) |

---

## Attributes

2 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/attributes/{entityId}/history` | Get attribute change history |
| GET | `/api/attributes/{entityId}/{scope}` | Get current attributes by scope |

---

## Audit

4 endpoints. JWT auth required. Delete operations require SUPER_ADMIN role.

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/audit/` | Any | Query audit trail (paginated, filterable by date/user/action/targetType) |
| GET | `/api/audit/{id}` | Any | Get audit record by ID (includes checksum integrity verification) |
| DELETE | `/api/audit/{id}` | SUPER_ADMIN | Delete single audit record |
| POST | `/api/audit/bulk-delete` | SUPER_ADMIN | Delete selected audit records |

---

## Auth

8 endpoints. Mixed auth requirements. Rate limiting applied to login and forgot-password.

| Method | Endpoint | Auth | Rate Limit | Description |
|--------|----------|------|------------|-------------|
| POST | `/api/auth/login` | No | 10/min | Login with username/password |
| POST | `/api/auth/logout` | JWT | -- | Logout and invalidate session |
| POST | `/api/auth/beacon-logout` | No | -- | Beacon logout (tab close, token in body) |
| GET | `/api/auth/me` | JWT | -- | Get current user profile |
| PUT | `/api/auth/profile` | JWT | -- | Update own profile (fullName, email, department, photoUrl) |
| POST | `/api/auth/change-password` | JWT | -- | Change own password |
| POST | `/api/auth/verify` | JWT | -- | Re-authenticate (returns verification token) |
| POST | `/api/auth/forgot-password` | No | 5/5min | Submit password reset request |

---

## Backup

3 endpoints. Requires ADMIN+ role. Export and restore use reauth.

| Method | Endpoint | Reauth | Description |
|--------|----------|--------|-------------|
| GET | `/api/backup/export` | EXPORT_BACKUP | Export database backup (ZIP) |
| POST | `/api/backup/restore` | RESTORE_BACKUP | Restore from backup |
| POST | `/api/backup/validate` | -- | Validate backup file |

---

## Checklists

2 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/checklist/{entityId}/responses` | List checklist responses for an entity |
| GET | `/api/checklist/{entityId}/responses/{checklistId}` | Get single checklist response |

---

## Config

33 endpoints. Various auth requirements. PUT operations generally require reauth.

### Security & Session

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/password-policy` | ADMIN+ | -- | Get password policy |
| PUT | `/api/config/password-policy` | ADMIN+ | UPDATE_PASSWORD_POLICY | Update password policy |
| GET | `/api/config/login-security` | ADMIN+ | -- | Get login security settings |
| PUT | `/api/config/login-security` | ADMIN+ | UPDATE_LOGIN_SECURITY | Update login security |
| GET | `/api/config/session` | ADMIN+ | -- | Get session config |
| PUT | `/api/config/session` | ADMIN+ | UPDATE_SESSION_CONFIG | Update session config |

### DateTime

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/datetime` | ADMIN+ | Get datetime config |
| PUT | `/api/config/datetime` | ADMIN+ | Update datetime config |
| GET | `/api/config/datetime/current` | Any (public) | Get effective datetime format |

### Pagination

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/pagination` | ADMIN+ | Get pagination config |
| PUT | `/api/config/pagination` | ADMIN+ | Update pagination config |
| GET | `/api/config/pagination/current` | Any | Get effective pagination options |

### User ID

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/user-id` | ADMIN+ | -- | Get user ID config |
| PUT | `/api/config/user-id` | SUPER_ADMIN | UPDATE_USERID_CONFIG | Update user ID config |
| GET | `/api/config/user-id/next` | ADMIN+ | -- | Get next auto-generated ID |
| POST | `/api/config/user-id/validate` | ADMIN+ | -- | Validate a user ID against rules |

### Branding

| Method | Endpoint | Auth | Reauth | Description |
|--------|----------|------|--------|-------------|
| GET | `/api/config/branding` | No (public) | -- | Get branding config |
| PUT | `/api/config/branding` | SUPER_ADMIN | UPDATE_BRANDING | Update branding (colors, logo, app name) |

### Role Configuration

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/config/roles` | ADMIN+ | -- | Get all role configs |
| GET | `/api/config/roles/{role}` | ADMIN+ | -- | Get single role config |
| PUT | `/api/config/roles/{role}` | SUPER_ADMIN | UPDATE_ROLE_CONFIG | Update role config |

### User Configuration

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/users/{userId}` | ADMIN+ | Get user-specific config |
| PUT | `/api/config/users/{userId}` | ADMIN+ | Update user-specific config |
| GET | `/api/config/my-config` | Any | Get current user's effective config |

### Field IDs

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/field-ids` | Any | List all field ID configs |
| PUT | `/api/config/field-ids/{fieldId}` | SUPER_ADMIN | Update field display name |

### Action Re-authentication

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/action-reauth` | SUPER_ADMIN | Get full reauth config matrix |
| PUT | `/api/config/action-reauth` | SUPER_ADMIN | Update reauth config |
| GET | `/api/config/action-reauth/check` | Any | Check if specific action requires reauth |
| GET | `/api/config/action-reauth/my-actions` | Any | Get reauth actions for current user's role |

### Audit Text Templates

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/audit-templates` | SUPER_ADMIN | Get full templates config |
| PUT | `/api/config/audit-templates` | SUPER_ADMIN | Update audit message templates |
| GET | `/api/config/audit-templates/current` | Any | Get effective templates (defaults + overrides) |

---

## Connectivity

6 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connectivity/{entityId}` | Get connectivity status |
| GET | `/api/connectivity/{entityId}/history` | Get connection history |
| GET | `/api/connectivity/{entityId}/snippets` | Get code snippets (Python/Node.js/cURL/Arduino) |
| POST | `/api/connectivity/{entityId}/test` | Test entity connectivity |
| POST | `/api/connectivity/{entityId}/token` | Generate device token |
| DELETE | `/api/connectivity/{entityId}/token` | Revoke device token |

---

## Data Ingestion

8 endpoints. Mixed auth: device token auth for device-facing endpoints, JWT auth for user-facing endpoints.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/data/telemetry` | Device Token | Submit telemetry data |
| POST | `/api/data/attributes` | Device Token | Submit device attributes |
| GET | `/api/data/attributes` | Device Token | Get shared attributes |
| POST | `/api/data/binary` | Device Token | Submit binary data |
| POST | `/api/data/checklist` | JWT | Submit checklist response |
| POST | `/api/data/event` | Device Token | Submit device event |
| POST | `/api/data/rpc` | JWT | Send RPC request |
| GET | `/api/data/rpc/response/{requestId}` | JWT | Get RPC response |

**Device Token auth:** Use `Authorization: Bearer <device-token>` where the token is generated via `POST /api/connectivity/{entityId}/token`.

---

## Entities

8 endpoints. All use `requirePermission()` (checks role.permissions JSON array in DB).

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/instances` | ASSET_VIEW | -- | List instances (paginated, filterable) |
| POST | `/api/assets/instances` | ASSET_CREATE | CREATE_ASSET | Create instance |
| GET | `/api/assets/instances/tree` | ASSET_VIEW | -- | Get flat array for tree building |
| GET | `/api/assets/instances/{id}` | ASSET_VIEW | -- | Get instance by ID |
| PUT | `/api/assets/instances/{id}` | ASSET_UPDATE | UPDATE_ASSET | Update instance |
| DELETE | `/api/assets/instances/{id}` | ASSET_DELETE | DELETE_ASSET | Soft-delete (cascade to descendants) |
| PATCH | `/api/assets/instances/{id}/status` | ASSET_UPDATE | UPDATE_ASSET | Change instance status |
| GET | `/api/assets/instances/{id}/children` | ASSET_VIEW | -- | Get direct children |

---

## Entity Identifiers

4 endpoints. All use `requirePermission()`.

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/identifiers` | ASSET_VIEW | -- | List identifiers |
| POST | `/api/assets/identifiers` | ASSET_IDENTIFIER_MANAGE | CREATE_ASSET_IDENTIFIER | Create identifier |
| GET | `/api/assets/identifiers/lookup/{value}` | ASSET_VIEW | -- | Lookup by identifier value |
| DELETE | `/api/assets/identifiers/{id}` | ASSET_IDENTIFIER_MANAGE | DELETE_ASSET_IDENTIFIER | Delete identifier |

---

## Entity Relationships

3 endpoints. All use `requirePermission()`.

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/relationships` | ASSET_VIEW | -- | List relationships |
| POST | `/api/assets/relationships` | ASSET_RELATIONSHIP_MANAGE | CREATE_ASSET_RELATIONSHIP | Create relationship (auto-creates inverse, cycle detection) |
| DELETE | `/api/assets/relationships/{id}` | ASSET_RELATIONSHIP_MANAGE | DELETE_ASSET_RELATIONSHIP | Delete relationship (deletes both sides) |

---

## Entity Templates

6 endpoints. All use `requirePermission()`.

| Method | Endpoint | Permission | Reauth | Description |
|--------|----------|-----------|--------|-------------|
| GET | `/api/assets/templates` | ASSET_VIEW | -- | List templates |
| POST | `/api/assets/templates` | ASSET_TEMPLATE_MANAGE | CREATE_ASSET_TEMPLATE | Create template |
| GET | `/api/assets/templates/{id}` | ASSET_VIEW | -- | Get template by ID |
| PUT | `/api/assets/templates/{id}` | ASSET_TEMPLATE_MANAGE | UPDATE_ASSET_TEMPLATE | Update template (increments version) |
| DELETE | `/api/assets/templates/{id}` | ASSET_TEMPLATE_MANAGE | DELETE_ASSET_TEMPLATE | Soft-delete template |
| GET | `/api/assets/templates/{id}/versions` | ASSET_VIEW | -- | List template version history |

---

## Export

5 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export/alarms` | Export alarms (CSV/JSON) |
| GET | `/api/export/attributes/{entityId}` | Export attribute history |
| GET | `/api/export/checklist/{entityId}` | Export checklist responses |
| GET | `/api/export/status/{jobId}` | Check export job status |
| GET | `/api/export/telemetry/{entityId}` | Export telemetry data |

---

## Health

1 endpoint. No auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check (public) |

---

## Help

6 endpoints. JWT auth required. Write operations require SUPER_ADMIN.

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/help/` | Any | List help articles |
| POST | `/api/help/` | SUPER_ADMIN | Create help article |
| GET | `/api/help/{key}` | Any | Get article by key |
| PUT | `/api/help/{id}` | SUPER_ADMIN | Update article (versioned) |
| DELETE | `/api/help/{id}` | SUPER_ADMIN | Delete article |
| GET | `/api/help/{id}/versions` | ADMIN+ | Article version history |

---

## Internal MQTT

3 endpoints. Internal use only (EMQX broker callbacks). Not exposed to external clients.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/internal/mqtt/auth` | MQTT client authentication callback |
| POST | `/api/internal/mqtt/acl` | MQTT ACL authorization callback |
| POST | `/api/internal/mqtt/superuser` | MQTT superuser check callback |

---

## Notifications

9 endpoints. JWT auth required. Bulk delete requires SUPER_ADMIN.

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/notifications/` | Any | List notifications (role-filtered) |
| GET | `/api/notifications/unread-count` | Any | Get unread count |
| PUT | `/api/notifications/{id}/read` | Any | Mark as read |
| PUT | `/api/notifications/{id}/unread` | Any | Mark as unread |
| PUT | `/api/notifications/mark-all-read` | Any | Mark all as read |
| PUT | `/api/notifications/bulk-read` | Any | Bulk mark as read |
| PUT | `/api/notifications/bulk-unread` | Any | Bulk mark as unread |
| DELETE | `/api/notifications/{id}` | Any | Delete notification |
| POST | `/api/notifications/bulk-delete` | SUPER_ADMIN | Bulk delete notifications |

---

## QR Codes

4 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/qr/{entityId}` | Get QR code data |
| DELETE | `/api/qr/{entityId}` | Delete QR code |
| POST | `/api/qr/{entityId}/generate` | Generate QR code |
| GET | `/api/qr/{entityId}/svg` | Get QR code as SVG |

---

## Retention

4 endpoints. Mixed: config endpoints under `/api/config/retention`, execution under `/api/retention`.

| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/api/config/retention` | SUPER_ADMIN | Get retention policies |
| PUT | `/api/config/retention` | SUPER_ADMIN | Update retention policies |
| POST | `/api/retention/archive` | SUPER_ADMIN | Archive data |
| POST | `/api/retention/execute` | SUPER_ADMIN | Execute retention cleanup |

---

## Roles

8 endpoints. Read operations require ADMIN+. Write operations require SUPER_ADMIN.

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/roles/` | ADMIN+ | -- | List all roles |
| POST | `/api/roles/` | SUPER_ADMIN | CREATE_ROLE | Create custom role |
| GET | `/api/roles/active` | Any | -- | List active roles (for dropdowns) |
| GET | `/api/roles/permissions/all` | SUPER_ADMIN | -- | List all available permissions |
| GET | `/api/roles/{name}` | ADMIN+ | -- | Get role by name |
| PUT | `/api/roles/{name}` | SUPER_ADMIN | UPDATE_ROLE | Update role |
| DELETE | `/api/roles/{name}` | SUPER_ADMIN | DELETE_ROLE | Delete role |
| GET | `/api/roles/{name}/creatable` | ADMIN+ | -- | Get creatable roles for this role |

---

## Rule Chains

14 endpoints. All require ADMIN+ role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rule-chains/` | List rule chains |
| POST | `/api/rule-chains/` | Create rule chain |
| GET | `/api/rule-chains/node-types` | List available node types |
| GET | `/api/rule-chains/{id}` | Get rule chain by ID (with nodes and connections) |
| PUT | `/api/rule-chains/{id}` | Update rule chain metadata |
| DELETE | `/api/rule-chains/{id}` | Delete rule chain |
| POST | `/api/rule-chains/{id}/save` | Save full chain state (nodes + connections) |
| POST | `/api/rule-chains/{id}/nodes` | Add node to chain |
| PUT | `/api/rule-chains/{id}/nodes/{nodeId}` | Update node |
| DELETE | `/api/rule-chains/{id}/nodes/{nodeId}` | Delete node |
| POST | `/api/rule-chains/{id}/connections` | Add connection between nodes |
| DELETE | `/api/rule-chains/{id}/connections/{connectionId}` | Delete connection |
| GET | `/api/rule-chains/{id}/debug` | Get debug buffer |
| DELETE | `/api/rule-chains/{id}/debug` | Clear debug buffer |

---

## System Health

1 endpoint. Requires ADMIN+ role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/system-health/` | Get system health metrics (queue sizes, uptime, memory) |

---

## Telemetry

3 endpoints. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/telemetry/{entityId}/keys` | List available telemetry keys |
| GET | `/api/telemetry/{entityId}/latest` | Get latest telemetry values |
| GET | `/api/telemetry/{entityId}/timeseries` | Query time-series data (with aggregation) |

---

## UNS

6 endpoints. Unified Namespace (ISA-95) hierarchy management. All require ADMIN+ role.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/uns/tree` | Get full UNS hierarchy tree |
| GET | `/api/uns/search` | Search by wildcard pattern |
| GET | `/api/uns/entity/{entityId}` | Get entity UNS mapping |
| PUT | `/api/uns/entity/{entityId}` | Override entity UNS path |
| POST | `/api/uns/entity/{entityId}/move` | Generate move impact report |
| POST | `/api/uns/entity/{entityId}/move/confirm` | Confirm and execute cascade move |

---

## Uploads

1 endpoint. JWT auth required.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/uploads/photo` | Upload profile photo (5MB max, multipart/form-data) |

Static file serving: `GET /uploads/{filename}` (public, no auth, served by Fastify static).

---

## Users

14 endpoints. All require ADMIN+ role. Mutations use reauth.

| Method | Endpoint | Roles | Reauth | Description |
|--------|----------|-------|--------|-------------|
| GET | `/api/users/` | ADMIN+ | -- | List users (paginated, filterable) |
| POST | `/api/users/` | ADMIN+ | CREATE_USER | Create user |
| GET | `/api/users/stats` | ADMIN+ | -- | User count stats by status |
| GET | `/api/users/{id}` | ADMIN+ | -- | Get user by ID |
| PUT | `/api/users/{id}` | ADMIN+ | UPDATE_USER | Update user |
| DELETE | `/api/users/{id}` | SUPER_ADMIN | DELETE_USER | Delete user |
| POST | `/api/users/{id}/enable` | ADMIN+ | ENABLE_USER | Enable user account |
| POST | `/api/users/{id}/disable` | ADMIN+ | DISABLE_USER | Disable user account |
| POST | `/api/users/{id}/unlock` | ADMIN+ | UNLOCK_USER | Unlock locked account |
| POST | `/api/users/{id}/reset-password` | ADMIN+ | RESET_PASSWORD | Admin password reset |
| POST | `/api/users/bulk-delete` | SUPER_ADMIN | BULK_DELETE_USERS | Bulk delete users |
| GET | `/api/users/reset-requests` | ADMIN+ | -- | List password reset requests |
| GET | `/api/users/reset-requests/pending` | ADMIN+ | -- | Pending reset request count |
| POST | `/api/users/reset-requests/{id}/process` | ADMIN+ | PROCESS_RESET_REQUEST | Process reset request |

---

## Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 100 req/min per IP |
| Login (`POST /api/auth/login`) | 10 req/min per IP |
| Forgot Password (`POST /api/auth/forgot-password`) | 5 req/5min per IP |

---

## Authentication Flow

1. **Login:** `POST /api/auth/login` with `{ username, password }` returns `{ token, user }`
2. **Use token:** Include `Authorization: Bearer <token>` on all subsequent requests
3. **Re-auth:** For sensitive actions, send password via `_currentPassword` body field or `x-reauth-password` header
4. **Logout:** `POST /api/auth/logout` or `POST /api/auth/beacon-logout` (tab close)

## Device Token Auth

Device-facing Data Ingestion endpoints use per-entity device tokens:
1. **Generate token:** `POST /api/connectivity/{entityId}/token` (JWT auth)
2. **Use token:** Include `Authorization: Bearer <device-token>` on data ingestion requests
3. **Revoke token:** `DELETE /api/connectivity/{entityId}/token` (JWT auth)

## Permission System

- **Entity routes** use `requirePermission()` -- checks `role.permissions` JSON array in DB
- **Non-entity routes** use `requireRole()` -- checks role name string
- **39 permissions** across categories: Entity, User, Config, Audit, Approval, Data Ingestion, Rule Chain, Alarm, UNS, and more

---

## Response Formats

### Paginated Response
```json
{
  "data": [],
  "total": 100,
  "page": 1,
  "limit": 20,
  "totalPages": 5
}
```

### Tree Response (flat array)
```json
[
  { "id": "...", "name": "...", "parentId": null, "templateId": "..." },
  { "id": "...", "name": "...", "parentId": "parent-id" }
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
