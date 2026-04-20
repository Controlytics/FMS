# DigiLog -- Project Summary

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-04-04 (Phase 2 Digital FMS Complete)
**Policy:** This document must be updated after every feature addition, bug fix, or structural change.

---

## A. Project Overview

### Purpose

DigiLog is a **21 CFR Part 11 compliant IoT data logging platform** designed for regulated industries (pharmaceutical, biotechnology, food manufacturing, medical devices). It replaces paper-based logbooks, equipment records, and manual tracking systems with a secure, auditable, and configurable digital platform. Phase 2 adds a comprehensive Digital Filter Management System for cleanroom HEPA filter cleaning lifecycle management.

### Scope

- Template-driven entity management with hierarchical parent-child relationships (ISA-95)
- Role-based access control with 52+ granular permissions across 10+ categories
- Tamper-evident audit trail with SHA-256 checksums (60+ audit actions)
- Configurable system settings via 23 config modules with auto-discovery
- Data ingestion pipeline (HTTP/MQTT/WebSocket) with BullMQ workers
- Rule chain engine (77 node types across 8 categories, sandboxed VM execution, sub-chain delegation)
- Alarm management with deduplication, electronic signatures, and role-based column visibility
- Unified Namespace (ISA-95) with cascade moves and wildcard search
- Multi-channel notifications (Email, SMS, Telegram, Slack) with configurable rules
- Backup and restore (4 formats: JSON, BAK, SQL, CSV)
- TimescaleDB hypertables for time-series data
- Digital Filter Management System (Phase 2): cleaning profiles, filter operations, PM schedules, checklists, equipment groups, retirement/replacement, bulk upload
- 21 CFR Part 11 and ALCOA+ compliance

### Platform Statistics

| Metric | Count |
|--------|-------|
| API Modules | 34 |
| Prisma Models | 57 |
| Enums | 17 |
| Config Definitions | 23 |
| Rule Chain Node Types | 77 (8 categories) |
| Permissions | 52+ |
| Help Articles | 28 |
| Notification Channels | 4 (Email, SMS, Telegram, Slack) |

### Core Modules

| Module | Description |
|--------|-------------|
| Authentication | Login, logout, session management, password change, forgot password |
| User Management | User CRUD, enable/disable/unlock, password reset, bulk operations |
| Role Management | Dynamic role CRUD, permissions, hierarchy |
| Entity Templates | Template blueprints with attributes, telemetry, checklists, alarms |
| Entity Instances | Hierarchical entity CRUD with parent-child tree |
| Entity Relationships | Bidirectional links (12 types) with cycle detection |
| Entity Identifiers | QR, barcode, RFID, NFC, manual tags |
| Configuration | 23 config modules: security, display, integrations, advanced |
| Audit Trail | Immutable, checksummed audit records |
| Notifications | Multi-channel delivery with role-based filtering |
| Uploads | Photo uploads with size limits |
| Backup | Database export, restore, validation (4 formats) |
| MQTT Auth | MQTT authentication, ACL, webhook |
| Data Ingestion | HTTP telemetry/attributes/events, RPC, config |
| Rule Chains | CRUD, nodes, connections, versions, activate/deactivate, debug |
| UNS | ISA-95 tree, entity mapping, move, search |
| Telemetry Queries | Latest, timeseries, keys, attributes, history, checklists |
| Alarms | List, entity alarms, acknowledge, clear, manual clear |
| Export | Telemetry, checklists, alarms, attributes CSV/JSON |
| Retention | Config GET/PUT, archive, execute |
| Connectivity | Status, test, snippets, token generate/revoke, history |
| QR Codes | Generate, get, SVG, delete |
| Help Articles | CRUD with versioning, version history |
| Debug Traces | List, detail, toggle, delete |

### Phase 2: Digital Filter Management Modules

