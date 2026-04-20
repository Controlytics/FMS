# DigiLog Backend Documentation

## System Architecture Overview

The backend follows a layered architecture with API Gateway/Routes, Plugin Layer, Service Layer, and Data Access Layer. PostgreSQL 18 with Prisma ORM is used as the primary database, TimescaleDB for time-series data, BullMQ + Redis for async job processing, and EMQX for MQTT broker.

**Architecture Layers:**

1. **API Gateway / Routes** — 34 route modules registered via `apps/api/src/modules/*/routes.ts`
2. **Plugin Layer** — Auth Check, RBAC (Permission-based), Audit Logger, Session Validator
3. **Service Layer** — Auth, User, Config, Asset, Audit, Backup, Filter Operations, Cleaning Profiles, etc.
4. **Data Access Layer** — PostgreSQL 18 (Prisma ORM, 57 models, 17 enums) + TimescaleDB (7 hypertables)
5. **Queue Layer** — BullMQ workers (ingestion, maintenance) via Redis
6. **Transport Layer** — MQTT client (EMQX), WebSocket handler

---

## 1. Database Schema

### 1.1 Prisma Models (57 total, 17 enums)

**Core Models:**
- Role, User, PasswordHistory, Session, PasswordResetRequest

**Configuration:**
- SystemConfig, FieldIdConfig, UserConfig, RoleConfig

**Audit & Compliance:**
- AuditTrail (SHA-256 checksums), ElectronicSignature

**Notifications:**
- Notification, NotificationRule, NotificationLog, EmailTemplate, SmsTemplate

**Entity Management:**
- AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier

**Data Ingestion & Rule Engine:**
- DeviceCredential, RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection
- Alarm, LatestTelemetry, UnsMapping, ConnectivityStatus, DataStream, IngestionSystemConfig
- DeadLetterQueue

**Help System:**
- HelpArticle, HelpArticleVersion

**QR Codes:**
- QrCode

**Phase 2 — Digital Filter Management:**
- CleaningProfile, CleaningProfileVersion, PipelineNode, PipelineConnection
- FilterProfile, FilterInstance, FilterEvent, CleaningCycle, CycleStageExecution
- ChecklistProfile, ChecklistQuestion, ChecklistResponse
- PmSchedule, PmScheduleEntry, PmExecution
- EquipmentGroup, EntityAssignment

**Key Enums:**
- UserStatus, AlarmSeverity, AlarmStatus, NotificationEventType, RelationshipType
- FilterStatus, CycleStatus, StageType, NodeType, PmStatus
- And 8 more enums

---

## 2. API Modules (34 total)

### Core Modules
| Module | Prefix | Purpose |
|--------|--------|---------|
| auth | `/api/auth` | Login, logout, session, password change, forgot-password, token refresh |
| users | `/api/users` | User CRUD, enable/disable, lock/unlock, password reset |
| roles | `/api/roles` | Role CRUD with dynamic permissions management |
| config | `/api/config` | 23 config definitions with auto-discovery registry |
| audit | `/api/audit` | Tamper-evident audit trail with SHA-256 hash chain |
| notifications | `/api/notifications` | In-app notifications with WebSocket real-time push |
| notification-rules | `/api/notification-rules` | Event-based notification rule management |
| notification-delivery | — | Email (OAuth2/SMTP), SMS (AWS SNS), Telegram, Slack dispatch |

### Entity Management
| Module | Prefix | Purpose |
|--------|--------|---------|
| assets (templates) | `/api/assets/templates` | Entity template blueprints with versioning |
| assets (instances) | `/api/assets/instances` | Entity instances, tree, hierarchy |
| assets (relationships) | `/api/assets/relationships` | Bidirectional relationships with auto-inverse |
| assets (identifiers) | `/api/assets/identifiers` | QR/Barcode/RFID/NFC identifiers |

