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
- `types/` — TypeScript interfaces and enums
- `constants/` — PERMISSIONS enum, role hierarchy, field definitions, alarm column definitions
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

## Phase 2 Notes
- No new shared types added for Phase 2 (types are co-located in API modules)
- Prisma schema extended with Phase 2 models (57 total models, 17 enums) in `apps/api/prisma/schema.prisma`
- Known issue: Phase 2 types (filter operations, cleaning profiles, etc.) should be extracted to shared package for frontend type safety
- 78 field IDs across all modules (including filter management fields)
- 95 permission constants, 82 feature privileges, 69 reauth actions

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

**Permissions & Privileges:**
- 95 permission constants in `types/permissions.ts`
- 82 feature privileges in `types/feature-privileges.ts` with FEATURE_TO_PERMISSION_MAP
- Each mapping includes both frontend visibility permission + backend route permission
- 69 reauth actions in `types/reauth-actions.ts` across 16 categories
- `colorTheme` field added to `brandingConfigSchema` in `schemas/config.ts`
- Sidebar privilege map updated with new toggle IDs for Filters/Checklist/Cleaning Profile/Equipment Group/PM page controls

See `CHANGELOG.md` for full details.
