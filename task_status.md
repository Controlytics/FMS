# DigiLog Phase 1 — Development Status

## Infrastructure

| Component | Status | Details |
|-----------|--------|---------|
| Turborepo Monorepo | Done | `apps/api`, `apps/web`, `packages/shared` |
| Docker Compose | Done | PostgreSQL 16 with ltree + pgcrypto |
| Prisma Schema | Done | 13 models, migrations applied |
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
| Module | Endpoints | Status |
|--------|-----------|--------|
| **Auth** | POST login, POST logout, GET me, POST change-password, POST verify, POST forgot-password | Done |
| **Users** | CRUD + enable/disable/unlock/reset-password + reset-requests | Done |
| **Roles** | CRUD + active list + creatable roles | Done |
| **Config** | password-policy, login-security, session, datetime, user-id, branding, roles, users, field-ids, action-reauth, audit-templates, pagination | Done |
| **Hierarchy** | GET tree, GET children, POST node, GET/PUT/DELETE node, GET ancestors, POST identifiers | Done |
| **Templates** | CRUD + versioning | Done |
| **Audit** | GET list (filtered/paginated), GET detail | Done |
| **Notifications** | List, unread-count, mark read/unread | Done |
| **Uploads** | Photo upload | Done |
| **Backup** | Export + Restore | Done |

### Key Backend Features
- Temporary password flow with forced change on first login
- Account lockout (temporary/permanent) after failed attempts
- Password history enforcement (configurable reuse prevention)
- Session-based auth with immediate invalidation on disable/logout
- SHA-256 audit trail checksums (tamper-evident)
- Template-driven asset creation with JSONB attribute merging (no isActive filter on templates)
- ltree-based unlimited-depth hierarchy
- Dynamic role management (create/edit/delete custom roles)
- Action re-authentication with in-memory cache
- Configurable audit text templates
- Configurable pagination options
- Re-auth enforcement helper (`apps/api/src/lib/reauth-check.ts`)
- ~~Template linking rules~~ *(Feature removed — any asset can link to any other with any relationship type)*

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
| `/assets` | Hierarchy browser with breadcrumbs | Done |
| `/assets/templates` | Template library grid | Done |
| `/assets/templates/create` | Create template (dynamic fields) | Done |
| `/assets/templates/:id` | Template detail + versions | Done |
| `/assets/node/create` | Create node from template | Done |
| `/notifications` | Notifications list | Done |
| `/audit` | Audit trail table with filters + detail dialog | Done |

### Key Frontend Features
- Copy/paste/cut/drag disabled on password fields (21 CFR Part 11)
- Idle session timeout with warning countdown
- Role-based navigation (different menus per role)
- SWR for data fetching with auto-revalidation
- Dynamic role support (custom roles in all dropdowns and config pages)
- Global SWR cache invalidation for role changes

## Shared Package (`packages/shared`)
- Zod schemas for all API payloads (auth, users, hierarchy, templates, config, audit, action-reauth) — **Done**
- TypeScript types (roles, permissions, audit actions, reauth actions, audit templates) — **Done**

## Documentation
- `CLAUDE.md` in root, api, web, shared — **Done**
- `DECISIONS.md` in api and web — **Done**
- `CHANGELOG.md` — **Done**
- `API_GUIDE.md` — **Done**
- `TEST_CASES.md` — **Done**
- `TEST_SUMMARY.md` — **Done**
- `21CFR_PART11_VERIFICATION.md` — **Done**

## What's NOT Done (Future Phases)
- Unit/integration tests
- Electronic signatures (e-sign with re-authentication)
- Logbook entries / digital forms
- Data point ingestion (MQTT/OPC-UA)
- Reports and exports
- HTTPS/TLS certificates
- CI/CD pipeline
- Per-page pagination selector integration (config page done, page integration pending)

## Summary
**Phase 1 is code-complete and deployed.** All User Management, Asset Management, and Configuration features are built end-to-end. The app is running on EC2 at `43.205.32.23` via PM2 + nginx. Dynamic role management supports custom roles across all UI and API flows.
