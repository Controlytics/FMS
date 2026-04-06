# DigiLog Documentation

Welcome to the DigiLog documentation — a 21 CFR Part 11 compliant digital logbook and IoT data logging platform for regulated industries, with an integrated Digital Filter Management System (Phase 2).

## Platform Overview
- **34 API modules**, **57 Prisma models**, **17 enums**
- **77 rule chain node types** across 8 categories
- **23 config definitions** with auto-discovery
- **4 notification channels**: Email, SMS, Telegram, Slack

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

## Development Phases
- [Phase Overview](phases/README.md)

## Digital Filter Management System (Phase 2)

DigiLog includes a comprehensive Digital Filter Management System for pharmaceutical cleanroom HEPA filter cleaning lifecycle management.

### Modules
- **Cleaning Profiles** — Visual pipeline editor for multi-stage cleaning workflows
- **Filter Profiles** — Filter-to-cleaning-profile assignment and configuration
- **Filter Operations** — Cycle start, stage advance, bypass (with deviation logging), checklist submission
- **PM Schedules** — Preventive maintenance scheduling per AHU with tolerance windows
- **Checklist Profiles** — Reusable question templates (10 question types) for pipeline checklist nodes
- **Equipment Groups** — AHU dashboard with dual-set (SET_A/SET_B) filter management

### Key Capabilities
- Multi-stage cleaning pipeline (configurable stages via visual editor)
- CHECKLIST nodes between STAGE nodes trigger automatic question dialogs
- Server-side enforcement: advance() blocks if pending checklist not completed
- Cycle auto-completes when last STAGE leads to END node
- Real-time filter status tracking with QR/barcode scan
- Cleaning cycle history with full audit trail
- Configurable cleaning reasons with justification support
- Filter retirement and replacement tracking
- Bulk upload for filter data import

### Phase 2 API Endpoints
```
POST /api/filters/:id/start-cycle       — Start cleaning cycle
POST /api/filters/:id/advance           — Advance to next stage
POST /api/filters/:id/submit-checklist  — Submit checklist answers
POST /api/filters/:id/bypass            — Bypass stage (deviation)
GET  /api/filters/:id/current-state     — Get filter state + next actions
GET  /api/filter/cycles                 — List cleaning cycles
GET  /api/filter/events                 — List filter events
GET  /api/cleaning-profiles             — List cleaning profiles
GET  /api/filter-profiles               — List filter profiles
GET  /api/pm-schedules                  — List PM schedules
GET  /api/checklist-profiles            — List checklist profiles
GET  /api/equipment-groups              — List equipment groups
```

### Compliance
All filter operations are recorded as immutable events with SHA-256 checksums, electronic signatures, and deviation tracking per 21 CFR Part 11.
