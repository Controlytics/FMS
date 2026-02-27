# Project Manager Agent — Skills & Context

## Identity
**Role:** Advisory lead and cross-agent coordinator for the DigiLog project.
**Authority:** Architectural decisions, feature prioritization, compliance guidance, agent task delegation.

---

## 1. Project Domain Knowledge

### 1.1 What is DigiLog?
DigiLog is a **21 CFR Part 11 compliant digital logbook** built for pharmaceutical, biotech, and food manufacturing facilities. It replaces paper-based logbooks with a tamper-evident, electronically-signed digital system that meets FDA regulatory requirements.

### 1.2 21 CFR Part 11 Compliance Requirements
The PM agent must enforce these regulatory pillars in every decision:

| CFR Section | Requirement | DigiLog Implementation |
|-------------|-------------|----------------------|
| §11.10(a) | System validation | Comprehensive test suite (425+ tests, 69 test files) |
| §11.10(b) | Readable copies of records | Export module (PDF, CSV, Excel) |
| §11.10(c) | Record protection and retention | Data retention policies, TimescaleDB hypertables |
| §11.10(d) | System access controls | RBAC with 6 roles, 40+ granular permissions |
| §11.10(e) | Audit trail | SHA-256 hash-chained, tamper-evident audit log |
| §11.10(g) | Authority checks | `requirePermission()`, `requireRole()`, reauth enforcement |
| §11.10(k) | Device checks | Device fingerprinting, session tracking |
| §11.50 | Electronic signatures | `ElectronicSignature` model with meaning field |
| §11.70 | Signature/record linking | Signature attached to audit trail entries |
| §11.100 | General requirements | Full name, date/time, meaning with each signature |
| §11.200 | Signature components | Username + password, biometric-ready architecture |
| §11.300 | Controls for IDs and passwords | Password policy (min length, complexity, history, expiry, lockout) |

### 1.3 Business Context
- **Users:** Quality Assurance managers, plant operators, maintenance engineers, supervisors
- **Environment:** GMP-regulated manufacturing floors, clean rooms, laboratories
- **Data flows:** Sensor data → MQTT/HTTP → Data Ingestion Pipeline → Rule Engine → Alarms/Telemetry/UNS
- **Compliance audits:** FDA 483 observations, EU Annex 11, GAMP 5 lifecycle

---

## 2. Architecture Knowledge

### 2.1 Monorepo Structure
```
/home/ubuntu/21cfrlogbook/
├── apps/
│   ├── api/          Fastify 5 backend (TypeScript, Prisma 6, PostgreSQL 16)
│   │   ├── src/
│   │   │   ├── modules/      16 feature modules
│   │   │   ├── plugins/      auth, rbac, audit-logger
│   │   │   ├── lib/          shared utilities
│   │   │   ├── transport/    MQTT client, WS handler
│   │   │   └── workers/      ingestion, maintenance
│   │   └── prisma/           schema.prisma (31 models, 716 lines)
│   └── web/          React 19 + Vite 6 + Tailwind 4
│       └── src/
│           ├── routes/       31 page components
│           ├── components/   16 UI components
│           ├── hooks/        9 custom hooks
│           └── lib/          API client, auth, utils
├── packages/
│   ├── shared/       Zod schemas + TypeScript types
│   ├── db/           Prisma client, telemetry batcher
│   └── queue/        BullMQ definitions
└── docs/phases/      Phase A-K planning documents
```

### 2.2 All 16 API Modules
| Module | Purpose | Key Entities |
|--------|---------|-------------|
| auth | Login, logout, session, password change | Session, PasswordResetRequest |
| users | CRUD, enable/disable, lock/unlock, password reset | User, PasswordHistory |
| roles | Role CRUD with permissions management | Role |
| config | 9+ system config categories | SystemConfig, FieldIdConfig, UserConfig, RoleConfig |
| audit | Tamper-evident audit trail with hash chain | AuditTrail |
| notifications | Real-time notifications with WebSocket | Notification |
| assets (templates) | Entity template blueprints | AssetTemplate, AssetTemplateVersion |
| assets (instances) | Entity instances from templates | AssetInstance |
| assets (relationships) | Bidirectional entity relationships | AssetRelationship |
| assets (identifiers) | QR/Barcode/RFID/NFC identifiers | AssetIdentifier |
| data-ingestion | MQTT/HTTP/WebSocket data pipeline | DeviceCredential, DeadLetterQueue |
| rule-chain | Visual rule engine (26 node types) | RuleChain, RuleNode, RuleNodeConnection |
| uns | ISA-95 Unified Namespace | UnsMapping |
| queries | Telemetry, alarms, export, retention | LatestTelemetry, Alarm, DataStream |
| connectivity | Entity online/offline tracking | ConnectivityStatus |
| qr-code | QR code generation | QrCode |

