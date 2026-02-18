# Changelog

All notable changes to DigiLog (21 CFR Part 11 Compliant Digital Logbook) are documented here.

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
