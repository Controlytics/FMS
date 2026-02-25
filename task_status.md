# DigiLog — Development Status

## Infrastructure

| Component | Status | Details |
|-----------|--------|---------|
| Turborepo Monorepo | Done | `apps/api`, `apps/web`, `packages/shared` |
| Docker Compose | Done | PostgreSQL 16 with ltree + pgcrypto |
| Prisma Schema | Done | 15 models, migrations applied |
| Database Seed | Done | Default admin, system configs, field IDs |
| EC2 Deployment | Done | API :3000, nginx frontend, PostgreSQL :5432 |
| PM2 Process Manager | Done | `digilog-api` cluster mode |

## Backend (`apps/api`) — Fastify 5

### Plugins
| Plugin | Status | Notes |
|--------|--------|-------|
| Auth (JWT + Sessions) | Done | Token verify, session validation, user status check |
| Audit Logger | Done | SHA-256 checksummed, SUPER_ADMIN exempt |
| RBAC | Done | `requirePermission()` + `requireRole()` decorators |

### API Modules
| Module | Endpoints | Status | Architecture |
|--------|-----------|--------|--------------|
| **Auth** (8) | login, logout, beacon-logout, me, profile, change-password, verify, forgot-password | Done | Routes → Services → Repositories |
| **Users** (14) | CRUD + enable/disable/unlock/reset-password + reset-requests + bulk-delete + stats | Done | Routes → Services → Repositories |
| **Roles** (8) | CRUD + active list + creatable roles + permissions | Done | Routes → Services → Repositories |
| **Config** (33) | password-policy, login-security, session, datetime, user-id, branding, roles, users, field-ids, action-reauth, audit-templates, pagination | Done | Routes → Services → Repositories |
| **Entity Templates** (6) | CRUD + versioning + checklistSchema (14 question types) | Done | Routes → Services → Repositories |
| **Entity Instances** (8) | CRUD + tree + children + status change + cascade soft-delete | Done | Routes → Services → Repositories |
| **Entity Relationships** (3) | List + create (auto-inverse, cycle detection, connection limits) + delete | Done | Routes → Services → Repositories |
| **Entity Identifiers** (4) | List + lookup + create + delete | Done | Routes → Services → Repositories |
| **Audit** (4) | GET list (filtered/paginated), GET detail, DELETE, POST bulk-delete | Done | Monolithic routes |
| **Notifications** (9) | List, unread-count, mark read/unread, bulk ops, delete | Done | Monolithic routes |
| **Uploads** (2) | Photo upload + serve | Done | Monolithic routes |
| **Backup** (3) | Export + Restore + Validate | Done | Monolithic routes |

### Key Backend Features
- Temporary password flow with forced change on first login
- Account lockout (temporary/permanent) after failed attempts
- Password history enforcement (configurable reuse prevention)
- Session-based auth with immediate invalidation on disable/logout
- SHA-256 audit trail checksums (tamper-evident)
- Template-driven entity creation with JSONB attribute merging
- Checklist schemas on templates (14 question types: PASS_FAIL, YES_NO, YES_NO_NA, MCQ, MULTI_SELECT, TEXT, NUMERIC, DROPDOWN, PHOTO, DATE_TIME, SIGNATURE, YES_NO_COMMENT, CALCULATED, CONDITIONAL)
- Parent-child hierarchy via `parentId` self-reference
- Bidirectional relationships with auto-inverse creation (12 types)
- Connection limits (`maxParentConnections`, `maxConnections`) enforced on create
- Cycle detection for CONTAINS relationships
- Dynamic role management (create/edit/delete custom roles)
- Action re-authentication with in-memory cache
- Configurable audit text templates (Entity Management category)
- Configurable pagination options
- Re-auth enforcement helper (`apps/api/src/lib/reauth-check.ts`)
- Global error handler mapping `AppError` subclasses to HTTP responses
- `RequestContext` abstraction decouples services from Fastify request object

