# DigiLog Documentation

**DigiLog** is a 21 CFR Part 11 compliant digital logbook and IoT platform for industrial environments. It provides entity management, real-time telemetry, rule-based automation, electronic signatures, and full audit trails — designed for regulated industries including pharmaceutical, manufacturing, and food & beverage.

---

## Getting Started

| Guide | Description |
|-------|-------------|
| [What is DigiLog?](getting-started/what-is-digilog.md) | Platform overview, architecture, and key concepts |
| [Hello World](getting-started/hello-world.md) | Create your first entity, connect a device, and view telemetry in 15 minutes |
| [System Requirements](getting-started/system-requirements.md) | Hardware, software, and network prerequisites |

## User Guide

### Entities & Data

| Guide | Description |
|-------|-------------|
| [Entities & Hierarchy](user-guide/entities/entities-and-hierarchy.md) | Entity types, ISA-95 hierarchy, parent-child relationships |
| [Asset Templates](user-guide/templates/asset-templates.md) | Template creation, attribute schemas, versioning |
| [Telemetry](user-guide/telemetry/telemetry.md) | Time-series data collection, storage, and querying |

### Connectivity

| Guide | Description |
|-------|-------------|
| [Device Connectivity](user-guide/connectivity/device-connectivity.md) | Access tokens, connection status, protocol support |
| [MQTT Connectivity](user-guide/connectivity/mqtt.md) | MQTT broker integration, topics, authentication, code examples |

### Automation & Alerts

| Guide | Description |
|-------|-------------|
| [Rule Engine Overview](user-guide/rule-engine/overview.md) | Concepts, message flow, and rule chain architecture |
| [Alarms](user-guide/alarms/alarms.md) | Alarm creation, severity levels, acknowledgment, e-signatures |

### Field Operations

| Guide | Description |
|-------|-------------|
| [Checklists](user-guide/checklists/checklists.md) | Template-based inspection forms with photo capture |
| [Unified Namespace (UNS)](user-guide/uns/uns.md) | ISA-95 topic hierarchy and MQTT namespace management |
| [Data Export](user-guide/data-export/data-export.md) | Export telemetry, attributes, alarms, and checklists |

## Administration

| Guide | Description |
|-------|-------------|
| [User Management](administration/users/user-management.md) | Create, edit, disable users; password resets |
| [Roles & Permissions](administration/roles/roles-and-permissions.md) | RBAC model, built-in roles, permission matrix |
| [Audit Trail](administration/audit/audit-trail.md) | Immutable activity log with electronic signatures |
| [Security Configuration](administration/security/security.md) | Password policy, login security, session management |
| [System Configuration](administration/configuration/system-configuration.md) | Branding, date/time, pagination, data retention |

## API Reference

| Endpoint | Description |
|----------|-------------|
| [Authentication](api-reference/authentication.md) | Login, logout, session management, password change |
| [Entities](api-reference/entities.md) | Entity instance CRUD, relationships, identifiers |
| [Templates](api-reference/templates.md) | Asset template management and versioning |
| [Telemetry](api-reference/telemetry.md) | Data ingestion (HTTP/MQTT) and time-series querying |
| [Alarms](api-reference/alarms.md) | Alarm query, acknowledge, clear with e-signatures |
| [Rule Chains](api-reference/rule-chains.md) | Rule chain management, 28 node types, debug inspection |
| [Users](api-reference/users.md) | User CRUD, enable/disable, lock/unlock, password resets |
| [Configuration](api-reference/configuration.md) | Security, branding, roles, re-auth, audit templates |
| [Notifications](api-reference/notifications.md) | In-app notification management |
| [UNS](api-reference/uns.md) | Unified Namespace tree, search, cascade moves |
| [Data Export](api-reference/export.md) | CSV/JSON export for telemetry, attributes, alarms, checklists |
| [Data Retention](api-reference/retention.md) | Retention policies, data deletion, archival |
| [Debug Traces](api-reference/debug-traces.md) | Pipeline execution traces and statistics |
| [Backup & Restore](api-reference/backup.md) | Database backup (JSON/BAK/SQL/CSV) with SHA-256 integrity |
| [Audit Trail](api-reference/audit.md) | Audit log querying with hash-chain integrity verification |
| [Help Articles](api-reference/help.md) | Context-sensitive help article management |

## Compliance

| Guide | Description |
|-------|-------------|
| [21 CFR Part 11](compliance/21-cfr-part-11.md) | How DigiLog meets FDA electronic records requirements |

---

*DigiLog v2.x — Built for regulated industrial environments.*
