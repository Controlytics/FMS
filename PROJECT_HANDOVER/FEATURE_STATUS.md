# Feature Status

## Completed Features

### Phase 1: Core Platform

| Feature | Status | Notes |
|---------|--------|-------|
| User Authentication (local) | Done | BCrypt, JWT, session management |
| LDAP/AD Integration | Done | Auto-provisioning, group mapping, attribute sync |
| Organization-Based Architecture | Done | SUPER_ADMIN > Organization > User hierarchy |
| Role-Based Access Control | Done | 7 roles, 52+ privileges, hierarchy enforcement |
| User Management | Done | CRUD, bulk delete, enable/disable, lock/unlock |
| Organization Management | Done | CRUD, delete with user unassign, active/inactive |
| Asset Template Management | Done | Create, version, attributes, telemetry keys |
| Asset Instance Management | Done | CRUD, relationships, identifiers, hierarchy |
| Rule Chain Engine | Done | 77 node types across 8 categories, visual editor, debug mode |
| Data Ingestion (MQTT) | Done | EMQX integration, device auth, rate limiting |
| Data Ingestion (HTTP) | Done | REST API with device token auth, 10-stage pipeline |
| TimescaleDB Telemetry | Done | Batched writes, hypertables, retention |
| Alarm Management | Done | Create, acknowledge, clear with e-signatures |
| Notification System | Done | In-app, email, SMS (Twilio/AWS SNS/Vonage/HTTP) channels |
| Notification Rules | Done | Event-based triggers with conditions |
| Audit Trail | Done | Immutable logs, export, IP tracking, checksums |
| Electronic Signatures | Done | 21 CFR Part 11 compliant (SHA-256) |
| Checklist System | Done | 3-step approval workflow |
| QR Code Generation | Done | Asset identification scanning |
| Dashboard Widgets | Done | Configurable, real-time data |
| WebSocket Real-time | Done | Live telemetry, alarm, notification updates |
| Password Policy | Done | Complexity, expiry, history, lockout |
| Session Management | Done | Sliding window, absolute timeout, single-tab |
| Configuration System | Done | 23 auto-discovered config modules |
| Branding | Done | Per-organization logo, colors, app name |
| System Health Monitoring | Done | API metrics, request tracking |
| Database Backup | Done | Manual backup/restore |
| Help Documentation | Done | 40+ help articles with version history |
| UNS (ISA-95 Paths) | Done | Entity to UNS path mapping |
| Debug Traces | Done | Pipeline execution debugging |
| Input Sanitization | Done | XSS prevention, strips HTML from all text fields |
| Admin Requests | Done | Password reset approval workflow |
| Entity Assignments | Done | Fine-grained view/control/configure permissions |
| User Groups | Done | Notification group management |

### Phase 2: Digital Filter Management System

| Feature | Status | Notes |
|---------|--------|-------|
| Cleaning Profiles | Done | Visual pipeline editor with 8 stage types + checklist gates |
| Filter Profiles | Done | Filter-to-cleaning-profile assignment with SET_A/SET_B |
| Filter Operations | Done | Cycle start, advance, bypass, checklist submission |
| Cleaning Cycle Tracking | Done | Full lifecycle with status tracking (IN_PROGRESS/COMPLETED/ABORTED) |
| Filter Events | Done | Complete event audit trail for all operations |
| PM Schedules | Done | Preventive maintenance scheduling with execution tracking |
| Checklist Profiles | Done | Configurable question templates (TEXT/YES_NO/NUMERIC/SELECT/MULTI_SELECT) |
| Equipment Groups | Done | AHU grouping with instrument assignments |
| AHU Dashboard | Done | Equipment group overview with filter status |
| Filter Traceability | Done | Full history timeline per filter |
| Cleaning Cycle History | Done | List and timeline views |
| Filter Status/Scan | Done | Current status view, QR/barcode scanning |
| Bulk Filter Upload | Done | CSV/Excel bulk import |
| Filter Retirement | Done | Retirement workflow |
| Filter Replacement | Done | Replacement workflow |
| Cleaning Profile Editor | Done | Visual drag-and-drop pipeline builder |

