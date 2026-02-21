# Changelog

All notable changes to DigiLog (21 CFR Part 11 Compliant Digital Logbook) are documented here.

## [Unreleased] - 2026-02-21

### Added
- **Checklist Schema on Entity Templates** — 14-type checklist question system for structured inspections/verifications
  - Question types: PASS_FAIL, YES_NO, YES_NO_NA, MCQ, MULTI_SELECT, TEXT, NUMERIC, DROPDOWN, PHOTO, DATE_TIME, SIGNATURE, YES_NO_COMMENT, CALCULATED, CONDITIONAL
  - Each question supports: `question`, `questionType`, `required`, `section`, `description`, `options` (MCQ/MULTI_SELECT/DROPDOWN), `numericUnit`/`numericMin`/`numericMax` (NUMERIC), `passCriteria` (PASS_FAIL), `expression` (CALCULATED), `conditionField`/`conditionValue` (CONDITIONAL)
  - Shared package: `CHECKLIST_QUESTION_TYPES` constant, `checklistItemSchema` Zod schema, added `checklistSchema` to `createAssetTemplateSchema` and `updateAssetTemplateSchema`
  - API: `checklistSchema` in Swagger request/response schemas for all template endpoints (POST, PUT, GET list, GET by ID)
  - Version snapshots include `checklistSchema`
  - Frontend: Checklist builder section in template create/edit dialog; read-only display in view dialog

- **Audit Log Descriptions for Entity Management** — Human-readable audit trail entries for entity operations
  - 12 entity actions in `AUDIT_TEMPLATE_DEFAULTS`: template CRUD (ASSET_TEMPLATE_CREATED/UPDATED/DELETED/VERSION_CREATED), instance CRUD (ASSET_CREATED/UPDATED/STATUS_CHANGED/DELETED), relationships (ASSET_RELATIONSHIP_CREATED/DELETED), identifiers (ASSET_IDENTIFIER_CREATED/DELETED)
  - Entity Management category in `AUDIT_TEMPLATE_CATEGORIES`
  - Placeholder system: `{actor}`, `{templateName}`, `{entityName}`, `{beforeStatus}`, `{afterStatus}`, etc.

- **Entity Feature Privileges** — Entity operations in role-privilege configuration
  - 7 entity privileges in `FEATURE_PRIVILEGES`: `assets.view`, `assets.create`, `assets.edit`, `assets.delete`, `assets.templates`, `assets.relationships`, `assets.identifiers`

- **Entity Reauth Actions** — Entity operations in action re-authentication configuration
  - 8 entity reauth actions: `CREATE/UPDATE/DELETE_ASSET_TEMPLATE`, `CREATE/UPDATE/DELETE_ASSET`, `CREATE/DELETE_ASSET_RELATIONSHIP`, `CREATE/DELETE_ASSET_IDENTIFIER`
  - Entity Management category in `REAUTH_ACTION_CATEGORIES`

- **Test Suite** — 51 new tests (267 total: 151 shared + 116 API)
  - `packages/shared/src/schemas/assets.test.ts` — 20 checklist schema unit tests (constants, valid/invalid items, all 14 types, edge cases)
  - `packages/shared/src/types/audit-templates.test.ts` — 17 audit template unit tests (categories, required fields, placeholder consistency, action groups)
  - `apps/api/src/e2e/checklist-templates.test.ts` — 14 E2E tests (create/read/update/delete with checklistSchema, version snapshots, validation, all 14 types)

### Fixed
- **`checklistSchema` stripped from GET `/templates/:id` response** — Fastify response serialization was removing `checklistSchema` because the field was missing from the GET-by-ID Swagger response schema. Added `checklistSchema: { type: 'array' }` to the response properties.
- **Audit template placeholder mismatch** — `FORCED_LOGOUT` listed `actor` in placeholders array but template string only used `{targetUser}`. Documented as known data-level exception.

### Changed
- Audit filter categories in frontend audit page aligned with updated action names
- `audit-logger.ts` aligned with updated audit template placeholders

---

## [Unreleased] - 2026-02-20 (Phase 2)

### Added
- **Connection Limit Enforcement** — New `maxConnections` field on entity templates to cap total relationships per entity
  - Template-level setting: `maxConnections` (default 10, 0=unlimited) alongside existing `maxParentConnections`
  - API enforces limits on POST /relationships for both source and target entities
  - API enforces limits on POST /instances when creating with parentId
  - Success responses include `connectionInfo` with used/allowed/remaining counts
  - Error responses include `connectionInfo` for which entity hit the limit

