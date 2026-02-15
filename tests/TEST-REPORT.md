# DigiLog Test Report

**Date:** 2026-02-15
**Target:** EC2 (43.205.32.23:3000)
**Result: 217/217 PASSED (100%)**
**Duration:** ~219s

---

## Summary

| Test File | Module | Tests | Status |
|-----------|--------|-------|--------|
| 01-auth.test.ts | Authentication | 27 | PASS |
| 02-users.test.ts | User Management | 36 | PASS |
| 03-config.test.ts | Configuration | 24 | PASS |
| 04-templates.test.ts | Asset Templates | 21 | PASS |
| 05-hierarchy.test.ts | Hierarchy Nodes | 31 | PASS |
| 06-audit.test.ts | Audit Trail | 13 | PASS |
| 07-security.test.ts | Security | 25 | PASS |
| 08-edge-cases.test.ts | Edge Cases | 31 | PASS |
| 09-frontend.test.ts | Frontend | 9 | PASS |
| **Total** | | **217** | **ALL PASS** |

---

## Module Coverage

### 1. Authentication (27 tests)
- Login with valid/invalid credentials
- Empty/missing fields validation
- Non-existent user (no user enumeration)
- Failed attempt tracking (attemptsRemaining)
- Role information in login response
- GET /auth/me with valid/invalid/expired tokens
- Password hash never exposed
- Logout + session invalidation
- Change password (valid, wrong current, mismatch, too short)
- Re-authentication verify endpoint
- Account lockout after max failed attempts
- Lockout blocks even correct password
- Disabled account login rejection

### 2. User Management (36 tests)
- Create user with all roles (ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER)
- forcePasswordChange flag on new users
- Duplicate username/email rejection (409 CONFLICT)
- Username policy (exactly 6 chars, uppercase alphanumeric)
- Email validation, password mismatch, short password, invalid role
- Auth required for user creation
- List with pagination, filter by role/status, search
- Password hash never in list response
- User detail retrieval + 404 handling
- Update fullName, email, role; duplicate email rejection
- Enable/disable with reason (21 CFR Part 11)
- Session invalidation on disable
- Account unlock after lockout
- Password reset with forcePasswordChange
- Soft-delete (status -> DISABLED)
- Self-deletion prevention
- RBAC: OPERATOR/VIEWER/SUPERVISOR denied user management

### 3. Configuration (24 tests)
- Password policy: read + update (min/max length, complexity, history)
- Login security: read + update (max attempts, lockout type/duration)
- Session config: read + update (auto-logout, idle timeout)
- Datetime config: read + update (timezone, format)
- Field ID config: read + update (auto-generate, format, prefix)
- RBAC: only ADMIN/SUPER_ADMIN can read/update config
- Invalid value rejection

### 4. Asset Templates (21 tests)
- Create with attribute + telemetry schemas
- Create with empty schemas
- Name/nodeType validation
- Invalid dataType rejection
- RBAC: OPERATOR/VIEWER denied creation
- List with filter by status/nodeType, search by name
- Detail with version history
- Update with version increment + reason required
- AttributeSchema update
- Reject update without/empty reason
- Soft-delete (status -> inactive) with reason
- 404 handling on all endpoints

### 5. Hierarchy Nodes (31 tests)
- Create root node, child node, node with template
- Template attribute merge (defaults + custom)
- Name/nodeType validation
- Non-existent parentId/templateId rejection
- RBAC: VIEWER denied creation
- List root nodes, filter by parent, full tree
- Node detail with children/parent/template/identifiers
- Ancestor chain traversal
- Update name, attributes, status with reason
- Reject update without reason
- 5 identifier types: QR, RFID, BARCODE, NFC, MANUAL
- Invalid identifier type, empty value rejection
- Reject delete node with children
- Soft-delete leaf (status -> decommissioned)
- 404 handling on all endpoints

### 6. Audit Trail (13 tests)
- List with pagination
- Required fields: id, timestamp, action, targetType, checksum
- Filter by action, targetType, date range
- Pagination (page 2)
- Limit boundary handling
- Auth required
- Detail with checksum
- SHA-256 checksum on all records (64 hex chars)
- IP address recording
- Before/after values on mutations

### 7. Security (25 tests)
- Auth bypass: no header, empty bearer, malformed JWT, tampered payload, tampered signature
- Revoked session token rejection
- SQL injection: login username/password, user search, audit filter
- XSS prevention: stored payload, query params
- RBAC enforcement across all modules:
  - OPERATOR: cannot create users, read config, create templates
  - VIEWER: cannot list users, update config, create nodes
  - SUPERVISOR: cannot update users
  - VIEWER/OPERATOR: CAN read templates, hierarchy, audit
- Rate limiting (20 rapid requests)
- Health endpoint (no auth required)
- CORS preflight headers
- Security headers (content-type)

### 8. Edge Cases (31 tests)
- Invalid JSON body, null body, array body, numeric body
- Username boundary: 5 chars (reject), 6 chars (accept), 7 chars (reject)
- Pagination: page=0, page=-1, limit=0, page=999999
- Unicode in fullName (Japanese characters)
- Emoji in fullName
- Special chars in department, node names, template descriptions
- Non-existent endpoints (404)
- HTTP method validation
- Concurrent user creation (5 parallel)
- Concurrent reads (10 parallel)
- Password cannot be/contain username
- Cannot reuse temporary password
- Role hierarchy: ADMIN can create all roles except SUPER_ADMIN
- Large payloads (50 attributes, 30 attribute fields)

### 9. Frontend (9 tests)
- Main page loads (200)
- HTML content type
- Contains root div
- Vite/React asset loading
- CSS/JS bundles served
- API proxy (/api -> backend)
- Page load < 5s
- Health check < 2s

---

## Server Bugs Discovered

1. **Pagination crashes on invalid values** — `page=0`, `page=-1`, `limit=0` return HTTP 500 instead of 400. Zod validation passes but Prisma crashes on negative skip/zero take.

2. **Audit limit>100 returns 500** — Requesting `?limit=200` crashes the server instead of capping or rejecting.

3. **Empty JSON body rejection** — Fastify rejects POST requests with `Content-Type: application/json` but no body (`FST_ERR_CTP_EMPTY_JSON_BODY`). State-changing endpoints (enable/disable/unlock/delete) require a body with `reason` field.

---

## 21 CFR Part 11 Compliance Observations

- All state changes require `reason` field (audit trail)
- Audit records have SHA-256 checksums (tamper detection)
- Before/after values recorded for mutations
- Password hash never exposed in API responses
- Account lockout after configurable failed attempts
- Force password change on first login / admin reset
- Session invalidation on disable/logout
- Soft deletes only (no physical data destruction)
- IP address recorded in audit trail
- Concurrent session prevention (forceLogin required)
