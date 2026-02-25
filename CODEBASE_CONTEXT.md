# DigiLog Codebase Context & Reference

> Comprehensive reference for working on the DigiLog 21 CFR Part 11 Compliant Digital Logbook.
> Updated: 2026-02-25 (documentation governance, testing docs centralization)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [Tech Stack & Dependencies](#3-tech-stack--dependencies)
4. [Backend (apps/api)](#4-backend-appsapi)
5. [Frontend (apps/web)](#5-frontend-appsweb)
6. [Shared Package (packages/shared)](#6-shared-package-packagesshared)
7. [Database Schema (Prisma)](#7-database-schema-prisma)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [API Route Inventory](#9-api-route-inventory)
10. [Frontend Routes & Pages](#10-frontend-routes--pages)
11. [Key Architectural Patterns](#11-key-architectural-patterns)
12. [Entity Management System](#12-entity-management-system)
13. [Configuration System](#13-configuration-system)
14. [Production Deployment](#14-production-deployment)
15. [Git & Development Workflow](#15-git--development-workflow)

---

## 1. Project Overview

DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. Core features:

- **User Management** with role-based access, password policies, account lockout
- **Entity Management** (template-based) with hierarchical parent-child trees, relationships, identifiers
- **Audit Trail** with SHA-256 checksum integrity verification (21 CFR Part 11)
- **System Configuration** for branding, security, datetime, pagination, field labels
- **Notification System** with role-based delivery
- **Backup/Restore** functionality

**Default Login:** `admin` / `Admin@123` (forces password change)

---

## 2. Monorepo Structure

```
21cfrlogbook/
├── apps/
│   ├── api/                    # Fastify 5 backend (port 3000)
│   │   ├── src/
│   │   │   ├── app.ts          # Entry point, middleware stack
│   │   │   ├── lib/            # Utilities (jwt, password, prisma, reauth, hash-chain, etc.)
│   │   │   ├── plugins/        # Fastify plugins (auth, rbac, audit-logger)
│   │   │   └── modules/        # Feature modules (auth, users, roles, config, assets, audit, notifications, uploads, backup)
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Database schema (15 models)
│   │   │   ├── seed.ts         # Default data seeding
│   │   │   └── sql/            # PostgreSQL extensions
│   │   └── uploads/            # Uploaded files directory
│   │
│   └── web/                    # React 19 frontend (Vite, port 5173 dev / port 80 prod)
│       ├── src/
│       │   ├── main.tsx        # Entry point with router + providers
│       │   ├── app.css         # Global Tailwind styles
│       │   ├── components/     # Layout + UI components + specialized
│       │   ├── hooks/          # 9 custom hooks
│       │   ├── lib/            # api-client, cn utility, swr-config
│       │   └── routes/         # Page components (auth, users, assets, config, audit, etc.)
│       └── public/             # Static assets
│
├── packages/
│   └── shared/                 # Zod schemas + TypeScript types (consumed by both apps)
│       └── src/
│           ├── schemas/        # auth, users, config, audit, action-reauth, assets
│           ├── types/          # roles, permissions, sidebar-items, audit-actions, reauth-actions, etc.
│           └── index.ts        # Re-exports everything
│
├── documentation/               # Centralized documentation
│   ├── Bug_Resolution_Log.md   # Structured bug tracking
│   ├── Project_Summary.md      # Comprehensive project summary
│   └── testing/                # All testing documentation
│       ├── manual/             # TEST.md, TEST_CASES.md, TEST_SUMMARY.md
│       ├── reports/            # TEST_REPORT.md, TREE_DIAGRAM_TEST_REPORT.md, RBAC_TEST_RESULTS.md
│       ├── automation/         # rbac-test.sh
│       ├── validation/         # 21CFR_PART11_VERIFICATION.md
│       └── regression/         # Regression test results
│
├── .github/
│   └── ISSUE_TEMPLATE/
│       └── bug_report.md       # Structured bug report template
│
├── turbo.json                  # Turborepo pipeline: shared -> api -> web
├── package.json                # Root scripts
├── docker-compose.yml          # PostgreSQL 16
├── .env                        # Environment variables
└── CLAUDE.md                   # Project instructions
```

---

## 3. Tech Stack & Dependencies

| Layer | Technology | Version |
|-------|-----------|---------|
| **Monorepo** | Turborepo | Latest |
| **Backend** | Fastify | 5.2.0 |
| **Frontend** | React | 19.0.0 |
| **Build** | Vite | 6.1.0 |
| **Styling** | Tailwind CSS | 4.0.0 |
| **ORM** | Prisma | 6.3.0 |
| **Database** | PostgreSQL | 16 (pgcrypto) |
| **Auth** | jose (JWT) | 6.0.0 |
| **Password** | bcrypt | 5.1.1 |
| **Validation** | Zod | 3.24.0 |
| **Data Fetching** | SWR | 2.3.0 |
| **Forms** | React Hook Form | 7.54.0 |
| **Icons** | Lucide React | 0.474.0 |
| **Process Manager** | PM2 | Production |

**Key Backend Plugins:** @fastify/cors, @fastify/helmet, @fastify/rate-limit, @fastify/multipart, @fastify/static, @fastify/swagger, @fastify/swagger-ui

---

## 4. Backend (apps/api)

### Directory Structure

```
apps/api/src/
├── app.ts                          # Entry point + middleware registration
├── lib/
│   ├── prisma.ts                   # Prisma client singleton
│   ├── jwt.ts                      # Token sign/verify (HS256, jose)
│   ├── password.ts                 # bcrypt hash/verify (cost 12)
│   ├── hash-chain.ts               # SHA-256 checksum for audit integrity
│   ├── reauth-check.ts             # Re-auth validation (10s cache)
│   ├── user-id-validator.ts        # User ID format validation
│   ├── swagger.ts                  # Swagger UI at /docs
│   └── error-schemas.ts            # Standard error response schemas (400-500)
├── plugins/
│   ├── auth.ts                     # JWT validation, session checks, public path exclusions
│   ├── rbac.ts                     # requirePermission() + requireRole() decorators
│   └── audit-logger.ts             # Audit trail with SHA-256 checksums
└── modules/
    ├── auth/routes.ts              # Login, logout, password, reauth (8 endpoints)
    ├── users/routes.ts             # User CRUD, unlock, reset (11 endpoints)
    ├── roles/routes.ts             # Role management (8 endpoints)
    ├── config/routes.ts            # System configuration (15+ endpoints)
    ├── assets/routes.ts            # Entity templates/instances/relationships/identifiers (21 endpoints)
    ├── audit/routes.ts             # Audit trail query + integrity (4 endpoints)
    ├── notifications/routes.ts     # Notification delivery (4 endpoints)
    ├── uploads/routes.ts           # File upload (2 endpoints)
    └── backup/routes.ts            # Backup/restore (3 endpoints)
```

### Middleware Stack (in order)

1. **CORS** - configurable origins via `ALLOWED_ORIGINS` env
2. **Helmet** - security headers (HSTS 1-year, preload)
3. **Rate Limiting** - 100 req/min global; 10/min login; 5/5min forgot-password
4. **Multipart** - 5MB max, 1 file per request
5. **Static Files** - serves `/uploads/` directory
6. **Audit Logger Plugin** - `app.auditLog()` method
7. **Auth Plugin** - JWT validation + session tracking
8. **RBAC Plugin** - `requirePermission()` + `requireRole()` decorators

### Public Endpoints (No Auth)

- `GET /api/health`
- `POST /api/auth/login`, `/api/auth/forgot-password`, `/api/auth/beacon-logout`
- `GET /api/config/branding`, `/api/config/datetime/current`
- `GET /uploads/*`
- `GET /docs` (Swagger)

---

## 5. Frontend (apps/web)

### Directory Structure

```
apps/web/src/
├── main.tsx                           # Router + ErrorBoundary + ToastProvider + SWRConfig
├── app.css                            # Tailwind imports + custom styles
├── components/
│   ├── layout/
│   │   ├── app-layout.tsx             # Main wrapper (sidebar + header + outlet)
│   │   ├── header.tsx                 # Top bar with notifications + user menu
│   │   └── sidebar.tsx                # Left nav (dynamic items from config API)
│   ├── ui/
│   │   ├── button.tsx                 # Variants: default, destructive, outline, secondary, ghost, link, success
│   │   ├── input.tsx                  # secureField prop (disables copy/paste for 21 CFR)
│   │   ├── dialog.tsx                 # Modal with Escape key support
│   │   ├── card.tsx                   # Container components
│   │   ├── table.tsx                  # Table components
│   │   ├── badge.tsx                  # Inline badges
│   │   ├── select.tsx                 # Dropdown
│   │   └── toast.tsx                  # Toast notification component
│   ├── error-boundary.tsx             # Error catch + reload
│   ├── reauth-dialog.tsx              # Re-authentication password modal
│   ├── require-role.tsx               # Role-based route guard
│   └── toast-provider.tsx             # Toast context provider
├── hooks/
│   ├── use-auth.ts                    # Login/logout, user state, token management
│   ├── use-reauth.ts                  # Re-auth dialog flow + action checking
│   ├── use-session.ts                 # Idle timeout + warning countdown
│   ├── use-single-tab.ts             # Enforce single active tab per user
│   ├── use-toast.ts                   # Access global toast notifications
│   ├── use-branding.ts               # Fetch & cache branding config
│   ├── use-datetime-format.ts         # DateTime formatting with timezone
│   ├── use-field-labels.ts            # Dynamic field label config from API
│   └── use-pagination-config.ts       # Pagination options [10, 25, 50]
├── lib/
│   ├── api-client.ts                  # HTTP client with auth headers + error handling
│   ├── cn.ts                          # clsx + tailwind-merge utility
│   └── swr-config.ts                  # SWR fetcher + global config
└── routes/                            # Page components (see section 10)
```

### Custom Hooks Summary

| Hook | Purpose | Key Detail |
|------|---------|------------|
| `useAuth()` | Auth state + login/logout | Token in `sessionStorage`, SWR-based `/api/auth/me` |
| `useReauth()` | Sensitive action gating | Checks `/api/config/action-reauth/my-actions`, shows dialog if needed |
| `useSession()` | Idle timeout | Activity tracking (click/key/scroll), warning countdown, auto-logout |
| `useSingleTab()` | Multi-tab prevention | localStorage heartbeat, cross-tab coordination |
| `useToast()` | Toast notifications | 4 variants: success/error/warning/info, auto-dismiss 5s |
| `useBranding()` | App branding | Colors, logos, app name from `/api/config/branding` |
| `useDatetimeFormat()` | Date/time formatting | Configurable format + timezone from `/api/config/datetime/current` |
| `useFieldLabels()` | Dynamic field names | Customizable labels from `/api/config/field-ids` |
| `usePaginationConfig()` | Table page sizes | Options tuple from `/api/config/pagination/current` |

### API Client Pattern

```typescript
// lib/api-client.ts
class ApiClient {
  get<T>(url), post<T>(url, body), put<T>(url, body), patch<T>(url, body), delete<T>(url)
  // Re-auth variants (password in body + x-reauth-password header)
  deleteWithReauth<T>(url, password), postWithReauth<T>(url, body, password),
  putWithReauth<T>(url, body, password)
}
// Token from sessionStorage, 401 → redirect /login, special error handling
```

### SWR Configuration

```typescript
// lib/swr-config.ts
{ fetcher: apiClient.get, revalidateOnFocus: false, shouldRetryOnError: false, dedupingInterval: 5000 }

// Paginated responses: { data: T[], total, page, limit, totalPages }
const { data: res } = useSWR<{ data: Item[] }>('/api/items?page=1&limit=10');
const items = res?.data ?? [];

// Tree endpoints return plain arrays
const { data: tree } = useSWR<TreeNode[]>('/api/assets/instances/tree');
```

---

## 6. Shared Package (packages/shared)

### Schemas (`src/schemas/`)

| File | Schemas | Used By |
|------|---------|---------|
| `auth.ts` | `loginSchema`, `passwordChangeSchema`, `reAuthSchema` | Login, password change, reauth |
| `users.ts` | `createUserSchema`, `updateUserSchema`, `resetPasswordSchema`, `userQuerySchema`, `bulkDeleteUsersSchema` | User CRUD |
| `config.ts` | `brandingConfigSchema`, `passwordPolicySchema`, `loginSecuritySchema`, `sessionConfigSchema`, `datetimeConfigSchema`, `userIdConfigSchema`, `auditTemplatesSchema`, `paginationConfigSchema` | All config pages |
| `audit.ts` | `auditQuerySchema` | Audit trail |
| `action-reauth.ts` | `actionReauthConfigSchema` | Action reauth config |
| `assets.ts` | `createAssetTemplateSchema`, `updateAssetTemplateSchema`, `createAssetInstanceSchema`, `updateAssetInstanceSchema`, `createAssetRelationshipSchema`, `createAssetIdentifierSchema`, `assetQuerySchema`, `templateQuerySchema` | Entity management |

### Constants (`src/schemas/assets.ts`)

| Constant | Values |
|----------|--------|
| `ATTRIBUTE_DATA_TYPES` | TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE |
| `TELEMETRY_DATA_TYPES` | INTEGER, FLOAT, BOOLEAN, STRING, ENUM |
| `RELATIONSHIP_TYPES` | CONTAINS, CONTAINED_IN, CONNECTED_TO, FEEDS, FED_BY, DEPENDS_ON, DEPENDED_ON_BY, BACKS_UP, BACKED_UP_BY, MONITORS, MONITORED_BY, CUSTOM |
| `IDENTIFIER_TYPES` | QR, BARCODE, RFID, NFC, MANUAL |
| `ASSET_STATUSES` | Active, Inactive, Under Maintenance, Commissioning, Decommissioned |
| `ALARM_RULE_TYPES` | HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM |
| `ALARM_SEVERITIES` | WARNING, ALARM, CRITICAL |
| `INVERSE_RELATIONSHIP_MAP` | CONTAINS<>CONTAINED_IN, FEEDS<>FED_BY, DEPENDS_ON<>DEPENDED_ON_BY, BACKS_UP<>BACKED_UP_BY, MONITORS<>MONITORED_BY, CONNECTED_TO<>CONNECTED_TO (symmetric) |

### Types (`src/types/`)

| File | Exports | Purpose |
|------|---------|---------|
| `roles.ts` | `DEFAULT_ROLES`, `USER_STATUS`, `RoleData` interface | Role hierarchy, user status enum |
| `permissions.ts` | `PERMISSIONS` (21 keys), `Permission` type | All permission constants |
| `permission-categories.ts` | `PERMISSION_CATEGORIES` | Grouped permissions for role editor UI |
| `feature-privileges.ts` | `FEATURE_PRIVILEGES`, `FEATURE_PRIVILEGE_CATEGORIES` | Config page privilege management |
| `sidebar-items.ts` | `SIDEBAR_ITEMS` | Sidebar navigation config |
| `audit-actions.ts` | `AUDIT_ACTIONS` (29+ actions) | All audit log action types |
| `reauth-actions.ts` | `REAUTH_ACTIONS` (21+ actions), `REAUTH_ACTION_CATEGORIES` | Actions requiring re-auth |
| `audit-templates.ts` | `AUDIT_TEMPLATE_DEFAULTS`, `AUDIT_TEMPLATE_CATEGORIES` | Customizable audit messages |

---

## 7. Database Schema (Prisma)

### 15 Models

#### User & Auth (5 models)
- **User** — username, fullName, email, passwordHash, role (string), status (ENABLED/DISABLED/LOCKED/EXPIRED), forcePasswordChange, failedLoginAttempts, lockoutUntil, passwordExpiresAt
- **Role** — name (unique), displayName, hierarchyLevel, permissions (JSON array), color, isSystem, isActive
- **PasswordHistory** — userId (FK), passwordHash (prevents reuse)
- **Session** — userId (FK), tokenHash (SHA-256), ipAddress, userAgent, isActive, expiresAt, terminationReason
- **PasswordResetRequest** — userId, status (PENDING), requestedAt, processedAt, processedBy

#### Configuration (3 models)
- **SystemConfig** — configKey (unique), configValue (JSON), configType, requiresReauth
  - Keys: `password-policy`, `login-security`, `session`, `datetime`, `pagination`, `user-id`, `branding`, `action-reauth`, `audit-templates`
- **UserConfig** — userId (unique), sidebarItems (JSON), homeWidgets (JSON), permissions (JSON)
- **RoleConfig** — role (unique), sidebarItems (JSON), homeWidgets (JSON), permissions (JSON)
- **FieldIdConfig** — fieldId, defaultName, displayName, module, description

#### Audit & Notifications (2 models)
- **AuditTrail** — timestamp, userId, userName, userRole, action, targetType, targetId, beforeValue, afterValue, reason, ipAddress, checksum (SHA-256), signatureMeaning
- **Notification** — type, title, message, targetUserId, forUserId, forRole, isRead, metadata (JSON)

#### Entity Management (5 models)
- **AssetTemplate** — name (unique), description, category, icon, version, attributeSchema (JSON), telemetrySchema (JSON), expectedIdentifiers (JSON), expectedRelationships (JSON), statusLifecycle (JSON), alarmRules (JSON), maxParentConnections, maxConnections, isActive
- **AssetTemplateVersion** — templateId (FK), versionNumber, snapshot (full JSON), changeNotes
- **AssetInstance** — name, templateId (FK), templateVersion, status, attributes (JSON), telemetryConfig (JSON), customAttributes (JSON), parentId (self-FK for tree), unsPath, isActive
- **AssetRelationship** — sourceAssetId, targetAssetId, relationshipType (enum), customLabel, notes
- **AssetIdentifier** — assetId (FK), identifierType (enum), identifierValue (globally unique), label, isPrimary

### Default Seed Data

**Roles (6):** SUPER_ADMIN (level 6), ADMIN (5), SUPERVISOR (4), MAINTENANCE (3), OPERATOR (2), VIEWER (1)

**Default User:** admin / Admin@123 (SUPER_ADMIN, forcePasswordChange: true)

**Config Defaults:** password-policy (minLength=8, reuseCount=12, expiryDays=90), login-security (maxFailed=5, lockout=30min), session (8h duration, 15min idle), datetime (DD/MM/YYYY, 24h, UTC), pagination (recordsPerPage=20)

---

## 8. Authentication & Authorization

### JWT

- **Algorithm:** HS256 (jose library)
- **Payload:** `{ sub, username, role, sessionId }`
- **Duration:** 8 hours (configurable via session config)
- **Storage:** `sessionStorage.setItem('access_token', token)`
- **Secrets:** `JWT_SECRET`, `VERIFICATION_TOKEN_SECRET` (env vars)

### Sessions

- Stored in `Session` table with tokenHash (SHA-256, not plaintext)
- **Single active session per user** — new login terminates previous
- Tracked: userId, tokenHash, ipAddress, userAgent, isActive, expiresAt, terminationReason

### Authorization: Two Systems

| System | Method | Used By | How It Works |
|--------|--------|---------|-------------|
| `requirePermission(perm)` | Checks role.permissions JSON array in DB | Entity/Asset routes | Dynamic, based on configured role permissions |
| `requireRole(...names)` | Checks role name string | User, Role, Config routes | Static role name matching |

### Permission Constants (21 total)

```
User: USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD
Config: CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE
Audit: AUDIT_READ
Approvals: APPROVAL_REVIEW, APPROVAL_REQUEST
Entity: ASSET_TEMPLATE_MANAGE, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_VIEW, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE
```

### Re-Authentication (enforceReauth)

- Dynamic: reads from DB `SystemConfig.action-reauth` (cached 10 seconds)
- Per-action, per-role configuration
- Password sent via `_currentPassword` body field or `x-reauth-password` header
- Frontend: `useReauth()` hook checks `/api/config/action-reauth/my-actions` before executing
- **All `reauth.execute()` calls must be `await`-ed** (prevents race conditions)

### Audit Trail

- **SUPER_ADMIN actions are NOT logged** (21 CFR Part 11 exemption)
- SHA-256 checksum on: timestamp, userId, action, targetType, targetId, afterValue
- Read-time verification: recompute checksum, return `integrityValid: boolean`

---

## 9. API Route Inventory

### Auth (`/api/auth`) — 8 endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /login | No | Login with username/password |
| POST | /logout | Yes | Terminate session |
| POST | /beacon-logout | No | Logout via sendBeacon (tab close) |
| GET | /me | Yes | Get current user profile |
| PUT | /profile | Yes | Update own profile |
| POST | /change-password | Yes | Change password |
| POST | /verify | Yes | Re-authenticate for sensitive ops |
| POST | /forgot-password | No | Password reset request |

### Users (`/api/users`) — 11 endpoints
| Method | Path | Reauth Action | Purpose |
|--------|------|--------------|---------|
| GET | / | — | List users (paginated, searchable) |
| GET | /stats | — | User count stats by status |
| POST | / | CREATE_USER | Create new user |
| GET | /:id | — | Get user details |
| PUT | /:id | UPDATE_USER | Update user |
| DELETE | /:id | DELETE_USER | Delete user |
| POST | /:id/enable | UPDATE_USER | Enable account |
| POST | /:id/disable | UPDATE_USER | Disable account |
| POST | /:id/unlock | UPDATE_USER | Unlock locked account |
| POST | /:id/password-reset | RESET_USER_PASSWORD | Admin password reset |
| POST | /bulk/delete | DELETE_USER | Bulk delete users |

### Roles (`/api/roles`) — 8 endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | / | List all roles (SUPER_ADMIN/ADMIN) |
| GET | /active | List active roles (all users, for dropdowns) |
| GET | /:name | Get role by name |
| GET | /permissions/all | List all available permissions (SUPER_ADMIN) |
| GET | /:name/creatable | Get roles this role can create |
| POST | / | Create custom role (SUPER_ADMIN) |
| PUT | /:name | Update role (SUPER_ADMIN) |
| DELETE | /:name | Delete role (SUPER_ADMIN) |

### Entity Management (`/api/assets`) — 21 endpoints

**Templates (6):**
| Method | Path | Permission | Reauth |
|--------|------|-----------|--------|
| GET | /templates | ASSET_VIEW | — |
| GET | /templates/:id | ASSET_VIEW | — |
| POST | /templates | ASSET_TEMPLATE_MANAGE | CREATE_ASSET_TEMPLATE |
| PUT | /templates/:id | ASSET_TEMPLATE_MANAGE | UPDATE_ASSET_TEMPLATE |
| DELETE | /templates/:id | ASSET_TEMPLATE_MANAGE | DELETE_ASSET_TEMPLATE |
| GET | /templates/:id/versions | ASSET_VIEW | — |

**Instances (8):**
| Method | Path | Permission | Reauth |
|--------|------|-----------|--------|
| GET | /instances | ASSET_VIEW | — |
| GET | /instances/tree | ASSET_VIEW | — |
| GET | /instances/:id | ASSET_VIEW | — |
| POST | /instances | ASSET_CREATE | CREATE_ASSET |
| PUT | /instances/:id | ASSET_UPDATE | UPDATE_ASSET |
| PATCH | /instances/:id/status | ASSET_UPDATE | UPDATE_ASSET |
| DELETE | /instances/:id | ASSET_DELETE | DELETE_ASSET |
| GET | /instances/:id/children | ASSET_VIEW | — |

**Relationships (3):**
| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | /relationships | ASSET_VIEW | — |
| POST | /relationships | ASSET_RELATIONSHIP_MANAGE | Auto-creates inverse; enforces maxConnections |
| DELETE | /relationships/:id | ASSET_RELATIONSHIP_MANAGE | Deletes both sides |

**Identifiers (4):**
| Method | Path | Permission | Reauth |
|--------|------|-----------|--------|
| GET | /identifiers | ASSET_VIEW | — |
| GET | /identifiers/lookup/:value | ASSET_VIEW | — |
| POST | /identifiers | ASSET_IDENTIFIER_MANAGE | CREATE_ASSET_IDENTIFIER |
| DELETE | /identifiers/:id | ASSET_IDENTIFIER_MANAGE | DELETE_ASSET_IDENTIFIER |

### Config (`/api/config`) — 15+ endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | /password-policy | Password policy config |
| GET/PUT | /login-security | Login security config |
| GET/PUT | /session | Session config |
| GET | /datetime/current | Get datetime format (public) |
| PUT | /datetime | Update datetime config |
| GET | /pagination/current | Get pagination settings (public) |
| PUT | /pagination | Update pagination config |
| GET/PUT | /user-id | User ID format config |
| GET | /user-id/next | Get next auto-generated User ID |
| GET | /branding | Get branding config (public, no auth) |
| GET | /action-reauth/my-actions | Get user's reauth actions |

### Audit (`/api/audit`) — 4 endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | / | Query audit trail (paginated, filterable) |
| GET | /:id | Get detail + checksum verification |
| DELETE | /:id | Delete single record (SUPER_ADMIN) |
| DELETE | / | Bulk delete records (SUPER_ADMIN) |

### Notifications (`/api/notifications`) — 4 endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET | / | List for current user (role-based filtering) |
| GET | /unread-count | Quick count for badge |
| POST | / | Create notification |
| PATCH | /:id/read | Mark as read |

### Uploads (`/api/uploads`) — 2 endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | / | Upload file (5MB max, auth required) |
| GET | /:filename | Serve file (public) |

### Backup (`/api/backup`) — 3 endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | /create | Create backup (SUPER_ADMIN) |
| GET | / | List backups (SUPER_ADMIN) |
| POST | /restore | Restore from backup (SUPER_ADMIN) |

---

## 10. Frontend Routes & Pages

| Path | Component | Access | Purpose |
|------|-----------|--------|---------|
| `/login` | LoginPage | Public | Authentication |
| `/forgot-password` | ForgotPasswordPage | Public | Password reset request |
| `/change-password` | ChangePasswordPage | Public | Force/voluntary password change |
| `/` | DashboardPage | Protected | Home dashboard with stats |
| `/profile` | ProfilePage | Protected | User profile |
| `/users` | UserListPage | SUPER_ADMIN, ADMIN | User list |
| `/users/create` | CreateUserPage | SUPER_ADMIN, ADMIN | Create user |
| `/users/:id` | EditUserPage | SUPER_ADMIN, ADMIN | Edit user |
| `/users/reset-requests` | ResetRequestsPage | SUPER_ADMIN, ADMIN | Password reset requests |
| `/assets` | AssetExplorerPage | Protected | Entity Explorer (tree + list) |
| `/assets/templates` | AssetTemplatesPage | SUPER_ADMIN, ADMIN | Entity Template Manager |
| `/audit` | AuditTrailPage | Protected | Audit trail viewing |
| `/notifications` | NotificationsPage | Protected | Notification center |
| `/config` | ConfigIndexPage | SUPER_ADMIN, ADMIN | Config landing |
| `/config/password-policy` | PasswordPolicyPage | SUPER_ADMIN, ADMIN | Password rules |
| `/config/login-security` | LoginSecurityPage | SUPER_ADMIN, ADMIN | Login security |
| `/config/session` | SessionConfigPage | SUPER_ADMIN, ADMIN | Session config |
| `/config/datetime` | DatetimeConfigPage | SUPER_ADMIN, ADMIN | DateTime format |
| `/config/branding` | BrandingConfigPage | SUPER_ADMIN, ADMIN | App branding |
| `/config/role-privileges` | RolePrivilegesPage | SUPER_ADMIN, ADMIN | Role permissions |
| `/config/roles` | RolesManagementPage | SUPER_ADMIN, ADMIN | Role CRUD |
| `/config/sidebar` | SidebarConfigPage | SUPER_ADMIN, ADMIN | Sidebar visibility |
| `/config/field-ids` | FieldIdsPage | SUPER_ADMIN, ADMIN | Field label config |
| `/config/user-id` | UserIdConfigPage | SUPER_ADMIN, ADMIN | User ID format |
| `/config/backup` | BackupRestorePage | SUPER_ADMIN, ADMIN | Backup/restore |
| `/config/action-reauth` | ActionReauthPage | SUPER_ADMIN | Reauth config |
| `/config/audit-templates` | AuditTemplatesConfigPage | SUPER_ADMIN | Audit templates |
| `/config/pagination` | PaginationConfigPage | SUPER_ADMIN | Pagination options |

---

## 11. Key Architectural Patterns

### Reauth Flow
```
Frontend: useReauth() → checks /api/config/action-reauth/my-actions (cached 30s)
  → If action requires reauth: shows ReauthDialog → user enters password
  → Password sent via _currentPassword body + x-reauth-password header
Backend: enforceReauth() → reads SystemConfig.action-reauth (cached 10s)
  → Validates password via bcrypt → strips password before schema validation
CRITICAL: Always await reauth.execute() to prevent race conditions
```

### SWR Data Fetching
```typescript
// Paginated: API returns { data: T[], total, page, limit, totalPages }
const { data: res } = useSWR<{ data: T[] }>('/api/items');
const items = res?.data ?? [];

// Tree: returns plain array
const { data: tree } = useSWR<TreeNode[]>('/api/assets/instances/tree');

// Conditional: only fetch if condition met
const { data } = useSWR(token ? '/api/auth/me' : null);
```

### Permission vs Role Check
```
Entity routes → requirePermission('ASSET_VIEW') → checks role.permissions JSON array
Non-entity routes → requireRole('SUPER_ADMIN', 'ADMIN') → checks role name string
```

### Audit Integrity
```
Write: SHA-256 of sorted JSON {timestamp, userId, action, targetType, targetId, afterValue}
Read: Recompute checksum → return integrityValid: boolean
SUPER_ADMIN actions are NOT audited (21 CFR Part 11 exemption)
```

### Soft Delete Pattern
- Templates: `isActive: false` (soft delete)
- Instances: cascade `isActive: false` to all descendants
- Identifiers: hard delete
- Relationships: hard delete (both sides)

### Pagination Response Format
```json
{ "data": [...], "total": N, "page": 1, "limit": 50, "totalPages": M }
```

---

## 12. Entity Management System

### Hierarchy

```
AssetTemplate (blueprint) → defines attribute schema, telemetry, identifiers, relationships, alarms
  └── AssetInstance (created from template) → stores actual values, parent-child tree via parentId
        ├── AssetRelationship → bidirectional with auto-inverse
        └── AssetIdentifier → globally unique identifier values
```

### Template Features

- **Attribute Schema** — typed fields: TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE
- **Telemetry Schema** — INTEGER, FLOAT, BOOLEAN, STRING, ENUM
- **Expected Identifiers** — QR, BARCODE, RFID, NFC, MANUAL
- **Expected Relationships** — relationship type suggestions
- **Status Lifecycle** — configurable statuses with transitions and colors
- **Alarm Rules** — HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM (severities: WARNING/ALARM/CRITICAL)
- **Connection Limits** — `maxParentConnections` (CONTAINS parents), `maxConnections` (total)
- **Versioning** — auto-creates AssetTemplateVersion snapshot on each update

### Relationship System

| Type | Inverse | Auto-Created |
|------|---------|-------------|
| CONTAINS | CONTAINED_IN | Yes |
| FEEDS | FED_BY | Yes |
| DEPENDS_ON | DEPENDED_ON_BY | Yes |
| BACKS_UP | BACKED_UP_BY | Yes |
| MONITORS | MONITORED_BY | Yes |
| CONNECTED_TO | CONNECTED_TO | Yes (symmetric) |
| CUSTOM | CUSTOM | No |

- Cycle detection via iterative ancestor walk for CONTAINS
- Connection limits enforced on both source and target
- Success/error responses include `connectionInfo: { used, allowed, remaining }`

### Tree Diagram (Entity Explorer)

- Interactive tree in Relationships tab
- **Create New Child** — green "+" button, opens Add Entity wizard with parent pre-set
- **Attach Existing** — blue link button, search/select entity, create CONTAINS relationship
- **Remove from Tree** — red "x" button, deletes CONTAINS relationship (not entity)
- **Unlink from Parent** — sidebar tree, removes parentId reference

---

## 13. Configuration System

### SystemConfig Keys

| Key | Purpose | Schema |
|-----|---------|--------|
| `password-policy` | Password requirements | minLength, maxLength, requireUppercase/Lowercase/Numbers/Special, reuseCount, expiryDays |
| `login-security` | Login protection | maxFailedAttempts, lockoutType, lockoutDuration |
| `session` | Session management | sessionDurationHours, idleTimeoutMinutes, warningMinutes |
| `datetime` | Date/time display | dateFormat, timeFormat, timezone |
| `pagination` | Table pagination | options tuple [10, 25, 50] |
| `user-id` | User ID generation | format, length, prefix, autoGenerate, startNumber |
| `branding` | App appearance | appName, colors, logos |
| `action-reauth` | Reauth requirements | `Record<action, role[]>` |
| `audit-templates` | Audit messages | `Record<action, template_string>` |

---

## 14. Production Deployment

| Component | Detail |
|-----------|--------|
| **App URL** | http://43.205.32.23 (port 80 via nginx) |
| **API** | PM2 process `digilog-api` on port 3000 |
| **Swagger** | http://43.205.32.23/docs |
| **Database** | `digilog_db` on PostgreSQL 5432 |
| **nginx config** | `/etc/nginx/sites-available/digilog` |
| **nginx root** | `/home/ubuntu/21cfrlogbook/apps/web/dist` |
| **PM2 config** | `/home/ubuntu/ecosystem.config.cjs` |

### Build & Deploy

```bash
npm run build                 # Builds shared -> api -> web via Turborepo
pm2 restart digilog-api       # Restart API
# Web is served directly from apps/web/dist — no copy needed
```

**Important:** Clean old modules before rebuilding:
```bash
rm -rf apps/api/dist && cd apps/api && npm run build
```

### Dual-App Server

This server also runs User Management app:
- URL: http://43.205.32.23:5175/ (PM2 process `usermgmt-api` on port 3001)
- nginx config: `/etc/nginx/sites-available/usermgmt`
- Database: `usermgmt_db`

---

## 15. Git & Development Workflow

**Current Branch:** `feature/user-id-config`
**Main Branch:** `main`

### Commit History
```
d0393f6 Phase 2: Connection limits, toast system, Asset→Entity rename, bug fixes
9c47e07 Template Linking Rules + Dynamic Tree Management
9ea3b8c DigiLog Phase 1: Full application with all features
```

### Quick Start (Development)
```bash
docker compose up -d          # Start PostgreSQL
npm install                   # Install all deps
npm run db:migrate            # Run Prisma migrations
npm run db:seed               # Seed default data
npm run dev                   # Start API + Web
```

### Key Commands
| Command | Purpose |
|---------|---------|
| `npm run dev` | Start all apps in dev mode |
| `npm run build` | Build all packages (Turborepo) |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed default data |
| `npm run db:studio` | Open Prisma Studio |
| `pm2 restart digilog-api` | Restart production API |
| `sudo systemctl restart nginx` | Restart nginx |

---

## File Path Quick Reference

### Backend
| File | Purpose |
|------|---------|
| `apps/api/src/app.ts` | Entry point + middleware |
| `apps/api/src/plugins/auth.ts` | JWT validation + session |
| `apps/api/src/plugins/rbac.ts` | requirePermission + requireRole |
| `apps/api/src/plugins/audit-logger.ts` | Audit trail + checksums |
| `apps/api/src/lib/jwt.ts` | Token sign/verify |
| `apps/api/src/lib/password.ts` | bcrypt hash/verify |
| `apps/api/src/lib/reauth-check.ts` | Re-auth enforcement |
| `apps/api/src/lib/hash-chain.ts` | SHA-256 audit checksums |
| `apps/api/src/lib/user-id-validator.ts` | User ID format validation |
| `apps/api/src/modules/auth/routes.ts` | Auth endpoints |
| `apps/api/src/modules/users/routes.ts` | User endpoints |
| `apps/api/src/modules/roles/routes.ts` | Role endpoints |
| `apps/api/src/modules/config/routes.ts` | Config endpoints |
| `apps/api/src/modules/assets/routes.ts` | Entity endpoints (21) |
| `apps/api/src/modules/audit/routes.ts` | Audit endpoints |
| `apps/api/src/modules/notifications/routes.ts` | Notification endpoints |
| `apps/api/src/modules/uploads/routes.ts` | Upload endpoints |
| `apps/api/src/modules/backup/routes.ts` | Backup endpoints |
| `apps/api/prisma/schema.prisma` | Database schema |
| `apps/api/prisma/seed.ts` | Seed data |

### Frontend
| File | Purpose |
|------|---------|
| `apps/web/src/main.tsx` | Entry point + router |
| `apps/web/src/components/layout/app-layout.tsx` | Main layout wrapper |
| `apps/web/src/components/layout/sidebar.tsx` | Navigation sidebar |
| `apps/web/src/components/layout/header.tsx` | Top header bar |
| `apps/web/src/components/reauth-dialog.tsx` | Re-auth modal |
| `apps/web/src/components/toast-provider.tsx` | Toast context |
| `apps/web/src/hooks/use-auth.ts` | Auth state management |
| `apps/web/src/hooks/use-reauth.ts` | Re-auth flow |
| `apps/web/src/hooks/use-session.ts` | Session timeout |
| `apps/web/src/hooks/use-single-tab.ts` | Single-tab enforcement |
| `apps/web/src/hooks/use-toast.ts` | Toast notifications |
| `apps/web/src/lib/api-client.ts` | HTTP client |
| `apps/web/src/lib/swr-config.ts` | SWR configuration |
| `apps/web/src/routes/assets/index.tsx` | Entity Explorer |
| `apps/web/src/routes/assets/templates.tsx` | Entity Template Manager |
| `apps/web/src/routes/config/role-privileges.tsx` | Role Privileges |
| `apps/web/src/routes/config/roles.tsx` | Role Management |
| `apps/web/src/routes/audit/index.tsx` | Audit Trail |

### Shared
| File | Purpose |
|------|---------|
| `packages/shared/src/index.ts` | Main entry (re-exports all) |
| `packages/shared/src/schemas/assets.ts` | Entity schemas + constants |
| `packages/shared/src/schemas/auth.ts` | Auth schemas |
| `packages/shared/src/schemas/users.ts` | User schemas |
| `packages/shared/src/schemas/config.ts` | Config schemas |
| `packages/shared/src/types/permissions.ts` | Permission constants |
| `packages/shared/src/types/roles.ts` | Role definitions |
| `packages/shared/src/types/reauth-actions.ts` | Reauth action constants |
| `packages/shared/src/types/audit-actions.ts` | Audit action constants |
