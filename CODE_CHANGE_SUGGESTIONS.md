# DigiLog — Code Change Suggestions Document

**Date:** 2026-02-15
**Branch:** `feature/user-id-config`
**Test Results:** 217/217 passed (9 test files, 265.95s)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Critical — 21 CFR Part 11 Compliance Violations](#2-critical--21-cfr-part-11-compliance-violations)
3. [Critical — Security Vulnerabilities](#3-critical--security-vulnerabilities)
4. [High — Backend Issues](#4-high--backend-issues)
5. [High — Frontend Issues](#5-high--frontend-issues)
6. [Medium — Performance & Code Quality](#6-medium--performance--code-quality)
7. [Medium — Test Suite Gaps](#7-medium--test-suite-gaps)
8. [Low — Improvements & Cleanup](#8-low--improvements--cleanup)
9. [Summary Matrix](#9-summary-matrix)

---

## 1. Executive Summary

All 217 tests pass across 9 test files, but thorough code and test review reveals **6 critical**, **10 high**, **16 medium**, and **8 low** severity issues. The most pressing items are 21 CFR Part 11 compliance gaps that could block regulatory approval.

| Severity | Count | Category |
|----------|-------|----------|
| CRITICAL | 6 | Regulatory compliance, auth secrets |
| HIGH | 10 | Security, missing audit, RBAC gaps |
| MEDIUM | 16 | Performance, validation, test coverage |
| LOW | 8 | Code quality, UX, cleanup |

---

## 2. Critical — 21 CFR Part 11 Compliance Violations

### 2.1 SUPER_ADMIN Actions Excluded from Audit Trail

**File:** `apps/api/src/plugins/audit-logger.ts` ~Line 30
**File:** `apps/api/src/modules/config/routes.ts` ~Line 84

```typescript
// audit-logger.ts
if (entry.userRole === 'SUPER_ADMIN') return; // <-- SKIPS audit logging entirely
```

**Problem:** 21 CFR Part 11 Section 11.10(e) requires a complete audit trail for ALL system changes. SUPER_ADMIN users can modify password policies, login security, session config, field IDs, and user accounts with zero audit record.

**Fix:**
```typescript
// Remove the early return. Log all actions regardless of role.
// If needed, add a flag: `privilegedAction: true` to distinguish.
```

---

### 2.2 Audit Trail Not Immutable at Database Level

**File:** `apps/api/prisma/schema.prisma` — `AuditTrail` model

**Problem:** No database-level constraint prevents UPDATE or DELETE on audit records. Anyone with DB access (or a future bug) can alter history. 21 CFR Part 11 Section 11.10(e) requires records be immutable.

**Fix:**
- Add a PostgreSQL trigger to prevent UPDATE/DELETE on `audit_trails` table.
- Restrict the application's DB role to INSERT + SELECT only on this table.

```sql
CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit trail records cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_trail_immutable
BEFORE UPDATE OR DELETE ON audit_trails
FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();
```

---

### 2.3 Password Policy Not Fully Enforced During Password Change

**File:** `apps/api/src/modules/auth/routes.ts` ~Lines 240-260

**Problem:** The password change endpoint only checks:
- `cannotBeUserId` (password = username)
- `cannotContainUserId` (password contains username)
- Password history reuse

It does NOT enforce:
- `minLength` from DB config (only the Zod schema's hardcoded min 8)
- `requireUppercase`, `requireLowercase`, `requireNumbers`, `requireSpecialChars`
- `minUppercase`, `minLowercase`, `minNumbers`, `minSpecialChars`
- `maxLength`

**Fix:** Add a `validatePasswordPolicy()` function that reads `SystemConfig` and validates all policy rules:

```typescript
async function validatePasswordPolicy(password: string, username: string): Promise<string | null> {
  const config = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
  const policy = config?.configValue as PasswordPolicy;
  if (!policy) return null;

  if (password.length < policy.minLength) return `Minimum ${policy.minLength} characters required`;
  if (policy.maxLength && password.length > policy.maxLength) return `Maximum ${policy.maxLength} characters`;
  if (policy.requireUppercase && (password.match(/[A-Z]/g) || []).length < (policy.minUppercase || 1))
    return `Minimum ${policy.minUppercase || 1} uppercase letter(s) required`;
  // ... repeat for lowercase, numbers, special chars
  if (policy.cannotBeUserId && password === username) return 'Password cannot be same as User ID';
  if (policy.cannotContainUserId && password.toLowerCase().includes(username.toLowerCase()))
    return 'Password cannot contain User ID';
  return null;
}
```

---

### 2.4 Password Expiration Field Exists But Never Enforced

**File:** `apps/api/prisma/schema.prisma` — `User.passwordExpiresAt`
**File:** `apps/api/src/modules/auth/routes.ts` — login handler

**Problem:** The `passwordExpiresAt` field exists in the schema but is never checked during login. Expired passwords should force a password change per 21 CFR Part 11 Section 11.300.

**Fix:** In the login handler, after successful password verification:
```typescript
if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
  // Either block login or set forcePasswordChange
  await prisma.user.update({
    where: { id: user.id },
    data: { status: 'EXPIRED', forcePasswordChange: true },
  });
  return reply.code(403).send({
    error: 'PASSWORD_EXPIRED',
    message: 'Password has expired. Please change your password.',
    forcePasswordChange: true,
  });
}
```

---

### 2.5 Checksum Computed But Never Verified

**File:** `apps/api/src/plugins/audit-logger.ts` — checksum computation
**File:** `apps/api/src/modules/audit/routes.ts` — no verification endpoint

**Problem:** Audit records have SHA-256 checksums for tamper detection, but there is no API endpoint to verify integrity. 21 CFR Part 11 requires the ability to detect tampering.

**Fix:** Add a verification endpoint:

```typescript
// GET /api/audit/:id/verify
app.get('/:id/verify', async (req, reply) => {
  const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
  if (!record) return reply.code(404).send({ error: 'Not found' });

  const recomputed = computeChecksum({
    timestamp: record.timestamp.toISOString(),
    userId: record.userId,
    action: record.action,
    targetId: record.targetId,
    afterValue: record.afterValue,
  });

  return { valid: record.checksum === recomputed, stored: record.checksum, computed: recomputed };
});
```

---

### 2.6 Re-authentication Not Implemented for Sensitive Operations

**File:** `apps/web/src/routes/config/index.tsx` ~Lines 5-10

**Problem:** Config cards have `reauth: true` flag but re-authentication is never actually enforced. Users can change password policy, login security, and session config without re-entering their password. 21 CFR Part 11 Section 11.10(d) requires this for sensitive operations.

**Fix:** Implement a re-authentication modal that calls `POST /api/auth/verify` before allowing config changes. Store the verification token and include it in the config update request. Backend should validate the verification token on config update endpoints.

---

## 3. Critical — Security Vulnerabilities

### 3.1 Weak JWT Secret Fallback

**File:** `apps/api/src/lib/jwt.ts` Lines 3-4

```typescript
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');
const VERIFY_SECRET = new TextEncoder().encode(process.env.VERIFICATION_TOKEN_SECRET ?? 'dev-verify-secret');
```

**Problem:** If env vars are not set, predictable defaults are used. An attacker could forge tokens.

**Fix:** Fail at startup if secrets are missing:
```typescript
if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is required');
if (!process.env.VERIFICATION_TOKEN_SECRET) throw new Error('VERIFICATION_TOKEN_SECRET is required');
```

---

### 3.2 JWT Stored in localStorage (XSS-Vulnerable)

**File:** `apps/web/src/lib/api-client.ts` Lines 4-6

```typescript
private getToken(): string | null {
  return localStorage.getItem('access_token');
}
```

**Problem:** Any XSS vulnerability allows token theft. localStorage is accessible to all JavaScript in the origin.

**Fix:** Switch to HttpOnly, Secure, SameSite=Strict cookies. The backend should set the cookie on login and the frontend should stop managing tokens directly.

---

### 3.3 No CSRF Protection

**Problem:** All state-changing requests (POST/PUT/DELETE) lack CSRF tokens. Combined with cookie-based auth (if switched per 3.2), this becomes critical.

**Fix:** Implement double-submit cookie pattern or synchronizer token pattern. Fastify has `@fastify/csrf-protection` plugin.

---

## 4. High — Backend Issues

### 4.1 User Enumeration via Timing Attack

**File:** `apps/api/src/modules/auth/routes.ts` ~Lines 18-26

**Problem:** Non-existent users return 401 immediately (no bcrypt comparison). Existing users with wrong password take ~200-300ms (bcrypt hash). Timing difference reveals user existence.

**Fix:** Add a dummy bcrypt comparison for non-existent users:
```typescript
if (!user) {
  await verifyPassword(password, '$2b$12$dummy.hash.that.takes.same.time');
  return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Invalid user ID or password.' });
}
```

---

### 4.2 Physical Identifier Creation Not Audited

**File:** `apps/api/src/modules/hierarchy/routes.ts` ~Lines 232-236

**Problem:** Adding QR/RFID/NFC identifiers to nodes is a mutation with no audit trail entry. Identifier assignments are critical for asset tracking.

**Fix:** Add `app.auditLog()` call after identifier creation with action `NODE_IDENTIFIER_ADDED`.

---

### 4.3 Hardcoded Session/JWT Expiry (Should Be Configurable)

**File:** `apps/api/src/lib/jwt.ts` Line 17 — `'8h'`
**File:** `apps/api/src/modules/auth/routes.ts` Line 134 — `8 * 60 * 60 * 1000`

**Problem:** Session and JWT expiry are hardcoded to 8 hours. The `session` config in SystemConfig has `idleTimeoutMinutes` but is only used on the frontend. Backend never reads it.

**Fix:** Read session config from DB and use it for both JWT and session expiry.

---

### 4.4 createdBy Field Inconsistency (username vs UUID)

**File:** `apps/api/src/modules/users/routes.ts` ~Line 46

```typescript
createdBy: req.user.username,  // <-- uses username
```

**File:** `apps/api/src/modules/hierarchy/routes.ts` ~Line 86
**File:** `apps/api/src/modules/templates/routes.ts` ~Line 44

```typescript
createdBy: req.user.sub,  // <-- uses UUID
```

**Problem:** `createdBy` stores username in users module but UUID in hierarchy/templates. This makes cross-referencing impossible.

**Fix:** Standardize on `req.user.sub` (UUID) across all modules, or `req.user.username` if the field is varchar. Pick one and be consistent.

---

### 4.5 Missing Rate Limiting on Login Endpoint

**File:** `apps/api/src/app.ts` ~Line 28

**Problem:** Global rate limit of 100 req/min is too permissive for `/api/auth/login`. Allows ~100 password guesses per minute.

**Fix:** Add per-route rate limiting:
```typescript
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

// On login route specifically:
{ config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
```

---

### 4.6 Missing Error Handling in Audit Logger

**File:** `apps/api/src/plugins/audit-logger.ts` ~Lines 41-57

**Problem:** If the audit trail INSERT fails (DB down, constraint violation), the error is silently swallowed. For 21 CFR Part 11, a failed audit write should block the operation.

**Fix:**
```typescript
try {
  await prisma.auditTrail.create({ data: { /* ... */ } });
} catch (error) {
  app.log.error({ error }, 'CRITICAL: Audit trail write failed');
  // Optionally: throw to block the original operation
  throw new Error('Audit trail logging failed — operation blocked');
}
```

---

### 4.7 N+1 Query in Hierarchy Ancestors

**File:** `apps/api/src/modules/hierarchy/routes.ts` ~Lines 129-148

**Problem:** Ancestor chain is fetched with a loop of individual queries. For a 10-level hierarchy, this is 10 DB round-trips.

**Fix:** Use a recursive CTE:
```sql
WITH RECURSIVE ancestors AS (
  SELECT * FROM hierarchy_nodes WHERE id = $nodeId
  UNION ALL
  SELECT hn.* FROM hierarchy_nodes hn
  INNER JOIN ancestors a ON hn.id = a.parent_id
)
SELECT * FROM ancestors ORDER BY created_at ASC;
```

---

### 4.8 Unbounded Full Tree Query

**File:** `apps/api/src/modules/hierarchy/routes.ts` ~Lines 27-37

**Problem:** `GET /api/hierarchy/tree` returns the entire tree with no pagination or depth limit. Could cause OOM with thousands of nodes.

**Fix:** Add optional `maxDepth` and `limit` query params, or paginate by root nodes.

---

### 4.9 Unsafe `as any` Type Casts

**Files:** Multiple locations in `apps/api/src/modules/`
- `users/routes.ts` Lines 41, 83, 98, 107
- `templates/routes.ts` Line 21
- `hierarchy/routes.ts` Line 84

**Problem:** Bypasses TypeScript type checking. If data shapes change, runtime errors will occur without compile-time warnings.

**Fix:** Define proper Prisma input types or use Zod-parsed types.

---

### 4.10 Missing Route-Level RBAC on Frontend

**File:** `apps/web/src/main.tsx` Lines 35-60

**Problem:** All protected routes only check authentication (logged in), not authorization (correct role). A VIEWER can navigate to `/users/create` directly — the form renders, only failing on submit.

**Fix:** Create a `<ProtectedRoute requiredRoles={[...]}/>` wrapper component that checks `user.role` and redirects if insufficient.

---

## 5. High — Frontend Issues

### 5.1 Session Timeout Not Enforced on Tab/Window Close

**File:** `apps/web/src/hooks/use-session.ts` Lines 40-56

**Problem:** If user closes the browser tab, the backend session persists until the 8-hour JWT expiry.

**Fix:** Add `beforeunload` event handler to call logout. Note: `fetch` with `keepalive: true` is needed for reliability.

---

### 5.2 Dynamic Attribute Collection via DOM Instead of React State

**File:** `apps/web/src/routes/assets/node-create.tsx` Lines 40-48

```typescript
const el = document.getElementById(`attr-${field.name}`) as HTMLInputElement;
if (el?.value) attrs[field.name] = el.value;
```

**Problem:** Bypasses React's controlled component model and Zod validation. HTML injection possible if `field.name` contains special characters.

**Fix:** Use React Hook Form's `useFieldArray` or register dynamic fields properly.

---

### 5.3 Silent Error Swallowing in Action Handlers

**File:** `apps/web/src/routes/users/list.tsx` Lines 39-42

```typescript
} catch {
  // error handling — no actual error handling
}
```

**Problem:** User enable/disable/unlock actions fail silently. User gets no feedback.

**Fix:** Add error state and display toast/alert on failure.

---

### 5.4 Missing Loading State Prevents Double-Submit

**File:** Multiple route files (list.tsx, create.tsx, edit.tsx)

**Problem:** No `isSubmitting` state on action handlers. Users can click submit multiple times, creating duplicate resources.

**Fix:** Track `isSubmitting` state, disable button during submission.

---

### 5.5 No React Error Boundary

**File:** `apps/web/src/main.tsx`

**Problem:** If any component throws, the entire app crashes to a white screen.

**Fix:** Wrap `<RouterProvider>` with an Error Boundary that shows a recovery UI.

---

## 6. Medium — Performance & Code Quality

### 6.1 Missing Database Indexes

**File:** `apps/api/prisma/schema.prisma`

| Table | Column | Reason |
|-------|--------|--------|
| `HierarchyNode` | `unsPath` | Used in ORDER BY for tree queries |
| `AuditTrail` | `(userId, timestamp)` | Common composite filter |
| `AuditTrail` | `(action, timestamp)` | Common composite filter |
| `PhysicalIdentifier` | `nodeId` | FK lookup on node detail |

---

### 6.2 Config Values Accessed via Type Assertion

**File:** `apps/api/src/modules/auth/routes.ts` Lines 63-67
**File:** `apps/api/src/modules/config/routes.ts` various

**Problem:** Config JSON values are cast with `as { ... }` without runtime validation.

**Fix:** Parse config values through Zod schemas from `packages/shared` before use.

---

### 6.3 Field ID Config Update Missing Max Length Validation

**File:** `apps/api/src/modules/config/routes.ts` ~Line 72

```typescript
if (!displayName || displayName.trim().length === 0) {
  return reply.code(400).send({ error: 'displayName is required' });
}
```

**Problem:** No max length check. Could store arbitrarily large strings.

**Fix:** Add `displayName.trim().length > 100` check or use a Zod schema.

---

### 6.4 Inconsistent Error Response Format

**Problem:** Error responses vary across modules:
- `{ error: 'CODE', message: 'text' }`
- `{ error: 'CODE', details: object }`
- `{ error: 'CODE', message: 'text', requiredPermission: '' }`
- `{ error: 'CODE', attemptsRemaining: 3 }`

**Fix:** Define a standard `ErrorResponse` schema in `packages/shared`:
```typescript
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
```

---

### 6.5 Pagination Bug: page=0 and limit=0 Cause 500

**File:** `apps/api/src/modules/users/routes.ts`, `audit/routes.ts`
**Test:** `tests/08-edge-cases.test.ts` Lines 77-94 (acknowledges the bug)

**Problem:** Zod schema defines `page: z.coerce.number().int().min(1)` but the coercion runs before validation. Certain edge cases (page=0, limit=0) cause unexpected 500 instead of 400.

**Fix:** Validate query params explicitly before using them, or add `.catch()` to Zod parse.

---

### 6.6 Audit Log userId Field Sometimes Stores Username, Sometimes UUID

**Files:** Multiple modules

| Module | Field Used | Value |
|--------|-----------|-------|
| `auth/routes.ts` | `userId` | `user.username` (string) |
| `users/routes.ts` | `userId` | `req.user.username` (string) |
| `rbac.ts` | `userId` | `req.user.username` (string) |

**Problem:** The `AuditTrail.userId` field type is `VarChar(100)` and inconsistently stores username vs UUID. This makes it impossible to reliably join with the `User` table.

**Fix:** Choose one convention. For audit trail readability, use username but add a separate `userUuid` column for FK-based queries.

---

## 7. Medium — Test Suite Gaps

### 7.1 Password Policy Enforcement Not Tested

**Tests affected:** `01-auth.test.ts`, `08-edge-cases.test.ts`

**Gap:** Tests verify that password change works but never verify that the password policy rules (uppercase, lowercase, numbers, special chars, minLength from DB config) are actually enforced. The edge case tests only check `cannotBeUserId` and `cannotContainUserId`.

**Required tests:**
- Change password with only lowercase chars when `requireUppercase=true` → expect 400
- Change password with 8 chars when DB config `minLength=10` → expect 400
- Change password without special chars when `requireSpecialChars=true` → expect 400

---

### 7.2 Password History Reuse Not Tested End-to-End

**Gap:** Config allows `preventReuseCount: 0-24` but no test verifies that changing password to one of the last N passwords is rejected (based on DB config, not hardcoded).

---

### 7.3 SUPER_ADMIN Audit Exclusion Not Tested

**Gap:** No test verifies (or flags) that SUPER_ADMIN actions are missing from audit trail. A compliance test should assert SUPER_ADMIN actions ARE logged.

---

### 7.4 forcePasswordChange Enforcement Not Tested

**Gap:** User creation sets `forcePasswordChange: true`, but no test verifies that the user is forced to change password before accessing other endpoints.

---

### 7.5 Temporary Lockout Auto-Unlock Not Tested

**Gap:** Auth routes auto-unlock accounts when `lockoutUntil < now()`, but no test verifies this behavior.

---

### 7.6 Flaky Test Patterns

| Pattern | Location | Risk |
|---------|----------|------|
| Shared `cachedAdminToken` | `helpers.ts` Line 7 | If admin token expires, all tests fail |
| 500ms hardcoded sleep | `07-security.test.ts` Line 57 | Race condition on slow DB |
| Config mutation without atomic restore | `03-config.test.ts` | If crash before restore, next run sees wrong config |
| No DB cleanup between runs | All test files | Accumulated test data may affect pagination assertions |

---

### 7.7 Missing Security Tests

| Missing Test | Reason |
|--------------|--------|
| JWT expiration after 8h | No test waits for token expiry |
| HTTP parameter pollution | POST with conflicting query/body params |
| Large payload DoS | 10MB request body |
| Deeply nested hierarchy (100 levels) | unsPath could exceed ltree limits |
| Concurrent same-username creation | Race condition on unique constraint |
| Identifier uniqueness across nodes | Two nodes with same QR code |

---

### 7.8 Overly Lenient Assertions

| Test | Issue |
|------|-------|
| `01-auth:26` | Asserts `expiresIn: '8h'` string but never verifies actual JWT expiration |
| `04-templates:152` | Asserts `versions.length >= 1` but not that versions are sequential |
| `06-audit:120` | Asserts `checksum.length === 64` but never verifies it's a valid SHA-256 |
| `06-audit:135` | Asserts `afterValue` is defined but not that it contains actual changed fields |
| `08-edge-cases:99` | Accepts 200, 400, or 500 for `page=999999` — too lenient |

---

## 8. Low — Improvements & Cleanup

### 8.1 Missing `.gitignore` Entries

**File:** `.gitignore` — currently only has `node_modules`

**Add:**
```gitignore
node_modules
dist
.env
*.pem
.turbo
apps/api/prisma/*.db
```

---

### 8.2 No Content-Type Validation

**File:** `apps/api/src/app.ts`

**Problem:** No explicit check that request bodies are `application/json`.

**Fix:** Fastify handles this by default, but explicitly setting `contentTypeParser` adds defense in depth.

---

### 8.3 Accessibility: Missing ARIA Labels

**File:** `apps/web/src/routes/users/list.tsx`, other route files

**Problem:** Search inputs, filter dropdowns, and action buttons lack `aria-label` attributes.

---

### 8.4 SWR Retry Disabled

**File:** `apps/web/src/lib/swr-config.ts` Lines 4-9

```typescript
shouldRetryOnError: false,
```

**Problem:** Transient network errors are not retried, degrading reliability.

**Fix:** Enable with a limit: `errorRetryCount: 2`.

---

### 8.5 Missing Content Security Policy Headers

**Problem:** No CSP headers configured. Inline script injection possible.

**Fix:** Add CSP via Helmet configuration in `apps/api/src/app.ts`.

---

### 8.6 Status Naming Convention Inconsistency

| Entity | Statuses |
|--------|----------|
| Users | `ENABLED`, `DISABLED`, `LOCKED`, `EXPIRED` (UPPER_CASE) |
| Hierarchy Nodes | `active`, `inactive`, `decommissioned` (lowercase) |
| Templates | `active`, `inactive` (lowercase) |

**Fix:** Standardize on one convention (prefer UPPER_CASE enums for consistency with Prisma).

---

### 8.7 Missing parseInt Validation

**File:** `apps/api/src/modules/audit/routes.ts` ~Line 42

```typescript
const record = await prisma.auditTrail.findUnique({ where: { id: parseInt(id, 10) } });
```

**Problem:** If `id` is not a numeric string, `parseInt` returns `NaN`, causing a Prisma error.

**Fix:** Add validation: `if (isNaN(parseInt(id, 10))) return reply.code(400).send(...)`.

---

### 8.8 Redundant Session Token Hashing

**File:** `apps/api/src/modules/auth/routes.ts` ~Line 126

```typescript
const sessionToken = createHash('sha256').update(crypto.randomUUID()).digest('hex');
```

**Problem:** Hashing a UUID adds no security value. Use `crypto.randomBytes(32)` directly for a stronger token.

---

## 9. Summary Matrix

| # | Issue | Severity | Type | File(s) |
|---|-------|----------|------|---------|
| 2.1 | SUPER_ADMIN excluded from audit | CRITICAL | Compliance | audit-logger.ts |
| 2.2 | Audit trail not immutable | CRITICAL | Compliance | schema.prisma |
| 2.3 | Password policy not enforced | CRITICAL | Compliance | auth/routes.ts |
| 2.4 | Password expiration not enforced | CRITICAL | Compliance | auth/routes.ts |
| 2.5 | Checksum never verified | CRITICAL | Compliance | audit/routes.ts |
| 2.6 | Re-auth not implemented | CRITICAL | Compliance | web config pages |
| 3.1 | Weak JWT secret fallback | CRITICAL | Security | jwt.ts |
| 3.2 | JWT in localStorage | CRITICAL | Security | api-client.ts |
| 3.3 | No CSRF protection | CRITICAL | Security | All mutations |
| 4.1 | User enumeration timing | HIGH | Security | auth/routes.ts |
| 4.2 | Identifiers not audited | HIGH | Compliance | hierarchy/routes.ts |
| 4.3 | Hardcoded session expiry | HIGH | Config | jwt.ts, auth/routes.ts |
| 4.4 | createdBy inconsistency | HIGH | Data integrity | users/routes.ts |
| 4.5 | Weak login rate limiting | HIGH | Security | app.ts |
| 4.6 | Audit write errors swallowed | HIGH | Compliance | audit-logger.ts |
| 4.7 | N+1 ancestor queries | HIGH | Performance | hierarchy/routes.ts |
| 4.8 | Unbounded tree query | HIGH | Performance | hierarchy/routes.ts |
| 4.9 | Unsafe `as any` casts | HIGH | Type safety | Multiple |
| 4.10 | No frontend RBAC guards | HIGH | Security | main.tsx |
| 5.1 | No logout on tab close | HIGH | Session mgmt | use-session.ts |
| 5.2 | DOM-based attribute collection | HIGH | Security | node-create.tsx |
| 5.3 | Silent error swallowing | HIGH | UX | list.tsx |
| 5.4 | No double-submit prevention | HIGH | UX | Multiple |
| 5.5 | No Error Boundary | HIGH | Reliability | main.tsx |
| 6.1 | Missing DB indexes | MEDIUM | Performance | schema.prisma |
| 6.2 | Config via type assertion | MEDIUM | Type safety | auth/routes.ts |
| 6.3 | Field ID no max length | MEDIUM | Validation | config/routes.ts |
| 6.4 | Inconsistent error format | MEDIUM | API design | Multiple |
| 6.5 | Pagination bug (page=0) | MEDIUM | Bug | users, audit routes |
| 6.6 | Audit userId inconsistency | MEDIUM | Data integrity | Multiple |
| 7.1-7.8 | Test suite gaps | MEDIUM | Testing | tests/ |
| 8.1-8.8 | Low-priority improvements | LOW | Quality | Various |

---

## Recommended Priority Order

### Phase A — Regulatory Blockers (Must fix before audit)
1. Remove SUPER_ADMIN audit exclusion (2.1)
2. Add audit trail immutability trigger (2.2)
3. Enforce full password policy (2.3)
4. Enforce password expiration (2.4)
5. Add checksum verification endpoint (2.5)
6. Implement re-authentication for sensitive ops (2.6)
7. Add audit logging for identifier creation (4.2)
8. Fix audit write error handling (4.6)

### Phase B — Security Hardening
1. Remove JWT secret fallback (3.1)
2. Switch to HttpOnly cookies (3.2)
3. Add CSRF protection (3.3)
4. Add dummy bcrypt for user enumeration (4.1)
5. Strengthen login rate limiting (4.5)
6. Add frontend RBAC guards (4.10)

### Phase C — Stability & Performance
1. Fix N+1 ancestor query (4.7)
2. Add pagination to tree endpoint (4.8)
3. Add missing DB indexes (6.1)
4. Standardize createdBy field (4.4)
5. Fix pagination edge cases (6.5)
6. Add Error Boundary + loading states (5.3, 5.4, 5.5)

### Phase D — Test Coverage
1. Add password policy enforcement tests (7.1)
2. Add password history reuse tests (7.2)
3. Add SUPER_ADMIN audit tests (7.3)
4. Add forcePasswordChange enforcement tests (7.4)
5. Fix flaky test patterns (7.6)
6. Add missing security tests (7.7)