- **Toast Notification System** — Global toast popups for relationship operations
  - 4 variants: success (green), error (red), warning (amber), info (blue)
  - Auto-dismiss after 5s with close button and slide-in animation
  - React Context + Provider pattern (`ToastProvider`, `useToast` hook)
  - Applied to: create relationship, delete relationship, remove from tree, attach existing

- **Connection Status Cards in Entity Overview** — 4 new read-only cards in Overview tab
  - "Connections Allowed" — shows template's maxConnections (or "Unlimited" if 0)
  - "Connections Used" — shows current count with progress bar (green/red)
  - "Parent Connections Allowed" — shows template's maxParentConnections
  - "Parent Connections Used" — shows current CONTAINS parent count with progress bar

- **Entity Template View Dialog** — Read-only detail view for entity templates
  - Eye icon button in template table actions column (alongside edit/delete)
  - Shows: Basic Info (name, icon, description, version, status, connection limits, instance count)
  - Shows: Attributes table (field name, type, required, unit, default)
  - Shows: Telemetry table (field name, type, unit, description)
  - Shows: Expected Identifiers (type badges with labels)
  - Shows: Alarm Rules (severity badges, type, source field, enabled status)
  - "Edit Template" button to transition directly to edit dialog

### Fixed
- **Missing reauth on identifier endpoints** — POST/DELETE `/identifiers` were the only mutation endpoints without `enforceReauth()`. Added `CREATE_ASSET_IDENTIFIER` and `DELETE_ASSET_IDENTIFIER` reauth actions to shared package, API enforceReauth calls, and frontend `await reauth.execute()` wrappers
- **Missing `await` on `reauth.execute()`** — `handleDeleteRelationship` in Entity Explorer and `handleDelete` in Template Manager were calling `reauth.execute()` without `await`, causing race conditions where dialog state was saved before reauth completed
- **3 Prisma fields not exposed via API** — `category`, `expectedRelationships`, `statusLifecycle` existed in database but were missing from Zod schemas, API body schemas, and response schemas. Now fully exposed in create/update/get template endpoints
- **`maxConnections` stripped from template list response** — Fastify JSON schema serialization was stripping `maxConnections` (and `telemetrySchema`) from GET /templates responses because they weren't declared in the response schema
- **`parentId` coerced to empty string** — GET /instances list response schema declared `parentId` as `type: 'string'`, causing Fastify to coerce `null` to `""`. Fixed to `type: ['string', 'null']` matching the tree endpoint

### Changed
- **Global Rename: "Asset" → "Entity"** — Renamed throughout the entire application
  - Sidebar: "Assets" → "Entities", "Asset Templates" → "Entity Templates"
  - Frontend pages: "Asset Explorer" → "Entity Explorer", "Asset Templates" → "Entity Templates"
  - API Swagger tags: "Asset Templates" → "Entity Templates", "Assets" → "Entities", "Asset Relationships" → "Entity Relationships", "Asset Identifiers" → "Entity Identifiers"
  - All frontend dialogs, buttons, placeholders, tooltips, error messages, confirm dialogs, empty states renamed (Add Entity, Edit Entity, Delete Entity, Link Entities, Attach Existing Entity, Search entities, etc.)
  - API summaries, descriptions, error messages, connectionInfo keys: all "asset" references → "entity"
  - Shared package types: permission categories, feature privileges, reauth actions, audit templates, audit actions, sidebar items — all labels/categories updated
  - Role privileges, action reauth, audit templates config pages: category keys updated
  - Seed data: MAINTENANCE role description updated
  - Database: MAINTENANCE role description updated, field_id_config module names "Asset Management" → "Entity Management"
  - "No of Connections" renamed to "Number of Parent Connections" in template editor and API descriptions
  - Note: Code identifiers (Prisma models, variable names, permission constants, API paths, file paths) intentionally retain "Asset" naming to avoid risky migrations

- **Entity Template View Dialog — Badge Colors Removed** — All colored badges in the view dialog replaced with neutral slate styling
  - Section count badges, section header icons, identifier type badges, alarm severity badges — all changed to neutral slate

- **API Client Error Enhancement** — Error objects now preserve `connectionInfo` from API responses for toast display