## Frontend (`apps/web`) — React 19 + Vite + Tailwind 4

### UI Components
| Component | Status |
|-----------|--------|
| Button, Input, Card, Badge, Select, Dialog, Table | Done |
| Sidebar (role-filtered nav) | Done |
| Header (user info, logout) | Done |
| AppLayout (auth guard, session timeout dialog) | Done |
| Error Boundary | Done |
| Re-auth Dialog | Done |
| Require Role Guard | Done |

### Pages
| Route | Page | Status |
|-------|------|--------|
| `/login` | Login form (secure password field) | Done |
| `/forgot-password` | Forgot password request | Done |
| `/change-password` | Forced password change with strength indicators | Done |
| `/` | Dashboard with role-based stats | Done |
| `/profile` | User profile | Done |
| `/users` | User list with search/filter/pagination | Done |
| `/users/create` | Create user form | Done |
| `/users/:id` | Edit user + reset password | Done |
| `/users/reset-requests` | Password reset requests | Done |
| `/config` | Config dashboard (general + super admin sections) | Done |
| `/config/password-policy` | Password policy + login security + session settings | Done |
| `/config/datetime` | Date/time format settings | Done |
| `/config/branding` | Logo, colors, company name config | Done |
| `/config/user-id` | User ID format + auto-generation config | Done |
| `/config/roles` | Role management (create/edit/delete) | Done |
| `/config/role-privileges` | Per-role feature permissions (dynamic roles) | Done |
| `/config/sidebar` | Per-user sidebar config | Done |
| `/config/field-ids` | Field display name config | Done |
| `/config/backup` | Database backup & restore | Done |
| `/config/action-reauth` | Action re-authentication matrix | Done |
| `/config/audit-templates` | Audit text template editor | Done |
| `/config/pagination` | Pagination settings (3 options) | Done |
| `/assets` | Entity Explorer with dynamic tree diagram, detail panel, CRUD dialogs | Done |
| `/assets/templates` | Entity Template Manager with 6-section editor + checklist builder | Done |
| `/notifications` | Notifications list | Done |
| `/audit` | Audit trail table with filters + detail dialog | Done |

### Key Frontend Features
- Copy/paste/cut/drag disabled on password fields (21 CFR Part 11)
- Idle session timeout with warning countdown
- Role-based navigation (different menus per role)
- SWR for data fetching with auto-revalidation
- Dynamic role support (custom roles in all dropdowns and config pages)
- Global SWR cache invalidation for role changes
- Toast notification system (success/error/warning/info with auto-dismiss)
- Dynamic tree diagram with create child, attach existing, remove from tree
- Connection limit enforcement in entity creation/linking
- Single-tab enforcement via localStorage heartbeat

## Shared Package (`packages/shared`)
- Zod schemas for all API payloads (auth, users, assets/entities, config, audit, action-reauth) — **Done**
- TypeScript types (roles, permissions, permission-categories, feature-privileges, sidebar-items, audit actions, reauth actions, audit templates) — **Done**
- Constants: ATTRIBUTE_DATA_TYPES (9), TELEMETRY_DATA_TYPES (5), RELATIONSHIP_TYPES (12), IDENTIFIER_TYPES (5), ASSET_STATUSES (5), ALARM_RULE_TYPES (7), ALARM_SEVERITIES (3), CHECKLIST_QUESTION_TYPES (14) — **Done**

## Documentation
- `CLAUDE.md` in root, api, web, shared — **Done**
- `DECISIONS.md` in api and web — **Done**
- `CHANGELOG.md` — **Done**
- `API_GUIDE.md` — **Done**
- `BUSINESS_CONTEXT.md` — **Done**
- `PLAN.md` — **Done**
- `documentation/Bug_Resolution_Log.md` — **Done**
- `documentation/Project_Summary.md` — **Done**
- `.github/ISSUE_TEMPLATE/bug_report.md` — **Done**

