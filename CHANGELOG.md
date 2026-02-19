# Changelog

All notable changes to DigiLog (21 CFR Part 11 Compliant Digital Logbook) are documented here.

## [Unreleased] - 2026-02-19

### Added
- **Template Linking Rules — Database & Backend**
  - New `TemplateLinkingRule` Prisma model with scoped priority system (USER=20 > ROLE=10 > GLOBAL=0)
  - `@@unique([sourceTemplateId, targetTemplateId, scope, scopeValue])` constraint + API-level duplicate prevention (PostgreSQL NULL workaround)
  - Relations on `AssetTemplate` model: `sourceLinkingRules`, `targetLinkingRules` with cascade delete
  - 5 new API endpoints under `/api/assets/linking-rules`:
    - `GET /linking-rules` — List all rules with template names, filterable by source/target
    - `GET /linking-rules/validate` — Check allowed relationship types between two assets
    - `POST /linking-rules` — Create rule (permission: `TEMPLATE_LINKING_RULE_MANAGE`, reauth-protected)
    - `PUT /linking-rules/:id` — Update rule
    - `DELETE /linking-rules/:id` — Delete rule
  - `validateLinkingRule()` engine integrated into `POST /relationships` — returns 403 if blocked
  - Backwards compatible: no rules = all relationship types allowed
  - Swagger tag "Template Linking Rules" added

- **Template Linking Rules — Shared Package**
  - New permission: `TEMPLATE_LINKING_RULE_MANAGE`
  - New `LINKING_RULE_SCOPES` constant: `['GLOBAL', 'ROLE', 'USER']`
  - New Zod schemas: `createTemplateLinkingRuleSchema`, `updateTemplateLinkingRuleSchema`
  - 3 new audit actions: `TEMPLATE_LINKING_RULE_CREATED/UPDATED/DELETED`
  - 3 new reauth actions: `CREATE/UPDATE/DELETE_TEMPLATE_LINKING_RULE`
  - 3 new audit templates with placeholder support
  - Added to permission categories (Asset Management) and reauth action categories
  - Seeded `TEMPLATE_LINKING_RULE_MANAGE` to SUPER_ADMIN and ADMIN default permissions

- **Role Cross-Template Linking Bypass**
  - New `allowCrossTemplateLinking` boolean field on `Role` model (default: false)
  - When enabled, bypasses all template linking rules for relationship creation
  - Toggle added to role create/edit dialogs in `roles.tsx` config page
  - Checked at request time from DB (not cached) — role changes take immediate effect

- **Template Linking Rules Config Page** (`/config/template-linking-rules`)
  - New SUPER_ADMIN-only frontend page (~449 lines)
  - Table view: source/target template names, allowed relationship badges, scope, edit/delete actions
  - Add/edit dialog: template dropdowns, relationship type checkboxes, scope selector (GLOBAL/ROLE/USER)
  - Reauth-protected create/update/delete operations
  - Route registered in `main.tsx` with `RequireRole` guard

- **Dynamic Tree Diagram — Sidebar Tree Actions**
  - 3 hover action buttons on each sidebar tree node:
    - Green "+" — Create new child asset (opens Add Asset wizard with parentId pre-set)
    - Blue link icon — Attach existing asset as child (opens Attach Existing dialog)
    - Red "x" — Unlink from parent (sets parentId to null, only shows if node has parentId)

- **Dynamic Tree Diagram — Diagram Tree Actions**
  - 3 hover action buttons on each diagram node:
    - Green circle — Create new child asset
    - Blue circle — Attach existing asset as child via CONTAINS relationship
    - Red circle — Remove from tree (deletes CONTAINS relationship, does NOT delete asset)
  - Renamed `renderTreeNode` to `renderDiagNode` with new `parentNodeId` parameter

- **Attach Existing Asset Dialog**
  - Full modal dialog for attaching an existing asset as a child in the tree
  - Search input with debounce filtering
  - Radio-button asset list with template badge indicator
  - Preview panel showing selected asset details
  - Creates CONTAINS relationship on confirm, reauth-protected via `CREATE_ASSET_RELATIONSHIP`

- **Linking Rule Enforcement in Link Assets Dialog**
  - Fetches applicable rules via `/api/assets/linking-rules/validate`
  - Relationship types shown as radio buttons with disabled state for blocked types
  - Lock icon + grayed styling on disallowed types
  - Info banners: "Restricted by template linking rules" / "Bypassed by role"
  - Auto-switch effect: moves selection to first allowed type if current becomes disallowed