### Technical
- Database: Added `max_connections` column to `asset_templates` table (default 10)
- Database: Updated MAINTENANCE role description ("asset" → "entity"), field_id_config module names ("Asset Management" → "Entity Management")
- New files: `apps/web/src/components/ui/toast.tsx`, `apps/web/src/hooks/use-toast.ts`, `apps/web/src/components/toast-provider.tsx`
- `main.tsx` wrapped in `<ToastProvider>`
- Prisma schema updated via `db push` (migration history out of sync)

---

## [Unreleased] - 2026-02-20

### Fixed
- **Entity creation returning 400** — API rejected entity creation from inactive templates (`isActive=false`) but the frontend showed all templates. Removed the `isActive` check from `POST /instances` so entities can be created from any template.
- **Role Privileges page crash** — Page crashed when rendering the Entity Management category because `CATEGORY_COLORS` map in `role-privileges.tsx` only had entries for 'User Management' and 'System', but not 'Entity Management'. Accessing `categoryConfig.bg` on `undefined` threw a TypeError. Added missing entry with teal/emerald color scheme.

### Removed
- **Template Linking Rules — Complete Removal** — Removed the entire Template Linking Rules feature. Any entity can now link to any other entity with any relationship type — no restrictions.
  - **Database**: Dropped `TemplateLinkingRule` model, removed `allowCrossTemplateLinking` field from Role model, removed `sourceLinkingRules`/`targetLinkingRules` relations from AssetTemplate
  - **API**: Deleted 5 linking rule endpoints (GET/POST/PUT/DELETE `/linking-rules`, GET `/linking-rules/validate`), removed `validateLinkingRule()` helper, removed linking rule validation from POST /relationships. Asset endpoints reduced from 26 to 21, Prisma models from 6 to 5
  - **Shared Package**: Removed `LINKING_RULE_SCOPES`, `FORWARD_RELATIONSHIP_TYPES` constants, `createTemplateLinkingRuleSchema`/`updateTemplateLinkingRuleSchema` schemas, `TEMPLATE_LINKING_RULE_MANAGE` permission, 3 linking rule audit actions, 3 linking rule reauth actions, 3 linking rule audit templates, `allowCrossTemplateLinking` from RoleData interface
  - **Frontend**: Deleted `/config/template-linking-rules` page (~449 lines), removed config card from config index, removed `allowCrossTemplateLinking` toggle from role create/edit dialogs, simplified Link Entities dialog (removed rule validation SWR, disabled states, info banners — all 12 relationship types now freely available)
  - **Seed**: Removed `TEMPLATE_LINKING_RULE_MANAGE` from SUPER_ADMIN and ADMIN default permissions
  - **Documentation**: Updated all 4 CLAUDE.md files, both DECISIONS.md files

---

## [Unreleased] - 2026-02-19

### Added
- ~~**Template Linking Rules**~~ *(Removed in 2026-02-20 — see Removed section above)*

- ~~**Role Cross-Template Linking Bypass**~~ *(Removed in 2026-02-20)*

- ~~**Template Linking Rules Config Page**~~ *(Removed in 2026-02-20)*

- **Dynamic Tree Diagram — Sidebar Tree Actions**
  - 3 hover action buttons on each sidebar tree node:
    - Green "+" — Create new child entity (opens Add Entity wizard with parentId pre-set)
    - Blue link icon — Attach existing entity as child (opens Attach Existing dialog)
    - Red "x" — Unlink from parent (sets parentId to null, only shows if node has parentId)

- **Dynamic Tree Diagram — Diagram Tree Actions**
  - 3 hover action buttons on each diagram node:
    - Green circle — Create new child entity
    - Blue circle — Attach existing entity as child via CONTAINS relationship
    - Red circle — Remove from tree (deletes CONTAINS relationship, does NOT delete entity)
  - Renamed `renderTreeNode` to `renderDiagNode` with new `parentNodeId` parameter

- **Attach Existing Entity Dialog**
  - Full modal dialog for attaching an existing entity as a child in the tree
  - Search input with debounce filtering
  - Radio-button entity list with template badge indicator
  - Preview panel showing selected entity details
  - Creates CONTAINS relationship on confirm, reauth-protected via `CREATE_ASSET_RELATIONSHIP`

- ~~**Linking Rule Enforcement in Link Entities Dialog**~~ *(Removed in 2026-02-20)*

- **Comprehensive Test Suite** — 70/70 tests passed
  - 13 sections: tree CRUD, attach existing, remove, unlink, 6 relationship types, cycle detection, config endpoints, cleanup
  - Full report: `TREE_DIAGRAM_TEST_REPORT.md`