| Module | Description |
|--------|-------------|
| Cleaning Profiles | Visual pipeline editor for multi-stage cleaning workflows |
| Filter Profiles | Filter-to-cleaning-profile assignment and configuration |
| Filter Operations | Cycle start, stage advance, bypass with deviation logging, checklist enforcement |
| PM Schedules | Preventive maintenance scheduling per AHU with tolerance windows |
| Checklist Profiles | Reusable question templates (10 types) for pipeline gates |
| Equipment Groups | AHU-level grouping for dashboard views |
| Filter Events | Immutable event log with SHA-256 checksums |
| Cleaning Cycles | Full cycle history with traceability |

---

## B. Current Architecture Overview

### High-Level System Structure

```
+-----------------------------------------------------------------+
|                      EC2 Instance (t3.large)                     |
|                      34.232.224.0                                |
|                                                                  |
|  +----------+   +----------+   +--------------+  +----------+   |
|  |  nginx   |-->| Fastify 5|-->| PostgreSQL 18|  |  Redis 5 |   |
|  | (port 80)|   | (port    |   | + Prisma ORM |  | (BullMQ) |   |
|  |          |   |  3000)   |   | 57 models    |  +----------+   |
|  | React    |   | PM2      |   | 17 enums     |                 |
|  | SPA      |   | managed  |   |              |  +----------+   |
|  +----------+   +----------+   | TimescaleDB  |  |  EMQX    |   |
|                                | digilog_tsdb |  |  (MQTT)  |   |
|  +-----------------------+     +--------------+  +----------+   |
|  |  BullMQ Workers       |                                      |
|  |  (ingestion,          |                                      |
|  |   maintenance)        |                                      |
|  +-----------------------+                                      |
+-----------------------------------------------------------------+
```

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Monorepo | Turborepo | Latest |
| Backend | Fastify | 5.x |
| Frontend | React | 19.x |
| Build | Vite | 6.x |
| Styling | Tailwind CSS | 4.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL + TimescaleDB | 18 |
| Queue | BullMQ + Redis | 5 |
| Messaging | EMQX (MQTT) | 5.x |
| Auth | jose (JWT) | 6.x |
| Validation | Zod | 3.x |
| Data Fetching | SWR | 2.x |
| Visual Editor | React Flow | Latest |

### Active Modules (34)

| Module | Location | Pattern |
|--------|----------|---------|
| Auth | `apps/api/src/modules/auth/` | Routes/Service/Repository |
| Users | `apps/api/src/modules/users/` | Routes/Service/Repository |
| Roles | `apps/api/src/modules/roles/` | Routes/Service/Repository |
| Config | `apps/api/src/modules/config/` | Routes/Service/Repository |
| Assets | `apps/api/src/modules/assets/` | Routes/Service/Repository |
| Audit | `apps/api/src/modules/audit/` | Monolithic routes |
| Notifications | `apps/api/src/modules/notifications/` | Monolithic routes |
| Notification Rules | `apps/api/src/modules/notification-rules/` | Monolithic routes |
| Notification Delivery | `apps/api/src/modules/notification-delivery/` | Dispatcher |
| Uploads | `apps/api/src/modules/uploads/` | Monolithic routes |
| Backup | `apps/api/src/modules/backup/` | Monolithic routes |
| Data Ingestion | `apps/api/src/modules/data-ingestion/` | Pipeline |
| Rule Chains | `apps/api/src/modules/rule-chain/` | Engine + routes |
| UNS | `apps/api/src/modules/uns/` | Monolithic routes |
| Queries | `apps/api/src/modules/queries/` | Multiple route files |
| Connectivity | `apps/api/src/modules/connectivity/` | Monolithic routes |
| QR Codes | `apps/api/src/modules/qr-code/` | Monolithic routes |
| Help | `apps/api/src/modules/help/` | Monolithic routes |
| Cleaning Profiles | `apps/api/src/modules/cleaning-profiles/` | Routes (Phase 2) |
| Filter Profiles | `apps/api/src/modules/filter-profiles/` | Routes (Phase 2) |
| Filter Operations | `apps/api/src/modules/filter-operations/` | Routes (Phase 2) |
| PM Schedules | `apps/api/src/modules/pm-schedules/` | Routes (Phase 2) |
| Checklist Profiles | `apps/api/src/modules/checklist-profiles/` | Routes (Phase 2) |
| Super Admin | `apps/api/src/modules/super-admin/` | Routes |
| Tenant Admin | `apps/api/src/modules/tenant-admin/` | Routes |
| Org Admin | `apps/api/src/modules/org-admin/` | Routes |

