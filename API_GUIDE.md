# DigiLog API Guide

Base URL: `http://localhost:3000/api`

All endpoints require `Authorization: Bearer <token>` header except login, health, and branding.

---

## Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | No | Login with username/password |
| POST | `/api/auth/logout` | Yes | Logout and invalidate session |
| GET | `/api/auth/me` | Yes | Get current user profile |
| POST | `/api/auth/change-password` | Yes | Change own password |
| POST | `/api/auth/verify` | Yes | Re-authenticate with password |
| POST | `/api/auth/forgot-password` | No | Submit password reset request |

## Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |

## Users

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/users` | Yes | SUPER_ADMIN, ADMIN | List users (paginated, filterable) |
| POST | `/api/users` | Yes | SUPER_ADMIN, ADMIN | Create user |
| GET | `/api/users/:id` | Yes | SUPER_ADMIN, ADMIN | Get user by ID |
| PUT | `/api/users/:id` | Yes | SUPER_ADMIN, ADMIN | Update user |
| DELETE | `/api/users/:id` | Yes | SUPER_ADMIN, ADMIN | Delete/disable user |
| POST | `/api/users/:id/enable` | Yes | SUPER_ADMIN, ADMIN | Enable user |
| POST | `/api/users/:id/disable` | Yes | SUPER_ADMIN, ADMIN | Disable user |
| POST | `/api/users/:id/unlock` | Yes | SUPER_ADMIN, ADMIN | Unlock locked account |
| POST | `/api/users/:id/reset-password` | Yes | SUPER_ADMIN, ADMIN | Reset user password |
| GET | `/api/users/reset-requests` | Yes | SUPER_ADMIN, ADMIN | List password reset requests |
| POST | `/api/users/reset-requests/:id/process` | Yes | SUPER_ADMIN, ADMIN | Process reset request |

## Roles

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/roles` | Yes | SUPER_ADMIN, ADMIN | List all roles |
| GET | `/api/roles/active` | Yes | Any | List active roles |
| GET | `/api/roles/:name` | Yes | SUPER_ADMIN, ADMIN | Get role by name |
| POST | `/api/roles` | Yes | SUPER_ADMIN | Create role |
| PUT | `/api/roles/:name` | Yes | SUPER_ADMIN | Update role |
| DELETE | `/api/roles/:name` | Yes | SUPER_ADMIN | Delete role |
| GET | `/api/roles/:name/creatable` | Yes | Any | Get roles this role can create |

## Configuration

### Standard Config (GET + PUT via configEndpoint pattern)

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/password-policy` | Yes | SUPER_ADMIN, ADMIN | Get password policy |
| PUT | `/api/config/password-policy` | Yes | SUPER_ADMIN, ADMIN | Update password policy |
| GET | `/api/config/login-security` | Yes | SUPER_ADMIN, ADMIN | Get login security settings |
| PUT | `/api/config/login-security` | Yes | SUPER_ADMIN, ADMIN | Update login security |
| GET | `/api/config/session` | Yes | SUPER_ADMIN, ADMIN | Get session config |
| PUT | `/api/config/session` | Yes | SUPER_ADMIN, ADMIN | Update session config |
| GET | `/api/config/datetime` | Yes | SUPER_ADMIN, ADMIN | Get datetime config |
| PUT | `/api/config/datetime` | Yes | SUPER_ADMIN, ADMIN | Update datetime config |
| GET | `/api/config/pagination` | Yes | SUPER_ADMIN, ADMIN | Get pagination config |
| PUT | `/api/config/pagination` | Yes | SUPER_ADMIN, ADMIN | Update pagination config |
| GET | `/api/config/pagination/current` | Yes | Any | Get effective pagination options |

### User ID Config

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/user-id` | Yes | SUPER_ADMIN, ADMIN | Get user ID config |
| PUT | `/api/config/user-id` | Yes | SUPER_ADMIN | Update user ID config |
| GET | `/api/config/user-id/next` | Yes | SUPER_ADMIN, ADMIN | Get next auto-generated ID |
| POST | `/api/config/user-id/validate` | Yes | SUPER_ADMIN, ADMIN | Validate a user ID |

