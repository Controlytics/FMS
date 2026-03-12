# API Tester Agent — Skills & Context

## Identity
**Role:** Backend API testing specialist. Validates all 16 API modules, 145+ endpoints, RBAC enforcement, input validation, error handling, and response schema correctness.
**Scope:** `apps/api/` — routes, services, repositories, plugins, workers.
**Node Types:** 48 rule chain node types across 9 categories (validated 2026-03-09)
**Known Issues:** Route conflicts on /stats endpoints (BUG-V003, BUG-V004), missing connectivity list (BUG-V005)

---

## 1. Test Coverage Map

### 1.1 Modules & Endpoints to Test

| Module | Prefix | Endpoints | Priority | Existing Tests |
|--------|--------|-----------|----------|---------------|
| auth | `/api/auth` | login, logout, session, change-password, forgot-password, validate-token, refresh, me | Critical | `e2e/auth.test.ts` |
| users | `/api/users` | list, get, create, update, delete, enable, disable, lock, unlock, reset-password, bulk | Critical | `e2e/users.test.ts`, `modules/users/*.test.ts` |
| roles | `/api/roles` | list, get, create, update, delete, active, permissions | Critical | `e2e/roles.test.ts`, `modules/roles/*.test.ts` |
| config | `/api/config` | get/set for 9+ keys (password-policy, session, datetime, branding, user-id, pagination, sidebar, action-reauth, audit-templates) | High | `e2e/config.test.ts` |
| audit | `/api/audit` | list, get, export, integrity-check | Critical | `e2e/audit.test.ts` |
| templates | `/api/assets/templates` | list, get, create, update, delete, versions | Critical | `modules/assets/template.*.test.ts` |
| instances | `/api/assets/instances` | list, get, create, update, delete, tree, move | Critical | `modules/assets/instance.*.test.ts` |
| relationships | `/api/assets/relationships` | list, create, delete, types | High | `modules/assets/relationship.*.test.ts` |
| identifiers | `/api/assets/identifiers` | list, create, delete, verify | High | `modules/assets/identifier.*.test.ts` |
| notifications | `/api/notifications` | list, get, mark-read, unread-count, delete, ws | Medium | `e2e/notifications.test.ts` |
| data-ingestion | `/api/data` | publish, device-credentials, DLQ, system-config | High | `modules/data-ingestion/*.test.ts` |
| rule-chains | `/api/rule-chains` | list, get, create, update, delete, nodes, connections, debug | High | `modules/rule-chain/*.test.ts` |
| uns | `/api/uns` | mappings, tree, lookup | Medium | `modules/uns/*.test.ts` |
| queries | `/api/...` | telemetry, alarms, export, retention | High | `queries/*.test.ts` |
| connectivity | `/api/connectivity` | status, history, list | Medium | `e2e/connectivity.test.ts` |
| qr-code | `/api/qr` | generate, get, list, delete | Low | `e2e/qr-codes.test.ts` |
| help | `/api/help` | list, get, create, update, delete, versions | Low | `e2e/help-articles.test.ts` |
| system-health | `/api/system-health` | health | Low | `e2e/system-health.test.ts` |
| backup | `/api/backup` | create, list, restore | Medium | `modules/backup/*.test.ts` |
| uploads | `/api/uploads` | upload, serve | Low | — |

### 1.2 Existing Test Infrastructure
- **Framework:** Vitest
- **Location:** `apps/api/src/e2e/` (E2E), `apps/api/src/modules/*/` (unit), `apps/api/src/lib/` (lib)
- **Count:** 69+ test files, 1,344 test cases (0 failures)
- **Run command:** `cd /home/ubuntu/21cfrlogbook && npx vitest run --project api`

---

## 2. Testing Categories

### 2.1 Input Validation Testing
For every POST/PUT endpoint, test:
- **Required fields missing** — expect 400
- **Invalid types** (string where number expected) — expect 400
- **Null values on nullable fields** — expect 200 (pass-through)
- **Null values on non-nullable fields** — expect 400
- **Empty strings** — verify behavior (some should reject, some allow)
- **Boundary values** (min/max length, min/max numbers)
- **UUID format** for ID fields
- **Email format** for email fields
- **SQL injection attempts** in string fields
- **XSS attempts** in string fields

**Template-specific validation:**
```
transportType: null | "MQTT" | "HTTP" | "WEBSOCKET"  (nullable enum)
credentialType: null | "TOKEN" | "X509"               (nullable enum)
defaultRuleChainId: null | uuid-string                 (nullable UUID)
category: "EQUIPMENT" | "AREA" | "PROCESS" | "INSTRUMENT" | "OTHER"  (required enum)
```

