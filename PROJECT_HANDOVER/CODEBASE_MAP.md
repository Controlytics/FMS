# Codebase Map

## Root Structure
```
21cfrlogbook/
├── apps/api/                   # Backend API (Fastify + TypeScript)
├── apps/web/                   # Frontend SPA (React + Vite)
├── packages/shared/            # Shared types, schemas, constants
├── packages/db/                # Database connections (Prisma + TimescaleDB)
├── packages/queue/             # BullMQ job queue wrapper
├── docs/                       # User-facing documentation
├── agents/                     # Claude Code automation skills
├── PROJECT_HANDOVER/           # This documentation package
├── package.json                # Workspace root
├── turbo.json                  # Turborepo build configuration
├── ecosystem.config.cjs        # PM2 process manager config
└── .env                        # Environment variables
```

## Backend Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `apps/api/src/app.ts` | ~300 | Main entry: server config, plugins, route registration, shutdown handling |
| `apps/api/prisma/schema.prisma` | ~1100 | Complete database schema (48 tables) |
| `apps/api/src/plugins/auth.ts` | ~150 | JWT validation, session check on every request |
| `apps/api/src/plugins/rbac.ts` | ~110 | Permission enforcement decorators |
| `apps/api/src/lib/tenant-utils.ts` | ~15 | Shared getTenantId helper |
| `apps/api/src/lib/jwt.ts` | ~50 | JWT sign/verify functions |
| `apps/api/src/lib/audit.ts` | ~40 | Audit trail logging helper |
| `apps/api/src/lib/password.ts` | ~30 | BCrypt hash/verify |
| `apps/api/src/lib/config-registry.ts` | ~180 | Dynamic config module registry |
| `apps/api/src/modules/auth/auth.service.ts` | ~400 | Login flow, password change, LDAP integration |
| `apps/api/src/modules/auth/routes.ts` | ~300 | Auth endpoints (login, logout, refresh, etc.) |
| `apps/api/src/modules/users/user.service.ts` | ~350 | User CRUD business logic |
| `apps/api/src/modules/users/routes.ts` | ~400 | User management endpoints |
| `apps/api/src/modules/rule-chain/nodes/index.ts` | ~2200 | **LARGEST FILE** - 77 rule chain node registrations |
| `apps/api/src/modules/data-ingestion/ingestion.service.ts` | ~900 | 8-stage telemetry pipeline |
| `apps/api/src/modules/ldap/ldap.service.ts` | ~200 | LDAP bind, search, provision, sync |
| `apps/api/src/modules/tenant-admin/routes.ts` | ~280 | Organization CRUD, tenant info |
| `apps/api/src/workers/ingestion.worker.ts` | ~80 | BullMQ consumer for async data processing |
| `apps/api/src/transport/mqtt-client.ts` | ~120 | MQTT client (subscribe, publish, reconnect) |
| `apps/api/src/transport/ws-handler.ts` | ~70 | WebSocket real-time push handler |

## Frontend Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `apps/web/src/main.tsx` | ~130 | App entry, all route definitions, lazy loading |
| `apps/web/src/lib/api-client.ts` | ~80 | HTTP client with auth headers, error handling |
| `apps/web/src/hooks/use-auth.ts` | ~120 | Auth state, login/logout, token refresh |
| `apps/web/src/components/layout/sidebar.tsx` | ~170 | Navigation sidebar with role-based filtering |
| `apps/web/src/components/layout/app-layout.tsx` | ~60 | Main layout wrapper |
| `apps/web/src/routes/auth/login.tsx` | ~400 | Login page with session conflict handling |
| `apps/web/src/routes/users/list.tsx` | ~350 | User list with filters, bulk actions |
| `apps/web/src/routes/users/create.tsx` | ~350 | Create user form |
| `apps/web/src/routes/tenant/organizations.tsx` | ~280 | Organization management with CRUD |
| `apps/web/src/routes/tenant/org-detail.tsx` | ~500 | Org detail tabs (users, entities, templates) |
| `apps/web/src/routes/rule-chains/editor.tsx` | ~2100 | **LARGEST FE FILE** - Visual rule chain editor |
| `apps/web/src/routes/config/ldap.tsx` | ~300 | LDAP configuration page |
| `apps/web/src/routes/config/index.tsx` | ~200 | Configuration category cards |

## Config Definitions (22 files)
Located at `apps/api/src/modules/config/defs/`:
```
action-reauth.def.ts    login-security.def.ts   retention.def.ts
alarm-columns.def.ts    notification-email.def.ts  role-privileges.def.ts
audit-templates.def.ts  notification-logs.def.ts   roles.def.ts
backup.def.ts           notification-rules.def.ts  session.def.ts
branding.def.ts         notification-sms.def.ts    sidebar-config.def.ts
datetime.def.ts         pagination.def.ts          uns.def.ts
field-ids.def.ts        password-policy.def.ts     user-id.def.ts
```
