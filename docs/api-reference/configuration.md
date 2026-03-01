# Configuration API

The Configuration API provides endpoints for managing system settings including security policies, branding, user ID rules, role configurations, action re-authentication, and audit text templates.

---

## Security Configuration

Each security config has a GET (read) and PUT (update) endpoint. Sensitive configs require re-authentication.

### Password Policy

```
GET  /api/config/password-policy
PUT  /api/config/password-policy
```

Settings: `minLength`, `maxLength`, `requireUppercase`, `requireLowercase`, `requireNumbers`, `requireSpecial`, `expiryDays`, `historyCount`, `maxFailedAttempts`

### Login Security

```
GET  /api/config/login-security
PUT  /api/config/login-security
```

Settings: `lockoutType` (`TEMPORARY` or `PERMANENT`), `lockoutDurationMinutes`

### Session Configuration

```
GET  /api/config/session
PUT  /api/config/session
```

Settings: `sessionDurationHours`, `idleTimeoutMinutes`, `singleSessionPerUser`, `sessionAbsoluteTimeout`

### Date/Time Format

```
GET  /api/config/datetime
PUT  /api/config/datetime
```

Settings: `dateFormat`, `timeFormat`, `timezone`, `use24Hour`

Public endpoint (no admin role required):
```
GET  /api/config/datetime/current
```

### Pagination

```
GET  /api/config/pagination
PUT  /api/config/pagination
```

Public endpoint:
```
GET  /api/config/pagination/current
```

**Read Permission:** `CONFIG_READ`
**Write Permission:** `CONFIG_UPDATE`

---

## Branding

### GET /api/config/branding

Get branding configuration. **Public endpoint** (no auth required — used on login page).

```json
{
  "companyName": "Acme Corp",
  "logoUrl": "/uploads/logo.png",
  "primaryColor": "#2563eb",
  "accentColor": "#7c3aed"
}
```

### PUT /api/config/branding

Update branding. Requires `CONFIG_UPDATE` permission and re-authentication.

---

## User ID Configuration

### GET /api/config/user-id

Get User ID format and auto-generation settings.

### PUT /api/config/user-id

Update User ID configuration (prefix, format, auto-generation, validation rules).

### GET /api/config/user-id/next

Compute the next auto-generated User ID based on current config and existing users.

```json
{ "autoGenerate": true, "nextId": "RB0005" }
```

### POST /api/config/user-id/validate

Validate a proposed User ID against current rules.

```bash
curl -X POST "http://your-server/api/config/user-id/validate" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "userId": "RB0004" }'
```

```json
{ "valid": true, "errors": [] }
```

---

## Role Configuration

Manage sidebar items, home widgets, and permissions per role.

### GET /api/config/roles

List all role configurations.

### GET /api/config/roles/:role

Get configuration for a specific role.

```json
{
  "role": "OPERATOR",
  "sidebarItems": ["dashboard", "entities", "checklists", "alarms"],
  "homeWidgets": ["alarm-summary", "recent-checklists"],
  "permissions": {
    "ASSET_VIEW": true,
    "ASSET_CREATE": false,
    "ALARM_ACKNOWLEDGE": true
  }
}
```

### PUT /api/config/roles/:role

Update role configuration.

---

## User-Specific Configuration

Override role-level config for individual users.

### GET /api/config/users/:userId

Get user-specific configuration.

### PUT /api/config/users/:userId

Update user-specific configuration (overrides role config).

### GET /api/config/my-config

Get the effective configuration for the authenticated user. Checks user-specific config first, then falls back to role config.

---

## Action Re-Authentication

Configure which actions require password re-entry for each role.

### GET /api/config/action-reauth

Get the full action → role matrix.

```json
{
  "DELETE_USER": ["SUPER_ADMIN", "ADMIN"],
  "CREATE_ASSET_TEMPLATE": ["SUPER_ADMIN", "ADMIN"],
  "EXPORT_BACKUP": ["SUPER_ADMIN"]
}
```

### PUT /api/config/action-reauth

Update the matrix.

### GET /api/config/action-reauth/check?action=DELETE_USER

Check if a specific action requires re-auth for the current user's role.

```json
{ "action": "DELETE_USER", "required": true }
```

### GET /api/config/action-reauth/my-actions

Get all actions requiring re-auth for the current user's role.

```json
{ "actions": ["DELETE_USER", "CREATE_ASSET_TEMPLATE", "EXPORT_BACKUP"] }
```

---

## Audit Text Templates

Customizable text templates for audit trail descriptions.

### GET /api/config/audit-templates

Get saved templates merged with defaults.

### PUT /api/config/audit-templates

Update custom audit text templates.

### GET /api/config/audit-templates/current

Public endpoint — get effective templates for rendering audit descriptions.

---

## Field ID Labels

Customize display names for system field identifiers.

### GET /api/config/field-ids

List all field ID label configurations.

### PUT /api/config/field-ids/:fieldId

Update the display name for a field ID.

```bash
curl -X PUT "http://your-server/api/config/field-ids/userId" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "displayName": "Employee ID" }'
```

---

## Next Steps

- [Security Configuration Guide](../administration/security/security.md) — Password, lockout, and session policies
- [System Configuration Guide](../administration/configuration/system-configuration.md) — All config pages
- [Roles & Permissions](../administration/roles/roles-and-permissions.md) — RBAC system