### Branding

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/config/branding` | No | Get branding config |
| PUT | `/api/config/branding` | Yes (SUPER_ADMIN) | Update branding |

### Role Configuration

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/roles` | Yes | SUPER_ADMIN, ADMIN | Get all role configs |
| GET | `/api/config/roles/:role` | Yes | SUPER_ADMIN, ADMIN | Get single role config |
| PUT | `/api/config/roles/:role` | Yes | SUPER_ADMIN | Update role config |

### User Configuration

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/users/:userId` | Yes | SUPER_ADMIN, ADMIN | Get user-specific config |
| PUT | `/api/config/users/:userId` | Yes | SUPER_ADMIN, ADMIN | Update user-specific config |
| GET | `/api/config/my-config` | Yes | Any | Get current user's effective config |

### Field IDs

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/field-ids` | Yes | Any | List all field ID configs |
| PUT | `/api/config/field-ids/:fieldId` | Yes | SUPER_ADMIN | Update field display name |

### Action Re-authentication

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/action-reauth` | Yes | SUPER_ADMIN | Get full reauth config matrix |
| PUT | `/api/config/action-reauth` | Yes | SUPER_ADMIN | Update reauth config |
| GET | `/api/config/action-reauth/check?action=X` | Yes | Any | Check if action requires reauth |
| GET | `/api/config/action-reauth/my-actions` | Yes | Any | Get reauth actions for current role |

### Audit Text Templates

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/config/audit-templates` | Yes | SUPER_ADMIN | Get full templates config |
| PUT | `/api/config/audit-templates` | Yes | SUPER_ADMIN | Update templates |
| GET | `/api/config/audit-templates/current` | Yes | Any | Get effective templates (defaults + overrides) |

## Hierarchy (Asset Management)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/hierarchy` | Yes | List nodes (paginated) |
| GET | `/api/hierarchy/tree` | Yes | Get full hierarchy tree |
| POST | `/api/hierarchy` | Yes | Create node |
| GET | `/api/hierarchy/:id` | Yes | Get node by ID |
| GET | `/api/hierarchy/:id/ancestors` | Yes | Get node ancestors |
| PUT | `/api/hierarchy/:id` | Yes | Update node |
| DELETE | `/api/hierarchy/:id` | Yes | Delete node |
| POST | `/api/hierarchy/:id/identifiers` | Yes | Add physical identifier |

## Templates

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/templates` | Yes | List templates (paginated) |
| POST | `/api/templates` | Yes | Create template |
| GET | `/api/templates/:id` | Yes | Get template by ID |
| PUT | `/api/templates/:id` | Yes | Update template |

## Audit Trail

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/audit` | Yes | Query audit trail (paginated, filterable) |
| GET | `/api/audit/:id` | Yes | Get single audit record |

## Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/notifications` | Yes | List notifications (paginated) |
| GET | `/api/notifications/unread-count` | Yes | Get unread count |
| PUT | `/api/notifications/:id/read` | Yes | Mark as read |
| PUT | `/api/notifications/:id/unread` | Yes | Mark as unread |

## Uploads

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/uploads/photo` | Yes | Upload photo |

## Backup & Restore

| Method | Endpoint | Auth | Roles | Description |
|--------|----------|------|-------|-------------|
| GET | `/api/backup/export` | Yes | SUPER_ADMIN | Export database backup |
| POST | `/api/backup/restore` | Yes | SUPER_ADMIN | Restore from backup |

---

## Error Response Format

All errors follow this format:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message"
}
```

Common error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `REAUTH_REQUIRED`, `REAUTH_FAILED`, `CONCURRENT_SESSION`, `TOKEN_EXPIRED`.
