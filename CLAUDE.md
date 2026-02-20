# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

## Overview
DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. It includes User Management, Configuration, Audit Trail, and a template-based Entity Management system with hierarchical relationships and identifiers.

## Monorepo Structure
- `apps/api` — Fastify backend (port 3000)
- `apps/web` — React frontend (port 5173 dev, port 80 production via nginx)
- `packages/shared` — Zod schemas + TypeScript types shared across apps

## Tech Stack
Turborepo, Fastify 5, React 19, Vite, Tailwind CSS 4, Prisma ORM, PostgreSQL 16 (pgcrypto), bcrypt, jose (JWT), Zod, SWR

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
Dynamic roles stored in DB. Default: SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER. Roles have name, displayName, color, hierarchyLevel, permissions, isSystem, isActive fields. All roles (including system) can be deleted. Frontend fetches roles from `/api/roles/active` via SWR (sidebar.tsx, role-privileges.tsx).

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
- **Vite cache busting**: Content-hashed filenames in production builds.
- **Build order**: Turborepo builds shared -> api -> web.

## Environment
All env vars in root `.env` file. See `.env.example` for reference.
