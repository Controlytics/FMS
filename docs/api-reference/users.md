# User Management API

The User Management API provides endpoints for creating, updating, enabling/disabling, locking/unlocking users, and managing password reset requests.

---

## User CRUD

### POST /api/users

Create a new user account.

**Request:**
```bash
curl -X POST "http://your-server/api/users" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "RB0004",
    "fullName": "Jane Doe",
    "email": "jane@company.com",
    "department": "Quality",
    "role": "OPERATOR",
    "password": "Temp@1234",
    "confirmPassword": "Temp@1234",
    "status": "ENABLED"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | Must match User ID config rules |
| `fullName` | string | Yes | Full display name |
| `email` | string | Yes | Email address |
| `department` | string | No | Department name |
| `role` | string | Yes | Role name (from roles management) |
| `password` | string | Yes | Must meet password policy |
| `confirmPassword` | string | Yes | Must match password |
| `status` | string | No | `ENABLED` or `DISABLED` (default: ENABLED) |

> **Note:** Creating a user requires **re-authentication** (password verification).

**Permission:** `USER_CREATE`

---

### GET /api/users

List users with search and filters.

```bash
GET /api/users?search=jane&role=OPERATOR&status=ENABLED&page=1&limit=20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by username, name, or email |
| `role` | string | Filter by role |
| `status` | string | `ENABLED`, `DISABLED`, `LOCKED`, `EXPIRED` |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 20) |

**Permission:** `USER_READ`

---

### GET /api/users/stats

Get user count statistics grouped by status.

```bash
GET /api/users/stats
```

**Response (200):**
```json
{
  "total": 15,
  "enabled": 12,
  "disabled": 1,
  "locked": 1,
  "expired": 1
}
```

**Permission:** `USER_READ`

---

### GET /api/users/:id

Get full user details.

**Permission:** `USER_READ`

---

### PUT /api/users/:id

Update user properties (name, email, department, role, status).

**Permission:** `USER_UPDATE`

---

### DELETE /api/users/:id

Permanently delete a user and all related data (sessions, audit entries reference).

**Permission:** `USER_DELETE`

---

### POST /api/users/bulk-delete

Delete multiple users at once (max 50).

```bash
curl -X POST "http://your-server/api/users/bulk-delete" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "userIds": ["uuid-1", "uuid-2", "uuid-3"] }'
```

**Permission:** `USER_DELETE`

---

## Account Status Management

### POST /api/users/:id/enable

Re-enable a disabled user account.

**Permission:** `USER_ENABLE_DISABLE`

### POST /api/users/:id/disable

Disable a user account. Terminates all active sessions.

**Permission:** `USER_ENABLE_DISABLE`

### POST /api/users/:id/unlock

Unlock a locked account with a temporary password. User must change password on next login.

```bash
curl -X POST "http://your-server/api/users/USER_UUID/unlock" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newPassword": "Temp@5678" }'
```

**Permission:** `USER_UNLOCK`

---

## Password Management

### POST /api/users/:id/reset-password

Admin-initiated password reset. Sets a temporary password that the user must change on next login.

```bash
curl -X POST "http://your-server/api/users/USER_UUID/reset-password" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "newPassword": "Temp@5678" }'
```

**Permission:** `USER_RESET_PASSWORD`

---

## Password Reset Requests

Users who forget their password can submit a reset request. Administrators review and process these requests.

### GET /api/users/reset-requests

List all password reset requests (pending and processed).

**Response (200):**
```json
{
  "data": [
    {
      "id": "request-uuid",
      "userId": "user-uuid",
      "status": "PENDING",
      "requestedAt": "2026-03-01T08:00:00Z",
      "userFullName": "Jane Doe",
      "userEmail": "jane@company.com",
      "userDepartment": "Quality"
    }
  ]
}
```

### GET /api/users/reset-requests/pending

Get count of pending requests (for notification badge).

```json
{ "count": 2 }
```

### POST /api/users/reset-requests/:id/process

Approve or reject a password reset request.

```bash
curl -X POST "http://your-server/api/users/reset-requests/REQUEST_UUID/process" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve",
    "newPassword": "Temp@5678",
    "notes": "Reset approved per helpdesk ticket #1234"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `approve` or `reject` |
| `newPassword` | string | Conditional | Required when approving |
| `notes` | string | No | Processing notes |

**Permission:** `USER_RESET_PASSWORD`

---

## Next Steps

- [Roles & Permissions](../administration/roles/roles-and-permissions.md) — Access control
- [Security Configuration](../administration/security/security.md) — Password and session policies
- [Authentication API](authentication.md) — Login and session management
