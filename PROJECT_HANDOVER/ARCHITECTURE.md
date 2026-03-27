# Architecture Document

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENTS                             │
│  Browser (React SPA)  │  IoT Devices  │  External APIs   │
└──────────┬────────────┴───────┬───────┴────────┬────────┘
           │ HTTP/WS            │ MQTT            │ HTTP
           ▼                    ▼                 ▼
┌──────────────────┐  ┌─────────────────┐  ┌──────────────┐
│     Nginx        │  │   EMQX Broker   │  │  Fastify API │
│  (Reverse Proxy  │  │  (MQTT Server)  │  │  (Port 3000) │
│   + Static SPA)  │  │  (Port 1883)    │  │              │
│  (Port 80/443)   │  │                 │  │              │
└────────┬─────────┘  └────────┬────────┘  └──────┬───────┘
         │                     │                    │
         └─────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Fastify API       │
                    │   ┌───────────────┐ │
                    │   │ Auth Plugin   │ │
                    │   │ RBAC Plugin   │ │
                    │   │ Audit Plugin  │ │
                    │   └───────────────┘ │
                    │   ┌───────────────┐ │
                    │   │ 27 Route      │ │
                    │   │ Modules       │ │
                    │   └───────────────┘ │
                    │   ┌───────────────┐ │
                    │   │ Workers       │ │
                    │   │ (Ingestion +  │ │
                    │   │  Maintenance) │ │
                    │   └───────────────┘ │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ PostgreSQL │  │ TimescaleDB│  │   Redis    │
     │ (App Data) │  │ (Telemetry)│  │ (Queue +   │
     │ Port 5432  │  │ Port 5433  │  │  Pub/Sub)  │
     └────────────┘  └────────────┘  └────────────┘
```

## Module Breakdown

### Backend Modules (27)

| Category | Module | Purpose |
|----------|--------|---------|
| **Auth** | auth, users, roles, user-groups | Authentication, authorization, user management |
| **Admin** | super-admin, admin, org-admin, entity-assignments | Organization management, resource assignments |
| **Config** | config, config (dynamic) | System configuration (22 auto-discovered modules) |
| **Assets** | assets | Templates, instances, relationships, identifiers |
| **Data** | data-ingestion, queries, uns | IoT data pipeline, queries, UNS paths |
| **Automation** | rule-chain | Visual rule chains with 77 node types |
| **Monitoring** | connectivity, system-health, debug-traces | Device status, system metrics, debug |
| **Alerts** | alarms (via queries) | Alarm lifecycle management |
| **Notifications** | notifications, notification-delivery, notification-rules | Multi-channel notification system |
| **Compliance** | audit, backup | Audit trails, database backups |
| **Utilities** | uploads, qr-code, help, ldap | File uploads, QR codes, help docs, LDAP |

## Data Flow: Telemetry Ingestion

```
Device → MQTT/HTTP → API Gateway → Auth Check → Rate Limit Check
  → Ingestion Worker (BullMQ)
    → Parse Payload
    → Validate Schema (against AssetTemplate)
    → Execute Rule Chain (if configured)
      → Filter Nodes → Transform Nodes → Action Nodes
    → Store in TimescaleDB (batched, 100/sec)
    → Update LatestTelemetry cache
    → Check Template Alarm Rules
    → Create Alarms (if triggered)
    → Dispatch Notifications
    → Update Connectivity Status
    → WebSocket Push to UI
```

## Organization Structure

```
Platform (SUPER_ADMIN scope)
├── Organization A (company)
│   ├── User (ORG_ADMIN - manages org resources)
│   ├── User (SUPERVISOR)
│   ├── User (OPERATOR)
│   ├── User (MAINTENANCE)
│   ├── Entity (Asset Instance)
│   └── Entity Template
├── Organization B
│   └── ...
├── ADMIN (manages assigned organizations)
└── SUPER_ADMIN (manages all organizations)
```

**Data Isolation:** Every query filters by `organizationId`. Entity assignments provide fine-grained access (view/control/configure).

## Rule Engine Architecture

```
Rule Chain
├── Input Node (entry point)
├── Filter Nodes (route messages)
│   ├── True → Transform/Enrich
│   └── False → Discard/Log
├── Transform Nodes (modify data)
├── Action Nodes (side effects)
│   ├── Create Alarm
│   ├── Send Email/SMS
│   ├── Save to Database
│   └── HTTP Webhook
└── External Integration Nodes
    ├── MQTT Publish
    ├── Kafka/AMQP
    └── Cloud Services (AWS/Azure/GCP)
```

**Execution:** Each node receives a message object, processes it, and routes to connected nodes via labeled outputs (Success, Failure, True, False, etc.).

## Integration Points

| System | Protocol | Purpose |
|--------|----------|---------|
| EMQX MQTT | MQTT 3.1.1/5.0 | Device telemetry, commands |
| PostgreSQL | TCP/5432 | Application data (Prisma) |
| TimescaleDB | TCP/5433 | Time-series telemetry |
| Redis | TCP/6379 | Job queues, pub/sub, WebSocket relay |
| SMTP | TCP/587 | Email notifications |
| SMS Gateway | HTTP | SMS notifications |
| LDAP/AD | LDAP/636 | User authentication |
| Telegram | HTTP | Bot notifications |
| Slack | HTTP | Webhook notifications |
| External webhooks | HTTP | Custom integrations |


## Phase 2: Digital Filter Management System (2026-03-27)

### Overview
Complete digital filter cleaning lifecycle management for pharmaceutical cleanrooms. Supports configurable cleaning pipelines with checklist gates, 8 cleaning stages, dual filter sets, PM scheduling, and full traceability.

### Key Components
- **5 backend modules**: cleaning-profiles, filter-profiles, filter-operations, pm-schedules, checklist-profiles
- **12+ frontend pages**: operations, profiles, cycles, checklists, PM, AHU dashboard, traceability, config
- **9 database tables**: filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events, pm_schedules, pm_schedule_entries, pm_executions
- **Quality audit**: 43 issues found and 35 fixed (security, compliance, logic, UI)

