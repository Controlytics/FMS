# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

## Overview
DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. It includes User Management, Configuration, Audit Trail, and a template-based Entity Management system with hierarchical relationships and identifiers.

## Monorepo Structure
- `apps/api` — Fastify backend (port 3000)
- `apps/web` — React frontend (port 5173 dev, port 80 production via nginx)
- `packages/shared` — Zod schemas + TypeScript types shared across apps

## Tech Stack
Turborepo, Fastify 5, React 19, Vite 6, Tailwind CSS 4, Prisma 6 ORM, PostgreSQL 16 (pgcrypto), bcrypt, jose (JWT), Zod, SWR, React Hook Form, Lucide React

## Production Deployment
- **App URL:** http://43.205.32.23 (port 80 via nginx)
- **API:** PM2 process `digilog-api` on port 3000
- **Swagger UI:** http://43.205.32.23/docs
- **Database:** `digilog_db` on PostgreSQL 5432
- **nginx config:** `/etc/nginx/sites-available/digilog`
- **nginx root:** `/home/ubuntu/21cfrlogbook/apps/web/dist` (served directly, no copy needed)
- **PM2 ecosystem:** `/home/ubuntu/ecosystem.config.cjs`

### Dual-App Server
This server also runs the User Management app:
- User Management at http://43.205.32.23:5175/ (PM2 process `usermgmt-api` on port 3001)
- nginx config: `/etc/nginx/sites-available/usermgmt`
- Database: `usermgmt_db`

## Quick Start
```bash
docker compose up -d          # Start PostgreSQL
npm install                   # Install all deps
npm run db:migrate            # Run Prisma migrations
npm run db:seed               # Seed default admin + configs
npm run dev                   # Start API + Web
```

## Default Login
- Username: `admin`
- Password: `Admin@123`
- Will force password change on first login

## Roles
Dynamic roles stored in DB. Default: SUPER_ADMIN (level 6), ADMIN (5), SUPERVISOR (4), MAINTENANCE (3), OPERATOR (2), VIEWER (1). Roles have name, displayName, color, hierarchyLevel, permissions (JSON array), isSystem, isActive fields. All roles (including system) can be deleted. Frontend fetches roles from `/api/roles/active` via SWR (sidebar.tsx, role-privileges.tsx).

## API Endpoints (90 total)

### Auth (8 endpoints) — `/api/auth`
POST /login (no auth, rate limited 10/min), POST /logout, POST /beacon-logout (no auth), GET /me, PUT /profile, POST /change-password, POST /verify, POST /forgot-password (no auth, rate limited 5/5min).

### Users (14 endpoints) — `/api/users`
All require `requireRole('SUPER_ADMIN', 'ADMIN')`. Mutations use enforceReauth:
- GET / (list, paginated), GET /stats, POST / (CREATE_USER), GET /:id, PUT /:id (UPDATE_USER), DELETE /:id (DELETE_USER, SUPER_ADMIN only), POST /bulk-delete (BULK_DELETE_USERS, SUPER_ADMIN only)
- POST /:id/enable (ENABLE_USER), POST /:id/disable (DISABLE_USER), POST /:id/unlock (UNLOCK_USER), POST /:id/reset-password (RESET_PASSWORD)
- GET /reset-requests, GET /reset-requests/pending, POST /reset-requests/:id/process (PROCESS_RESET_REQUEST)

### Roles (8 endpoints) — `/api/roles`
GET / (ADMIN+), GET /active (any), GET /:name (ADMIN+), GET /permissions/all (SUPER_ADMIN), GET /:name/creatable (ADMIN+), POST / (CREATE_ROLE, SUPER_ADMIN), PUT /:name (UPDATE_ROLE, SUPER_ADMIN), DELETE /:name (DELETE_ROLE, SUPER_ADMIN).

### Entity Management (21 endpoints) — `/api/assets`
All use `requirePermission()` (checks role.permissions JSON array in DB).

**Templates (6):** GET /templates (ASSET_VIEW), GET /templates/:id (ASSET_VIEW), POST /templates (ASSET_TEMPLATE_MANAGE, reauth CREATE_ASSET_TEMPLATE), PUT /templates/:id (ASSET_TEMPLATE_MANAGE, reauth UPDATE_ASSET_TEMPLATE), DELETE /templates/:id (ASSET_TEMPLATE_MANAGE, reauth DELETE_ASSET_TEMPLATE), GET /templates/:id/versions (ASSET_VIEW).

