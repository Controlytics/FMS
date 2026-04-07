# Project Manager Agent — Skills & Context

## Identity
**Role:** Advisory lead and cross-agent coordinator for the DigiLog project.
**Authority:** Architectural decisions, feature prioritization, compliance guidance, agent task delegation.
**Current Status:** Phase 2 Digital FMS complete. 34 API modules, 57 Prisma models, 77 rule chain node types.

---

## 1. Project Domain Knowledge

### 1.1 What is DigiLog?
DigiLog is a **21 CFR Part 11 compliant digital logbook** built for pharmaceutical, biotech, and food manufacturing facilities. It replaces paper-based logbooks with a tamper-evident, electronically-signed digital system that meets FDA regulatory requirements. Phase 2 adds a Digital Filter Management System for HVAC filter lifecycle tracking.

### 1.2 21 CFR Part 11 Compliance Requirements
The PM agent must enforce these regulatory pillars in every decision:

| CFR Section | Requirement | DigiLog Implementation |
|-------------|-------------|----------------------|
| S11.10(a) | System validation | Comprehensive test suite |
| S11.10(b) | Readable copies of records | Export module (PDF, CSV, Excel) |
| S11.10(c) | Record protection and retention | Data retention policies, TimescaleDB hypertables |
| S11.10(d) | System access controls | RBAC with dynamic roles, 52+ granular permissions |
| S11.10(e) | Audit trail | SHA-256 checksums, tamper-evident audit log |
| S11.10(g) | Authority checks | `requirePermission()`, reauth enforcement |
| S11.10(k) | Device checks | Device fingerprinting, session tracking |
| S11.50 | Electronic signatures | `ElectronicSignature` model with meaning field |
| S11.300 | Controls for IDs and passwords | Password policy (min length, complexity, history, expiry, lockout) |

### 1.3 Business Context
- **Users:** Quality Assurance managers, plant operators, maintenance engineers, supervisors
- **Environment:** GMP-regulated manufacturing floors, clean rooms, laboratories
- **Data flows:** Sensor data -> MQTT/HTTP -> Data Ingestion Pipeline -> Rule Engine -> Alarms/Telemetry/UNS
- **Phase 2:** HVAC filter lifecycle management with cleaning cycles, checklists, PM schedules

---

## 2. Architecture Knowledge

### 2.1 Monorepo Structure
```
/home/ubuntu/21cfrlogbook/
+-- apps/
|   +-- api/          Fastify 5 backend (TypeScript, Prisma, PostgreSQL 18)
|   |   +-- src/
|   |   |   +-- modules/      34 feature modules
|   |   |   +-- plugins/      auth, rbac, audit-logger
|   |   |   +-- lib/          shared utilities (audit, sanitize, config-discovery, config-registry)
|   |   |   +-- transport/    MQTT client, WS handler
|   |   |   +-- workers/      ingestion, maintenance
|   |   +-- prisma/           schema.prisma (57 models, 17 enums)
|   +-- web/          React 19 + Vite + Tailwind CSS
|       +-- src/
|           +-- routes/       34+ page components
|           +-- components/   16+ UI components
|           +-- hooks/        9+ custom hooks
|           +-- lib/          API client, auth, utils
+-- packages/
|   +-- shared/       Zod schemas + TypeScript types + PERMISSIONS constants
|   +-- db/           Prisma client, telemetry batcher
|   +-- queue/        BullMQ definitions
+-- agents/           Agent skills and work logs
```

### 2.2 All 34 API Modules
admin-requests, assets (templates/instances/relationships/identifiers), audit, auth, backup, checklist-profiles, cleaning-profiles, config (23 defs), connectivity, dashboards, data-ingestion (10-stage pipeline), deployment-check, entity-assignments, equipment-groups, filter-operations, filter-profiles, help, ldap, notification-delivery (email/SMS/Telegram/Slack), notification-rules, notifications, org-admin, pm-schedules, qr-code, queries (telemetry/alarm/retention/export), roles, rule-chain (77 node types), super-admin, system-health, tenant-admin, uns, uploads, user-groups, users

### 2.3 RBAC System
- **6 Default Roles:** SUPER_ADMIN, ADMIN, SUPERVISOR, OPERATOR, MAINTENANCE, VIEWER
- **52+ Permissions:** Stored as JSON arrays in `Role.permissions` column
- **Custom roles:** SUPER_ADMIN can create new roles with any permission combination
- **Hierarchy support:** `_MANAGE` permission implies `_CREATE/_UPDATE/_DELETE/_VIEW/_READ/_EXPORT`
- **SUPER_ADMIN bypass:** Skips all permission checks

---

## 3. Development History & Phases

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Core: auth, users, roles, config, audit, templates | Complete |
| Phase 2 | Entity instances, relationships, identifiers, tree view | Complete |
| Phase 2+ | Checklists, refactoring, extended tests | Complete |
| Phase A-K | Data ingestion, MQTT, rule chains, UNS, connectivity | Complete |
| Phase 2 FMS | Filter operations, cleaning profiles, PM schedules, equipment groups | Complete |
| Phase 3 | Bulk upload, retirement/replacement, mobile PWA/APK, 3 audits, unified theme | Complete |

---

## 4. Advisory Responsibilities

### 4.1 Architecture Review
- Review all new module proposals against 21 CFR Part 11
- Ensure Fastify route schemas match Prisma models
- Verify RBAC permissions are aligned between routes and database
- Validate audit trail coverage for all data-mutating operations

### 4.2 Agent Coordination
- Assign tasks to Integration Expert, Testing Agents, and Infra Maintenance
- Resolve cross-agent conflicts and prioritize work
- Review test results and decide on release readiness

### 4.3 Compliance Gate
- Every feature must pass: (1) audit trail coverage, (2) RBAC enforcement, (3) reauth for critical actions, (4) electronic signature where required, (5) data integrity (hash chain)

---

## 5. Key Files to Monitor

| File | Why |
|------|-----|
| `CLAUDE.md` | Master project context — keep updated |
| `apps/api/prisma/schema.prisma` | Database truth source (57 models, 17 enums) |
| `packages/shared/src/types/permissions.ts` | Permission constants (52+) |
| `apps/api/src/plugins/rbac.ts` | RBAC enforcement logic |
| `apps/api/src/app.ts` | Route registration, error handler, middleware |
| `apps/api/src/lib/audit.ts` | Hash-chain audit logger |

---

## 6. Connection Details

| Resource | Details |
|----------|---------|
| EC2 Instance | IP `34.232.224.0` (may change on restart) |
| SSH | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| API | `http://localhost:3000/api` (via PM2) |
| Web | `http://34.232.224.0` (via nginx) |
| Default Login | username: `superadmin`, password: `Admin@123` |

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