### Testing Documentation (centralized at `documentation/testing/`)
- `documentation/testing/manual/TEST.md` — **Done**
- `documentation/testing/manual/TEST_CASES.md` — **Done**
- `documentation/testing/manual/TEST_SUMMARY.md` — **Done**
- `documentation/testing/reports/TEST_REPORT.md` — **Done**
- `documentation/testing/reports/TREE_DIAGRAM_TEST_REPORT.md` — **Done**
- `documentation/testing/reports/RBAC_TEST_RESULTS.md` — **Done**
- `documentation/testing/automation/rbac-test.sh` — **Done**
- `documentation/testing/validation/21CFR_PART11_VERIFICATION.md` — **Done**

## Tests

### Unit Tests (`packages/shared`)
| Suite | Tests | Status |
|-------|-------|--------|
| `schemas/assets.test.ts` | Checklist schema validation (20 tests) | Passing |
| `schemas/auth.test.ts` | Auth schema validation | Passing |
| `schemas/config.test.ts` | Config schema validation | Passing |
| `schemas/users.test.ts` | User schema validation | Passing |
| `types/audit-templates.test.ts` | Audit template categories, defaults, getDefaultTemplates (17 tests) | Passing |
| **Total** | **151 tests** | **All passing** |

### API Tests (`apps/api`)
| Suite | Tests | Status |
|-------|-------|--------|
| `e2e/checklist-templates.test.ts` | Checklist CRUD lifecycle (14 tests) | Passing |
| `e2e/entities.test.ts` | Entity instance + relationship + identifier E2E | Passing |
| `lib/hash-chain.test.ts` | Hash chain utilities | Passing |
| `lib/jwt.test.ts` | JWT utilities | Passing |
| `lib/password.test.ts` | Password hashing | Passing |
| **Total** | **116 tests** | **115 passing, 1 pre-existing failure** |

### Test Infrastructure
- Vitest with `globals: true`, `environment: 'node'`
- E2E tests use `buildApp()` + `app.inject()` (no HTTP server)
- `vitest.config.ts` in both `packages/shared` and `apps/api`

## API Refactoring Status

| Module | Old Pattern | New Pattern | Status |
|--------|-------------|-------------|--------|
| **Entity Management** (assets) | Monolithic `routes.ts` (2,088 lines) | Routes → Services → Repositories (16 files) | Done |
| **Auth** | Monolithic `routes.ts` | Routes → Services → Repositories | Done |
| **Config** | Monolithic `routes.ts` | Routes → Services → Repositories | Done |
| **Users** | Monolithic `routes.ts` | Monolithic routes | Pending |
| **Roles** | Monolithic `routes.ts` | Monolithic routes | Pending |
| **Backup** | Monolithic `routes.ts` | Monolithic routes | Pending |
| **Notifications** | Monolithic `routes.ts` | Monolithic routes | Pending |
| **Audit** | Monolithic `routes.ts` | Monolithic routes | Pending |

### Shared Infrastructure (Phase 0)
| Component | Status |
|-----------|--------|
| `types/context.ts` — RequestContext interface | Done |
| `lib/errors.ts` — AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError | Done |
| `lib/build-context.ts` — extract user info from request | Done |
| `lib/error-schemas.ts` — reusable Swagger error response schemas | Done |
| Global error handler in `app.ts` | Done |

## Recent Changes (Phase 2+)

### 1. Checklist Feature — Entity Templates
Add 14-type checklist schema to entity template definitions, enabling structured inspection/verification questions.

| File | Change |
|------|--------|
| `packages/shared/src/schemas/assets.ts` | Added `CHECKLIST_QUESTION_TYPES` constant (14 types), `checklistItemSchema` Zod schema, `checklistSchema` field to `createAssetTemplateSchema` and `updateAssetTemplateSchema` |
| `apps/api/src/modules/assets/routes/template.routes.ts` | Added `checklistSchema` to Swagger request body and all response schemas (POST, PUT, GET list, GET by ID) |
| `apps/api/src/modules/assets/services/template.service.ts` | Passes `checklistSchema` through CRUD operations and version snapshots |
| `apps/web/src/routes/assets/templates.tsx` | Checklist builder section in create/edit dialog; read-only checklist display in view dialog |

