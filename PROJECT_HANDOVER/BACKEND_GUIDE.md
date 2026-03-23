# Backend Guide

## Folder Structure

```
apps/api/src/
├── app.ts                    # Main entry - server config, plugin registration, route mounting
├── lib/                      # Shared utilities
│   ├── prisma.ts            # Prisma client singleton
│   ├── jwt.ts               # JWT sign/verify helpers
│   ├── password.ts          # BCrypt hash/verify
│   ├── audit.ts             # Audit trail logging helper
│   ├── sanitize.ts          # XSS prevention (input sanitization)
│   ├── errors.ts            # Custom error classes (AppError, NotFoundError, etc.)
│   ├── error-schemas.ts     # Fastify JSON schema for error responses
│   ├── build-context.ts     # Extract RequestContext from Fastify request
│   ├── reauth-check.ts      # Re-authentication enforcement
│   ├── tenant-utils.ts      # Shared getTenantId helper
│   ├── config-registry.ts   # Dynamic config module registry
│   ├── config-discovery.ts  # Auto-discover config definitions
│   └── user-id-validator.ts # Username format validation
├── plugins/                  # Fastify plugins (run on every request)
│   ├── auth.ts              # JWT validation, session check, org-active check
│   ├── rbac.ts              # Permission enforcement (requirePermission decorator)
│   └── audit-logger.ts      # Auto-log mutations to audit trail
├── modules/                  # Feature modules (27 total)
│   ├── auth/                # Login, logout, refresh, password change
│   │   ├── routes.ts        # Auth endpoints
│   │   ├── auth.service.ts  # Business logic (login flow, LDAP, lockout)
│   │   └── auth.repository.ts # Database queries
│   ├── users/               # User CRUD
│   │   ├── routes.ts
│   │   ├── user.service.ts
│   │   └── user.repository.ts
│   ├── config/              # Configuration system
│   │   ├── routes.ts        # Static config endpoints
│   │   ├── dynamic-routes.ts # Auto-generated config endpoints
│   │   ├── config.service.ts
│   │   ├── config.repository.ts
│   │   └── defs/            # 22 config definition files
│   ├── rule-chain/          # Rule engine
│   │   ├── routes.ts        # CRUD endpoints
│   │   ├── rule-chain.service.ts
│   │   ├── debug-recorder.ts
│   │   └── nodes/
│   │       └── index.ts     # 77 node type registrations
│   ├── data-ingestion/      # IoT data pipeline
│   │   ├── routes.ts
│   │   ├── ingestion.service.ts  # 8-stage pipeline
│   │   └── ingestion.repository.ts
│   ├── ldap/                # LDAP/AD integration
│   │   ├── routes.ts
│   │   └── ldap.service.ts
│   └── [other modules...]
├── workers/                  # Background job processors
│   ├── ingestion.worker.ts  # BullMQ consumer for data pipeline
│   └── maintenance.worker.ts # Scheduled cleanup tasks
├── transport/                # Protocol handlers
│   ├── mqtt-client.ts       # MQTT client (subscribe, publish)
│   ├── mqtt-auth-routes.ts  # EMQX auth callback
│   └── ws-handler.ts        # WebSocket real-time push
└── types/
    └── context.ts           # RequestContext interface
```

## Authentication & Authorization

### Auth Flow
1. `POST /api/auth/login` → `auth.service.login()`
2. Check user exists → if LDAP enabled and user not found, try LDAP auto-provision
3. Check user status (ENABLED/DISABLED/LOCKED/EXPIRED)
4. Check organization active status
5. Verify password (local BCrypt or LDAP bind based on `authSource`)
6. Track failed attempts → lockout after max attempts
7. Check password expiry → force change if expired
8. Handle session conflicts (single-session enforcement)
9. Create JWT token + Session record
10. Return token to client

### Authorization
- **Plugin:** `plugins/rbac.ts`
- **Usage:** `app.requirePermission('USER_CREATE')` as route preHandler
- **SUPER_ADMIN** bypasses all permission checks
- **Other roles** checked against `roles.permissions` JSONB array in DB
- **Fallback:** `_MANAGE` permission grants child permissions (e.g., `USER_MANAGE` → `USER_CREATE`)

### Re-authentication
Sensitive actions require password re-entry:
- `lib/reauth-check.ts` enforces based on `action-reauth` config
- Password sent via `x-reauth-password` header or `_currentPassword` body field
- 5-minute verification token issued after successful re-auth

## Important Business Logic

### Data Ingestion Pipeline (8 stages)
Located in `ingestion.service.ts`:
1. **Parse** - Decode payload (JSON, binary, etc.)
2. **Validate** - Check against template schema
3. **Normalize** - Convert units, timestamps to UTC
4. **Enrich** - Add metadata (template info, UNS path)
5. **Rule Chain** - Execute assigned rule chains
6. **Store** - Batch insert to TimescaleDB
7. **Cache** - Update LatestTelemetry
8. **Alert** - Evaluate alarm rules, create alarms, dispatch notifications

### Rule Chain Execution
- Nodes registered via `registerNode(type, category, handler)`
- Each node returns `{ outputs: Record<string, any[]> }` mapping output labels to messages
- Execution is recursive: output messages are passed to connected nodes
- Debug mode records execution trace per node
- Script nodes run in sandboxed VM with 1-second timeout
