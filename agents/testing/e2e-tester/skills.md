# E2E Tester Agent — Skills & Context

## Identity
**Role:** End-to-end integration testing specialist. Validates complete user workflows that span multiple modules, from frontend actions through API calls to database state changes.
**Scope:** Cross-module user journeys, regression testing, workflow validation.
**Last E2E Run:** 2026-03-09 — 20-step workflow (Login→Template→Entity→RuleChain→Telemetry→Alarm lifecycle) all PASS.

---

## 1. Core Responsibility

Test **complete user workflows** that cross module boundaries. While the API Tester tests individual endpoints and the Frontend Tester tests individual pages, the E2E Tester validates that the full chain works together.

```
User Action → Frontend → API → Service → Repository → Database
                                  ↕               ↕
                            RBAC/Reauth      Audit Trail
                                  ↕
                          Notification/MQTT
```

---

## 2. Critical Workflows to Test

### 2.1 User Lifecycle (Priority: Critical)
```
SUPER_ADMIN creates user
  → User receives temporary password
    → User logs in (forced password change)
      → User changes password (meets policy)
        → User logs in with new password
          → User performs role-based actions
            → ADMIN disables user
              → User login rejected (DISABLED)
                → ADMIN enables user
                  → User login works again
                    → ADMIN resets password
                      → User logs in with reset password
```

**Validate at each step:**
- Correct HTTP status codes
- Audit trail entry created
- Password history updated
- Session invalidated on disable
- Notification sent on password reset

### 2.2 Entity Template → Instance → Data Flow (Priority: Critical)
```
ADMIN creates template (with MQTT data ingestion)
  → ADMIN creates entity instance from template
    → System generates device credentials
      → Device publishes MQTT telemetry
        → Ingestion pipeline processes message
          → Rule engine evaluates rules
            → Telemetry stored in TimescaleDB
              → Alarm triggered (if threshold exceeded)
                → Notification sent to subscribed users
                  → UNS path updated
```

**Validate at each step:**
- Template created with correct schema
- Instance inherits template attributes
- Device credentials generated
- MQTT message accepted
- Telemetry visible in queries
- Alarm lifecycle (ACTIVE → ACKNOWLEDGED → CLEARED)

### 2.3 RBAC Full Cycle (Priority: Critical)
```
SUPER_ADMIN creates custom role with specific permissions
  → SUPER_ADMIN creates user with that role
    → User logs in
      → User tests allowed operations (should succeed)
        → User tests denied operations (should get 403)
          → SUPER_ADMIN modifies role permissions
            → User's next request reflects new permissions
```

### 2.4 Configuration Change Propagation (Priority: High)
```
SUPER_ADMIN changes password policy
  → Next user creation enforces new policy
    → Next password change enforces new policy

ADMIN changes branding
  → All users see new branding on next load

ADMIN changes session timeout
  → All active sessions respect new timeout
```

### 2.5 Template Versioning Workflow (Priority: High)
```
ADMIN creates template v1
  → Creates entities from v1
    → ADMIN updates template (creates v2)
      → Existing entities still reference v1 data
        → New entities use v2
          → Version history shows both v1 and v2
```

### 2.6 Entity Relationship Tree (Priority: High)
```
Create parent entity (e.g., Building)
  → Create child entity (e.g., Floor)
    → Create grandchild (e.g., Room)
      → Create relationship (Room CONTAINS Equipment)
        → Verify tree diagram shows hierarchy
          → Move entity in tree
            → Verify relationship updated
              → Delete entity
                → Verify children reassigned or deleted
```

### 2.7 Audit Trail Integrity (Priority: Critical)
```
Perform 10 sequential actions (create users, templates, entities)
  → Fetch audit trail
    → Verify hash chain integrity (each entry's hash depends on previous)
      → Verify no gaps in sequence
        → Verify timestamps are monotonic
          → Verify actor matches logged-in user
            → Export audit trail
              → Verify export contains all entries
```

### 2.8 Backup & Restore (Priority: High)
```
Create data (users, templates, entities)
  → Create backup
    → Modify/delete data
      → Restore backup
        → Verify data matches pre-backup state
```

### 2.9 Password Policy Enforcement (Priority: Critical)
```
Set policy: min 8 chars, uppercase, lowercase, number, special, no reuse of last 5

Test:
  → Create user with weak password → rejected
  → Create user with valid password → accepted
  → Change password to same as current → rejected (reuse)
  → Change password to one of last 5 → rejected
  → Change password to valid new one → accepted
  → After password expiry → forced change on login
```

### 2.10 Multi-User Concurrent Access (Priority: Medium)
```
User A and User B both logged in
  → User A edits template
    → User B views same template → sees old version
      → User A saves
        → User B refreshes → sees updated version
          → User B tries to edit (session conflict?) → handled gracefully
```

---

## 3. Test Execution

### 3.1 Existing E2E Tests
```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106
cd /home/ubuntu/21cfrlogbook

# Run all E2E tests
npx vitest run --project api -- e2e

# Specific E2E test
npx vitest run apps/api/src/e2e/auth.test.ts
npx vitest run apps/api/src/e2e/users.test.ts
npx vitest run apps/api/src/e2e/entities.test.ts
```

**Existing E2E test files (14):**
- `auth.test.ts` — login/logout/session flows
- `users.test.ts` — user CRUD lifecycle
- `roles.test.ts` — role management
- `config.test.ts` — configuration changes
- `audit.test.ts` — audit trail queries
- `notifications.test.ts` — notification delivery
- `entities.test.ts` — entity CRUD
- `connectivity.test.ts` — device connectivity
- `checklist-templates.test.ts` — checklist workflows
- `help-articles.test.ts` — help content
- `qr-codes.test.ts` — QR generation
- `rule-chains.test.ts` — rule chain management
- `system-health.test.ts` — health endpoint
- `health.test.ts` — basic health check

### 3.2 Manual Workflow Testing
```bash
BASE="http://localhost:3000/api"

# Login as admin
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Chain API calls to test workflows
# Example: Create template → Create instance → Verify
```

### 3.3 Database State Verification
```bash
# After each workflow step, verify DB state
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "
  SELECT * FROM audit_trails ORDER BY created_at DESC LIMIT 5;
"
```

---

## 4. Regression Test Triggers

Run E2E tests when:
- Any route file changes
- Any service file changes
- Prisma schema changes
- RBAC plugin changes
- Auth plugin changes
- Error handler changes
- Shared package (Zod schemas) changes

---

## 5. Test Data Management

### 5.1 Test Users
| Username | Role | Password | Purpose |
|----------|------|----------|---------|
| admin | SUPER_ADMIN | Admin@123 | Primary test account |
| RB0002 | ADMIN | Test@1234 | RBAC testing |
| RB0001 | OPERATOR | Test@1234 | RBAC testing |
| RB0003 | VIEWER | Test@1234 | RBAC testing |

### 5.2 Cleanup Protocol
After each E2E test run:
1. Delete test-created templates
2. Delete test-created entities
3. Delete test-created users (except core test users)
4. Verify no orphaned records in relationship tables

---

## 6. Reporting

After each test run, produce:
1. **Workflow Status:** PASS/FAIL for each workflow
2. **Step-by-Step:** Which step failed and why
3. **Regression Check:** Any previously-passing workflows that now fail
4. **Data State:** Any inconsistencies found in DB
5. **New Bugs:** File as BUG-NNN in `documentation/Bug_Resolution_Log.md`

---

## 7. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://3.108.185.106` |
| Admin | username: `admin`, password: `Admin@123` |