### Changed
- Entity Explorer `index.tsx` grew from ~2382 to ~2993 lines (tree diagram actions + attach existing + rule enforcement)
- `AssetDetailPanel` props expanded: added `onAddChild`, `onAttachExisting`, `onRemoveFromDiagram`
- Updated all 4 CLAUDE.md files, both DECISIONS.md files (5 new architecture decisions)

- **Telemetry Schema for Entity Templates**
  - New `TELEMETRY_DATA_TYPES` constant (INTEGER, FLOAT, BOOLEAN, STRING, ENUM)
  - Zod `telemetryDefinitionSchema` with fieldName, dataType, unit, description
  - `telemetrySchema` field added to `createAssetTemplateSchema` / `updateAssetTemplateSchema`
  - API POST/PUT `/api/assets/templates` now persist `telemetrySchema` to database
  - Template version snapshots include telemetry schema data
  - Exported `TELEMETRY_DATA_TYPES` from `@digilog/shared`

- **Telemetry Section in Entity Template Editor** (`/assets/templates`)
  - New "Telemetry Schema" collapsible section (Section 3) in the 5-section template editor
  - Add/remove telemetry point definitions with: Field Name, Data Type (5 types), Unit, Description
  - Persists on create and edit, loads existing data when editing templates

- **Telemetry Tab in Entity Explorer** (`/assets`)
  - New "Telemetry" tab in the entity detail panel (between Attributes and Relationships)
  - Shows telemetry schema from the entity's template: Field Name, Data Type, Unit, Description
  - Shows instance-level `telemetryConfig` overrides per field
  - API GET `/api/assets/instances/:id` now includes `telemetrySchema` in template select

- **Multi-Select Target in Link Entities Dialog**
  - Target Entities field replaced with searchable multi-select checkbox list
  - Selected targets shown as removable blue chips with count badge
  - Search box to filter entities by name or template name
  - Direction preview shows one line per source-target pair
  - Bulk relationship creation: one source linked to all selected targets in sequence
  - After linking, source node auto-expands in tree view
  - Button text dynamically shows count (e.g., "Link 3 Entities")

- **Hierarchical Tree Diagram in Entity Explorer**
  - Visual node-based hierarchy diagram in Relationships tab with box nodes and arrow connectors
  - Walks up to the topmost root, then renders the full tree top-to-bottom with SVG arrow lines
  - Parent node at top, arrow down to horizontal bar, arrows branching down to each child node
  - Each child can recursively have its own sub-children, rendered at the next level
  - Relationship type labels (Contains, Feeds, Monitors, etc.) shown as badges above each child node
  - Current entity highlighted with blue border + ring; click any other node to navigate
  - Single-child paths use straight vertical connectors; multi-child paths use horizontal bar branching
  - Cycle-safe via visited-node tracking; horizontally scrollable for wide trees
  - Fetches all relationships from `/api/assets/relationships` to build complete hierarchy
  - After linking, auto-selects source entity and switches to Relationships tab

- **Dialog Scroll Fix**
  - All dialog popups now constrained to 90% viewport height with scrollable content
  - Link Entities chips area capped at `max-h-24` with overflow scroll
  - Preview section capped at `max-h-32` with sticky header, preventing Link button from going off-screen

### Fixed
- **Link Entities dropdowns empty** — Source Entity and Target Entities dropdowns were rendering empty despite entities existing in the database
  - Root cause: API tree endpoint's JSON schema defined `parentId` as `type: 'string'`, causing Fastify serialization to coerce `null` to `""` (empty string)
  - Frontend `flatAssetList` walk function started from `parentId === null`, which never matched `""`, so no assets were found
  - Fix: Made `parentId` nullable in API response schema (`type: ['string', 'null']`), and updated frontend `flatAssetList` + `rootNodes` to treat `null`, `undefined`, and `""` as root indicators

### Removed
- **Instruments Feature** — Complete removal of instruments and instrument templates
  - Deleted: `packages/shared/src/schemas/instruments.ts`, `apps/api/src/modules/instruments/`, `apps/web/src/routes/instruments/`
  - Reverted all shared types (permissions, sidebar, reauth, audit actions, audit templates, feature privileges)
  - Dropped database tables: `instruments`, `instrument_template_versions`, `instrument_templates`
  - Removed from API routes, swagger tags, seed data, main.tsx routes, sidebar navigation

