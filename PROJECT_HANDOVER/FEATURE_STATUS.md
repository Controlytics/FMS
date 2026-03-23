# Feature Status

## Completed Features

| Feature | Status | Notes |
|---------|--------|-------|
| User Authentication (local) | Done | BCrypt, JWT, session management |
| LDAP/AD Integration | Done | Auto-provisioning, group mapping, attribute sync |
| Multi-Tenant Architecture | Done | Tenant > Organization > User hierarchy |
| Role-Based Access Control | Done | 7 roles, 61 permissions, hierarchy enforcement |
| User Management | Done | CRUD, bulk delete, enable/disable, lock/unlock |
| Organization Management | Done | CRUD, delete with user unassign, active/inactive |
| Asset Template Management | Done | Create, version, attributes, telemetry keys |
| Asset Instance Management | Done | CRUD, relationships, identifiers, hierarchy |
| Rule Chain Engine | Done | 77 node types, visual editor, debug mode |
| Data Ingestion (MQTT) | Done | EMQX integration, device auth, rate limiting |
| Data Ingestion (HTTP) | Done | REST API with device token auth |
| TimescaleDB Telemetry | Done | Batched writes, hypertables, retention |
| Alarm Management | Done | Create, acknowledge, clear with e-signatures |
| Notification System | Done | In-app, email, SMS channels |
| Notification Rules | Done | Event-based triggers with conditions |
| Audit Trail | Done | Immutable logs, export, IP tracking |
| Electronic Signatures | Done | 21 CFR Part 11 compliant (SHA-256) |
| Checklist System | Done | 3-step approval workflow |
| QR Code Generation | Done | Asset identification scanning |
| Dashboard Widgets | Done | Configurable, real-time data |
| WebSocket Real-time | Done | Live telemetry, alarm, notification updates |
| Password Policy | Done | Complexity, expiry, history, lockout |
| Session Management | Done | Sliding window, absolute timeout, single-tab |
| Configuration System | Done | 22 auto-discovered config modules |
| Branding | Done | Per-tenant logo, colors, app name |
| System Health Monitoring | Done | API metrics, request tracking |
| Database Backup | Done | Manual backup/restore |
| Help Documentation | Done | Contextual help with version history |
| UNS (ISA-95 Paths) | Done | Entity → UNS path mapping |
| Debug Traces | Done | Pipeline execution debugging |

## Partially Completed

| Feature | Status | Missing |
|---------|--------|---------|
| Tenant Management | 90% | Hard delete not implemented |
| Data Retention | 80% | Auto-cleanup scheduled but not all modules |
| SMS Notifications | 80% | Gateway integration needs per-deployment config |
| Telegram/Slack | 70% | Basic implementation, no OAuth for Slack |

## Not Yet Implemented

| Feature | Priority | Notes |
|---------|----------|-------|
| SSO (SAML/OAuth2) | Medium | Currently LDAP only |
| Mobile App | Low | Responsive web works on mobile |
| Report Generation | Medium | PDF/Excel report exports |
| Data Analytics | Low | Basic queries exist, no BI integration |
| Multi-Region | Low | Single-server deployment |
| API Rate Limiting Per Tenant | Medium | Currently global only |
| Automated Backups | Medium | Currently manual only |