### Removed Modules

| Module | Date Removed | Reason |
|--------|-------------|--------|
| Instruments | 2026-02-19 | Feature superseded by entity management system |
| Template Linking Rules | 2026-02-20 | Overly restrictive; any entity can now link freely |

---

## C. Feature Completion Status

### Completed

| Feature | Version | Date |
|---------|---------|------|
| User Management (CRUD, roles, password policies) | 1.0.0 | 2026-02-17 |
| Entity Management (templates, instances, hierarchy) | 1.0.0 | 2026-02-17 |
| Audit Trail (SHA-256 checksums, tamper-evident) | 1.0.0 | 2026-02-17 |
| System Configuration (23 modules) | 1.0.0 | 2026-02-17 |
| Notifications | 1.0.0 | 2026-02-17 |
| Backup & Restore (4 formats) | 1.0.0 | 2026-02-17 |
| Action Re-authentication (42+ actions) | 1.0.0 | 2026-02-17 |
| Dynamic Tree Diagram | Phase 2 | 2026-02-19 |
| Telemetry Schema | Phase 2 | 2026-02-19 |
| Multi-select Linking | Phase 2 | 2026-02-19 |
| Checklist Schema (14 question types) | Phase 2+ | 2026-02-21 |
| Permission-based RBAC (52+ permissions) | Phase 2+ | 2026-02-23 |
| Data Ingestion Pipeline | Phase A-C | 2026-02-25 |
| Rule Chain Engine (77 nodes, 8 categories) | Phase D | 2026-02-25 |
| UNS ISA-95 | Phase E | 2026-02-25 |
| Queries & Export | Phase F | 2026-02-25 |
| Connectivity, QR, Help + Frontend | Phase G-J | 2026-02-25 |
| Security Fixes, CI/CD, TimescaleDB | v3.0 | 2026-03-01 |
| Alarm Column Visibility, Sandboxed VM | v3.1 | 2026-03-07 |
| Config Registry with Auto-Discovery | v3.2 | 2026-03-12 |
| **Digital Filter Management System** | **Phase 2** | **2026-03-27** |
| Cleaning Profiles (visual pipeline editor) | Phase 2 | 2026-03-27 |
| Filter Profiles (assignment) | Phase 2 | 2026-03-27 |
| Filter Operations (cycle/advance/bypass/checklist) | Phase 2 | 2026-03-27 |
| PM Schedules (preventive maintenance) | Phase 2 | 2026-03-27 |
| Checklist Profiles (10 question types) | Phase 2 | 2026-03-27 |
| Equipment Groups (AHU dashboard) | Phase 2 | 2026-03-27 |
| Filter Events (immutable audit log) | Phase 2 | 2026-03-27 |
| Retirement/Replacement workflow | Phase 3 | 2026-04-01 |
| Bulk Upload (CSV) | Phase 3 | 2026-04-01 |
| Multi-channel Notifications (Email, SMS, Telegram, Slack) | Phase 3 | 2026-04-01 |
| Quality Audit (35 security, logic, UI fixes) | Phase 3 | 2026-04-01 |

### In Progress

All features are complete and deployed as of 2026-04-04. No items currently in progress.

---

## D. Testing Summary

### Types of Testing Performed

