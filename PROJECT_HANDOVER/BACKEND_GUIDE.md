# Backend Guide

## Folder Structure

```
apps/api/src/
+-- app.ts                    # Main entry - server config, plugin registration, route mounting
+-- lib/                      # Shared utilities
|   +-- prisma.ts            # Prisma client singleton
|   +-- jwt.ts               # JWT sign/verify helpers
|   +-- password.ts          # BCrypt hash/verify
|   +-- audit.ts             # Audit trail logging helper
|   +-- sanitize.ts          # XSS prevention (input sanitization, strips HTML from all text)
|   +-- errors.ts            # Custom error classes (AppError, NotFoundError, etc.)
|   +-- error-schemas.ts     # Fastify JSON schema for error responses
|   +-- build-context.ts     # Extract RequestContext from Fastify request
|   +-- reauth-check.ts      # Re-authentication enforcement
|   +-- config-registry.ts   # Dynamic config module registry
|   +-- config-discovery.ts  # Auto-discover config definitions (23 modules)
|   +-- user-id-validator.ts # Username format validation
+-- plugins/                  # Fastify plugins (run on every request)
|   +-- auth.ts              # JWT validation, session check, org-active check
|   +-- rbac.ts              # Permission enforcement (requirePermission decorator)
|   +-- audit-logger.ts      # Auto-log mutations to audit trail
+-- modules/                  # Feature modules (34 total)
|   +-- auth/                # Login, logout, refresh, password change
|   |   +-- routes.ts        # Auth endpoints
|   |   +-- auth.service.ts  # Business logic (login flow, LDAP, lockout)
|   |   +-- auth.repository.ts # Database queries
|   +-- users/               # User CRUD
|   |   +-- routes.ts
|   |   +-- user.service.ts
|   |   +-- user.repository.ts
|   +-- roles/               # Role management
|   |   +-- routes.ts
|   |   +-- role.service.ts
|   |   +-- role.repository.ts
|   +-- config/              # Configuration system
|   |   +-- routes.ts        # Static config endpoints
|   |   +-- dynamic-routes.ts # Auto-generated config endpoints
|   |   +-- config.service.ts
|   |   +-- config.repository.ts
|   |   +-- defs/            # 23 config definition files
|   +-- rule-chain/          # Rule engine
|   |   +-- routes.ts        # CRUD endpoints
|   |   +-- rule-chain.service.ts
|   |   +-- debug-recorder.ts
|   |   +-- nodes/
|   |       +-- index.ts     # 77 node type registrations
|   |       +-- action-nodes.ts # Action node implementations
|   +-- data-ingestion/      # IoT data pipeline (10-stage)
|   |   +-- routes.ts
|   |   +-- ingestion.service.ts
|   |   +-- ingestion.repository.ts
|   +-- ldap/                # LDAP/AD integration
|   |   +-- routes.ts
|   |   +-- ldap.service.ts
|   +-- cleaning-profiles/   # Phase 2: Pipeline profile CRUD with visual editor
|   |   +-- routes.ts
|   +-- filter-profiles/     # Phase 2: Filter-to-profile assignment
|   |   +-- routes.ts
|   |   +-- filter-profile.service.ts
|   +-- filter-operations/   # Phase 2: Core cleaning operations
|   |   +-- routes.ts        # Cycle start/advance/bypass/checklist
|   |   +-- events-routes.ts # Filter events and cycle history
|   |   +-- filter-operations.service.ts
|   +-- pm-schedules/        # Phase 2: Preventive maintenance
|   |   +-- routes.ts
|   |   +-- pm-schedule.service.ts
|   +-- checklist-profiles/  # Phase 2: Checklist template management
|   |   +-- routes.ts
|   +-- notification-delivery/ # Multi-channel dispatch
|   |   +-- notification-dispatcher.ts
|   +-- notification-rules/  # Event-based notification triggers
|   +-- notifications/       # In-app notifications
|   +-- assets/              # Templates, instances, relationships
|   |   +-- repositories/instance.repository.ts
|   |   +-- routes/instance.routes.ts
|   |   +-- services/instance.service.ts
|   +-- audit/               # Audit trail
|   +-- super-admin/         # Platform admin operations
|   +-- tenant-admin/        # Organization detail routes
|   +-- org-admin/           # Org-level management
|   +-- admin-requests/      # Password reset approvals
|   +-- queries/             # Data queries and export
|   +-- connectivity/        # Device online/offline tracking
|   +-- system-health/       # API metrics
|   +-- uploads/             # File upload management
|   +-- qr-code/            # QR code generation
|   +-- help/               # Help documentation
|   +-- dashboards/         # Dashboard widgets
|   +-- backup/             # Database backup
|   +-- entity-assignments/ # Fine-grained entity access
|   +-- equipment-groups/   # Phase 2: AHU equipment grouping
|   +-- user-groups/        # Notification groups
|   +-- uns/                # ISA-95 UNS path mapping
|   +-- deployment-check/   # Deployment verification
+-- workers/                  # Background job processors
|   +-- ingestion.worker.ts  # BullMQ consumer for data pipeline
|   +-- maintenance.worker.ts # Scheduled cleanup tasks
+-- transport/                # Protocol handlers
|   +-- mqtt-client.ts       # MQTT client (subscribe, publish)
|   +-- mqtt-auth-routes.ts  # EMQX auth callback
|   +-- ws-handler.ts        # WebSocket real-time push
+-- types/
    +-- context.ts           # RequestContext interface
```

