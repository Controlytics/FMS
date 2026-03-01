# Roles & Permissions

DigiLog implements a Role-Based Access Control (RBAC) system with six hierarchical roles. Each role is assigned a set of permissions that determine what actions a user can perform.

---

## Built-in Roles

| Role | Level | Description |
|------|-------|-------------|
| **SUPER_ADMIN** | 6 | Full system access. Can configure roles, system settings, and manage all users. Exempt from lockout and password expiry. |
| **ADMIN** | 5 | Administrative access. Can manage users, entities, templates, and rule chains. Cannot modify role permissions or system-level settings. |
| **SUPERVISOR** | 4 | Oversight role. Can view all entities, manage alarms, and generate reports. Can create lower-level users. |
| **MAINTENANCE** | 3 | Maintenance operations. Can manage entity connectivity, troubleshoot devices, and perform maintenance tasks. |
| **OPERATOR** | 2 | Day-to-day operations. Can view entities, submit checklists, and view telemetry. Cannot modify entity structure. |
| **VIEWER** | 1 | Read-only access. Can view dashboards and reports. Cannot modify any data. |

---

## Permission Categories

Permissions are organized into functional categories. The `_MANAGE` permission in any category grants all sub-permissions within that category.

### Asset Permissions

| Permission | Description | SUPER_ADMIN | ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER |
|------------|-------------|:-----------:|:-----:|:----------:|:-----------:|:--------:|:------:|
| `ASSET_MANAGE` | Full entity management | Yes | Yes | — | — | — | — |
| `ASSET_CREATE` | Create entities and templates | Yes | Yes | — | — | — | — |
| `ASSET_UPDATE` | Edit entities and templates | Yes | Yes | Yes | — | — | — |
| `ASSET_DELETE` | Delete entities and templates | Yes | Yes | — | — | — | — |
| `ASSET_VIEW` | View entities and data | Yes | Yes | Yes | Yes | Yes | — |

### User Permissions

| Permission | Description | SUPER_ADMIN | ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER |
|------------|-------------|:-----------:|:-----:|:----------:|:-----------:|:--------:|:------:|
| `USER_MANAGE` | Full user management | Yes | Yes | — | — | — | — |
| `USER_CREATE` | Create user accounts | Yes | Yes | Yes | — | — | — |
| `USER_READ` | View user list and profiles | Yes | Yes | Yes | — | — | — |
| `USER_UPDATE` | Edit user accounts | Yes | Yes | — | — | — | — |
| `USER_DELETE` | Disable/delete users | Yes | Yes | — | — | — | — |
| `USER_RESET_PASSWORD` | Reset user passwords | Yes | Yes | Yes | — | — | — |

### Configuration Permissions

| Permission | Description | SUPER_ADMIN | ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER |
|------------|-------------|:-----------:|:-----:|:----------:|:-----------:|:--------:|:------:|
| `CONFIG_MANAGE` | Full configuration access | Yes | — | — | — | — | — |
| `CONFIG_READ` | View configuration | Yes | Yes | — | — | — | — |
| `CONFIG_UPDATE` | Modify configuration | Yes | — | — | — | — | — |

### Node Permissions (Rule Chains)

| Permission | Description | SUPER_ADMIN | ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER |
|------------|-------------|:-----------:|:-----:|:----------:|:-----------:|:--------:|:------:|
| `NODE_CREATE` | Create rule chain nodes | Yes | Yes | — | — | — | — |
| `NODE_READ` | View rule chains | Yes | Yes | Yes | — | — | — |
| `NODE_UPDATE` | Edit rule chains | Yes | Yes | — | — | — | — |
| `NODE_DELETE` | Delete rule chains | Yes | Yes | — | — | — | — |

### Template Permissions

| Permission | Description | SUPER_ADMIN | ADMIN | SUPERVISOR | MAINTENANCE | OPERATOR | VIEWER |
|------------|-------------|:-----------:|:-----:|:----------:|:-----------:|:--------:|:------:|
| `TEMPLATE_CREATE` | Create asset templates | Yes | Yes | — | — | — | — |
| `TEMPLATE_VIEW` | View templates | Yes | Yes | Yes | Yes | Yes | — |
| `TEMPLATE_UPDATE` | Edit templates | Yes | Yes | — | — | — | — |
| `TEMPLATE_DELETE` | Delete templates | Yes | Yes | — | — | — | — |

---

## The _MANAGE Hierarchy

When a role has the `_MANAGE` permission for a category, it automatically includes all sub-permissions:

```
ASSET_MANAGE includes:
  ├── ASSET_CREATE
  ├── ASSET_UPDATE
  ├── ASSET_DELETE
  ├── ASSET_VIEW
  ├── ASSET_READ
  └── ASSET_EXPORT
```

This means checking for `ASSET_VIEW` will pass for any user who has `ASSET_MANAGE`.

---

## Role Privileges Page

SUPER_ADMIN users can view and configure role permissions:

1. Navigate to **Configuration** → **Role Privileges**.
2. Select a role from the dropdown.
3. View the permissions assigned to that role.
4. Toggle individual permissions on/off.
5. Click **Save**.

> **Note:** SUPER_ADMIN role permissions cannot be modified — it always has full access.

---

## Frontend Route Protection

DigiLog enforces RBAC on both frontend routes and API endpoints:

### Frontend Guards

Routes are protected using the `<RequireRole>` component:

```tsx
<Route path="/users" element={
  <RequireRole permissions={['USER_READ']}>
    <UserListPage />
  </RequireRole>
} />
```

If a user without the required permission navigates to a protected route, they see an "Access Denied" page.

### Sidebar Filtering

The sidebar automatically hides menu items the user doesn't have permission to access. An OPERATOR will see fewer menu items than an ADMIN.

### API Enforcement

Every API endpoint is protected with `preHandler` hooks:

```typescript
app.get('/api/users', {
  preHandler: [app.requirePermission('USER_READ')],
}, handler);
```

Unauthorized API requests return `403 Forbidden`.

---

## Next Steps

- [User Management](../users/user-management.md) — Create and manage users
- [Security Configuration](../security/security.md) — Password and session policies
- [Audit Trail](../audit/audit-trail.md) — Track permission usage