### Data Ingestion & IoT
| Module | Prefix | Purpose |
|--------|--------|---------|
| data-ingestion | `/api/data` | 10-stage pipeline: MQTT/HTTP/WS ingestion |
| rule-chain | `/api/rule-chains` | 77 node types across 8 categories, visual editor |
| uns | `/api/uns` | ISA-95 Unified Namespace mappings |
| connectivity | `/api/connectivity` | Entity online/offline tracking |
| queries | `/api/telemetry`, `/api/alarms`, `/api/retention`, `/api/export` | Time-series queries, export |

### Phase 2 — Digital Filter Management
| Module | Prefix | Purpose |
|--------|--------|---------|
| filter-operations | `/api/filters` | Cycle lifecycle: start, advance, bypass, checklist, events |
| cleaning-profiles | `/api/filter-cleaning-profiles` | Pipeline profile CRUD with graph validation and versioning |
| filter-profiles | `/api/filter-profiles` | Filter-to-cleaning-profile assignment |
| checklist-profiles | `/api/checklist-profiles` | Checklist template and question management |
| pm-schedules | `/api/pm-schedules` | Preventive maintenance scheduling with tolerance windows |
| equipment-groups | `/api/equipment-groups` | Equipment group management for AHU dashboard |
| entity-assignments | `/api/entity-assignments` | Entity-to-group assignments |

### Admin & Infrastructure
| Module | Prefix | Purpose |
|--------|--------|---------|
| admin-requests | `/api/admin-requests` | Admin approval requests |
| backup | `/api/backup` | Backup create/restore (JSON/BAK/SQL/CSV) |
| deployment-check | `/api/deployment-check` | Deployment health verification |
| help | `/api/help` | Help articles with version history |
| ldap | `/api/ldap` | LDAP authentication integration |
| org-admin | `/api/org-admin` | Organization administration |
| qr-code | `/api/qr` | QR code generation |
| super-admin | `/api/super-admin` | Super admin operations |
| system-health | `/api/system-health` | System health monitoring |
| tenant-admin | `/api/tenant-admin` | Tenant administration |
| uploads | `/api/uploads` | File upload and serving |
| user-groups | `/api/user-groups` | User group management |
| dashboards | `/api/dashboards` | Dashboard data endpoints |

---

## 3. Key API Endpoints

### Authentication
| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/auth/login | POST | User login (supports `force: true` to terminate existing sessions) |
| /api/auth/logout | POST | User logout |
| /api/auth/refresh | POST | Refresh JWT token |
| /api/auth/change-password | POST | Change password (enforces policy) |
| /api/auth/forgot-password | POST | Request password reset |
| /api/auth/verify | POST | Re-authenticate for sensitive operations |

### Phase 2 Filter Operations
| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/filters/:id/start-cycle | POST | Start cleaning cycle with reason |
| /api/filters/:id/advance | POST | Advance to next stage |
| /api/filters/:id/submit-checklist | POST | Submit checklist answers |
| /api/filters/:id/bypass | POST | Bypass stage (deviation with reason) |
| /api/filters/:id/current-state | GET | Get filter state + next actions |
| /api/filter/cycles | GET | List cleaning cycles |
| /api/filter/events | GET | List filter events |

---

## 4. Middleware & Plugins

### Authentication Plugin
- Validates JWT token and session for all protected routes
- Checks session validity in database
- Verifies user account status (ENABLED)
- Updates session last activity timestamp

### RBAC Plugin
- Permission-based: `requirePermission('ASSET_CREATE')` on every protected route
- `_MANAGE` hierarchy resolution: `ASSET_MANAGE` implies `ASSET_CREATE/UPDATE/DELETE/VIEW/READ/EXPORT`
- SUPER_ADMIN bypass: Skips all permission checks
- Dynamic roles from database (no hardcoded enum)

### Audit Logger Plugin
- Automatically logs actions to audit trail
- Generates SHA-256 checksum for integrity
- Skips SUPER_ADMIN actions (per business requirement)

