# DigiLog API — Backend

## Stack
Fastify 5, TypeScript, Prisma ORM, PostgreSQL 16, bcrypt, jose (JWT), Zod validation

## Directory Structure
- `src/app.ts` — Entry point, registers plugins and routes
- `src/plugins/` — Fastify plugins (auth, audit-logger, rbac)
- `src/modules/` — Feature modules:
  - `auth/` — Login, logout, password management, re-verification
  - `users/` — User CRUD, stats, enable/disable, unlock, password reset
  - `config/` — System configuration (password policy, datetime, branding, etc.)
  - `roles/` — Role management, permissions, hierarchy
  - `assets/` — Asset templates, instances, relationships, identifiers (21 endpoints)
  - `audit/` — Audit trail with SHA-256 checksums
  - `backup/` — Database backup & restore
  - `notifications/` — Role-based user alerts
  - `uploads/` — File uploads (profile photos)
- `src/lib/` — Shared utilities (prisma client, JWT, password hashing, hash chain, error schemas, reauth, user-id validator, swagger)
- `prisma/schema.prisma` — Database schema (5 asset models: AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier)
- `prisma/seed.ts` — Seed script for default data

## Running
```bash
npm run dev          # tsx watch src/app.ts
npm run build        # tsc
```

## API Prefix
All routes under `/api/`. Auth on all routes except `/api/auth/login`, `/api/auth/forgot-password`, `/api/config/branding`, `/api/health`, and `/docs`.

## Swagger (`src/lib/swagger.ts`)
Swagger UI available at `/docs`. Auto-generated from route schemas. Tags: Health, Auth, Users, Roles, Config, Audit, Notifications, Uploads, Backup, Entity Templates, Entities, Entity Relationships, Entity Identifiers. Config: `docExpansion: 'list'`, `persistAuthorization: true`, `tryItOutEnabled: true`. Two servers: Production (http://43.205.32.23) and Local Development.

## Auth Flow
JWT token in `Authorization: Bearer <token>` header. Sessions stored in DB for invalidation support.

## Roles
Dynamic roles stored in DB. Default: SUPER_ADMIN (no audit), ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER.

## Audit Trail
SHA-256 checksummed entries. SUPER_ADMIN actions are never logged. All other roles are logged for every mutation.

## Route Schema Pattern
All routes with error responses MUST include `...errorResponses` in their schema `response` object (imported from `src/lib/error-schemas.ts`). Without this, Fastify 5's TypeScript types reject `reply.code(400)` etc.

## Entity Module (`src/modules/assets/routes.ts`)
21 endpoints across 14 paths for entity template management, entity instance management, entity relationships, and entity identifiers. All using `requirePermission` (checks role.permissions array in DB):

- **Templates** (6): GET/POST `/templates`, GET/PUT/DELETE `/templates/:id`, GET `/templates/:id/versions`
  - Permissions: ASSET_VIEW (GET), ASSET_TEMPLATE_MANAGE (POST/PUT/DELETE)
  - Reauth: CREATE_ASSET_TEMPLATE, UPDATE_ASSET_TEMPLATE, DELETE_ASSET_TEMPLATE
  - Update auto-creates AssetTemplateVersion snapshot, increments version number
  - Template includes `category`, `expectedRelationships`, `statusLifecycle`, `maxParentConnections`, and `maxConnections` fields.
  - All JSONB fields (`attributeSchema`, `telemetrySchema`, `expectedIdentifiers`, `expectedRelationships`, `statusLifecycle`, `alarmRules`) declared in both body and response schemas
- **Instances** (8): GET `/instances`, GET `/instances/tree`, GET/POST/PUT/DELETE `/instances/:id`, PATCH `/instances/:id/status`, GET `/instances/:id/children`
  - Permissions: ASSET_VIEW (GET), ASSET_CREATE (POST), ASSET_UPDATE (PUT/PATCH), ASSET_DELETE (DELETE)
  - POST /instances: Template existence check only (no isActive filter — assets can be created from any template)
  - Reauth: CREATE_ASSET, UPDATE_ASSET, DELETE_ASSET
  - Delete uses cascade soft-delete via `collectDescendantIds()` helper
- **Relationships** (3): GET/POST `/relationships`, DELETE `/relationships/:id`
  - Auto-creates bidirectional inverses using INVERSE_RELATIONSHIP_MAP (CONTAINS<->CONTAINED_IN, FEEDS<->FED_BY, DEPENDS_ON<->DEPENDED_ON_BY, BACKS_UP<->BACKED_UP_BY, MONITORS<->MONITORED_BY, CONNECTED_TO symmetric, CUSTOM)
  - POST /relationships enforces `maxConnections` limit on both source and target entities. Returns `connectionInfo` in success/error responses.
  - `hasContainsCycle()` helper: iterative ancestor walk to prevent circular CONTAINS
  - Reauth: CREATE_ASSET_RELATIONSHIP, DELETE_ASSET_RELATIONSHIP
- **Identifiers** (4): GET `/identifiers`, GET `/identifiers/lookup/:value`, POST/DELETE `/identifiers/:id`
  - Globally unique `identifierValue` enforced at DB level
  - Types: QR, BARCODE, RFID, NFC, MANUAL
  - Permissions: ASSET_VIEW (GET), ASSET_IDENTIFIER_MANAGE (POST/DELETE)
  - Reauth: CREATE_ASSET_IDENTIFIER, DELETE_ASSET_IDENTIFIER

API response format for paginated endpoints: `{ data: [], total, page, limit, totalPages }`. Tree endpoint returns a flat array.

## RBAC Plugin (`src/plugins/rbac.ts`)
Two decorators:
- **`requirePermission(permission)`**: Fetches role from DB, checks if `permissions` JSON array includes the required permission. Logs UNAUTHORIZED_ACTION_ATTEMPT on failure.
- **`requireRole(...roles)`**: Checks if user's role name is in the allowed list. Simpler check, used for non-asset routes.

Asset routes exclusively use `requirePermission`. Non-asset routes may use `requireRole`.

## Performance Notes
- Use SQL queries for aggregate operations (MAX, COUNT) instead of fetching all rows
- Batch-fetch related records with `findMany` + `IN (...)` instead of N+1 loops
- All major tables have indexes (see `prisma/schema.prisma` for `@@index` declarations)

## Build Note
Always clean `dist/` before rebuilding if old modules were removed to avoid stale compiled files:
```bash
rm -rf dist && npm run build
```
