# Architecture Document

## High-Level System Architecture

```
+-----------------------------------------------------------+
|                      CLIENTS                               |
|  Browser (React SPA)  |  IoT Devices  |  External APIs    |
+----------+------------+-------+-------+--------+----------+
           | HTTP/WS            | MQTT            | HTTP
           v                    v                 v
+------------------+  +-----------------+  +--------------+
|     Nginx        |  |   EMQX Broker   |  |  Fastify API |
|  (Reverse Proxy  |  |  (MQTT Server)  |  |  (Port 3000) |
|   + Static SPA)  |  |  (Port 1883)    |  |              |
|  (Port 80/443)   |  |                 |  |              |
+--------+---------+  +--------+--------+  +------+-------+
         |                     |                    |
         +---------------------+--------------------+
                               |
                    +----------v----------+
                    |   Fastify API       |
                    |   +---------------+ |
                    |   | Auth Plugin   | |
                    |   | RBAC Plugin   | |
                    |   | Audit Plugin  | |
                    |   +---------------+ |
                    |   +---------------+ |
                    |   | 34 Route      | |
                    |   | Modules       | |
                    |   +---------------+ |
                    |   +---------------+ |
                    |   | Workers       | |
                    |   | (Ingestion +  | |
                    |   |  Maintenance) | |
                    |   +---------------+ |
                    +---------+-----------+
                              |
              +---------------+---------------+
              v               v               v
     +------------+  +------------+  +------------+
     | PostgreSQL |  | TimescaleDB|  |   Redis    |
     | (App Data) |  | (Telemetry)|  | (Queue +   |
     | Port 5432  |  | Port 5432  |  |  Pub/Sub)  |
     +------------+  +------------+  +------------+
```

## Module Breakdown

### Backend Modules (34)

| Category | Module | Purpose |
|----------|--------|---------|
| **Auth** | auth, users, roles, user-groups | Authentication, authorization, user management |
| **Admin** | super-admin, tenant-admin, org-admin, admin-requests, entity-assignments | Organization management, resource assignments |
| **Config** | config (23 auto-discovered definitions) | System configuration with dynamic routes |
| **Assets** | assets | Templates, instances, relationships, identifiers |
| **Data** | data-ingestion (10-stage pipeline), queries, uns | IoT data pipeline, queries, UNS paths |
| **Automation** | rule-chain | Visual rule chains with 77 node types across 8 categories |
| **Monitoring** | connectivity, system-health, deployment-check | Device status, system metrics, deployment verification |
| **Notifications** | notifications, notification-delivery (email/SMS/Telegram/Slack), notification-rules | Multi-channel notification system |
| **Compliance** | audit, backup | Audit trails, database backups |
| **Utilities** | uploads, qr-code, help, ldap, dashboards | File uploads, QR codes, help docs, LDAP, dashboards |
| **Filter Management** | cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles, equipment-groups | Phase 2 Digital FMS |

## Data Flow: Telemetry Ingestion

```
Device -> MQTT/HTTP -> API Gateway -> Auth Check -> Rate Limit Check
  -> Ingestion Worker (BullMQ)
    -> Parse Payload
    -> Validate Schema (against AssetTemplate)
    -> Execute Rule Chain (if configured)
      -> Filter Nodes -> Transform Nodes -> Action Nodes
    -> Store in TimescaleDB (batched, 100/sec)
    -> Update LatestTelemetry cache
    -> Check Template Alarm Rules
    -> Create Alarms (if triggered)
    -> Dispatch Notifications
    -> Update Connectivity Status
    -> WebSocket Push to UI
```

## Data Flow: Filter Cleaning Cycle

```
Operator -> Start Cycle -> Create CleaningCycle record
  -> Load FilterCleaningProfile pipeline
  -> Begin at START node
  -> For each stage:
    -> If CHECKLIST node: block until operator submits answers
    -> If STAGE node (WASH_IN/OUT, DRY_IN/OUT, STORAGE_IN/OUT):
      -> Record FilterEvent with timestamp + operator
      -> Advance to next connected node
    -> If operator requests BYPASS:
      -> Record deviation event
      -> Skip to next stage
  -> When END node reached:
    -> Mark CleaningCycle as COMPLETED
    -> Record completion event
  -> All events visible in traceability timeline
```

