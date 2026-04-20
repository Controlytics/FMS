# DigiLog API Summary

**Base URL:** `http://localhost:3000/api` (dev) | `http://34.232.224.0/api` (prod)
**Swagger:** `http://localhost:3000/docs` | `http://34.232.224.0/docs`
**Auth:** JWT Bearer token in Authorization header
**Default Login:** superadmin / Admin@123

---

## Quick Reference

| Metric | Count |
|--------|-------|
| Total Endpoints | ~169 |
| Modules | 34 |
| Public Endpoints | 6 |
| Protected Endpoints | ~163 |
| Permissions Required | 95 unique |

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | Public | Login (returns JWT) |
| POST | /api/auth/logout | Token | Logout (invalidate session) |
| POST | /api/auth/refresh | Token | Refresh JWT token |
| GET | /api/auth/me | Token | Get current user profile |
| PUT | /api/auth/profile | Token | Update profile |
| POST | /api/auth/change-password | Token | Change password |
| POST | /api/auth/forgot-password | Public | Request password reset |
| POST | /api/auth/verify | Token | Verify token validity |
| POST | /api/auth/beacon-logout | Token | Beacon logout (page close) |

---

## Users

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/users | USER_READ | List users (org-scoped) |
| GET | /api/users/stats | USER_READ | User statistics |
| GET | /api/users/:id | USER_READ | Get user by ID |
| POST | /api/users | USER_CREATE | Create user |
| PUT | /api/users/:id | USER_UPDATE | Update user |
| DELETE | /api/users/:id | USER_DELETE | Delete user |
| POST | /api/users/:id/enable | USER_UPDATE | Enable user |
| POST | /api/users/:id/disable | USER_UPDATE | Disable user |
| POST | /api/users/:id/unlock | USER_UPDATE | Unlock locked user |
| POST | /api/users/:id/reset-password | USER_RESET_PASSWORD | Reset password |
| GET | /api/users/reset-requests | USER_RESET_PASSWORD | List reset requests |
| POST | /api/users/bulk-delete | USER_DELETE | Bulk delete users |

---

## Roles & Permissions

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/roles | ROLE_READ | List all roles |
| GET | /api/roles/active | Auth required | List active roles |
| GET | /api/roles/permissions/all | Auth required | All available permissions |
| GET | /api/roles/:name | ROLE_READ | Get role details |
| POST | /api/roles | ROLE_CREATE | Create role |
| PUT | /api/roles/:name | ROLE_UPDATE | Update role |
| DELETE | /api/roles/:name | ROLE_DELETE | Delete role |
| GET | /api/roles/:name/creatable | Auth required | Roles this role can create |

---

## Asset Management

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/assets/templates | ASSET_VIEW | List templates |
| GET | /api/assets/templates/:id | ASSET_VIEW | Get template |
| POST | /api/assets/templates | ASSET_TEMPLATE_CREATE | Create template |
| PUT | /api/assets/templates/:id | ASSET_TEMPLATE_UPDATE | Update template |
| GET | /api/assets/instances | ASSET_VIEW | List instances |
| GET | /api/assets/instances/:id | ASSET_VIEW | Get instance |
| POST | /api/assets/instances | ASSET_CREATE | Create instance |
| PUT | /api/assets/instances/:id | ASSET_UPDATE | Update instance |
| DELETE | /api/assets/instances/:id | ASSET_DELETE | Delete instance |
| GET | /api/assets/relationships | ASSET_VIEW | List relationships |
| POST | /api/assets/relationships | ASSET_UPDATE | Create relationship |
| DELETE | /api/assets/relationships/:id | ASSET_UPDATE | Delete relationship |
| GET | /api/assets/identifiers | ASSET_VIEW | List identifiers |
| POST | /api/assets/identifiers | ASSET_IDENTIFIER_CREATE | Create identifier |
| DELETE | /api/assets/identifiers/:id | ASSET_IDENTIFIER_DELETE | Delete identifier |
| GET | /api/assets/identifiers/lookup/:value | ASSET_VIEW | Lookup by identifier |

---

## Filter Operations (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/filters/:id/current-state | ASSET_READ | Get filter state + next actions |
| POST | /api/filters/:id/start-cycle | FILTER_OPERATE | Start cleaning cycle |
| POST | /api/filters/:id/advance | FILTER_OPERATE | Advance to next stage |
| POST | /api/filters/:id/submit-checklist | FILTER_OPERATE | Submit checklist answers |
| POST | /api/filters/:id/bypass | FILTER_OPERATE | Bypass stage (deviation) |
| POST | /api/filters/:id/retire | ASSET_UPDATE | Retire filter |
| POST | /api/filters/:id/replace | ASSET_UPDATE | Replace filter |
| POST | /api/filters/:id/terminate-cycle | FILTER_OPERATE | Terminate active cycle |
| GET | /api/filters/events | EVENT_READ | List filter events |
| GET | /api/filters/cycles | CYCLE_READ | List cleaning cycles |
| GET | /api/filters/cycles/:id | CYCLE_READ | Get cycle by ID |
| GET | /api/filters/retirements | ASSET_READ | List retired filters |
| GET | /api/filters/replacements | ASSET_READ | List replacements |

---

