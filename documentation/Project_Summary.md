# DigiLog — Project Summary

**Maintained by:** Engineering Team
**Created:** 2026-02-25
**Last Updated:** 2026-02-25 (v2.1.2)
**Policy:** This document must be updated after every feature addition, bug fix, or structural change.

---

## A. Project Overview

### Purpose

DigiLog is a **21 CFR Part 11 compliant digital logbook** designed for regulated industries (pharmaceutical, biotechnology, food manufacturing, medical devices). It replaces paper-based logbooks, equipment records, and manual tracking systems with a secure, auditable, and configurable digital platform.

### Scope

- Template-driven entity management with hierarchical parent-child relationships
- Role-based access control with configurable permissions (22 feature privileges)
- Tamper-evident audit trail with SHA-256 checksums
- Configurable system settings (security, branding, datetime, pagination, field labels)
- Notification system with role-based delivery
- Backup and restore functionality
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
| Configuration | 33 | Security, display, access, audit, branding settings |
| Audit Trail | 4 | Immutable, checksummed audit records |
| Notifications | 9 | Role-filtered notifications with bulk operations |
| Uploads | 2 | Photo uploads with size limits |
| Backup | 3 | Database export, restore, validation |
| **Total** | **102** | |

---

## B. Current Architecture Overview

### High-Level System Structure

```
┌─────────────────────────────────────────────────────┐
│                    EC2 Instance                       │
│                                                       │
│  ┌─────────┐   ┌──────────┐   ┌──────────────────┐  │
│  │  nginx   │──▶│ Fastify 5│──▶│  PostgreSQL 16   │  │
│  │ (port 80)│   │ (port    │   │  (pgcrypto)      │  │
│  │          │   │  3000)   │   │  digilog_db      │  │
│  │ React    │   │ PM2      │   │  15 tables        │  │
│  │ SPA      │   │ managed  │   │                   │  │
│  └─────────┘   └──────────┘   └──────────────────┘  │
└─────────────────────────────────────────────────────┘
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
| Database | PostgreSQL | 16 |
| Auth | jose (JWT) | 6.0.0 |
| Validation | Zod | 3.24.0 |
| Data Fetching | SWR | 2.3.0 |

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

### In Progress

| Feature | Target | Notes |
|---------|--------|-------|
| API Refactoring Phases 5-7 | TBD | Backup, Roles, Notifications modules |
| Frontend Refactoring Phases 8-13 | TBD | Component decomposition for large pages |

### Planned (Not Started)

| Feature | Priority | Description |
|---------|----------|-------------|
| Electronic Signatures | High | E-sign with re-authentication for approvals |
| Logbook Entries / Digital Forms | High | Structured data entry tied to entities |
| Data Point Ingestion | Medium | MQTT/OPC-UA integration for real-time telemetry |
| Reports & Exports | Medium | PDF/Excel reports for audit and entity data |
| HTTPS/TLS Certificates | Medium | SSL for production deployment |
| CI/CD Pipeline | Medium | Automated build/test/deploy |
| Frontend Component Tests | Low | Vitest + React Testing Library |
| Per-page Pagination Selector | Low | Page-level pagination integration |

---

## D. Testing Summary

### Types of Testing Performed

| Type | Framework | Scope |
|------|-----------|-------|
| Unit Tests | Vitest | Shared package schemas, API library functions |
| E2E Tests | Vitest | All 12 API modules (82 endpoints) |
| RBAC Tests | Custom bash script | 73 permission/isolation tests |
| Manual Tests | Manual | All 28 frontend pages, UI flows |
| Compliance Verification | Manual | 21 CFR Part 11 (22 controls), ALCOA+ (9 principles) |
| Feature Tests | Manual + API | Tree diagram (70 tests), linking, checklists |

### Coverage Summary

| Category | Files | Tests | Pass Rate |
|----------|-------|-------|-----------|
| Shared — Schema Validation | 4 | 161 | 100% |
| Shared — Type Validation | 1 | 29 | 100% |
| API — Library Unit Tests | 3 | 29 | 100% |
| API — E2E Endpoint Tests | 9 | 115 | 99.1% (1 pre-existing) |
| RBAC — Permission Tests | 1 | 73 | 100% |
| Tree Diagram — Feature Tests | 1 | 70 | 100% |
| **Total** | **19** | **477** | **99.8%** |

### Last Regression Date

**2026-02-23** — Full RBAC regression suite (73 tests, 100% pass). Automated test suites (334 tests, 333 pass).

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
| Total Bugs Identified | 12 |
| Total Resolved | 11 |
| Open Issues | 1 ([#13](https://github.com/pankajexa/21cfrlogbook/issues/13) — low priority) |
| Git Issues Created | 12 (#2–#13) |
| Critical Severity | 0 |
| High Severity | 5 |
| Medium Severity | 4 |
| Low Severity | 2 |

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
| **Current Version** | 2.1.2 |
| **Auto-Sync Documents** | 7 (CHANGELOG, API_GUIDE, task_status, BUSINESS_CONTEXT, CODEBASE_CONTEXT, PLAN, Project_Summary) |
| **Bug Lifecycle** | Enforced (Git issue → fix → Bug_Resolution_Log → close) |
| **Testing Docs** | Centralized at `/documentation/testing/` |
| **Last Full Sync** | 2026-02-25 |

---

## Version History

| Date | Version | Change |
|------|---------|--------|
| 2026-02-25 | 2.1.2 | Git issue lifecycle: 12 bugs converted to GitHub issues (#2–#13), 11 closed, 1 open |
| 2026-02-25 | 2.1.1 | Documentation governance enforcement activated; all 7 core documents auto-synchronized |
| 2026-02-25 | 1.0 | Initial creation — comprehensive project summary reflecting current system state |