**Instances (8):** GET /instances (ASSET_VIEW), GET /instances/tree (ASSET_VIEW, returns flat array), GET /instances/:id (ASSET_VIEW), POST /instances (ASSET_CREATE, reauth CREATE_ASSET), PUT /instances/:id (ASSET_UPDATE, reauth UPDATE_ASSET), PATCH /instances/:id/status (ASSET_UPDATE, reauth UPDATE_ASSET), DELETE /instances/:id (ASSET_DELETE, reauth DELETE_ASSET, cascade soft-delete), GET /instances/:id/children (ASSET_VIEW).

**Relationships (3):** GET /relationships (ASSET_VIEW), POST /relationships (ASSET_RELATIONSHIP_MANAGE, reauth CREATE_ASSET_RELATIONSHIP, auto-creates inverse, enforces maxConnections, cycle detection), DELETE /relationships/:id (ASSET_RELATIONSHIP_MANAGE, reauth DELETE_ASSET_RELATIONSHIP, deletes both sides).

**Identifiers (4):** GET /identifiers (ASSET_VIEW), GET /identifiers/lookup/:value (ASSET_VIEW), POST /identifiers (ASSET_IDENTIFIER_MANAGE, reauth CREATE_ASSET_IDENTIFIER), DELETE /identifiers/:id (ASSET_IDENTIFIER_MANAGE, reauth DELETE_ASSET_IDENTIFIER).

### Configuration (33 endpoints) — `/api/config`
- Security: GET/PUT password-policy, login-security, session (ADMIN+, PUT uses reauth)
- DateTime: GET/PUT datetime (ADMIN+), GET datetime/current (any, public)
- Pagination: GET/PUT pagination (ADMIN+), GET pagination/current (any)
- User ID: GET/PUT user-id (PUT SUPER_ADMIN only, reauth UPDATE_USERID_CONFIG), GET user-id/next, POST user-id/validate
- Branding: GET (public, no auth), PUT (SUPER_ADMIN, reauth UPDATE_BRANDING)
- Role Config: GET /roles, GET /roles/:role, PUT /roles/:role (SUPER_ADMIN, reauth UPDATE_ROLE_CONFIG)
- User Config: GET/PUT /users/:userId, GET /my-config (any)
- Field IDs: GET /field-ids (any), PUT /field-ids/:fieldId (SUPER_ADMIN)
- Action Reauth: GET/PUT /action-reauth (SUPER_ADMIN), GET /action-reauth/check, GET /action-reauth/my-actions (any)
- Audit Templates: GET/PUT /audit-templates (SUPER_ADMIN), GET /audit-templates/current (any)

### Audit Trail (4 endpoints) — `/api/audit`
GET / (any, paginated, filterable), GET /:id (any, includes checksum verification), DELETE /:id (SUPER_ADMIN), POST /bulk-delete (SUPER_ADMIN).

### Notifications (9 endpoints) — `/api/notifications`
GET / (role-filtered), GET /unread-count, PUT /:id/read, PUT /:id/unread, PUT /mark-all-read, PUT /bulk-read, PUT /bulk-unread, DELETE /:id, POST /bulk-delete (SUPER_ADMIN).

### Uploads (2 endpoints)
POST /api/uploads/photo (auth required, 5MB max), GET /uploads/:filename (public, no auth).

### Backup (3 endpoints) — `/api/backup`
GET /export (ADMIN+, reauth EXPORT_BACKUP), POST /restore (ADMIN+, reauth RESTORE_BACKUP), POST /validate (ADMIN+).

### User Account Creation Requests (8 endpoints) — `/api/user-requests`
**Public (no auth):** GET /roles (active roles for dropdown, rate 10/min), POST / (submit request, rate 5/min).
**Admin (USER_CREATE permission):** GET / (list), GET /pending/count, GET /:id (detail), POST /:id/approve (reauth APPROVE_USER_REQUEST, creates user + temp password), POST /:id/reject (reauth REJECT_USER_REQUEST), POST /:id/password-viewed.