- **Comprehensive Test Suite** — 70/70 tests passed
  - 13 sections: tree CRUD, attach existing, remove, unlink, 6 relationship types, cycle detection, linking rules CRUD, validation engine, role bypass, edge cases, config endpoints, cleanup
  - Full report: `TREE_DIAGRAM_TEST_REPORT.md`

### Changed
- Asset Explorer `index.tsx` grew from ~2382 to ~2993 lines (tree diagram actions + attach existing + rule enforcement)
- Asset module `routes.ts` grew from ~1662 to ~2057 lines (5 linking rule endpoints + validation engine)
- `AssetDetailPanel` props expanded: added `onAddChild`, `onAttachExisting`, `onRemoveFromDiagram`
- Total asset API endpoints: 21 → 26 (5 new linking rule endpoints)
- Total asset Prisma models: 5 → 6 (added `TemplateLinkingRule`)
- Updated all 4 CLAUDE.md files, both DECISIONS.md files (5 new architecture decisions)

- **Telemetry Schema for Asset Templates**
  - New `TELEMETRY_DATA_TYPES` constant (INTEGER, FLOAT, BOOLEAN, STRING, ENUM)
  - Zod `telemetryDefinitionSchema` with fieldName, dataType, unit, description
  - `telemetrySchema` field added to `createAssetTemplateSchema` / `updateAssetTemplateSchema`
  - API POST/PUT `/api/assets/templates` now persist `telemetrySchema` to database
  - Template version snapshots include telemetry schema data
  - Exported `TELEMETRY_DATA_TYPES` from `@digilog/shared`

- **Telemetry Section in Asset Template Editor** (`/assets/templates`)
  - New "Telemetry Schema" collapsible section (Section 3) in the 5-section template editor
  - Add/remove telemetry point definitions with: Field Name, Data Type (5 types), Unit, Description
  - Persists on create and edit, loads existing data when editing templates

- **Telemetry Tab in Asset Explorer** (`/assets`)
  - New "Telemetry" tab in the asset detail panel (between Attributes and Relationships)
  - Shows telemetry schema from the asset's template: Field Name, Data Type, Unit, Description
  - Shows instance-level `telemetryConfig` overrides per field
  - API GET `/api/assets/instances/:id` now includes `telemetrySchema` in template select

- **Multi-Select Target in Link Assets Dialog**
  - Target Assets field replaced with searchable multi-select checkbox list
  - Selected targets shown as removable blue chips with count badge
  - Search box to filter assets by name or template name
  - Direction preview shows one line per source-target pair
  - Bulk relationship creation: one source linked to all selected targets in sequence
  - After linking, source node auto-expands in tree view
  - Button text dynamically shows count (e.g., "Link 3 Assets")

- **Hierarchical Tree Diagram in Asset Explorer**
  - Visual node-based hierarchy diagram in Relationships tab with box nodes and arrow connectors
  - Walks up to the topmost root, then renders the full tree top-to-bottom with SVG arrow lines
  - Parent node at top, arrow down to horizontal bar, arrows branching down to each child node
  - Each child can recursively have its own sub-children, rendered at the next level
  - Relationship type labels (Contains, Feeds, Monitors, etc.) shown as badges above each child node
  - Current asset highlighted with blue border + ring; click any other node to navigate
  - Single-child paths use straight vertical connectors; multi-child paths use horizontal bar branching
  - Cycle-safe via visited-node tracking; horizontally scrollable for wide trees
  - Fetches all relationships from `/api/assets/relationships` to build complete hierarchy
  - After linking, auto-selects source asset and switches to Relationships tab

- **Dialog Scroll Fix**
  - All dialog popups now constrained to 90% viewport height with scrollable content
  - Link Assets chips area capped at `max-h-24` with overflow scroll
  - Preview section capped at `max-h-32` with sticky header, preventing Link button from going off-screen

### Fixed
- **Link Assets dropdowns empty** — Source Asset and Target Assets dropdowns were rendering empty despite assets existing in the database
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
  - 7 template categories: User Management, Authentication, Configuration, Asset Management, Role Management, Backup, Data & Approvals
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
- Initial release with full User Management and Asset Management
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
- ISA-95 asset hierarchy (Enterprise > Site > Area > Line > Cell > Equipment)
- Template-driven asset creation with JSONB attribute merging
- ltree-based unlimited-depth hierarchy
- Audit trail with SHA-256 checksums (tamper-evident)
- Notifications system
- Profile management
- Forgot password / reset request workflow
- 21 CFR Part 11 compliance (secure password fields, audit trail, RBAC, session management)