### Phase 3: Mobile & Infrastructure

| Feature | Status | Notes |
|---------|--------|-------|
| Unified Light Theme | Done | All pages bg-white, no dark theme |
| Windows Local Dev | Done | Batch scripts, Redis 5, PostgreSQL 18, tsx watch |
| Android Build (Capacitor) | Done | JDK21 + Android SDK, HTTP config for tablet |
| Mobile PWA Views | Done | Mobile-optimized filter operations |

## Partially Completed

| Feature | Status | Missing |
|---------|--------|---------|
| Data Retention | 80% | Auto-cleanup scheduled but no automated job; no audit/session/notification log retention |
| SMS Notifications | 80% | Gateway integration needs per-deployment config; no user phone UI; no delivery webhooks |
| Telegram/Slack | 70% | Basic Slack webhook node only; no Telegram implementation; no notification channel integration |

---

### Detailed Gap Analysis for Partially Completed Features

---

#### 1. Data Retention (80%) -- Remaining Gaps

**What exists:**
- Full CRUD API for retention config (GET/PUT `/config/retention`)
- Manual execution endpoints: `POST /retention/execute`, `/retention/execute-range`, `/retention/delete-keys`, `/retention/delete-records`
- Covers 5 TSDB tables: `ts_telemetry`, `ts_attributes`, `ts_device_events`, `ts_pipeline_traces`, `ts_checklist_responses`
- Frontend config page at `/config/retention`
- `autoEnabled` boolean flag stored in config

**What is missing (the 20%):**
1. No automated/scheduled retention job (autoEnabled flag has no effect)
2. No retention for audit logs (grow indefinitely)
3. No retention for notification logs
4. No retention for expired session records
5. No data archival/export-before-delete (requiresArchive flag is cosmetic)
6. No retention execution history/logging

---

#### 2. SMS Notifications (80%) -- Remaining Gaps

**What exists:**
- Full implementation with 4 providers (Twilio, AWS SNS, Vonage, HTTP Gateway)
- Phone number normalization with E.164 validation
- Delivery service with retry logic (3 retries, exponential backoff)
- Frontend SMS settings page at `/config/sms-settings`

**What is missing (the 20%):**
1. Config definition only lists 2 of 4 providers (missing Vonage and HTTP Gateway)
2. No per-organization SMS config (system-wide only)
3. No user phone number management UI
4. AWS SNS uses shell exec (`execSync`) instead of SDK
5. No delivery status webhooks/callbacks
6. No SMS rate limiting or cost controls

---

#### 3. Telegram/Slack (70%) -- Remaining Gaps

**What exists:**
- Slack: A single rule-chain node (`send-to-slack`) that sends to a webhook URL
- Telegram: Nothing -- zero Telegram code exists

**What is missing (the 30%):**
1. No Telegram implementation at all
2. No Slack or Telegram notification delivery channel (only email and SMS channels exist)
3. No Slack/Telegram in notification rules system (no `slackEnabled`/`telegramEnabled` flags)
4. No Slack OAuth2 / Bot Token integration
5. No config/settings pages for Slack or Telegram
6. No Slack/Telegram user mapping
7. Slack rule-chain node is webhook-only with basic formatting (no Block Kit)

---

## Not Yet Implemented

| Feature | Priority | Notes |
|---------|----------|-------|
| SSO (SAML/OAuth2) | Medium | Currently LDAP only |
| Report Generation | Medium | PDF/Excel report exports |
| Data Analytics | Low | Basic queries exist, no BI integration |
| Multi-Region | Low | Single-server deployment |
| API Rate Limiting Per Organization | Medium | Currently global and per-device only |
| Automated Backups | Medium | Currently manual only |
| CI/CD Pipeline | Medium | No GitHub Actions or similar configured |
| E2E Testing | Medium | No Playwright/Cypress setup |
| Docker Containerization | Low | Direct installation on EC2 |

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
