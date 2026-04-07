# DigiLog Backend Summary

**Path:** `apps/api/`
**Framework:** Fastify 5.2 + TypeScript 5.7
**Database:** PostgreSQL 18 (Prisma ORM) + TimescaleDB (pg pool)
**Queue:** BullMQ 5.70 + Redis 5 (IORedis)
**MQTT:** EMQX via mqtt.js 5.15
**Entry:** `apps/api/src/app.ts`

---

## Scale

| Metric | Count |
|--------|-------|
| API Modules | 34 |
| Route Endpoints | ~169 |
| Prisma Models | 59 |
| Prisma Enums | 18 |
| Config Definitions | 27 |
| Lib Files | 25 |
| Core Plugins | 3 (auth, rbac, audit-logger) |
| Rule Chain Node Types | 79 |
| Rule Chain Categories | 8 |
| Ingestion Pipeline Stages | 11 |
| Test Files | 74 |
| Dependencies | 28 production + 5 dev |

---

## 34 API Modules

| Module | Key Endpoints |
|--------|--------------|
| admin-requests | POST /, GET /, GET /pending-count, POST /:id/process |
| assets | Templates, instances, relationships, identifiers CRUD |
| audit | GET /, GET /:id, DELETE /:id, POST /bulk-delete |
| auth | POST /login, /logout, /refresh, /change-password, GET /me, PUT /profile |
| backup | GET /export, POST /restore, POST /validate |
| checklist-profiles | CRUD + question management |
| cleaning-profiles | CRUD + PATCH /:id/toggle-status, versioning |
| config | GET /, GET /:key, PUT /:key, POST /reload |
| connectivity | GET /:entityId, POST /:entityId/test, GET /:entityId/snippets |
| dashboards | CRUD for custom dashboards |
| data-ingestion | POST /ingest, debug traces, DLQ management |
| deployment-check | GET / (system readiness check) |
| entity-assignments | GET /, POST /, DELETE /:id |
| equipment-groups | CRUD for AHU equipment groups |
| filter-operations | start-cycle, advance, bypass, submit-checklist, retire, replace, terminate |
| filter-profiles | CRUD + assign filters to profiles |
| help | CRUD + versioned articles |
| ldap | POST /sync, /test, GET /status |
| notification-delivery | GET /channels, POST /test/:channel, GET /templates |
| notification-rules | CRUD for alert rules |
| notifications | GET /, unread-count, mark-all-read, bulk-read/unread |
| org-admin | Organization self-management |
| pm-schedules | CRUD + executions (start, complete, overdue) |
| qr-code | GET /, POST /generate, GET /:code |
| queries | Telemetry, alarms, retention, export endpoints |
| roles | CRUD + permissions, hierarchy, creatable roles |
| rule-chain | CRUD + POST /:id/execute, GET /node-types |
| super-admin | System stats, reset, audit log |
| system-health | GET /, GET /detailed, POST /check |
| tenant-admin | Org management + user bulk-invite |
| uns | UNS tree build, validate, entity paths |
| uploads | POST /, GET /:id, DELETE /:id |
| user-groups | CRUD for user groups |
| users | CRUD + enable/disable/unlock/reset-password, stats, bulk-delete |

---

## 59 Prisma Models

### Core (20)
Organization, Role, User, PasswordHistory, Session, SystemConfig, FieldIdConfig, UserConfig, RoleConfig, AdminRequest, AuditTrail, Notification, NotificationLog, NotificationTemplate, NotificationRule, NotificationRuleRecipient, PasswordResetRequest, UserGroup, UserGroupMember, Dashboard

### Assets (10)
AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier, TemplateAssignment, EntityAssignment, DashboardWidget, DashboardAssignment, DeviceCredential

### Data & Rules (9)
RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection, Alarm, LatestTelemetry, DataStream, DeadLetterQueue, IngestionSystemConfig

### Compliance (4)
ChecklistReview, ElectronicSignature, ConnectivityStatus, QrCode