### 2. Audit Log Descriptions — Entity Management
Update audit trail text templates so entity/template actions produce clear human-readable log entries.

| File | Change |
|------|--------|
| `packages/shared/src/types/audit-templates.ts` | Updated `AUDIT_TEMPLATE_DEFAULTS` — 12 entity actions (ASSET_TEMPLATE_CREATED/UPDATED/DELETED, ASSET_TEMPLATE_VERSION_CREATED, ASSET_CREATED/UPDATED/STATUS_CHANGED/DELETED, ASSET_RELATIONSHIP_CREATED/DELETED, ASSET_IDENTIFIER_CREATED/DELETED) with descriptive templates and placeholder arrays |
| `apps/api/src/plugins/audit-logger.ts` | Aligned audit log calls with updated template placeholders |

### 3. Privileges & Reauth Configuration
Ensure entity/template operations appear correctly in role-privilege and action-reauth config pages.

| File | Change |
|------|--------|
| `packages/shared/src/types/feature-privileges.ts` | Added/updated entity privileges: `assets.view`, `assets.create`, `assets.edit`, `assets.delete`, `assets.templates`, `assets.relationships`, `assets.identifiers` |
| `packages/shared/src/types/reauth-actions.ts` | Fixed entity reauth actions: `CREATE/UPDATE/DELETE_ASSET_TEMPLATE`, `CREATE/UPDATE/DELETE_ASSET`, `CREATE/DELETE_ASSET_RELATIONSHIP`, `CREATE/DELETE_ASSET_IDENTIFIER` |
| `apps/web/src/routes/audit/index.tsx` | Aligned audit filter categories with updated action names |

### 4. Unit & E2E Tests
Add test coverage for checklist schemas, audit templates, and checklist CRUD lifecycle.

| File | Tests | Type |
|------|-------|------|
| `packages/shared/src/schemas/assets.test.ts` | 20 tests — checklist constants, valid/invalid items, all 14 types, edge cases | Unit |
| `packages/shared/src/types/audit-templates.test.ts` | 17 tests — categories, required fields, placeholder-template consistency, action groups | Unit |
| `apps/api/src/e2e/checklist-templates.test.ts` | 14 tests — create/read/update/delete with checklistSchema, version snapshots, validation, all 14 types | E2E |

### 5. Bug Fix — GET /templates/:id Response Schema
Fix Fastify stripping `checklistSchema` from GET-by-ID responses due to missing Swagger response declaration.

| File | Change |
|------|--------|
| `apps/api/src/modules/assets/routes/template.routes.ts` | Added `checklistSchema: { type: 'array' }` to GET `/templates/:id` 200 response schema (was already present in GET list but missing from GET by ID) |

## What's NOT Done (Future Phases)
- API refactoring: Users, Roles, Backup, Notifications, Audit modules (pending Routes → Services → Repositories)
- Frontend refactoring: Extract sub-components/hooks from large page files
- Electronic signatures (e-sign with re-authentication)
- Logbook entries / digital forms
- Data point ingestion (MQTT/OPC-UA)
- Reports and exports
- HTTPS/TLS certificates
- CI/CD pipeline

## Summary
**Phase 1 is code-complete and deployed.** All User Management, Entity Management, and Configuration features are built end-to-end with 82 API endpoints. The app is running on EC2 at `43.205.32.23` via PM2 + nginx. Entity Management module (assets), Auth, and Config have been refactored to Routes → Services → Repositories. Test coverage includes 267 tests (151 shared + 116 API). Checklist feature supports 14 question types on entity templates.
