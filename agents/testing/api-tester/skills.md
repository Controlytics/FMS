# API Tester Agent — Skills & Context

## Identity
**Role:** Backend API testing specialist. Validates all 34 API modules, 200+ endpoints, RBAC enforcement, input validation, error handling, and response schema correctness.
**Scope:** `apps/api/` — routes, services, repositories, plugins, workers.
**Node Types:** 77 rule chain node types across 8 categories

---

## 1. Test Coverage Map

### 1.1 Modules & Endpoints to Test

| Module | Prefix | Priority | Notes |
|--------|--------|----------|-------|
| auth | `/api/auth` | Critical | Login, logout, session, password change, token refresh |
| users | `/api/users` | Critical | CRUD, enable/disable, lock/unlock, password reset |
| roles | `/api/roles` | Critical | Role CRUD with dynamic permissions |
| config | `/api/config` | High | 23 config definitions, auto-discovery |
| audit | `/api/audit` | Critical | Audit trail, integrity check, export |
| assets | `/api/assets` | Critical | Templates, instances, relationships, identifiers |
| data-ingestion | `/api/data` | High | 10-stage pipeline, device credentials |
| rule-chains | `/api/rule-chains` | High | 77 node types, save with temp ID remapping |
| filter-operations | `/api/filters` | High | Cycle lifecycle, checklist enforcement |
| cleaning-profiles | `/api/filter-cleaning-profiles` | High | Pipeline CRUD, graph validation, versioning |
| checklist-profiles | `/api/checklist-profiles` | High | Profile CRUD, question management |
| filter-profiles | `/api/filter-profiles` | High | Filter-to-profile assignment |
| pm-schedules | `/api/pm-schedules` | High | PM scheduling, tolerance windows |
| equipment-groups | `/api/equipment-groups` | Medium | Equipment group CRUD |
| entity-assignments | `/api/entity-assignments` | Medium | Entity-to-group assignments |
| notifications | `/api/notifications` | Medium | In-app + WebSocket |
| notification-rules | `/api/notification-rules` | Medium | Event-based rules |
| queries | `/api/telemetry`, `/api/alarms`, etc. | High | Time-series queries, export |
| connectivity | `/api/connectivity` | Medium | Online/offline tracking |
| uns | `/api/uns` | Medium | ISA-95 mappings |
| backup | `/api/backup` | Medium | Create/restore (JSON/BAK/SQL/CSV) |
| help | `/api/help` | Low | Help articles with versioning |
| qr-code | `/api/qr` | Low | QR generation |
| system-health | `/api/system-health` | Low | Health endpoint |
| uploads | `/api/uploads` | Low | File upload/serve |

### 1.2 Test Infrastructure
- **Framework:** Vitest
- **Location:** `apps/api/src/e2e/` (E2E), `apps/api/src/modules/*/` (unit), `apps/api/src/lib/` (lib)
- **Run command:** `cd /home/ubuntu/21cfrlogbook && npx vitest run --project api`

---

## 2. Testing Categories

### 2.1 Input Validation Testing
For every POST/PUT endpoint, test:
- Required fields missing -> expect 400
- Invalid types -> expect 400
- Null values on nullable/non-nullable fields
- Boundary values (min/max)
- UUID format for ID fields
- SQL injection and XSS attempts

### 2.2 RBAC Testing
52+ permissions across all modules. Test with each of the 6 default roles.
**RBAC hierarchy rule:** `*_MANAGE` implies `*_CREATE`, `*_UPDATE`, `*_DELETE`, `*_VIEW`, `*_READ`, `*_EXPORT`

### 2.3 Response Schema Testing
Verify Fastify response schemas include ALL Prisma model fields.
**High-risk:** Fastify's `fast-json-stringify` silently drops undeclared fields.

### 2.4 Phase 2 Testing
- Filter operations: start cycle, advance, bypass, checklist submission
- Cleaning profiles: create, validate pipeline graph, version
- Checklist profiles: CRUD, question reorder, usage check on delete
- PM schedules: CRUD, monthly entries, tolerance windows
- Equipment groups: CRUD, entity assignments

---

## 3. Test Execution

### 3.1 Running Tests
```bash
cd /home/ubuntu/21cfrlogbook
npx vitest run --project api          # All API tests
npx vitest run --project api -- auth  # Specific module
```

### 3.2 Test Users
| Username | Role | Password |
|----------|------|----------|
| superadmin | SUPER_ADMIN | Admin@123 |

---

## 4. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| API | `http://localhost:3000/api` |
| Default Login | username: `superadmin`, password: `Admin@123` |
| Test Runner | `npx vitest run --project api` |

## Phase 2 Coverage
- Filter management module testing (operations, profiles, cycles, checklists)
- PM scheduling module testing
- Equipment groups and entity assignments testing
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

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