### Health
GET /api/health (no auth).

## Entities
Template-based entity management system with 5 Prisma models and 21 API endpoints.

**Entity Templates** define reusable blueprints for entity types with: typed attribute schemas (TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE), telemetry schemas (INTEGER, FLOAT, BOOLEAN, STRING, ENUM), expected identifiers, expected relationships, status lifecycles (with transitions and colors), and alarm rules (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM with severities WARNING/ALARM/CRITICAL). Template versioning auto-creates a full JSON snapshot (`AssetTemplateVersion`) on each update.

**Entity Instances** are created from templates and organized in a parent-child hierarchy via `parentId` self-reference. Instances store `attributes` (validated against template schema), `telemetryConfig`, `customAttributes`, `status`, and `templateVersion` (which version they were created from).

**Entity Relationships** are bidirectional with automatic inverse creation (CONTAINS/CONTAINED_IN, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, BACKS_UP/BACKED_UP_BY, MONITORS/MONITORED_BY, CONNECTED_TO symmetric, CUSTOM). CONTAINS relationships include cycle detection via iterative ancestor walk. Deleting either side deletes both.

**Entity Identifiers** support QR, BARCODE, RFID, NFC, and MANUAL types with globally unique `identifierValue` enforcement and optional `isPrimary` flag.