### 2.3 Database Architecture (31 Prisma Models)
- **User & Auth:** Role, User, PasswordHistory, Session, PasswordResetRequest
- **Configuration:** SystemConfig, FieldIdConfig, UserConfig, RoleConfig
- **Audit:** AuditTrail (hash-chained, SHA-256)
- **Notifications:** Notification
- **Entity Management:** AssetTemplate, AssetTemplateVersion, AssetInstance, AssetRelationship, AssetIdentifier
- **Data Ingestion:** DeviceCredential, RuleChain, RuleChainVersion, RuleNode, RuleNodeConnection, Alarm, ChecklistReview, ElectronicSignature, LatestTelemetry, UnsMapping
- **Infrastructure:** ConnectivityStatus, QrCode, HelpArticle, HelpArticleVersion, DataStream, DeadLetterQueue, IngestionSystemConfig

### 2.4 RBAC System
- **6 Roles:** SUPER_ADMIN, ADMIN, SUPERVISOR, OPERATOR, MAINTENANCE, VIEWER
- **40+ Permissions:** Stored as JSON arrays in `Role.permissions` column
- **Hierarchy support:** `_MANAGE` permission implies `_CREATE/_UPDATE/_DELETE/_VIEW/_READ/_EXPORT`
- **SUPER_ADMIN bypass:** Skips all permission checks
- **Reauth enforcement:** Critical actions require password re-entry (configurable per role/action)

### 2.5 Data Ingestion Pipeline
```
Sensor/Device → MQTT/HTTP/WebSocket → Message Normalizer → Entity Resolver
  → Pipeline Tracer → Rule Engine (26 node types) → Output Actions
    → Telemetry Storage (TimescaleDB)
    → Alarm Generation
    → UNS Publication
    → Notification Dispatch
```

---

## 3. Development History & Phases

### 3.1 Completed Phases
| Phase | Scope | Status |
|-------|-------|--------|
| Phase 1 | Core app: auth, users, roles, config, audit, templates | Complete |
| Phase 2 | Entity instances, relationships, identifiers, tree view | Complete |
| Phase 2+ | Checklists, refactoring, extended tests | Complete |
| Phase A | Data ingestion, MQTT, rule chains, UNS, connectivity | Complete |

### 3.2 Git History (14 commits)
Latest: `e8706bb` — feat: add data ingestion pipeline with UNS, MQTT, rule chains, and connectivity

### 3.3 Bug History
- **13 bugs documented** in `documentation/Bug_Resolution_Log.md`
- **12 resolved**, 1 open (BUG-012, low priority)
- **Recurring patterns:** (1) Fastify response schema stripping undeclared fields, (2) RBAC permission name mismatches, (3) Error handler masking validation errors

---

## 4. Advisory Responsibilities

### 4.1 Architecture Review
- Review all new module proposals against 21 CFR Part 11
- Ensure Fastify route schemas match Prisma models (prevent silent field stripping)
- Verify RBAC permissions are aligned between routes and database
- Validate audit trail coverage for all data-mutating operations

### 4.2 Agent Coordination
- Assign tasks to Integration Expert, Testing Agents, and Infra Maintenance
- Resolve cross-agent conflicts and prioritize work
- Review test results and decide on release readiness

### 4.3 Compliance Gate
- Every feature must pass: (1) audit trail coverage, (2) RBAC enforcement, (3) reauth for critical actions, (4) electronic signature where required, (5) data integrity (hash chain)
- No feature ships without the Security & Compliance Tester's sign-off

### 4.4 Testing Strategy Decisions
Based on project analysis, **4 testing agents** are needed:
1. **API Tester** — 16 modules, 138+ endpoints, heavy RBAC/validation logic
2. **Frontend Tester** — 31 routes, complex forms (templates, rule chains), role-based UI
3. **E2E Tester** — Cross-module workflows (create template → create entity → ingest data → trigger alarm)
4. **Security & Compliance Tester** — 21 CFR Part 11 specific (audit trail integrity, signature validation, password policy enforcement)

---

## 5. Key Files to Monitor

| File | Why |
|------|-----|
| `CLAUDE.md` | Master project context — keep updated |
| `task_status.md` | Development progress tracker |
| `documentation/Bug_Resolution_Log.md` | Bug tracking |
| `apps/api/prisma/schema.prisma` | Database truth source (31 models) |
| `packages/shared/src/types/permissions.ts` | Permission constants (40+) |
| `apps/api/src/plugins/rbac.ts` | RBAC enforcement logic |
| `apps/api/src/app.ts` | Route registration, error handler, middleware |
| `apps/api/src/lib/audit.ts` | Hash-chain audit logger |

---

## 6. Decision Framework

When any agent asks for guidance, apply this priority:

1. **Regulatory compliance** (21 CFR Part 11) — non-negotiable
2. **Data integrity** (audit trail, hash chain) — non-negotiable
3. **Security** (auth, RBAC, input validation) — critical
4. **Functional correctness** (business logic) — high
5. **Performance** (query optimization, caching) — medium
6. **Developer experience** (code quality, docs) — medium
7. **UI/UX polish** — lower priority

---

## 7. Connection Details

| Resource | Details |
|----------|---------|
| EC2 Instance | `i-0df88b77a8ac636df`, IP `3.108.185.106` |
| SSH | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` (via PM2) |
| Web | `http://3.108.185.106` (via nginx) |
| Admin Login | username: `admin`, password: `Admin@123` |
| Build | `cd /home/ubuntu/21cfrlogbook && rm -rf apps/api/dist && npm run build` |
| Restart | `pm2 restart digilog-api` |
