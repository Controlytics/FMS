# DigiLog — Project Summary

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-03-09 (v3.1.0 — System Validation Complete)
**Policy:** This document must be updated after every feature addition, bug fix, or structural change.

---

## A. Project Overview

### Purpose

DigiLog is a **21 CFR Part 11 compliant digital logbook** designed for regulated industries (pharmaceutical, biotechnology, food manufacturing, medical devices). It replaces paper-based logbooks, equipment records, and manual tracking systems with a secure, auditable, and configurable digital platform.

### Scope

- Template-driven entity management with hierarchical parent-child relationships
- Role-based access control with 39+ granular permissions (10 categories)
- Tamper-evident audit trail with SHA-256 checksums (60+ audit actions)
- Configurable system settings (security, branding, datetime, pagination, field labels, alarm columns)
- Data ingestion pipeline (HTTP/MQTT/WebSocket) with BullMQ workers
- Rule chain engine (**48 node types** across 9 categories, sandboxed VM execution, sub-chain delegation)
- Alarm management with deduplication and role-based column visibility
- Unified Namespace (ISA-95) with cascade moves and wildcard search
- Notification system with role-based delivery
- Backup and restore functionality
- TimescaleDB hypertables for time-series data (7 tables)
- GitHub Actions CI/CD pipeline (1,344 tests)
- 21 CFR Part 11 and ALCOA+ compliance

### Core Modules

| Module | Endpoints | Description |
|--------|-----------|-------------|
| Authentication | 8 | Login, logout, session management, password change, forgot password |
| User Management | 14 | User CRUD, enable/disable/unlock, password reset, bulk operations |
| Role Management | 8 | Dynamic role CRUD, permissions, hierarchy |
| Entity Templates | 6 | Template blueprints with attributes, telemetry, checklists, alarms |
| Entity Instances | 8 | Hierarchical entity CRUD with parent-child tree |
| Entity Relationships | 3 | Bidirectional links (12 types) with cycle detection |
| Entity Identifiers | 4 | QR, barcode, RFID, NFC, manual tags |
| Configuration | 36+ | Security, display, access, audit, branding, alarm-columns settings |
| Audit Trail | 4 | Immutable, checksummed audit records |
| Notifications | 9 | Role-filtered notifications with bulk operations |
| Uploads | 2 | Photo uploads with size limits |
| Backup | 3 | Database export, restore, validation |
| MQTT Auth | 3 | MQTT authentication, ACL, webhook |
| Data Ingestion | 8 | HTTP telemetry/attributes/events, RPC, config |
| Rule Chains | 14 | CRUD, nodes, connections, versions, activate/deactivate, debug |
| UNS | 6 | ISA-95 tree, entity mapping, move, search |
| Telemetry Queries | 7 | Latest, timeseries, keys, attributes, history, checklists |
| Alarms | 5 | List, entity alarms, acknowledge, clear, manual clear |
| Export | 5 | Telemetry, checklists, alarms, attributes CSV/JSON, status |
| Retention | 4 | Config GET/PUT, archive, execute |
| Connectivity | 6 | Status, test, snippets, token generate/revoke, history |
| QR Codes | 4 | Generate, get, SVG, delete |
| Help Articles | 6 | CRUD with versioning, version history |
| Debug Traces | 4 | List, detail, toggle, delete |
| **Total** | **~145+** | |

---

## B. Current Architecture Overview

### High-Level System Structure

