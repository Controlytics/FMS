# DigiLog Documentation

Welcome to the DigiLog documentation -- a 21 CFR Part 11 compliant IoT data logging platform with Digital Filter Management for regulated industries.

## Getting Started
- [What is DigiLog?](getting-started/what-is-digilog.md)
- [System Requirements](getting-started/system-requirements.md)
- [Hello World](getting-started/hello-world.md)

## User Guide
- [Entities & Hierarchy](user-guide/entities/entities-and-hierarchy.md)
- [Asset Templates](user-guide/templates/asset-templates.md)
- [Device Connectivity](user-guide/connectivity/device-connectivity.md)
- [MQTT Setup](user-guide/connectivity/mqtt.md)
- [Telemetry](user-guide/telemetry/telemetry.md)
- [Rule Engine](user-guide/rule-engine/overview.md)
- [Alarms](user-guide/alarms/alarms.md)
- [Checklists](user-guide/checklists/checklists.md)
- [UNS (Unified Namespace)](user-guide/uns/uns.md)
- [Data Export](user-guide/data-export/data-export.md)

## Administration
- [User Management](administration/users/user-management.md)
- [Roles & Permissions](administration/roles/roles-and-permissions.md)
- [System Configuration](administration/configuration/system-configuration.md)
- [Audit Trail](administration/audit/audit-trail.md)
- [Email Integration](administration/notifications/email-integration.md)
- [SMS Integration](administration/notifications/sms-integration.md)
- [Security](administration/security/security.md)

## API Reference
- [Authentication](api-reference/authentication.md)
- [Users](api-reference/users.md)
- [Entities](api-reference/entities.md)
- [Templates](api-reference/templates.md)
- [Telemetry](api-reference/telemetry.md)
- [Rule Chains](api-reference/rule-chains.md)
- [Alarms](api-reference/alarms.md)
- [UNS](api-reference/uns.md)
- [Notifications](api-reference/notifications.md)
- [Configuration](api-reference/configuration.md)
- [Audit](api-reference/audit.md)
- [Backup](api-reference/backup.md)
- [Export](api-reference/export.md)
- [Retention](api-reference/retention.md)
- [Help](api-reference/help.md)
- [Debug Traces](api-reference/debug-traces.md)

## Compliance
- [21 CFR Part 11](compliance/21-cfr-part-11.md)

---

## Digital Filter Management System (Phase 2)

DigiLog includes a comprehensive Digital Filter Management System for pharmaceutical cleanroom HEPA filter cleaning lifecycle management.

### Core Modules
- **Cleaning Profiles** -- Visual pipeline editor for defining multi-stage cleaning workflows
- **Filter Profiles** -- Filter-to-cleaning-profile assignment and configuration
- **Filter Operations** -- Cycle start, stage advance, bypass with deviation logging, checklist enforcement
- **PM Schedules** -- Preventive maintenance scheduling per AHU with tolerance windows
- **Checklist Profiles** -- Reusable question templates (10 types) for pipeline gates
- **Equipment Groups** -- AHU-level grouping for dashboard views
- **Filter Events** -- Immutable event log with SHA-256 checksums
- **Cleaning Cycle History** -- Full traceability from start to completion

### Key API Endpoints
| Endpoint | Description |
|----------|-------------|
| `POST /api/filters/:id/start-cycle` | Start a cleaning cycle with reason selection |
| `POST /api/filters/:id/advance` | Advance filter to next pipeline stage |
| `POST /api/filters/:id/submit-checklist` | Submit checklist answers for gate completion |
| `POST /api/filters/:id/bypass` | Bypass a stage with deviation justification |
| `GET /api/filters/:id/current-state` | Get filter state and next available actions |
| `GET /api/filter/cycles` | List cleaning cycles with filters |
| `GET /api/filter/events` | List filter events with filters |
| `GET /api/cleaning-profiles` | Manage cleaning profile definitions |
| `GET /api/filter-profiles` | Manage filter-to-profile assignments |
| `GET /api/pm-schedules` | Manage PM schedules |
| `GET /api/checklist-profiles` | Manage checklist profile templates |
| `GET /api/equipment-groups` | Manage AHU equipment groups |

### Additional Phase 2 Features
- Retirement and replacement workflow for end-of-life filters
- Bulk upload of filter data via CSV
- AHU dashboard with real-time filter status overview
- Full 21 CFR Part 11 compliance for all filter operations

### Compliance
All filter operations are recorded as immutable events with SHA-256 checksums, electronic signatures, and deviation tracking per 21 CFR Part 11.

### Platform Stats
- **34 API modules**, **57 Prisma models**, **17 enums**
- **23 config definitions** with auto-discovery
- **77 rule chain node types** across 8 categories
- **28 help articles** with version history
- **Multi-channel notifications**: Email, SMS, Telegram, Slack

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
