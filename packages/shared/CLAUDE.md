# DigiLog Shared — Types & Schemas

## Purpose
Shared Zod schemas and TypeScript types used by both API and Web apps. Single source of truth for validation rules and type definitions.

## Structure
- `src/types/roles.ts` — Role enum, hierarchy, creatable roles map
- `src/types/permissions.ts` — Permission constants (PERMISSIONS), role-permission matrix
- `src/types/permission-categories.ts` — PERMISSION_CATEGORIES for role create/edit dialog (derived from PERMISSIONS)
- `src/types/feature-privileges.ts` — FEATURE_PRIVILEGES and FEATURE_PRIVILEGE_CATEGORIES for role-privileges config page
- `src/types/sidebar-items.ts` — SIDEBAR_ITEMS for sidebar config page
- `src/types/audit-actions.ts` — Audit action enum
- `src/types/reauth-actions.ts` — REAUTH_ACTIONS, REAUTH_ACTION_CATEGORIES for action-reauth config
- `src/types/audit-templates.ts` — AUDIT_TEMPLATE_DEFAULTS, AUDIT_TEMPLATE_CATEGORIES
- `src/schemas/` — Zod schemas for auth, users, hierarchy, templates, config, audit, action-reauth

## Dynamic Configuration Pattern
All configuration page data definitions are centralized here:
- **Adding a permission**: Add to `PERMISSIONS` in permissions.ts, then add to `PERMISSION_CATEGORIES` in permission-categories.ts
- **Adding a feature privilege**: Add to `FEATURE_PRIVILEGES` in feature-privileges.ts
- **Adding a sidebar item**: Add to `SIDEBAR_ITEMS` in sidebar-items.ts
- **Adding a reauth action**: Add to `REAUTH_ACTIONS` in reauth-actions.ts
- **Adding an audit template**: Add to `AUDIT_TEMPLATE_DEFAULTS` in audit-templates.ts

All config pages import from this package — no hardcoded lists in frontend components.

## Usage
Import from `@digilog/shared` in either app:
```ts
import { PERMISSIONS, PERMISSION_CATEGORIES, FEATURE_PRIVILEGES, SIDEBAR_ITEMS } from '@digilog/shared';
```
