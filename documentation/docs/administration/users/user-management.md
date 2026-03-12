# User Management

DigiLog provides comprehensive user management with role-based access control, password policies, account lockout protection, and full audit trail for all user operations.

---

## User Properties

| Field | Required | Description |
|-------|----------|-------------|
| **Username** | Yes | Unique login identifier (auto-generated or custom format) |
| **Full Name** | Yes | Display name (2-100 characters) |
| **Email** | No | Contact email address |
| **Role** | Yes | One of the built-in roles or a custom dynamic role |
| **Department** | No | Organizational department |
| **Status** | Auto | ENABLED, LOCKED, DISABLED, or EXPIRED |
| **Temporary Password** | Auto | Set on creation, user must change on first login |
| **Photo** | No | Profile photo upload |

---

## Creating Users

### Steps

1. Navigate to **Users** from the left sidebar.
2. Click **Create User**.
3. Fill in the user details:
   - Username (auto-generated based on User ID configuration, or custom)
   - Full Name
   - Email (optional)
   - Role
   - Department (optional)
4. A temporary password is auto-generated.
5. Click **Create**.

### First Login

When a new user logs in with their temporary password:
1. They are redirected to the **Change Password** page.
2. They must set a new password that meets the password policy.
3. The new password cannot be the same as the temporary password.
4. After changing, they are redirected to the dashboard.

### Required Permission

Creating users requires the `USER_CREATE` permission (ADMIN role or higher).

---

## User Roles

DigiLog includes six hierarchical roles. Users can only create accounts with a role lower than their own.

| Role | Level | Can Create |
|------|-------|-----------|
| **SUPER_ADMIN** | 6 | All roles below |
| **ADMIN** | 5 | Supervisor, Maintenance, Operator, Viewer |
| **SUPERVISOR** | 4 | Maintenance, Operator, Viewer |
| **MAINTENANCE** | 3 | Operator, Viewer |
| **OPERATOR** | 2 | Viewer |
| **VIEWER** | 1 | None |

See [Roles & Permissions](../roles/roles-and-permissions.md) for the full permission matrix.

---

## User Status

| Status | Description | Recovery |
|--------|-------------|----------|
| **ENABLED** | Normal active account | — |
| **LOCKED** | Locked due to failed login attempts | Auto-unlock after lockout duration, or admin unlock |
| **DISABLED** | Manually disabled by administrator | Admin must re-enable |
| **EXPIRED** | Password has expired | Must change password on next login |

### SUPER_ADMIN Protection

The SUPER_ADMIN account has special protections:
- **Exempt from lockout** — Never gets locked regardless of failed attempts
- **Exempt from password expiry** — Password never expires
- **Auto-recovery** — Automatically unlocks if somehow locked

---

## Editing Users

1. Navigate to **Users** and click on a user.
2. Edit fields: Full Name, Email, Department, Role, Status.
3. Click **Save**.

### Resetting Passwords

Administrators can reset a user's password:
1. Open the user's profile.
2. Click **Reset Password**.
3. A new temporary password is generated.
4. The user must change it on next login.

### Disabling Users

1. Open the user's profile.
2. Change status to **DISABLED**.
3. The user can no longer log in.
4. All active sessions are terminated.

---

## Password Reset Requests

Users who forget their password can request a reset:

1. On the login page, click **Forgot Password?**
2. Enter their username.
3. A notification is sent to administrators.
4. Admins can view pending requests at **Users** → **Reset Requests**.
5. Admin approves the request and generates a new temporary password.

---

## Session Management

### Single Session Policy

DigiLog enforces a single active session per user:
- When a user logs in while another session is active, they see a **Session Conflict** dialog.
- They can choose to **Continue Here** (terminates the old session) or **Cancel**.
- The `force: true` parameter in the API terminates existing sessions automatically.

### Session Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Session Duration | 8 hours | Maximum session lifetime |
| Idle Timeout | 30 minutes | Auto-logout after inactivity |
| Warning Before Timeout | 5 minutes | Countdown warning before idle logout |
| Sliding Window | Enabled | Session extends on each activity |

Configure in **Configuration** → **Session**.

### Session Invalidation

Sessions are automatically terminated when:
- The user logs out
- The user changes their password (all other sessions terminated)
- An admin disables the user account
- The session expires (idle or maximum duration)
- A new login terminates the existing session

---

## User ID Configuration

Administrators can configure the username auto-generation format:

| Setting | Description |
|---------|-------------|
| **Prefix** | Username prefix (e.g., "RB", "USR") |
| **Starting Number** | First sequential number |
| **Padding** | Zero-padding width (e.g., 4 → RB0001) |

Configure in **Configuration** → **User ID** (SUPER_ADMIN only).

---

## Next Steps

- [Roles & Permissions](../roles/roles-and-permissions.md) — Permission matrix and RBAC configuration
- [Security Configuration](../security/security.md) — Password policy, login security, sessions
- [Audit Trail](../audit/audit-trail.md) — Track all user management operations