| Type | Framework | Scope |
|------|-----------|-------|
| Unit Tests | Vitest | Shared package schemas, API library functions, data ingestion, rule chain |
| E2E Tests | Vitest | All API modules |
| RBAC Tests | Custom bash script | 73 permission/isolation tests |
| Manual Tests | Manual | All frontend pages, UI flows, filter operations |
| Compliance Verification | Manual | 21 CFR Part 11 (22 core + 7 Phase 2 controls) |
| Feature Tests | Manual + API | Tree diagram (70 tests), linking, checklists, filter operations |

### Test Documentation Location

| Subfolder | Contents |
|-----------|----------|
| `manual/` | TEST.md (comprehensive), TEST_CASES.md, TEST_SUMMARY.md |
| `reports/` | TEST_REPORT.md, TREE_DIAGRAM_TEST_REPORT.md, RBAC_TEST_RESULTS.md |
| `automation/` | rbac-test.sh (automated RBAC testing script) |
| `validation/` | 21CFR_PART11_VERIFICATION.md |

---

## E. Bug Metrics

### Summary

| Metric | Count |
|--------|-------|
| Total Bugs Identified | 38+ |
| Total Resolved | 30+ |
| Open Issues | BUG-012 (low priority) |
| Phase 2 Quality Audit | 35 security, logic, and UI fixes |
| Phase 2 GitHub Issues | 30 (#36-#65) |

### Recurring Patterns

| Pattern | Occurrences | Description |
|---------|-------------|-------------|
| Fastify Schema Serialization | 3 | Response schema missing fields causes silent data stripping |
| Async Race Conditions | 1 | Missing `await` on `reauth.execute()` calls |
| ReactFlow Custom Nodes | 1 | Custom nodes require explicit Handle components |

### Bug Resolution Rate

- Average resolution time: < 24 hours
- All high-severity bugs resolved within same day
- Detailed log: `/documentation/Bug_Resolution_Log.md`

---

## F. Documentation Governance Process

### How Updates Are Maintained

1. **Every code change** triggers mandatory updates to relevant documentation
2. **Every bug fix** requires entry in Bug_Resolution_Log.md
3. **Every testing activity** produces documentation in `/documentation/testing/`
4. **This summary** is updated after every significant change

### Key URLs

| Resource | URL |
|----------|-----|
| Application | http://34.232.224.0 |
| Swagger API Docs | http://34.232.224.0/docs |
| EMQX Dashboard | http://34.232.224.0:18083 |
| Default Login | superadmin / Admin@123 |

### Document Inventory

| Document | Location | Purpose |
|----------|----------|---------|
| CLAUDE.md | `/CLAUDE.md` | Codebase overview, endpoints, architecture |
| Bug_Resolution_Log.md | `/documentation/Bug_Resolution_Log.md` | Structured bug tracking |
| Project_Summary.md | `/documentation/Project_Summary.md` | This file |
| Testing Docs | `/documentation/testing/` | All test plans, reports, and scripts |
| Documentation Docs | `/documentation/docs/` | User-facing documentation |

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-04-04 | 4.0.0 | Phase 2 Digital FMS complete. Updated all documentation to reflect 34 API modules, 57 Prisma models, 17 enums, 23 config definitions, 77 rule chain node types. Added Phase 2 modules, permissions, test cases, and compliance verification. |
| 2026-03-27 | 3.3.0 | Phase 2 Digital Filter Management System: cleaning profiles, filter operations, PM schedules, checklist profiles, equipment groups, filter events |
| 2026-03-12 | 3.2.0 | Config registry with auto-discovery, additional bug fixes |
| 2026-03-07 | 3.1.0 | All features COMPLETE. Bug fixes, alarm deduplication, sandboxed VM, real-time auto-refresh |
| 2026-03-05 | 3.0.0 | Data ingestion, rule chains, alarms, UNS, TimescaleDB, CI/CD, security fixes |
| 2026-02-25 | 2.1.2 | Git issue lifecycle, documentation governance |
| 2026-02-25 | 1.0 | Initial creation |

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
