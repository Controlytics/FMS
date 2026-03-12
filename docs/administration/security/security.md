# Security Configuration

DigiLog provides comprehensive security settings for password policies, login protection, session management, and account lockout. These settings are configured through the **Configuration** section and enforce 21 CFR Part 11 compliance requirements.

---

## Password Policy

Configure password complexity and lifecycle requirements.

Navigate to **Configuration** → **Password Policy**.

### Complexity Requirements

| Setting | Default | Description |
|---------|---------|-------------|
| **Minimum Length** | 8 | Minimum password characters |
| **Maximum Length** | 128 | Maximum password characters |
| **Require Uppercase** | Yes | At least N uppercase letters |
| **Min Uppercase** | 1 | Minimum uppercase count |
| **Require Lowercase** | Yes | At least N lowercase letters |
| **Min Lowercase** | 1 | Minimum lowercase count |
| **Require Numbers** | Yes | At least N digits |
| **Min Numbers** | 1 | Minimum digit count |
| **Require Special Characters** | Yes | At least N special characters |
| **Min Special Characters** | 1 | Minimum special character count |

### Password Restrictions

| Setting | Default | Description |
|---------|---------|-------------|
| **Cannot Be User ID** | Yes | Password cannot match username |
| **Cannot Contain User ID** | Yes | Password cannot contain username |
| **Prevent Reuse Count** | 12 | Cannot reuse last N passwords |
| **Max Failed Attempts** | 10 | Lock account after N failed logins |

### Password Expiry

| Setting | Default | Description |
|---------|---------|-------------|
| **Password Expiry Days** | 90 | Password expires after N days |

> **Note:** SUPER_ADMIN accounts are exempt from password expiry. Their passwords never expire.

When a password expires:
1. The user is prompted to change their password on next login.
2. They can only access the change password page until they set a new password.
3. The new password must meet all policy requirements.

---

## Login Security

Configure account lockout behavior.

Navigate to **Configuration** → **Login Security**.

### Lockout Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Lockout Type** | TEMPORARY | TEMPORARY (auto-unlock) or PERMANENT (admin required) |
| **Lockout Duration (minutes)** | 30 | For TEMPORARY lockout: minutes until auto-unlock |

### Lockout Flow

```
Failed login attempt
        │
        ▼
  Increment failed counter
        │
        ▼
  Counter >= maxFailedAttempts?
   │ No              │ Yes
   ▼                 ▼
  Return error    Lock account
  with attempts   ├── TEMPORARY: Set lockoutUntil = now + duration
  remaining       └── PERMANENT: Requires admin unlock
```

### What Happens When Locked

- The user receives an "Account locked" error.
- A notification is sent to ADMIN users.
- The user receives a personal notification about the lock.
- An audit record is created.
- For TEMPORARY lockout: the account auto-unlocks after the configured duration.
- For PERMANENT lockout: an administrator must manually unlock the account.

> **Important:** SUPER_ADMIN accounts are exempt from lockout. They can always retry login regardless of failed attempts.

---

## Session Configuration

Configure session lifetime and idle timeout behavior.

Navigate to **Configuration** → **Session**.

### Session Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Session Duration (hours)** | 8 | Maximum session lifetime |
| **Auto-Logout Enabled** | Yes | Enable idle timeout |
| **Idle Timeout (minutes)** | 30 | Time before idle logout |
| **Warning (minutes)** | 5 | Countdown warning before idle logout |

### Single-Tab Enforcement

DigiLog enforces single active browser tab per user via the `useSingleTab()` hook, which uses localStorage heartbeat and cross-tab coordination. Opening DigiLog in a second tab will prompt the user to close one.

### Sliding Window

Sessions use a **sliding window** — the session expiry extends with each authenticated request. Active users are never logged out mid-session. There is also an absolute 24-hour timeout regardless of activity.

- Each API request resets the `expiresAt` timestamp to `now + sessionDurationHours`.
- The session configuration is cached (1-minute TTL) to avoid database overhead.
- Idle users who make no requests will expire at the original expiry time.

### Idle Timeout

The frontend tracks user activity (mouse movement, keyboard, clicks, scrolling):

1. If no activity for `idleTimeoutMinutes - warningMinutes`, a warning dialog appears.
2. A countdown timer shows remaining seconds.
3. The user can click **Continue** to reset the timer.
4. If the countdown reaches zero, the user is logged out.

### Session Invalidation on Password Change

When a user changes their password:
- All other active sessions for that user are immediately terminated.
- The current session (where the password was changed) remains active.
- Terminated sessions are marked with reason: `password_changed`.

---

## Action Re-authentication

For sensitive actions (alarm acknowledgment, entity deletion), users may be required to re-enter their password. This provides an additional layer of non-repudiation per 21 CFR Part 11.

Configure in **Configuration** → **Action Re-authentication** (SUPER_ADMIN only).

---

## Security Headers

DigiLog configures the following HTTP security headers:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | SAMEORIGIN | Prevents clickjacking |
| `X-Content-Type-Options` | nosniff | Prevents MIME type sniffing |
| `X-XSS-Protection` | 1; mode=block | XSS filter |
| `Referrer-Policy` | strict-origin-when-cross-origin | Controls referrer information |
| `Permissions-Policy` | camera=(), microphone=(), geolocation=() | Restricts browser features |
| `Strict-Transport-Security` | max-age=31536000 | HTTPS enforcement (via Fastify helmet) |

### Rate Limiting

DigiLog applies rate limiting to prevent brute-force attacks:
- **Global limit:** 500 requests per minute per client IP
- **Login endpoint:** Additional per-route rate limiting
- **Proxy trust:** Configured to trust exactly 1 proxy hop (nginx), preventing IP spoofing via `X-Forwarded-For`

---

## Next Steps

- [User Management](../users/user-management.md) — Create and manage user accounts
- [Roles & Permissions](../roles/roles-and-permissions.md) — Permission matrix
- [Audit Trail](../audit/audit-trail.md) — Security event logging
- [21 CFR Part 11](../../compliance/21-cfr-part-11.md) — Compliance details