## Cleaning Profiles (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/filter-cleaning-profiles | FCP_READ | List cleaning profiles |
| GET | /api/filter-cleaning-profiles/:id | FCP_READ | Get profile with pipeline |
| POST | /api/filter-cleaning-profiles | FCP_CREATE | Create profile |
| PUT | /api/filter-cleaning-profiles/:id | FCP_UPDATE | Update profile (new version) |
| PATCH | /api/filter-cleaning-profiles/:id/toggle-status | FCP_UPDATE | Activate/archive profile |

---

## Filter Profiles (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/filter-profiles | FP_READ | List filter profiles |
| GET | /api/filter-profiles/:id | FP_READ | Get filter profile |
| POST | /api/filter-profiles | FP_CREATE | Create filter profile |
| PUT | /api/filter-profiles/:id | FP_UPDATE | Update filter profile |
| DELETE | /api/filter-profiles/:id | FP_DELETE | Delete filter profile |

---

## PM Schedules (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/pm-schedules/:entityId | PM_READ | Get PM schedule for entity |
| POST | /api/pm-schedules | PM_CREATE | Create PM schedule |
| PUT | /api/pm-schedules/:id | PM_UPDATE | Update PM schedule |
| DELETE | /api/pm-schedules/:id | PM_DELETE | Delete PM schedule |
| POST | /api/pm-executions | PM_EXECUTE | Start PM execution |
| PUT | /api/pm-executions/:id | PM_EXECUTE | Update execution status |

---

## Checklist Profiles (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/checklist-profiles | FCP_READ | List checklist profiles |
| GET | /api/checklist-profiles/:id | FCP_READ | Get with questions |
| POST | /api/checklist-profiles | FCP_CREATE | Create profile |
| PUT | /api/checklist-profiles/:id | FCP_UPDATE | Update profile |
| DELETE | /api/checklist-profiles/:id | FCP_DELETE | Delete profile |

---

## Equipment Groups (Phase 2)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/equipment-groups | CONFIG_READ | List equipment groups |
| GET | /api/equipment-groups/:id | CONFIG_READ | Get group with instruments |
| POST | /api/equipment-groups | CONFIG_UPDATE | Create group |
| PUT | /api/equipment-groups/:id | CONFIG_UPDATE | Update group |
| DELETE | /api/equipment-groups/:id | CONFIG_UPDATE | Delete group |

---

## Configuration

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/config/:key | CONFIG_READ | Get config value |
| PUT | /api/config/:key | CONFIG_UPDATE | Update config value |
| POST | /api/config/reload | SUPER_ADMIN | Reload all configs |

**27 Config Keys:** action-reauth, alarm-columns, audit-templates, backup, branding, datetime, field-ids, filter-cleaning-reasons, filter-lifecycle-states, filter-pm-schedule, help, login-security, notification-email, notification-logs, notification-rules, notification-slack, notification-sms, notification-telegram, pagination, password-policy, retention, role-privileges, roles, session, sidebar-config, uns, user-id

---

## Audit Trail

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/audit | AUDIT_READ | List audit records |
| GET | /api/audit/:id | AUDIT_READ | Get audit record |
| DELETE | /api/audit/:id | SUPER_ADMIN | Delete audit record |
| POST | /api/audit/bulk-delete | SUPER_ADMIN | Bulk delete records |

---

## Notifications

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | /api/notifications | Auth required | List user notifications |
| GET | /api/notifications/unread-count | Auth required | Unread count |
| PUT | /api/notifications/mark-all-read | Auth required | Mark all read |
| PUT | /api/notifications/bulk-read | Auth required | Mark selected read |
| PUT | /api/notifications/bulk-unread | Auth required | Mark selected unread |
| POST | /api/notifications/bulk-delete | NOTIFICATION_DELETE | Delete selected |

---

## Data Ingestion

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/data/telemetry | Device token | Ingest telemetry |
| POST | /api/data/attributes | Device token | Ingest attributes |
| GET | /api/data/binaries/:entityId | Auth required | List binary data |
| GET | /api/data/binaries/:entityId/file | Auth required | Download binary file |

---

## Other Endpoints

| Module | Key Endpoints |
|--------|--------------|
| Rule Chains | CRUD + POST /:id/execute, GET /node-types |
| Alarms | GET /alarms, PUT /:id/acknowledge, PUT /:id/clear |
| Help | CRUD + GET /:id/versions |
| QR Codes | POST /generate, GET /:code |
| UNS | GET /tree, POST /validate |
| Connectivity | GET /:entityId, POST /test, GET /snippets |
| Export | POST /queries/export (CSV/Excel) |
| Retention | POST /retention/execute-range |
| System Health | GET /, GET /detailed |
| Uploads | POST /, GET /:id, DELETE /:id |
| LDAP | POST /sync, POST /test, GET /status |

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.

---

## Phase 4 Update (2026-04-14)

**New Public Endpoints:**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/config/report-settings/current | Public | Get report settings (no auth) |
| GET | /api/config/password-policy/current | Public | Get password policy (no auth) |

**Updated Endpoints:**

| Method | Path | Permission | Change |
|--------|------|------------|--------|
| GET | /api/block-change-requests | BLOCK_CHANGE_REQUEST or BLOCK_CHANGE_APPROVE | Now accepts either permission (was single permission) |

**Permission Count:** 95 unique permissions (up from 52)
**Re-auth Actions:** 69 sensitive operations require re-authentication
**Config Keys:** Added `report-settings` to config definitions
