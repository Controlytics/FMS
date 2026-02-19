# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

## Overview
DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. It includes User Management, Configuration, Audit Trail, and a template-based Asset Management system with hierarchical relationships and identifiers.

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
Dynamic roles stored in DB. Default: SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER. Roles have name, displayName, color, hierarchyLevel, permissions, isSystem, isActive, allowCrossTemplateLinking fields. All roles (including system) can be deleted. Frontend fetches roles from `/api/roles/active` via SWR (sidebar.tsx, role-privileges.tsx).

## Assets
Template-based asset management system with 6 Prisma models and 26 API endpoints.

**Asset Templates** define reusable blueprints with: typed attribute schemas (TEXT, INTEGER, FLOAT, DATE, DATETIME, BOOLEAN, DROPDOWN, URL, FILE), telemetry schemas (INTEGER, FLOAT, BOOLEAN, STRING, ENUM), expected identifiers, expected relationships, status lifecycles (with transitions and colors), and alarm rules (HIGH, LOW, HIGH_HIGH, LOW_LOW, RATE_OF_CHANGE, BOOLEAN_STATE, CUSTOM with severities WARNING/ALARM/CRITICAL). Template versioning auto-creates a full JSON snapshot (`AssetTemplateVersion`) on each update.

**Asset Instances** are created from templates and organized in a parent-child hierarchy via `parentId` self-reference. Instances store `attributes` (validated against template schema), `telemetryConfig`, `customAttributes`, `status`, and `templateVersion` (which version they were created from).

**Asset Relationships** are bidirectional with automatic inverse creation (CONTAINS/CONTAINED_IN, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, BACKS_UP/BACKED_UP_BY, MONITORS/MONITORED_BY, CONNECTED_TO symmetric, CUSTOM). CONTAINS relationships include cycle detection via iterative ancestor walk. Deleting either side deletes both.

**Asset Identifiers** support QR, BARCODE, RFID, NFC, and MANUAL types with globally unique `identifierValue` enforcement and optional `isPrimary` flag.

**Template Linking Rules** define which template types can be linked together and with which relationship types. Rules have scoped priority (USER > ROLE > GLOBAL). When no rules exist for a template pair, all relationship types are allowed (backwards compatible). Roles can have `allowCrossTemplateLinking=true` to bypass all linking rules. Duplicate rule prevention at API level (PostgreSQL NULL unique constraint workaround).

Permissions: `ASSET_TEMPLATE_MANAGE`, `ASSET_CREATE`, `ASSET_UPDATE`, `ASSET_DELETE`, `ASSET_RELATIONSHIP_MANAGE`, `ASSET_IDENTIFIER_MANAGE`, `ASSET_VIEW`, `TEMPLATE_LINKING_RULE_MANAGE`. Authorization uses `requirePermission` (checks role.permissions array in DB, different from `requireRole` which checks role name). Reauth enforced on mutations via `enforceReauth`.

Database models: `AssetTemplate`, `AssetTemplateVersion`, `AssetInstance`, `AssetRelationship`, `AssetIdentifier`, `TemplateLinkingRule`.

Frontend pages: `/assets` (Asset Explorer with dynamic tree diagram, ~2993 lines), `/assets/templates` (Template Manager with 6-section editor, ~1410 lines), `/config/template-linking-rules` (Linking Rules config, ~449 lines).

### Dynamic Tree Diagram
The Asset Explorer features an interactive tree diagram in the Relationships tab with:
- **Create New Child**: Green "+" button on tree nodes opens Add Asset wizard with parent pre-set
- **Attach Existing Asset**: Blue link button opens dialog to search/select an existing asset and create CONTAINS relationship
- **Remove from Tree**: Red "x" button deletes the CONTAINS relationship (does not delete the asset)
- **Unlink from Parent**: In sidebar tree, removes parentId reference
- **Linking Rule Enforcement**: Link Assets dialog shows allowed/disallowed relationship types based on template linking rules with visual indicators

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
- **`requirePermission` vs `requireRole`**: `requirePermission` checks the role's `permissions` JSON array in DB; `requireRole` checks the role name string. Asset routes use `requirePermission`.
- **Reauth integration**: `useReauth` hook fetches `/api/config/action-reauth/my-actions`, calls callback directly if action is not configured for reauth. All `reauth.execute` calls must be `await`-ed to prevent saving state race conditions.
- **SWR paginated responses**: API returns `{ data: [], total, page, limit, totalPages }`. Use `useSWR<{ data: T[] }>()` then extract `.data`. Tree endpoints return plain arrays.
- **Vite cache busting**: Content-hashed filenames in production builds.
- **Build order**: Turborepo builds shared -> api -> web.

## Environment
All env vars in root `.env` file. See `.env.example` for reference.
