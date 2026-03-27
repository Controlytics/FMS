# Authentication API

All API endpoints (except login and health check) require a valid JWT token in the `Authorization` header.

---

## Base URL

```
http://your-server/api/auth
```

---

## Endpoints

### POST /api/auth/login

Authenticate a user and create a session.

**Request:**
```bash
curl -X POST "http://your-server/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "Admin@123",
    "force": true
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `username` | string | Yes | User's login ID |
| `password` | string | Yes | User's password |
| `force` | boolean | No | Terminate existing session and proceed (default: false) |

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "user": {
    "id": "abc-123",
    "username": "admin",
    "fullName": "System Administrator",
    "role": "SUPER_ADMIN",
    "forcePasswordChange": false,
    "isTemporaryPassword": false
  },
  "expiresIn": "8h"
}
```

**Error Responses:**

| Code | Error | Description |
|------|-------|-------------|
| 401 | `INVALID_CREDENTIALS` | Wrong username or password. Includes `attemptsRemaining`. |
| 403 | `ACCOUNT_LOCKED` | Account locked due to failed attempts |
| 403 | `ACCOUNT_DISABLED` | Account disabled by administrator |
| 403 | `PASSWORD_EXPIRED` | Password has expired |
| 409 | `SESSION_CONFLICT` | Active session exists (use `force: true` to override) |

**Session Conflict Response (409):**
```json
{
  "error": "SESSION_CONFLICT",
  "message": "An active session already exists for this account.",
  "activeSession": {
    "ipAddress": "192.168.1.100",
    "loginTime": "2026-03-01T08:00:00Z",
    "lastActiveAt": "2026-03-01T08:30:00Z"
  }
}
```

---

### POST /api/auth/logout

Terminate the current session.

**Request:**
```bash
curl -X POST "http://your-server/api/auth/logout" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{ "success": true }
```

---

### GET /api/auth/me

Get the current user's profile and permissions.

**Request:**
```bash
curl "http://your-server/api/auth/me" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response (200):**
```json
{
  "id": "abc-123",
  "username": "admin",
  "fullName": "System Administrator",
  "email": "admin@company.com",
  "department": "IT",
  "role": "SUPER_ADMIN",
  "status": "ENABLED",
  "permissions": ["ASSET_MANAGE", "USER_MANAGE", "CONFIG_MANAGE", "NODE_CREATE", ...]
}
```

---

### POST /api/auth/change-password

Change the current user's password.

**Request:**
```bash
curl -X POST "http://your-server/api/auth/change-password" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "OldPass@123",
    "newPassword": "NewPass@456",
    "confirmPassword": "NewPass@456"
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `currentPassword` | string | Yes* | Current password (*not required for temporary passwords) |
| `newPassword` | string | Yes | New password (must meet policy) |
| `confirmPassword` | string | Yes | Must match newPassword |

**Error Responses:**

| Code | Error | Description |
|------|-------|-------------|
| 400 | `INVALID_PASSWORD` | Current password incorrect |
| 400 | `POLICY_VIOLATION` | New password doesn't meet policy |

> **Note:** Changing your password terminates all other active sessions for your account.

---

### PUT /api/auth/profile

Update the current user's profile.

**Request:**
```bash
curl -X PUT "http://your-server/api/auth/profile" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "John Doe",
    "email": "john@company.com",
    "department": "Engineering"
  }'
```

---

### POST /api/auth/verify

Verify the current user's password (for re-authentication).

**Request:**
```bash
curl -X POST "http://your-server/api/auth/verify" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password": "MyPass@123"}'
```

**Response (200):**
```json
{
  "verificationToken": "eyJhbGci..."
}
```

---

### POST /api/auth/forgot-password

Request a password reset (creates a notification for admins).

**Request:**
```bash
curl -X POST "http://your-server/api/auth/forgot-password" \
  -H "Content-Type: application/json" \
  -d '{"username": "RB0001"}'
```

> **Note:** This endpoint always returns 200 regardless of whether the user exists (to prevent user enumeration).

---

## Authentication Headers

All authenticated requests must include:

```
Authorization: Bearer <jwt_token>
```

The JWT token contains:
- `sub` — User ID
- `username` — Username
- `role` — User role
- `sessionId` — Active session ID
- `exp` — Token expiry timestamp

---

## Next Steps

- [Entity API](entities.md) — CRUD operations for entities
- [Telemetry API](telemetry.md) — Data ingestion endpoints
- [Security Configuration](../administration/security/security.md) — Auth settings


> **Note:** Phase 2 adds filter management endpoints. See API_GUIDE.md for the full Phase 2 API reference including filter operations, cleaning profiles, checklist profiles, and PM schedules.