## Authentication & Authorization

### Auth Flow
1. `POST /api/auth/login` -> `auth.service.login()`
2. Check user exists -> if LDAP enabled and user not found, try LDAP auto-provision
3. Check user status (ENABLED/DISABLED/LOCKED/EXPIRED)
4. Check organization active status
5. Verify password (local BCrypt or LDAP bind based on `authSource`)
6. Track failed attempts -> lockout after max attempts
7. Check password expiry -> force change if expired
8. Handle session conflicts (single-session enforcement)
9. Create JWT token + Session record
10. Return token to client

### Authorization
- **Plugin:** `plugins/rbac.ts`
- **Usage:** `app.requirePermission('USER_CREATE')` as route preHandler
- **SUPER_ADMIN** bypasses all permission checks
- **Other roles** checked against `roles.permissions` JSONB array in DB
- **Fallback:** `_MANAGE` permission grants child permissions (e.g., `USER_MANAGE` -> `USER_CREATE`)

### Re-authentication
Sensitive actions require password re-entry:
- `lib/reauth-check.ts` enforces based on `action-reauth` config
- Password sent via `x-reauth-password` header or `_currentPassword` body field
- 5-minute verification token issued after successful re-auth

## Important Business Logic

### Data Ingestion Pipeline (10 stages)
Located in `ingestion.service.ts`:
1. **Parse** - Decode payload (JSON, binary, etc.)
2. **Validate** - Check against template schema
3. **Normalize** - Convert units, timestamps to UTC
4. **Enrich** - Add metadata (template info, UNS path)
5. **Rule Chain** - Execute assigned rule chains
6. **Store** - Batch insert to TimescaleDB
7. **Cache** - Update LatestTelemetry
8. **Alert** - Evaluate alarm rules, create alarms
9. **Notify** - Dispatch notifications via configured channels
10. **Push** - WebSocket push to connected UI clients

### Rule Chain Execution
- Nodes registered via `registerNode(type, category, handler)`
- Each node returns `{ outputs: Record<string, any[]> }` mapping output labels to messages
- Execution is recursive: output messages are passed to connected nodes
- Debug mode records execution trace per node
- Script nodes run in sandboxed VM with 1-second timeout
- 77 node types across 8 categories (INPUT, FILTER, ENRICHMENT, TRANSFORMATION, ACTION, EXTERNAL INTEGRATION, FLOW, ANALYTICS)

### Filter Cleaning Operations (Phase 2)
Located in `filter-operations.service.ts`:
- **Start Cycle**: Creates CleaningCycle record, loads pipeline from FilterCleaningProfile
- **Advance**: Moves to next stage; blocked if pending checklist not submitted
- **Submit Checklist**: Records answers for CHECKLIST gate nodes
- **Bypass**: Skips a stage with deviation recording (requires authorization)
- **Current State**: Returns filter's position in pipeline + available actions
- Cycle auto-completes when pipeline reaches END node
- All operations create FilterEvent records for traceability

### PM Schedule Management (Phase 2)
Located in `pm-schedule.service.ts`:
- Creates recurring maintenance schedules with entries
- Tracks PmExecution status (PENDING, IN_PROGRESS, COMPLETED, MISSED)
- Links to equipment groups and filter profiles

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
