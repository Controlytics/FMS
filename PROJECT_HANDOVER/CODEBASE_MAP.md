# Codebase Map

## Root Structure
```
21cfrlogbook/
+-- apps/api/                   # Backend API (Fastify + TypeScript)
+-- apps/web/                   # Frontend SPA (React + Vite)
+-- apps/android/               # Android/Capacitor build (PWA/APK)
+-- packages/shared/            # Shared types, schemas, constants
+-- packages/db/                # Database connections (Prisma + TimescaleDB)
+-- packages/queue/             # BullMQ job queue wrapper
+-- docs/                       # User-facing documentation
+-- PROJECT_HANDOVER/           # This documentation package
+-- package.json                # Workspace root
+-- turbo.json                  # Turborepo build configuration
+-- ecosystem.config.cjs        # PM2 process manager config
+-- start-digilog.bat           # Windows local dev startup script
+-- stop-digilog.bat            # Windows local dev shutdown script
+-- .env                        # Environment variables
```

## Backend Key Files

| File | Purpose |
|------|---------|
| `apps/api/src/app.ts` | Main entry: server config, plugins, route registration, shutdown handling |
| `apps/api/prisma/schema.prisma` | Complete database schema (57 models, 17 enums) |
| `apps/api/prisma/seed.ts` | Initial data seeding (roles, super admin, default org) |
| `apps/api/src/plugins/auth.ts` | JWT validation, session check on every request |
| `apps/api/src/plugins/rbac.ts` | Permission enforcement decorators |
| `apps/api/src/lib/jwt.ts` | JWT sign/verify functions |
| `apps/api/src/lib/audit.ts` | Audit trail logging helper |
| `apps/api/src/lib/password.ts` | BCrypt hash/verify |
| `apps/api/src/lib/sanitize.ts` | XSS prevention (strips HTML from all text fields) |
| `apps/api/src/lib/config-registry.ts` | Dynamic config module registry |
| `apps/api/src/lib/config-discovery.ts` | Auto-discover 23 config definitions |
| `apps/api/src/modules/auth/auth.service.ts` | Login flow, password change, LDAP integration |
| `apps/api/src/modules/auth/routes.ts` | Auth endpoints (login, logout, refresh, etc.) |
| `apps/api/src/modules/users/user.service.ts` | User CRUD business logic |
| `apps/api/src/modules/users/routes.ts` | User management endpoints |
| `apps/api/src/modules/roles/role.service.ts` | Role management, permission handling |
| `apps/api/src/modules/roles/role.repository.ts` | Role database queries |
| `apps/api/src/modules/rule-chain/nodes/index.ts` | 77 rule chain node registrations |
| `apps/api/src/modules/rule-chain/nodes/action-nodes.ts` | Action node implementations |
| `apps/api/src/modules/data-ingestion/ingestion.service.ts` | 10-stage telemetry pipeline |
| `apps/api/src/modules/ldap/ldap.service.ts` | LDAP bind, search, provision, sync |
| `apps/api/src/modules/filter-operations/filter-operations.service.ts` | Cleaning cycle state machine |
| `apps/api/src/modules/filter-operations/routes.ts` | Filter operation endpoints |
| `apps/api/src/modules/filter-operations/events-routes.ts` | Filter events and cycle history |
| `apps/api/src/modules/filter-profiles/filter-profile.service.ts` | Filter-to-profile assignment logic |
| `apps/api/src/modules/pm-schedules/pm-schedule.service.ts` | PM scheduling business logic |
| `apps/api/src/modules/notification-delivery/notification-dispatcher.ts` | Multi-channel dispatch |
| `apps/api/src/modules/assets/services/instance.service.ts` | Asset instance business logic |
| `apps/api/src/modules/assets/repositories/instance.repository.ts` | Asset instance DB queries |
| `apps/api/src/workers/ingestion.worker.ts` | BullMQ consumer for async data processing |
| `apps/api/src/transport/mqtt-client.ts` | MQTT client (subscribe, publish, reconnect) |
| `apps/api/src/transport/ws-handler.ts` | WebSocket real-time push handler |

## Frontend Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/main.tsx` | App entry, all route definitions, lazy loading |
| `apps/web/src/lib/api-client.ts` | HTTP client with auth headers, error handling |
| `apps/web/src/hooks/use-auth.ts` | Auth state, login/logout, token refresh |
| `apps/web/src/components/layout/sidebar.tsx` | Navigation sidebar with role-based filtering |
| `apps/web/src/components/layout/app-layout.tsx` | Main layout wrapper |
| `apps/web/src/routes/auth/login.tsx` | Login page with session conflict handling |
| `apps/web/src/routes/users/list.tsx` | User list with filters, bulk actions |
| `apps/web/src/routes/users/create.tsx` | Create user form |
| `apps/web/src/routes/organizations/index.tsx` | Organization management with CRUD |
| `apps/web/src/routes/organizations/detail.tsx` | Org detail tabs (users, entities, templates) |
| `apps/web/src/routes/rule-chains/editor.tsx` | Visual ReactFlow rule chain editor |
| `apps/web/src/routes/config/ldap.tsx` | LDAP configuration page |
| `apps/web/src/routes/config/index.tsx` | Configuration category cards |
| `apps/web/src/routes/filter-management/` | Phase 2 filter management pages |
| `apps/web/src/routes/cleaning-cycles/` | Cycle history and timeline views |
| `apps/web/src/routes/pm-schedules/` | PM schedule management |
| `apps/web/src/routes/checklists/` | Checklist profile management |

## Frontend Route Areas

| Route Area | Pages |
|------------|-------|
| admin-requests | Password reset approvals |
| alarms | Alarm list, acknowledge, clear |
| assets | Entity tree, templates, dialogs, tabs, hooks |
| audit | Audit trail viewer with export |
| auth | Login, forgot-password, change-password |
| checklist | Checklist execution |
| checklists | Checklist profile management |
| cleaning-cycles | History, timeline views |
| config | Branding, notification-rules, notification-settings, roles, LDAP, 20+ config pages |
| debug | Pipeline execution debugging |
| filter-management | Operations, profiles, status, scan, traceability, AHU dashboard, cleaning-profile-editor, retirement, replacement, bulk-upload, equipment groups |
| mobile | Mobile-optimized views |
| notifications | Notification list |
| pm-schedules | PM schedule management |
| profile | User profile |
| rule-chains | List and visual editor |
| system-health | API metrics |
| tenant | Organization management |
| users | User CRUD |

## Config Definitions (23 files)
Located at `apps/api/src/modules/config/defs/`:
```
action-reauth.def.ts    login-security.def.ts   retention.def.ts
alarm-columns.def.ts    notification-email.def.ts  role-privileges.def.ts
audit-templates.def.ts  notification-logs.def.ts   roles.def.ts
backup.def.ts           notification-rules.def.ts  session.def.ts
branding.def.ts         notification-sms.def.ts    sidebar-config.def.ts
datetime.def.ts         pagination.def.ts          uns.def.ts
field-ids.def.ts        password-policy.def.ts     user-id.def.ts
                        [+ additional Phase 2 defs]
```

## Shared Package
Located at `packages/shared/`:
- Shared TypeScript types and interfaces
- Schema validation constants
- Permission constants
- Must be rebuilt (`npx nx build shared`) when types change
