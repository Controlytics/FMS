# DigiLog Shared — CLAUDE.md

## Overview
Shared TypeScript types, Zod schemas, and constants used by both API and Web apps.

## Build
```bash
npx nx build shared
# or: cd packages/shared && npx tsc
```

**Important:** After any changes to the shared package, rebuild it before testing API or Web:
```bash
npx nx build shared
```

## Key Exports
- `schemas/` — Zod validation schemas (login, user, config, etc.)
- `types/` — TypeScript interfaces, enums, and constants (10 files; see Live Type Inventory below)
- `index.ts` — Barrel export

## Usage
```typescript
import { PERMISSIONS, loginSchema, createUserSchema } from '@digilog/shared';
```

## Exports Inventory

### Permissions
- `PERMISSIONS` enum — 52+ permission constants (ASSET_CREATE, ASSET_READ, FILTER_MANAGE, etc.)
- Used by both backend `requirePermission()` and frontend `<RequireRole permissions={[]}>`

### Schemas
- `loginSchema` — Login form validation
- `createUserSchema` — User creation validation
- `updateUserSchema` — User update validation
- `passwordPolicySchema` — Password policy config validation
- `loginSecuritySchema` — Login security config validation
- `sessionConfigSchema` — Session config validation
- `datetimeConfigSchema` — Date/time format validation

### Types
- Role hierarchy types
- Notification event types
- Config key types
- Alarm column definitions
- Relationship type mappings (INVERSE_RELATIONSHIP_MAP)

### Constants
- `ALARM_COLUMN_DEFINITIONS` — 11 alarm columns with metadata
- `INVERSE_RELATIONSHIP_MAP` — Bidirectional relationship type pairs
- Default audit text templates

## Live Type Inventory (verified 2026-04-30 post-MT-removal)

`packages/shared/src/types/` contains **10 type files**:

| File | Purpose |
|---|---|
| `permissions.ts` | **105** permission constants (PERMISSIONS enum + ALL_PERMISSIONS list) — 4 ORG_* perms removed in MT removal |
| `feature-privileges.ts` | **90** feature privileges + `FEATURE_TO_PERMISSION_MAP` — 2 org.* privileges removed in MT removal; `version_history.view` added 2026-05-02 |
| `reauth-actions.ts` | **81** reauth actions across 16 categories |
| `roles.ts` | Role constants + hierarchy + display labels |
| `permission-categories.ts` | Permission grouping for the role-access UI |
| `sidebar-items.ts` | **26** sidebar items (Organizations entry removed in MT removal; `version-history` added 2026-05-02) |
| `sidebar-privilege-map.ts` | Sidebar item → privilege binding |
| `audit-actions.ts` | Audit action constants for `AuditTrail.action` |
| `audit-templates.ts` | Templates that hide UUIDs in audit UI (e.g. `"<RequestType> — <Name> (<EmployeeID>)"`) |
| `alarm-columns.ts` | Alarm column metadata for `/config/alarm-columns` |

Plus `index.ts` (barrel).

`packages/shared/src/schemas/` contains **8 Zod validation schemas** (+ `.test.ts` siblings):

| File | Purpose |
|---|---|
| `auth.ts` | Login, logout, change-password, force-login |
| `users.ts` | Create / update / role-assignment user payloads |
| `assets.ts` | Asset template + instance + relationship + identifier + **TemplateKind CRUD** payloads. `SYSTEM_TEMPLATE_KIND_CODES` and `templateKindCodeSchema` exported here (Step 1 of architectural refactor). |
| `templates.ts` | Asset template body schema (`attributeSchema`, alarm rules) |
| `hierarchy.ts` | Block / Area / AHU hierarchy create payloads |
| `audit.ts` | Audit query schema |
| `config.ts` | All config-page payload schemas (password-policy, branding, datetime, etc.) |
| `action-reauth.ts` | Reauth-action request schema |

> Stray file: `config.ts.patch` exists in this folder — clean up.

## Notes
- Prisma schema has **69 models, 23 enums** in `apps/api/prisma/schema.prisma` (Step 6 — 2026-05-01 — added `FilterDetails` 1:1 sidecar holding the filter-specific cycle state; was 64 post-MT-removal; Phase A.3 — 2026-05-01 — added `FilterProfileVersion` sidecar; Phase A.4 — 2026-05-02 — added `EquipmentGroupVersion` sidecar; Step 4 — 2026-05-02 — replaced `FilterProfile.applicableTemplates` JSONB array with `FilterProfileApplicableTemplate` join table)
- Phase 2 types (filter operations, cleaning profiles) are still co-located in API modules (not yet extracted)
- 78+ field IDs across all modules (including filter management fields)

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.

---

## Phase 4 Update (2026-04-14)

**Permissions & Privileges (snapshot at release; current totals are higher — see Live Type Inventory):**
- Each FEATURE_TO_PERMISSION_MAP mapping includes both frontend visibility permission + backend route permission
- 16 reauth categories
- `colorTheme` field added to `brandingConfigSchema` in `schemas/config.ts`
- Sidebar privilege map updated with new toggle IDs for Filters/Checklist/Cleaning Profile/Equipment Group/PM page controls

See `CHANGELOG.md` for full details.

## Phase 5 Updates (2026-04-15..29)

- New audit-template + audit-action types added (UUIDs no longer leak in admin-request audit UI)
- New permission/reauth additions: `FILTER_CREATE/EDIT/DELETE/HIERARCHY_EDIT/HIERARCHY_DELETE`, `PM_APPROVE`, 9 `REPORT_*` permissions, `BLOCK_CHANGE_REQUEST/APPROVE`
- `requireAnyPermission(...perms)` decorator pattern requires shared types to expose permission lists in tuple form (used by backend RBAC plugin to check "any of")
