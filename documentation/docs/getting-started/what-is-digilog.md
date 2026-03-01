# What is DigiLog?

DigiLog is an open-source digital logbook and IoT platform designed for **21 CFR Part 11 compliant** industrial environments. It enables organizations to manage physical assets, collect real-time telemetry data, automate workflows through rule chains, and maintain complete audit trails — all through a modern web interface.

---

## Key Features

### Entity Management
Organize your physical assets — machines, sensors, production lines, facilities — into a hierarchical structure following the **ISA-95** standard. Each entity is created from a configurable **Asset Template** that defines its attributes, telemetry keys, and connectivity settings.

### Real-Time Data Collection
Ingest time-series telemetry data from devices via **HTTP**, **MQTT**, or **WebSocket** protocols. DigiLog processes, stores, and visualizes this data in real time, with configurable retention policies.

### Rule Engine
Build automated data processing pipelines using a visual drag-and-drop **Rule Chain Editor**. Filter, transform, enrich, and route telemetry data through configurable processing nodes. Trigger alarms, send notifications, or forward data to external systems.

### Alarms & Notifications
Define alarm rules that trigger based on telemetry thresholds or device events. Alarms support multiple severity levels (Critical, Major, Minor, Warning, Indeterminate) and require **electronic signatures** for acknowledgment and clearing — meeting FDA 21 CFR Part 11 requirements.

### Checklists & QR Codes
Create template-based inspection checklists with text, numeric, yes/no, dropdown, and **photo capture** question types. Generate QR codes for entities so field operators can scan and fill checklists from any device.

### Unified Namespace (UNS)
Automatically generate ISA-95 compliant MQTT topic paths based on your entity hierarchy. The UNS provides a single source of truth for data routing across your organization.

### Compliance & Audit
Every action in DigiLog is recorded in an immutable **audit trail** with timestamps, user identification, electronic signatures, and before/after values. This meets the requirements of 21 CFR Part 11 for electronic records and signatures.

---

## Architecture Overview

DigiLog uses a modern monorepo architecture:

```
┌─────────────────────────────────────────────────────┐
│                   Web Browser                        │
│              React 19 SPA (Vite)                     │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────────┐
│                 Nginx Reverse Proxy                   │
│            (Static files + API proxy)                 │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Fastify 5 API Server                     │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ │
│  │  Auth    │ │ Entities │ │Rule Engine│ │Telemetry│ │
│  │  RBAC   │ │Templates │ │  Alarms   │ │Ingestion│ │
│  └─────────┘ └──────────┘ └───────────┘ └────────┘ │
└───────┬──────────────┬──────────────┬───────────────┘
        │              │              │
┌───────▼──────┐ ┌─────▼─────┐ ┌─────▼──────┐
│  PostgreSQL  │ │   Redis    │ │   EMQX     │
│  (Prisma ORM)│ │  (BullMQ)  │ │(MQTT Broker)│
└──────────────┘ └───────────┘ └────────────┘
```

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 19, Vite, Tailwind CSS | Single-page application |
| **API** | Fastify 5, TypeScript | REST API, WebSocket, authentication |
| **Database** | PostgreSQL + Prisma ORM | Entity data, configs, audit trail |
| **Time-Series** | PostgreSQL (hypertable-compatible) | Telemetry, attributes, device events |
| **Message Queue** | Redis + BullMQ | Async data ingestion pipeline |
| **MQTT Broker** | EMQX | Device-to-platform MQTT communication |
| **Process Manager** | PM2 | Production process management |
| **Reverse Proxy** | Nginx | Static file serving, API proxy, TLS |

---

## Core Concepts

### Entities
An **entity** represents a physical or logical asset in your system — a machine, sensor, production line, building, or any item you want to monitor. Entities are organized in a parent-child hierarchy.

### Asset Templates
A **template** defines the blueprint for a category of entities. It specifies:
- **Category** (Enterprise, Site, Area, Line, Cell, Equipment, Sensor, Custom)
- **Attribute schema** (typed fields: text, number, boolean, enum, date, JSON)
- **Telemetry keys** (what data points this entity type produces)
- **Data ingestion settings** (transport protocol, credential type)
- **Connection limits** (max parent/child connections)

### Telemetry
**Telemetry** is time-series data sent by devices or external systems. Each data point is a timestamped key-value pair. DigiLog stores telemetry in optimized time-series tables and provides query APIs for historical and real-time access.

### Rule Chains
A **rule chain** is a directed graph of processing nodes that transforms and routes incoming messages. Messages flow from an input node through filter, enrichment, transformation, and action nodes. Rule chains enable automation without code.

### Alarms
An **alarm** is a triggered alert based on device data or system events. Alarms have a severity level, require acknowledgment with electronic signatures, and propagate through the entity hierarchy for centralized visibility.

### Sessions & Authentication
DigiLog uses **JWT-based session authentication** with configurable session duration, sliding window expiry, idle timeout with countdown warning, and forced password change on first login.

---

## Supported Roles

DigiLog includes six built-in roles with hierarchical permissions:

| Role | Level | Description |
|------|-------|-------------|
| **SUPER_ADMIN** | 6 | Full system access, configuration, role management |
| **ADMIN** | 5 | User management, entity management, rule chains |
| **SUPERVISOR** | 4 | Entity oversight, alarm management, reports |
| **MAINTENANCE** | 3 | Entity maintenance, connectivity, troubleshooting |
| **OPERATOR** | 2 | Day-to-day operations, checklist submissions |
| **VIEWER** | 1 | Read-only access to dashboards and data |

---

## Next Steps

- [Hello World Tutorial](hello-world.md) — Create your first entity and send telemetry data
- [Entities & Hierarchy](../user-guide/entities/entities-and-hierarchy.md) — Learn about the entity model
- [User Management](../administration/users/user-management.md) — Set up users and roles