Permissions: `ASSET_TEMPLATE_MANAGE`, `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, `ASSET_RELATIONSHIP_MANAGE`, `ASSET_IDENTIFIER_MANAGE`, `ASSET_VIEW`. These permission constants control entity operations. Authorization uses `requirePermission` (checks role.permissions array in DB, different from `requireRole` which checks role name). Reauth enforced on mutations via `enforceReauth`.

Database models: `AssetTemplate`, `AssetTemplateVersion`, `AssetInstance`, `AssetRelationship`, `AssetIdentifier` (Prisma model names retained; these represent entity data).

Frontend pages: `/assets` (Entity Explorer with dynamic tree diagram), `/assets/templates` (Entity Template Manager with 6-section editor), `/config/role-privileges` (Role Privileges config with 3 category color groups: User Management, System, Entity Management).

### Dynamic Tree Diagram
The Entity Explorer features an interactive tree diagram in the Relationships tab with:
- **Create New Child**: Green "+" button on tree nodes opens Add Entity wizard with parent pre-set
- **Attach Existing Entity**: Blue link button opens dialog to search/select an existing entity and create CONTAINS relationship
- **Remove from Tree**: Red "x" button deletes the CONTAINS relationship (does not delete the entity)
- **Unlink from Parent**: In sidebar tree, removes parentId reference

### Connection Limits
Entity templates have two connection limit fields:
- `maxParentConnections` — limits CONTAINS parent relationships (0=not allowed, 1=single parent, N=multiple)
- `maxConnections` — limits total connections of all relationship types (0=unlimited, N=limit)

Both are enforced on POST /relationships and POST /instances. Success responses include `connectionInfo` with used/allowed/remaining counts.

### Toast Notifications
Global toast system via React Context (`ToastProvider` + `useToast` hook). Applied to relationship create/delete/attach/remove operations. 4 variants: success, error, warning, info with auto-dismiss.

### Entity Template View Dialog
Read-only view dialog accessible via eye icon in template table. Shows all template details: basic info, attributes, telemetry, identifiers, alarm rules. Has "Edit Template" button to transition to edit mode.

## Database Schema (16 Prisma Models)

**User & Auth:** User, Role, PasswordHistory, Session, PasswordResetRequest, UserCreationRequest
**Configuration:** SystemConfig (9 config keys), UserConfig, RoleConfig, FieldIdConfig
**Audit & Notifications:** AuditTrail (SHA-256 checksums), Notification
**Entity Management:** AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier

## Frontend (30 pages, 9 custom hooks)

### Custom Hooks
- `useAuth()` — login/logout, JWT in sessionStorage, SWR-based /api/auth/me
- `useReauth()` — re-auth dialog flow, checks /api/config/action-reauth/my-actions
- `useSession()` — idle timeout with warning countdown, auto-logout
- `useSingleTab()` — enforce single active tab per user via localStorage heartbeat
- `useToast()` — global toast notifications (success/error/warning/info)
- `useBranding()` — app branding colors/logos from /api/config/branding
- `useDatetimeFormat()` — configurable date/time formatting with timezone
- `useFieldLabels()` — dynamic field labels from /api/config/field-ids
- `usePaginationConfig()` — pagination options from /api/config/pagination/current

### Frontend Routes
**Public:** /login, /forgot-password, /change-password, /request-account
**Protected:** / (dashboard), /profile, /assets (Entity Explorer), /audit, /notifications
**Admin (SUPER_ADMIN/ADMIN):** /users, /users/create, /users/:id, /users/reset-requests, /users/creation-requests, /assets/templates, /config/*
**SUPER_ADMIN only:** /config/action-reauth, /config/audit-templates, /config/pagination

## Key Commands
- `npm run dev` — start all apps in dev mode
- `npm run build` — build all packages (shared -> api -> web via Turborepo)
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed default data
- `npm run db:studio` — open Prisma Studio
- `pm2 restart digilog-api` — restart production API
- `sudo systemctl restart nginx` — restart nginx

## Build & Deploy
```bash
npm run build                 # Builds shared, api, web via Turborepo
pm2 restart digilog-api       # Restart API (picks up new dist/)
# Web is served directly from apps/web/dist by nginx — no copy needed
```

**Important:** Always clean `apps/api/dist/` before rebuilding if old modules were removed:
```bash
rm -rf apps/api/dist && cd apps/api && npm run build
```

## Key Architecture Patterns
- **`requirePermission` vs `requireRole`**: `requirePermission` checks the role's `permissions` JSON array in DB; `requireRole` checks the role name string. Entity routes use `requirePermission`.
- **Reauth integration**: `useReauth` hook fetches `/api/config/action-reauth/my-actions`, calls callback directly if action is not configured for reauth. All `reauth.execute` calls must be `await`-ed to prevent saving state race conditions.
- **SWR paginated responses**: API returns `{ data: [], total, page, limit, totalPages }`. Use `useSWR<{ data: T[] }>()` then extract `.data`. Tree endpoints return plain arrays.
- **Audit trail integrity**: SHA-256 checksum on {timestamp, userId, action, targetType, targetId, afterValue}. SUPER_ADMIN actions are NOT logged (21 CFR Part 11 exemption). Read-time verification returns `integrityValid: boolean`.
- **Soft delete**: Templates and instances use `isActive: false`. Instance delete cascades to descendants. Relationships and identifiers are hard-deleted.
- **Session management**: Single active session per user. New login terminates previous. Configurable duration (default 8h) and idle timeout (default 15min).
- **Single-tab enforcement**: localStorage heartbeat + cross-tab coordination via `useSingleTab()` hook.
- **Vite cache busting**: Content-hashed filenames in production builds.
- **Build order**: Turborepo builds shared -> api -> web.

## Shared Package (`@digilog/shared`)
Single source of truth for Zod schemas and TypeScript types consumed by both apps:
- **Schemas:** auth (login, password, reauth), users (CRUD, query, bulk delete), user-requests (create, query, reject), config (branding, password policy, session, datetime, user-id, audit templates, pagination), audit (query), action-reauth, assets (templates, instances, relationships, identifiers, queries)
- **Types:** roles (RoleData interface, DEFAULT_ROLES, USER_STATUS), permissions (21 constants), permission-categories, feature-privileges, sidebar-items, audit-actions (30+), reauth-actions (21+), audit-templates
- **Constants:** ATTRIBUTE_DATA_TYPES (9), TELEMETRY_DATA_TYPES (5), RELATIONSHIP_TYPES (12), IDENTIFIER_TYPES (5), ASSET_STATUSES (5), INVERSE_RELATIONSHIP_MAP, ALARM_RULE_TYPES (7), ALARM_SEVERITIES (3)

## Environment
All env vars in root `.env` file. Key vars: DATABASE_URL, JWT_SECRET, VERIFICATION_TOKEN_SECRET, API_PORT, CORS_ORIGIN, ALLOWED_ORIGINS, UPLOAD_DIR, MAX_FILE_SIZE.
