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
| [Attributes](user-guide/telemetry/attributes.md) | Static and dynamic key-value properties on entities |
| [Latest Telemetry](user-guide/telemetry/latest-telemetry.md) | Real-time latest values dashboard |

### Connectivity

| Guide | Description |
|-------|-------------|
| [Device Connectivity](user-guide/connectivity/device-connectivity.md) | Access tokens, connection status, protocol support |
| [HTTP API](user-guide/connectivity/http-api.md) | Send telemetry and attributes via HTTP |
| [MQTT](user-guide/connectivity/mqtt.md) | MQTT broker integration with EMQX |
| [WebSocket](user-guide/connectivity/websocket.md) | Real-time bidirectional communication |
| [Code Snippets](user-guide/connectivity/code-snippets.md) | Auto-generated connection code in Python, Node.js, curl, Arduino |

### Automation & Alerts

| Guide | Description |
|-------|-------------|
| [Rule Engine Overview](user-guide/rule-engine/overview.md) | Concepts, message flow, and rule chain architecture |
| [Rule Chain Editor](user-guide/rule-engine/rule-chain-editor.md) | Visual drag-and-drop rule chain builder |
| [Rule Nodes](user-guide/rule-engine/rule-nodes.md) | All available node types: filter, transform, action, external |
| [Alarms](user-guide/alarms/alarms.md) | Alarm creation, severity levels, acknowledgment, e-signatures |

### Field Operations

| Guide | Description |
|-------|-------------|
| [Checklists](user-guide/checklists/checklists.md) | Template-based inspection forms with photo capture |
| [QR Codes](user-guide/checklists/qr-codes.md) | Generate and scan QR codes for entity-linked checklists |
| [Unified Namespace (UNS)](user-guide/uns/uns.md) | ISA-95 topic hierarchy and MQTT namespace management |

## Administration

| Guide | Description |
|-------|-------------|
| [User Management](administration/users/user-management.md) | Create, edit, disable users; password resets |
| [Roles & Permissions](administration/roles/roles-and-permissions.md) | RBAC model, built-in roles, permission matrix |
| [Audit Trail](administration/audit/audit-trail.md) | Immutable activity log with electronic signatures |
| [Security Configuration](administration/security/security.md) | Password policy, login security, session management |
| [System Configuration](administration/configuration/system-configuration.md) | Branding, date/time, pagination, data retention |
| [Backup & Restore](administration/configuration/backup-restore.md) | Database backup and configuration restore |
| [System Health](administration/configuration/system-health.md) | API metrics, queue status, connectivity monitoring |

## API Reference

| Guide | Description |
|-------|-------------|
| [Authentication API](api-reference/authentication.md) | Login, logout, session management, password change |
| [Entity API](api-reference/entities.md) | CRUD operations for entity instances |
| [Template API](api-reference/templates.md) | Asset template management |
| [Telemetry API](api-reference/telemetry.md) | Data ingestion and query endpoints |
| [Alarm API](api-reference/alarms.md) | Alarm query, acknowledge, clear |
| [Configuration API](api-reference/configuration.md) | System configuration endpoints |

## Compliance

| Guide | Description |
|-------|-------------|
| [21 CFR Part 11](compliance/21-cfr-part-11.md) | How DigiLog meets FDA electronic records requirements |
| [Audit Trail Requirements](compliance/audit-requirements.md) | Traceability, electronic signatures, data integrity |

---

*DigiLog v2.x — Built for regulated industrial environments.*