### 2.2 RBAC Testing
For every protected endpoint, test with each role:

| Role | Permissions |
|------|------------|
| SUPER_ADMIN | All (bypasses checks) |
| ADMIN | USER_*, CONFIG_*, AUDIT_READ, ASSET_TEMPLATE_MANAGE, ASSET_CREATE/UPDATE/DELETE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE, ASSET_VIEW |
| SUPERVISOR | AUDIT_READ, APPROVAL_REVIEW, ASSET_VIEW, ASSET_CREATE |
| OPERATOR | AUDIT_READ, ASSET_VIEW |
| MAINTENANCE | AUDIT_READ, APPROVAL_REQUEST, ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE |
| VIEWER | AUDIT_READ, ASSET_VIEW |

**RBAC hierarchy rule:** `*_MANAGE` implies `*_CREATE`, `*_UPDATE`, `*_DELETE`, `*_VIEW`, `*_READ`, `*_EXPORT`

**Test pattern:**
```bash
# For each role, login and test:
# 1. Allowed endpoints → expect 200
# 2. Denied endpoints → expect 403
# 3. Unauthenticated → expect 401
```

### 2.3 Response Schema Testing
Verify Fastify response schemas include ALL Prisma model fields:

```bash
# Pattern: Compare Prisma model fields with route response schema properties
# If Prisma has field X but route schema doesn't declare X,
# fast-json-stringify will silently strip X from the response
```

**High-risk endpoints (have had schema stripping bugs):**
- `GET /api/assets/templates` — must include data ingestion fields
- `GET /api/assets/templates/:id` — must include ALL fields
- `GET /api/users` — must include all user fields
- `GET /api/roles` — must include permissions

### 2.4 Error Handler Testing
```
Validation errors → 400 VALIDATION_ERROR (not INTERNAL_ERROR)
Auth errors → 401 UNAUTHORIZED
Permission errors → 403 FORBIDDEN
Not found → 404 NOT_FOUND
Business logic errors → 400/409 with specific error codes
Server errors → 500 INTERNAL_ERROR (only for real server errors)
```

### 2.5 Reauth Testing
Critical actions require password re-authentication:
- Template create/update/delete
- User create/update/delete
- Config changes
- Password changes

**Test:** Send request with and without `x-reauth-password` header or `_currentPassword` body field.

---

## 3. Test Execution

### 3.1 Running Existing Tests
```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

cd /home/ubuntu/21cfrlogbook

# All API tests
npx vitest run --project api

# Specific module
npx vitest run --project api -- auth
npx vitest run --project api -- template

# Specific file
npx vitest run apps/api/src/e2e/auth.test.ts
```

### 3.2 Manual API Testing
```bash
BASE="http://localhost:3000/api"

# Login
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Test any endpoint
curl -s "$BASE/assets/templates" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### 3.3 Test Users Available
| Username | Role | Password |
|----------|------|----------|
| admin | SUPER_ADMIN | Admin@123 |
| RB0002 | ADMIN | Test@1234 |
| RB0001 | OPERATOR | Test@1234 |
| RB0003 | VIEWER | Test@1234 |

---

## 4. Known Bugs & Patterns

### 4.1 Recurring Bug Pattern: Response Schema Stripping
**BUG-001, BUG-006, BUG-007:** Fastify's `fast-json-stringify` silently drops any response field not declared in the route schema. When new fields are added to Prisma models, they must also be added to route response schemas.

### 4.2 Recurring Bug Pattern: Null Handling
**BUG (template routes):** Fastify body schemas must explicitly allow null for nullable fields using `oneOf: [{type: 'string', enum: [...]}, {type: 'null'}]`.

### 4.3 Known Open Bug
**BUG-012:** Auth test expects `INVALID_CREDENTIALS` error code but gets generic `Unauthorized`. Low priority.

---

## 5. Reporting

After each test run, report:
1. **Summary:** X passed, Y failed, Z skipped
2. **Failures:** Endpoint, expected vs actual, error message
3. **New bugs:** File as BUG-NNN in `documentation/Bug_Resolution_Log.md`
4. **Regressions:** Flag any previously-passing tests that now fail

---

## 6. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Admin | username: `admin`, password: `Admin@123` |
| Test Runner | `npx vitest run --project api` |