## [Unreleased] - 2026-02-17

### Added
- **Action Re-authentication Configuration** (`/config/action-reauth`)
  - New SUPER_ADMIN config page with role-action matrix (checkboxes)
  - 20 configurable actions across 4 categories (User Mgmt, Config, Roles, Backup)
  - Select All / Clear per category and per role
  - Backend: `GET/PUT /api/config/action-reauth`, `/action-reauth/check`, `/action-reauth/my-actions`
  - Reauth helper library (`apps/api/src/lib/reauth-check.ts`) with in-memory cache (10s TTL)
  - Shared types: `REAUTH_ACTIONS`, `ReauthAction`, `REAUTH_ACTION_CATEGORIES`
  - Shared schema: `actionReauthConfigSchema`

- **Audit Text Templates Configuration** (`/config/audit-templates`)
  - New SUPER_ADMIN config page to customize audit trail action descriptions
  - 7 template categories: User Management, Authentication, Configuration, Entity Management, Role Management, Backup, Data & Approvals
  - Live preview with sample data while editing templates
  - Placeholder system: `{actor}`, `{targetUser}`, `{targetName}`, `{configKey}`, `{targetType}`
  - Reset individual or all templates to defaults
  - Backend: `GET/PUT /api/config/audit-templates`, `/audit-templates/current`
  - Shared types: `AUDIT_TEMPLATE_DEFAULTS`, `AUDIT_TEMPLATE_CATEGORIES`, `getDefaultTemplates()`
  - Shared schema: `auditTemplatesSchema`

- **Pagination Settings Configuration** (`/config/pagination`)
  - New SUPER_ADMIN config page with 3 configurable record-per-page options
  - Preview of pagination selector UI
  - Auto-sorts values ascending on save
  - Validation: min 5, max 100, all 3 must be distinct
  - Backend: `GET/PUT /api/config/pagination`, `/pagination/current`
  - Shared schema: `paginationConfigSchema`

- **3 new cards** added to System Configuration index (`/config`) under Super Admin Settings

### Changed
- **Role Privileges page** (`/config/role-privileges`) — now fetches roles dynamically from `/api/roles/active` API instead of using hardcoded `ROLES` constant. Newly created custom roles now appear immediately in the role selection buttons. Uses `role.displayName` and `role.color` from database. Fallback icon/color for custom roles without predefined styling.
- **SWR revalidation** — Role privileges page now uses `revalidateOnMount: true` and `dedupingInterval: 0` to ensure fresh role data on every page visit.

### Fixed
- **Dynamic role validation** — Changed Zod schemas from hardcoded `z.enum([...])` to `z.string()` for role fields in `packages/shared/src/schemas/users.ts` to support custom roles (e.g., "QA", "ENGINEER").
- **Dynamic role checking in backend** — Replaced hardcoded `CREATABLE_ROLES` import with dynamic DB lookups in `apps/api/src/modules/users/routes.ts` for create and update user routes.
- **SWR cache invalidation for roles** — Changed `roles.tsx` to use `useSWRConfig()` global mutate with filter function `(key => key.startsWith('/api/roles'))` to invalidate all role-related SWR cache entries when roles are created, updated, or deleted.
- **Newly created roles not appearing in Role Privileges** — Role privileges page was using hardcoded `ROLES` constant; now fetches from API dynamically.

## [1.0.0] - 2026-02-17

### Added
- Initial release with full User Management and Entity Management
- User CRUD with role-based access control
- 6 default roles: SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER
- Dynamic role management (create/edit/delete custom roles)
- Password policy configuration (min length, complexity, history, reuse prevention)
- Login security (account lockout after failed attempts)
- Session management (idle timeout with warning countdown)
- Date/time format configuration
- User ID format configuration (auto-generation, custom patterns)
- Branding configuration (logo, colors, company name)
- Field ID name customization
- Role privileges (per-role feature permissions)
- Sidebar configuration (per-user sidebar items)
- Backup & restore (database export/import)
- ISA-95 entity hierarchy (Enterprise > Site > Area > Line > Cell > Equipment)
- Template-driven entity creation with JSONB attribute merging
- ltree-based unlimited-depth hierarchy
- Audit trail with SHA-256 checksums (tamper-evident)
- Notifications system
- Profile management
- Forgot password / reset request workflow
- 21 CFR Part 11 compliance (secure password fields, audit trail, RBAC, session management)