### Content (3)
HelpArticle, HelpArticleVersion, UnsMapping

### Phase 2 — Filter Management (13)
FilterCleaningProfile, FilterPipelineStage, FilterPipelineConnection, FilterProfile, CleaningCycle, FilterEvent, EquipmentGroup, EquipmentGroupInstrument, ChecklistProfile, ChecklistQuestion, PmSchedule, PmScheduleEntry, PmExecution

---

## 18 Prisma Enums

RoleScope, DashboardScope, AssigneeType, UserStatus, NotificationType, NotificationChannel, NotificationDeliveryStatus, NotificationEventType, PmScheduleStatus, PmExecutionStatus, FilterSetLabel, PipelineFlowMode, PipelineNodeType, CleaningCycleStatus, FilterEventType, BlockRestriction, ChecklistQuestionType, CleaningProfileStatus

---

## 27 Config Definitions

action-reauth, alarm-columns, audit-templates, backup, branding, datetime, field-ids, filter-cleaning-reasons, filter-lifecycle-states, filter-pm-schedule, help, login-security, notification-email, notification-logs, notification-rules, notification-slack, notification-sms, notification-telegram, pagination, password-policy, retention, role-privileges, roles, session, sidebar-config, uns, user-id

---

## 11-Stage Data Ingestion Pipeline

| Stage | Purpose |
|-------|---------|
| 1-2 | Transport & deserialization (MQTT/HTTP/WS) |
| 3 | Device validation (IP allowlist, rate limiting) |
| 4-5 | Entity resolution & metadata enrichment |
| 6 | Message normalization & validation |
| 6.5 | Template alarm rules evaluation |
| 7 | Rule chain resolution & execution |
| 8 | Rule chain output processing |
| 9 | Data persistence (TSDB + PostgreSQL) |
| 10 | Audit trail (SHA-256 hash-chained) |
| 11 | Event emission (Redis pub/sub, MQTT, notifications) |

---

## 79 Rule Chain Node Types (8 Categories)

| Category | Description |
|----------|-------------|
| INPUT | Message input nodes |
| FILTER | Conditional filtering & routing |
| ENRICHMENT | Data enrichment from external sources |
| TRANSFORMATION | Data transformation & mapping |
| ACTION | Action execution (save, alarm, notify) |
| EXTERNAL | External system integration (HTTP, MQTT) |
| FLOW | Flow control (IF/SWITCH/LOOP/DELAY) |
| ANALYTICS | Analytics & calculation nodes |

---

## Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| fastify | ^5.2.0 | Web framework |
| @prisma/client | ^6.3.0 | ORM |
| bullmq | ^5.70.1 | Job queue |
| ioredis | ^5.9.3 | Redis client |
| mqtt | ^5.15.0 | MQTT client |
| jose | ^6.0.0 | JWT handling |
| bcrypt | ^5.1.1 | Password hashing |
| zod | ^3.24.0 | Schema validation |
| nodemailer | ^8.0.2 | Email sending |
| pg | ^8.18.0 | PostgreSQL driver |
| pino | ^9.6.0 | Structured logging |

---

## Key Architectural Patterns

1. **Modular routing** — each module has `routes.ts` registered at startup
2. **Config auto-discovery** — 27 `.def.ts` files self-register via `config-registry.ts`
3. **Permission-based RBAC** — `requirePermission()` on all protected routes
4. **Hash-chained audit trail** — SHA-256 checksums, immutable (21 CFR Part 11)
5. **Recursive input sanitization** — HTML stripping on all text at any depth
6. **Transaction-guarded state machines** — filter advance/bypass re-validate inside tx
7. **Multi-transport ingestion** — MQTT, HTTP, WebSocket → unified pipeline
8. **TimescaleDB separation** — time-series data in dedicated hypertables
9. **Graceful shutdown** — 15s timeout, closes all pools (TSDB, Redis, MQTT)
10. **Org scoping** — shared `orgScope()` utility for multi-tenant isolation

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
