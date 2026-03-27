# DigiLog Documentation

Welcome to the DigiLog documentation — a 21 CFR Part 11 compliant digital logbook for IoT data logging in regulated industries.

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


## Digital Filter Management (Phase 2)

DigiLog includes a comprehensive Digital Filter Management System for pharmaceutical cleanroom HEPA filter cleaning lifecycle management.

### Features
- 8-stage cleaning pipeline (To Be Cleaned, Wash In/Out, Dry In/Out, Storage In/Out, Ready For Use)
- Visual pipeline editor for creating cleaning profiles
- Checklist gates between stages with 10 question types
- Real-time filter status tracking with QR/barcode scan
- Cleaning cycle history with full audit trail
- PM scheduling per AHU with tolerance windows
- Configurable cleaning reasons with justification support

### Compliance
All filter operations are recorded as immutable events with SHA-256 checksums, electronic signatures, and deviation tracking per 21 CFR Part 11.