## Organization Structure

```
Platform (SUPER_ADMIN scope)
+-- Organization A (company)
|   +-- User (ORG_ADMIN - manages org resources)
|   +-- User (SUPERVISOR)
|   +-- User (OPERATOR)
|   +-- User (MAINTENANCE)
|   +-- Entity (Asset Instance)
|   +-- Entity Template
|   +-- Equipment Groups (AHU with filters)
|   +-- Cleaning Profiles
|   +-- Filter Profiles
|   +-- PM Schedules
+-- Organization B
|   +-- ...
+-- ADMIN (manages assigned organizations)
+-- SUPER_ADMIN (manages all organizations)
```

**Data Isolation:** Every query filters by `organizationId`. Entity assignments provide fine-grained access (view/control/configure).

## Rule Engine Architecture

```
Rule Chain
+-- Input Node (entry point)
+-- Filter Nodes (route messages)
|   +-- True -> Transform/Enrich
|   +-- False -> Discard/Log
+-- Transform Nodes (modify data)
+-- Action Nodes (side effects)
|   +-- Create Alarm
|   +-- Send Email/SMS
|   +-- Save to Database
|   +-- HTTP Webhook
+-- External Integration Nodes
    +-- MQTT Publish
    +-- Kafka/AMQP
    +-- Cloud Services (AWS/Azure/GCP)
```

**Execution:** Each node receives a message object, processes it, and routes to connected nodes via labeled outputs (Success, Failure, True, False, etc.). 77 node types across 8 categories.

## Phase 2: Filter Pipeline Architecture

```
Cleaning Profile (visual editor)
+-- START node
+-- CHECKLIST node (pre-wash inspection)
+-- WASH_IN stage
+-- WASH_OUT stage
+-- CHECKLIST node (post-wash verification)
+-- DRY_IN stage
+-- DRY_OUT stage
+-- CHECKLIST node (dryness check)
+-- STORAGE_IN stage
+-- STORAGE_OUT stage
+-- END node
```

Pipeline is a directed graph stored as:
- `FilterPipelineStage` records (nodes with type, position, config)
- `FilterPipelineConnection` records (edges linking stages)

Supports dual filter sets (SET_A/SET_B) with `PipelineFlowMode` (SEQUENTIAL, PARALLEL).

## Integration Points

| System | Protocol | Purpose |
|--------|----------|---------|
| EMQX MQTT | MQTT 3.1.1/5.0 | Device telemetry, commands |
| PostgreSQL | TCP/5432 | Application data (Prisma ORM, 57 models) |
| TimescaleDB | TCP/5432 | Time-series telemetry (same PG instance) |
| Redis | TCP/6379 | Job queues (BullMQ), pub/sub, WebSocket relay |
| SMTP | TCP/587 | Email notifications |
| SMS Gateway | HTTP | SMS notifications (Twilio/AWS SNS/Vonage/HTTP) |
| LDAP/AD | LDAP/636 | User authentication |
| Telegram | HTTP | Bot notifications |
| Slack | HTTP | Webhook notifications |
| External webhooks | HTTP | Custom integrations |

## Prisma Schema Summary

- **57 models** covering all application domains
- **17 enums** including Phase 2 additions:
  - PmScheduleStatus, PmExecutionStatus, FilterSetLabel, PipelineFlowMode
  - PipelineNodeType, CleaningCycleStatus, FilterEventType
  - BlockRestriction, ChecklistQuestionType
- **13 Phase 2 models**: FilterCleaningProfile, FilterPipelineStage, FilterPipelineConnection, FilterProfile, CleaningCycle, FilterEvent, EquipmentGroup, EquipmentGroupInstrument, ChecklistProfile, ChecklistQuestion, PmSchedule, PmScheduleEntry, PmExecution

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
