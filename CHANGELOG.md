# Changelog

All notable changes to DigiLog (21 CFR Part 11 Compliant Digital Logbook) are documented here.

## [2.2.2] - 2026-02-25

### Fixed — Runtime `h.map is not a function` Error (BUG-014)
- **Root cause:** PM2 was running stale API build without the `/api/user-requests/roles` endpoint; public roles fetch returned a 404 error object instead of an array, causing `roles.map()` to crash in production
- **Fix 1:** Rebuilt API (`rm -rf dist && tsc`) and restarted PM2 to register user-requests module
- **Fix 2:** Added defensive `Array.isArray()` guard + `r.ok` HTTP status check in `request-account.tsx` roles fetch to prevent future non-array responses from crashing the page
- **Impact:** Public `/request-account` page now loads reliably; error boundary no longer triggered

---

## [2.2.1] - 2026-02-25

### Fixed — User Creation Requests Code Quality & 400-Line Compliance
- **Split `creation-requests.tsx` (451→331 lines)** — extracted 3 dialog components to `creation-request-dialogs.tsx` (209 lines)
  - `ApproveDialog` — approve confirmation with request details
  - `RejectDialog` — reject with mandatory reason textarea
  - `TempPasswordDialog` — one-time temp password display with copy/show/hide
- **Added 300ms search debounce** to admin requests list (per frontend CLAUDE.md performance guidelines)
- All user-requests module files now comply with 400-line limit

---

## [2.2.0] - 2026-02-25

### Added — Public User Account Creation Request Flow (NEW FEATURE)
- **Self-service account onboarding** — unauthenticated users can request a new account from the login page
  - Module: User Management — User Requests
  - New Prisma model: `UserCreationRequest` with status tracking, reviewer FK, temp password hash
  - New API module: `apps/api/src/modules/user-requests/` (repository, service, routes)
  - 8 new API endpoints (2 public, 6 admin):
    - `GET /api/user-requests/roles` — Public, active roles for form dropdown (rate limited 10/min)
    - `POST /api/user-requests` — Public, submit creation request (rate limited 5/min)
    - `GET /api/user-requests` — Admin, list requests (paginated, filterable)
    - `GET /api/user-requests/pending/count` — Admin, pending count for badge
    - `GET /api/user-requests/:id` — Admin, request detail
    - `POST /api/user-requests/:id/approve` — Admin, approve with reauth (creates user with temp password)
    - `POST /api/user-requests/:id/reject` — Admin, reject with mandatory reason and reauth
    - `POST /api/user-requests/:id/password-viewed` — Admin, mark temp password as viewed
  - New frontend pages:
    - `/request-account` — Public form (User ID, Full Name, Email, Department, Role) styled to match login/forgot-password branding
    - `/users/creation-requests` — Admin review panel with pending requests, approve/reject workflow, temp password one-time display, request history
  - Sidebar nav item: "Account Requests" (visible to SUPER_ADMIN, ADMIN)
  - Login page: "Request Account" link added alongside "Forgot password?"
  - 3 new audit actions: `USER_CREATION_REQUEST_SUBMITTED`, `USER_CREATION_REQUEST_APPROVED`, `USER_CREATION_REQUEST_REJECTED`
  - 2 new reauth actions: `APPROVE_USER_REQUEST`, `REJECT_USER_REQUEST`
  - 3 new notification types matching the audit actions
  - 3 new audit templates with `{actor}`, `{targetUser}`, `{requestedRole}` placeholders
  - Security: rate limiting on public endpoints, duplicate detection (users + pending requests), role hierarchy enforcement, server-side user ID validation, crypto.randomBytes temp password generation, one-time display with isPasswordViewed flag
  - Shared package: `createUserRequestSchema`, `userRequestQuerySchema`, `rejectUserRequestSchema`

---

## [2.1.3] - 2026-02-25