### Re-authentication
- Required for security-sensitive operations (configurable per action per role)
- Uses `x-reauth-password` header or `_currentPassword` body field
- 10-second in-memory cache for config lookups

---

## 5. Key Libraries (`apps/api/src/lib/`)

| File | Purpose |
|------|---------|
| `audit.ts` | SHA-256 hash-chained audit logger |
| `sanitize.ts` | HTML stripping on all text inputs |
| `config-discovery.ts` | Auto-discover config definitions at startup |
| `config-registry.ts` | Self-registering config module pattern |
| `jwt.ts` | JWT token creation, verification, refresh |
| `reauth-check.ts` | Re-authentication enforcement with 10s TTL cache |

---

## 6. Data Ingestion Pipeline (10 stages)

```
Sensor/Device -> MQTT/HTTP/WebSocket -> Message Normalizer -> Entity Resolver
  -> Pipeline Tracer -> Rule Engine (77 node types) -> Output Actions
    -> Telemetry Storage (TimescaleDB)
    -> Alarm Generation (deduplication)
    -> UNS Publication
    -> Notification Dispatch (email/SMS/Telegram/Slack)
```

Two BullMQ workers:
- **Ingestion Worker** — Processes incoming payloads through pipeline
- **Maintenance Worker** — DLQ cleanup, connectivity staleness checks

---

## 7. Compliance (21 CFR Part 11)

| Requirement | Implementation |
|-------------|----------------|
| Unique user identification | Unique User IDs with database constraint |
| Password complexity | Configurable policy with validation service |
| Password history | Password history table with configurable depth |
| Account lockout | Configurable failed attempts with auto-lock |
| Session timeout | Configurable idle timeout with auto-logout, 24h absolute timeout |
| Audit trail | SHA-256 checksums, tamper-evident, all users can view |
| Electronic signatures | ElectronicSignature model with signer, meaning, timestamp |
| Re-authentication | Required for sensitive operations (configurable per action) |
| SUPER_ADMIN exemption | Actions not recorded in audit trail |
| Record integrity | SHA-256 checksums on audit records and filter events |

---

## 8. Phase 2 Backend Modules

### filter-operations (Prefix: /api/filters)
Core module for filter cleaning lifecycle management.
- `filter-operations.service.ts` — getCurrentState, startCycle, advance, bypass, submitChecklist, getCycles, getCycleById, getEvents, getCleaningReasons
- `routes.ts` — REST endpoints for cycle management
- `events-routes.ts` — REST endpoints for events, cycles, reasons queries
- Organization scoping via `orgWhere(ctx)` on all queries
- Transaction wrapping for startCycle (race condition prevention)
- Server-side checklist enforcement in advance()

### cleaning-profiles (Prefix: /api/filter-cleaning-profiles)
- Pipeline profile CRUD with versioning (archive old, create new version)
- Pipeline validation: START/END nodes, stage keys, checklist profiles, graph connectivity
- Transaction wrapping for update operations

### checklist-profiles (Prefix: /api/checklist-profiles)
- Profile CRUD with usage check on delete (blocks if referenced by pipeline nodes)
- Question CRUD with reorder support

### filter-profiles (Prefix: /api/filter-profiles)
- Links cleaning profiles to filter instances
- Organization scoping with fallback for global scope users

### pm-schedules (Prefix: /api/pm-schedules)
- Annual PM schedule management per AHU
- Monthly entry management with tolerance windows

### equipment-groups (Prefix: /api/equipment-groups)
- Equipment group CRUD for AHU dashboard organization
- Entity-to-group assignment management

---

*Document Version: 3.0*
*Last Updated: 2026-04-04*
*Compliance Standard: 21 CFR Part 11*
*Status: Phase 2 Digital FMS complete — 34 API modules, 57 Prisma models, 77 rule chain node types, 23 config definitions*

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