```
┌──────────────────────────────────────────────────────────────┐
│                      EC2 Instance (t3.large)                  │
│                                                                │
│  ┌─────────┐   ┌──────────┐   ┌────────────┐  ┌──────────┐  │
│  │  nginx   │──▶│ Fastify 5│──▶│ PostgreSQL │  │  Redis   │  │
│  │ (port 80)│   │ (port    │   │ 16         │  │ (BullMQ) │  │
│  │          │   │  3000)   │   │ digilog_db │  └──────────┘  │
│  │ React    │   │ PM2      │   │ 30 tables  │                │
│  │ SPA      │   │ managed  │   │            │  ┌──────────┐  │
│  └─────────┘   └──────────┘   │ TimescaleDB│  │  EMQX    │  │
│                                │ digilog_   │  │  (MQTT)  │  │
│  ┌──────────────────────┐     │ tsdb       │  └──────────┘  │
│  │  BullMQ Workers      │     │ 7 hyper-   │                │
│  │  (ingestion,         │────▶│ tables     │                │
│  │   maintenance)       │     └────────────┘                │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Monorepo | Turborepo | Latest |
| Backend | Fastify | 5.2.0 |
| Frontend | React | 19.0.0 |
| Build | Vite | 6.1.0 |
| Styling | Tailwind CSS | 4.0.0 |
| ORM | Prisma | 6.3.0 |
| Database | PostgreSQL + TimescaleDB | 16 |
| Queue | BullMQ + Redis | Latest |
| Messaging | EMQX (MQTT) | Latest |
| Auth | jose (JWT) | 6.0.0 |
| Validation | Zod | 3.24.0 |
| Data Fetching | SWR | 2.3.0 |
| Visual Editor | React Flow | Latest |
| CI/CD | GitHub Actions | Latest |

### Active Modules

| Module | Location | Status |
|--------|----------|--------|
| Auth | `apps/api/src/modules/auth/` | Active — Routes/Service/Repository pattern |
| Users | `apps/api/src/modules/users/` | Active — Routes/Service/Repository pattern |
| Roles | `apps/api/src/modules/roles/` | Active — Monolithic routes file |
| Config | `apps/api/src/modules/config/` | Active — Routes/Service/Repository pattern |
| Assets (Entities) | `apps/api/src/modules/assets/` | Active — Routes/Service/Repository pattern (16 files) |
| Audit | `apps/api/src/modules/audit/` | Active — Monolithic routes file |
| Notifications | `apps/api/src/modules/notifications/` | Active — Monolithic routes file |
| Uploads | `apps/api/src/modules/uploads/` | Active — Monolithic routes file |
| Backup | `apps/api/src/modules/backup/` | Active — Monolithic routes file |
| Data Ingestion | `apps/api/src/modules/data-ingestion/` | Active — Pipeline architecture |
| Rule Chains | `apps/api/src/modules/rule-chain/` | Active — Engine + routes |
| UNS | `apps/api/src/modules/uns/` | Active — Monolithic routes file |
| Queries | `apps/api/src/modules/queries/` | Active — 4 route files (telemetry, alarms, export, retention) |
| Connectivity | `apps/api/src/modules/connectivity/` | Active — Monolithic routes file |
| QR Codes | `apps/api/src/modules/qr-code/` | Active — Monolithic routes file |
| Help | `apps/api/src/modules/help/` | Active — Monolithic routes file |

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
| System Configuration (33 endpoints) | 1.0.0 | 2026-02-17 |
| Notifications | 1.0.0 | 2026-02-17 |
| Backup & Restore | 1.0.0 | 2026-02-17 |
| Action Re-authentication | 1.0.0 | 2026-02-17 |
| Audit Text Templates | 1.0.0 | 2026-02-17 |
| Pagination Settings | 1.0.0 | 2026-02-17 |
| Dynamic Tree Diagram | Phase 2 | 2026-02-19 |
| Telemetry Schema | Phase 2 | 2026-02-19 |
| Multi-select Linking | Phase 2 | 2026-02-19 |
| Connection Limits | Phase 2 | 2026-02-20 |
| Toast Notification System | Phase 2 | 2026-02-20 |
| Entity Template View Dialog | Phase 2 | 2026-02-20 |
| Asset → Entity UI Rename | Phase 2 | 2026-02-20 |
| API Refactoring (Phases 0-4) | Phase 2 | 2026-02-20 |
| Checklist Schema (14 question types) | Phase 2+ | 2026-02-21 |
| Entity Audit Descriptions | Phase 2+ | 2026-02-21 |
| Entity Feature Privileges | Phase 2+ | 2026-02-21 |
| Permission-based RBAC | Phase 2+ | 2026-02-23 |
| Session Conflict Dialog | Phase 2+ | 2026-02-23 |

| Data Ingestion Pipeline (Phases A-C) | Phase A-C | 2026-02-25 |
| Rule Chain Engine (Phase D) | Phase D | 2026-02-25 |
| UNS ISA-95 (Phase E) | Phase E | 2026-02-25 |
| Queries & Export (Phase F) | Phase F | 2026-02-25 |
| Connectivity, QR, Help + Frontend (Phases G-J) | Phase G-J | 2026-02-25 |
| Testing & Documentation (Phase K) | Phase K | 2026-02-26 |
| Security Fixes (8), CI/CD, TimescaleDB, Refactoring | v3.0 | 2026-03-01 |
| Checklist MCQ/MULTI_SELECT Fix | v3.0 | 2026-03-02 |
| Component Extraction (Entity Explorer 2081→386 lines) | v3.0 | 2026-03-01 |
| GitHub Actions CI/CD Pipeline | v3.0 | 2026-03-01 |
| 1,344 Tests (0 failures) across 83+ files | v3.0 | 2026-03-01 |
| Alarm Column Visibility Config | v3.1 | 2026-03-07 |
| Permission Migration (role→permission-based) | v3.1 | 2026-03-07 |
| Sandboxed VM Execution for Rule Chain Scripts | v3.1 | 2026-03-07 |
| Sub-Chain Delegation | v3.1 | 2026-03-07 |
| Atomic SQL Telemetry Upsert | v3.1 | 2026-03-07 |
| Alarm Deduplication | v3.1 | 2026-03-07 |
| MANUALLY_CLEARED Alarm Status | v3.1 | 2026-03-07 |
| Absolute 24h Session Timeout | v3.1 | 2026-03-07 |
| LatestTelemetry UUID Cast Fix (P0) | v3.1 | 2026-03-07 |
| Device Credential createdAt Fix (P2) | v3.1 | 2026-03-07 |
| Entity Resolver Cache TTL (P3) | v3.1 | 2026-03-07 |
| Real-time Auto-refresh (SWR polling + WebSocket) | v3.1 | 2026-03-07 |

### In Progress

All features are complete and deployed as of 2026-03-07. No items currently in progress.

### Planned (Not Started)

| Feature | Priority | Description |
|---------|----------|-------------|
| Electronic Signatures | High | E-sign with re-authentication for approvals |
| Logbook Entries / Digital Forms | High | Structured data entry tied to entities |
| Reports & Exports | Medium | PDF/Excel reports for audit and entity data |
| HTTPS/TLS Certificates | Medium | SSL for production deployment |
| Frontend Component Tests | Low | Vitest + React Testing Library |

---

## D. Testing Summary

### Types of Testing Performed

| Type | Framework | Scope |
|------|-----------|-------|
| Unit Tests | Vitest | Shared package schemas, API library functions, data ingestion, rule chain |
| E2E Tests | Vitest | All API modules (~145+ endpoints) |
| RBAC Tests | Custom bash script | 73 permission/isolation tests |
| Manual Tests | Manual | All 34+ frontend pages, UI flows |
| Compliance Verification | Manual | 21 CFR Part 11 (22 controls), ALCOA+ (9 principles) |
| Feature Tests | Manual + API | Tree diagram (70 tests), linking, checklists |
| CI/CD | GitHub Actions | PostgreSQL 15, Redis 7, Node 20, automated on push/PR |

### Coverage Summary

| Category | Files | Tests | Pass Rate |
|----------|-------|-------|-----------|
| Shared — Schema Validation | 4 | 161 | 100% |
| Shared — Type Validation | 1 | 29 | 100% |
| API — Library Unit Tests | 3 | 29 | 100% |
| API — E2E Endpoint Tests | 9+ | 115+ | 100% |
| API — Data Ingestion Unit Tests | 7 | 150+ | 100% |
| API — Rule Chain Unit Tests | 4 | 80+ | 100% |
| API — UNS Unit Tests | 1 | 20+ | 100% |
| DB — Telemetry Batcher | 1 | 15+ | 100% |
| API — Checklist E2E | 3 | 40+ | 100% |
| API — Connectivity E2E | 1 | 15+ | 100% |
| RBAC — Permission Tests | 1 | 73 | 100% |
| Tree Diagram — Feature Tests | 1 | 70 | 100% |
| **Total** | **83+** | **1,344** | **100%** |

### Last Regression Date

**2026-03-07** — Full CI/CD regression (1,344 tests, 0 failures). GitHub Actions pipeline on push to main/DataIngestion. All development phases (A through K) complete and deployed.

### Test Documentation Location

All testing documents are centralized in `/documentation/testing/`:

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
| Total Bugs Identified | 28 |
| Total Resolved | 27 |
| Open Issues | 1 ([#13](https://github.com/pankajexa/21cfrlogbook/issues/13) — low priority) |
| Git Issues Created | 12 (#2–#13) |
| Security Fixes (v3.0) | 8 |
| Critical Severity | 1 |
| High Severity | 8 |
| Medium Severity | 11 |
| Low Severity | 7 |

### Recurring Patterns

| Pattern | Occurrences | Description |
|---------|-------------|-------------|
| Fastify Schema Serialization | 3 (BUG-001, 006, 007) | Response schema missing fields causes silent data stripping |
| Async Race Conditions | 1 (BUG-004) | Missing `await` on `reauth.execute()` calls |

### Bug Resolution Rate

- Average resolution time: < 24 hours
- All high-severity bugs resolved within same day of identification
- Detailed log: `/documentation/Bug_Resolution_Log.md`

---

## F. Documentation Governance Process

### How Updates Are Maintained

1. **Every code change** triggers mandatory updates to:
   - `PLAN.md` — Feature status, scope, change log entry
   - `BUSINESS_CONTEXT.md` — Business impact, workflow changes
   - `CODEBASE_CONTEXT.md` — Architecture, folder structure, API/schema changes

2. **Every bug fix** requires:
   - Git issue created with structured template (`.github/ISSUE_TEMPLATE/bug_report.md`)
   - Entry added to `/documentation/Bug_Resolution_Log.md`
   - Git issue closed with commit reference

3. **Every testing activity** produces documentation in `/documentation/testing/`

4. **This summary** (`Project_Summary.md`) is updated after every significant change

### Versioning Approach

| Document | Versioning |
|----------|-----------|
| Source Code | Git (branch-based, commit history) |
| Documentation | Version history sections in each major document |
| Database Schema | Prisma migrations (`apps/api/prisma/migrations/`) |
| Entity Templates | Automatic version snapshots (`AssetTemplateVersion`) |
| API Contracts | Swagger/OpenAPI (auto-generated from route schemas) |

### Document Inventory

| Document | Location | Purpose |
|----------|----------|---------|
| CLAUDE.md | `/CLAUDE.md` | Codebase overview, endpoints, architecture |
| PLAN.md | `/PLAN.md` | Master development plan |
| BUSINESS_CONTEXT.md | `/BUSINESS_CONTEXT.md` | Business context, regulatory compliance |
| CODEBASE_CONTEXT.md | `/CODEBASE_CONTEXT.md` | Technical architecture reference |
| CHANGELOG.md | `/CHANGELOG.md` | Version history and change details |
| API_GUIDE.md | `/API_GUIDE.md` | API endpoint reference with examples |
| Bug_Resolution_Log.md | `/documentation/Bug_Resolution_Log.md` | Structured bug tracking |
| Project_Summary.md | `/documentation/Project_Summary.md` | This file |
| Testing Docs | `/documentation/testing/` | All test plans, reports, and scripts |

---

### Documentation Compliance Status

| Status | Details |
|--------|---------|
| **Governance Mode** | Active (self-enforcing) |
| **Current Version** | 3.1.0 |
| **Auto-Sync Documents** | 7 (CHANGELOG, API_GUIDE, task_status, BUSINESS_CONTEXT, CODEBASE_CONTEXT, PLAN, Project_Summary) |
| **Bug Lifecycle** | Enforced (Git issue → fix → Bug_Resolution_Log → close) |
| **Testing Docs** | Centralized at `/documentation/testing/` |
| **CI/CD** | GitHub Actions (push to main/DataIngestion, PRs) |
| **Last Full Sync** | 2026-03-07 |

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-03-07 | 3.1.0 | All features COMPLETE and deployed. Added 3 bug fixes (FIX-024/025/026): LatestTelemetry UUID cast (P0), device credential createdAt (P2), entity resolver cache TTL (P3). Moved all in-progress items to completed. Updated metrics (28 bugs, 7 hypertables). Test tools: push-telemetry.py, push-telemetry.mjs, telemetry-200.csv. Real-time auto-refresh via SWR polling + WebSocket. |
| 2026-03-05 | 3.0.0 | Full documentation sync: updated all metrics (145+ endpoints, 1344 tests, 30 models, 34+ pages), added Phases A-K and v3.0 features (data ingestion, rule chains, alarms, UNS, TimescaleDB, CI/CD, security fixes, component refactoring) |
| 2026-02-25 | 2.1.2 | Git issue lifecycle: 12 bugs converted to GitHub issues (#2–#13), 11 closed, 1 open |
| 2026-02-25 | 2.1.1 | Documentation governance enforcement activated; all 7 core documents auto-synchronized |
| 2026-02-25 | 1.0 | Initial creation — comprehensive project summary reflecting current system state |