### Fixed — Audit Trail Showing UUID Instead of User ID (BUG-013)
- **Audit trail `targetId` now shows username instead of UUID** for all user-related actions (BUG FIX)
  - Module: Audit Trail — User & Auth Services
  - Severity: HIGH
  - Root cause: 15 audit log calls in `user.service.ts` (9) and `auth.service.ts` (6) passed `user.id` (UUID) as `targetId` instead of `user.username`
  - Files fixed: `apps/api/src/modules/users/user.service.ts`, `apps/api/src/modules/auth/auth.service.ts`
  - Actions fixed: USER_CREATED, USER_UPDATED, USER_DELETED, BULK_USER_DELETED, USER_ENABLED, USER_DISABLED, ACCOUNT_UNLOCKED, PASSWORD_RESET, PASSWORD_RESET_REQUEST_APPROVED, ACCOUNT_LOCKED, LOGIN_FAILED, PASSWORD_EXPIRED, LOGIN_SUCCESS, PROFILE_UPDATED, PASSWORD_CHANGED
  - Also added `fullName` to `afterValue` in PASSWORD_RESET and PASSWORD_RESET_REQUEST_APPROVED audit entries
  - Frontend reset-requests page success message now shows both fullName and userId
  - Git Issue: [#14](https://github.com/pankajexa/21cfrlogbook/issues/14)

### Added — Separate Audit Action for Role Changes (USER_ROLE_CHANGED)
- **Role changes now logged as `USER_ROLE_CHANGED`** instead of generic `USER_UPDATED` (ENHANCEMENT)
  - Module: Audit Trail — User Service
  - Files changed:
    - `apps/api/src/modules/users/user.service.ts` — `update()` detects role change, logs `USER_ROLE_CHANGED` with before/after role values
    - `packages/shared/src/types/audit-actions.ts` — Added `USER_ROLE_CHANGED` constant
    - `packages/shared/src/types/audit-templates.ts` — Added template: `Role changed for "{targetUser}" from {beforeRole} to {afterRole} by {actor}`
    - `apps/web/src/routes/audit/audit-helpers.ts` — Added `USER_ROLE_CHANGED` color (violet), added `{beforeRole}`/`{afterRole}` placeholder support
  - Behavior: role changed → logs `USER_ROLE_CHANGED` only; no role change → logs `USER_UPDATED` only (always one record per update, never two)
  - Notifications: role change sends two notifications — one to ADMIN users ("User X role changed from Y to Z") and one to the affected user ("Your role has been changed from Y to Z")

### Fixed — E2E Test Infrastructure (BUG-012 + SESSION_CONFLICT)
- **E2E test helper `loginAs()` now sends `force: true`** — resolves SESSION_CONFLICT failures when active admin session exists (BUG FIX)
  - Module: Testing Infrastructure
  - Root cause: `loginAs()` in `apps/api/src/e2e/test-helper.ts` did not pass `force: true` to `/api/auth/login`, causing 409 SESSION_CONFLICT errors in all test suites that needed authentication
  - Files fixed:
    - `apps/api/src/e2e/test-helper.ts` — Added `force: true` to login payload in `loginAs()`; added global error handler (matching `app.ts`) to `buildApp()` so `AppError` instances are serialized correctly
    - `apps/api/src/e2e/auth.test.ts` — Added `force: true` to direct login test call
    - `apps/api/src/e2e/roles.test.ts` — Removed `VIEWER` role assertion (role deleted from test DB); test now checks only guaranteed roles (SUPER_ADMIN, ADMIN)
  - BUG-012 resolved: `buildApp()` was missing the global error handler, so `AppError(401, 'INVALID_CREDENTIALS')` was serialized as Fastify's default `Unauthorized` instead of the custom error code
  - **Result: 267/267 tests passing (151 shared + 116 API) — 100% pass rate**

---

## [2.1.2] - 2026-02-25

### Changed — Git Issue Lifecycle for Bug Resolution Log
- **Created 12 GitHub issues** (#2–#13) for all bugs in Bug_Resolution_Log.md (PATCH)
  - Module: Documentation / Bug Lifecycle
  - Files affected: `documentation/Bug_Resolution_Log.md`, all 7 governance docs
  - 11 issues closed with commit references, 1 remains open (#13 — BUG-012, low priority)
  - Each issue follows structured template: Summary, Module, Severity, Steps to Reproduce, Root Cause, Impact, Resolution
  - Labels applied: `bug`, `severity:<level>`, `module:<name>`
  - Bug_Resolution_Log.md updated with linked Git Issue IDs for full traceability

---

## [2.1.1] - 2026-02-25

### Changed — Documentation Governance
- **Documentation governance enforcement activated** — All 7 core documents now auto-updated on every change (PATCH)
  - Module: Documentation / Governance
  - Files affected: `CHANGELOG.md`, `API_GUIDE.md`, `task_status.md`, `BUSINESS_CONTEXT.md`, `CODEBASE_CONTEXT.md`, `PLAN.md`, `documentation/Project_Summary.md`
  - Established permanent self-enforcing documentation synchronization rule
  - Every prompt, fix, feature, or structural change will trigger mandatory updates to all 7 governance files
  - Added documentation compliance status tracking in `Project_Summary.md`

### Changed — Documentation Centralization (2026-02-25)
- **Testing documents centralized** to `/documentation/testing/` with subfolders: `manual/`, `reports/`, `automation/`, `validation/`
- **Created `Bug_Resolution_Log.md`** — 12 historical bugs cataloged with structured format
- **Created `Project_Summary.md`** — Comprehensive project summary with architecture, features, testing, bug metrics
- **Created `.github/ISSUE_TEMPLATE/bug_report.md`** — Structured bug report template
- **Updated all cross-references** in PLAN.md, BUSINESS_CONTEXT.md, CODEBASE_CONTEXT.md, CHANGELOG.md, task_status.md
  - Module: Documentation
  - Files moved: 8 testing documents from root to `/documentation/testing/`
  - Files created: 3 (`Bug_Resolution_Log.md`, `Project_Summary.md`, `bug_report.md`)
  - Files updated: 5 (`PLAN.md`, `BUSINESS_CONTEXT.md`, `CODEBASE_CONTEXT.md`, `CHANGELOG.md`, `task_status.md`)

---

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
  - Full report: `documentation/testing/reports/TREE_DIAGRAM_TEST_REPORT.md`

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
