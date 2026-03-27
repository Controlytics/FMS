# Security & Compliance Tester Agent — Skills & Context

## Identity
**Role:** 21 CFR Part 11 compliance and security testing specialist. Validates that DigiLog meets FDA regulatory requirements, audit trail integrity, electronic signature correctness, and security best practices.
**Authority:** Can block releases that fail compliance checks.
**Last Validation:** 2026-03-09 — All 21 CFR Part 11 §11.10 and §11.50 requirements verified PASS. 15 security checks confirmed.

---

## 1. 21 CFR Part 11 Compliance Test Matrix

### 1.1 Subpart B — Electronic Records (§11.10)

| Section | Requirement | Test | How to Verify |
|---------|-------------|------|---------------|
| §11.10(a) | System validation | Test suite passes | `npx vitest run` — all 1,344 tests pass (0 failures) |
| §11.10(b) | Accurate and complete copies | Export functionality | Export audit trail as PDF/CSV, verify completeness |
| §11.10(c) | Record protection | Data retention policies | Verify retention settings prevent premature deletion |
| §11.10(d) | Limit system access | RBAC enforcement | Test all 6 roles against all 145+ endpoints |
| §11.10(e) | Audit trail | Hash-chain integrity | Verify SHA-256 hash chain, no gaps, tamper detection |
| §11.10(f) | Operational checks | Sequence enforcement | Verify workflow steps execute in correct order |
| §11.10(g) | Authority checks | Permission enforcement | `requirePermission()` and `requireRole()` on every route |
| §11.10(h) | Device checks | Session management | Device fingerprint, IP tracking, user-agent logging |
| §11.10(i) | Education/training | Documentation | Help articles system, user guides |
| §11.10(j) | Documentation controls | Version history | Template versioning, audit trail for all changes |
| §11.10(k) | Controls for system access | Auth controls | Login, logout, timeout, lockout, password policy |

### 1.2 Subpart B — Electronic Signatures (§11.50, §11.70, §11.100)

| Section | Requirement | Test |
|---------|-------------|------|
| §11.50 | Signature manifestations | Each e-signature includes printed name, date/time, and meaning |
| §11.70 | Signature/record linking | Electronic signatures are permanently linked to their records |
| §11.100(a) | Unique to signer | Each signature tied to individual user, cannot be reused |
| §11.100(b) | Identity verified | Re-authentication required before signing |
| §11.100(c) | Administered by issuing authority | Only SUPER_ADMIN can create/manage users |

### 1.3 Subpart C — Electronic Signatures (§11.200, §11.300)

| Section | Requirement | Test |
|---------|-------------|------|
| §11.200(a) | Not reusable | Signatures bound to specific records |
| §11.200(b) | Two components | Username + password for non-biometric |
| §11.300(a) | Unique user IDs | Username uniqueness enforced |
| §11.300(b) | ID checking | At least two identification components |
| §11.300(c) | ID issuance | Documented user creation process |
| §11.300(d) | ID deactivation | User disable/lock functionality |

---

## 2. Security Tests

### 2.1 Authentication Security

```bash
BASE="http://localhost:3000/api"

# Test 1: Brute force protection
# Send 5 wrong passwords, verify account lockout
for i in 1 2 3 4 5; do
  curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"wrong'$i'"}'
done
# After max attempts: should return ACCOUNT_LOCKED

# Test 2: Token expiration
# Login, wait past token expiry, verify 401
TOKEN=$(curl -s -X POST "$BASE/auth/login" ... | ...)
# Wait for token to expire...
curl -s "$BASE/users" -H "Authorization: Bearer $TOKEN"
# Should return 401

# Test 3: Invalid token
curl -s "$BASE/users" -H "Authorization: Bearer invalid.token.here"
# Should return 401

# Test 4: Missing token
curl -s "$BASE/users"
# Should return 401

# Test 5: Session hijacking prevention
# Login from IP A, try to use token from IP B
# Should be rejected or logged

# Test 6: Concurrent session enforcement
# Login user, login same user again without force:true
# Should return SESSION_CONFLICT
```

### 2.2 Password Security

```bash
# Test password policy enforcement
# 1. Minimum length
# 2. Uppercase requirement
# 3. Lowercase requirement
# 4. Number requirement
# 5. Special character requirement
# 6. Password history (no reuse of last N passwords)
# 7. Password expiry
# 8. Temporary password must be changed on first login

# Get current password policy
curl -s "$BASE/config/password-policy" -H "Authorization: Bearer $TOKEN"

# Try to create user with weak password
curl -s -X POST "$BASE/users" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"username":"WK0001","fullName":"Weak","email":"w@w.com","roleId":"...","password":"weak","confirmPassword":"weak"}'
# Should return 400 VALIDATION_ERROR
```

### 2.3 Input Validation Security

```bash
# SQL Injection tests
curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"admin'\'' OR 1=1--","password":"x"}'

# XSS tests
curl -s -X POST "$BASE/assets/templates" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-reauth-password: Admin@123" \
  -d '{"name":"<script>alert(1)</script>","description":"XSS test","category":"EQUIPMENT"}'

# Path traversal
curl -s "$BASE/uploads/../../etc/passwd" -H "Authorization: Bearer $TOKEN"

# IDOR (Insecure Direct Object Reference)
# Login as OPERATOR, try to access another user's data by ID
```

### 2.4 API Security Headers

```bash
# Check security headers in response
curl -sI http://3.108.185.106 | grep -iE 'x-frame|x-content-type|strict-transport|content-security|x-xss'

# Expected:
# X-Frame-Options: DENY or SAMEORIGIN
# X-Content-Type-Options: nosniff
# Strict-Transport-Security (if HTTPS)
# Content-Security-Policy
```

---

## 3. Audit Trail Integrity Tests

### 3.1 Hash Chain Verification

```bash
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db << 'SQL'
-- Verify hash chain integrity
-- Each audit entry's checksum should depend on the previous entry's checksum
SELECT
  id,
  action,
  checksum,
  previous_checksum,
  created_at
FROM audit_trails
ORDER BY created_at DESC
LIMIT 20;
SQL
```

**Verify:**
1. First entry has `previous_checksum = NULL`
2. Each subsequent entry's `previous_checksum` = previous entry's `checksum`
3. No gaps in the chain (consecutive sequence)
4. Checksums are valid SHA-256 hashes (64 hex chars)
5. Recalculating hash from entry data + previous_checksum produces the same checksum

### 3.2 Audit Trail Completeness

Every data-mutating operation must create an audit trail entry:

| Operation | Expected Audit Action |
|-----------|----------------------|
| User create | USER_CREATED |
| User update | USER_UPDATED |
| User delete | USER_DELETED |
| User enable/disable | USER_STATUS_CHANGED |
| User password reset | PASSWORD_RESET |
| Template create | ASSET_TEMPLATE_CREATED |
| Template update | ASSET_TEMPLATE_UPDATED |
| Template delete | ASSET_TEMPLATE_DELETED |
| Entity create | ASSET_CREATED |
| Entity update | ASSET_UPDATED |
| Entity delete | ASSET_DELETED |
| Config change | CONFIG_UPDATED |
| Role change | ROLE_UPDATED |
| Login | LOGIN_SUCCESS |
| Failed login | LOGIN_FAILED |
| Logout | LOGOUT |
| Password change | PASSWORD_CHANGED |
| RBAC denial | UNAUTHORIZED_ACTION_ATTEMPT |

### 3.3 Audit Trail Tamper Detection

```bash
# 1. Record current hash chain state
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "
  SELECT id, checksum FROM audit_trails ORDER BY created_at DESC LIMIT 1;
"

# 2. Attempt to modify an audit entry (should be detectable)
# (DO NOT actually modify - just verify the API's integrity check endpoint)
curl -s "$BASE/audit/integrity-check" -H "Authorization: Bearer $TOKEN"
# Should return integrity status
```

---

## 4. Electronic Signature Tests

### 4.1 Signature Components
```sql
-- Verify electronic signatures contain required fields
SELECT
  id,
  user_id,
  meaning,        -- §11.50: What the signature means
  signed_at,      -- §11.100: Date and time
  ip_address,     -- §11.10(h): Device check
  user_agent      -- §11.10(h): Device check
FROM electronic_signatures
ORDER BY signed_at DESC LIMIT 10;
```

### 4.2 Signature Binding
```sql
-- Verify signatures are permanently linked to audit entries
SELECT
  es.id as sig_id,
  es.meaning,
  at.id as audit_id,
  at.action,
  at.checksum
FROM electronic_signatures es
JOIN audit_trails at ON es.audit_trail_id = at.id
ORDER BY es.signed_at DESC LIMIT 10;
```

---

## 5. Re-authentication Tests

### 5.1 Actions Requiring Reauth
Test that these actions require password re-entry:

```bash
# Without reauth password → should fail
curl -s -X POST "$BASE/assets/templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"No Reauth","description":"Should fail","category":"EQUIPMENT"}'
# Expected: 403 or reauth required error

# With reauth password → should succeed
curl -s -X POST "$BASE/assets/templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-reauth-password: Admin@123" \
  -d '{"name":"With Reauth","description":"Should work","category":"EQUIPMENT"}'
# Expected: 201 Created
```

### 5.2 Reauth Configuration
```bash
# Verify reauth matrix is configurable per role/action
curl -s "$BASE/config/action-reauth" -H "Authorization: Bearer $TOKEN"
```

---

## 6. Data Integrity Tests

### 6.1 Referential Integrity
```sql
-- Check for orphaned records
SELECT COUNT(*) FROM asset_instances WHERE template_id NOT IN (SELECT id FROM asset_templates);
SELECT COUNT(*) FROM sessions WHERE user_id NOT IN (SELECT id FROM users);
SELECT COUNT(*) FROM password_history WHERE user_id NOT IN (SELECT id FROM users);
SELECT COUNT(*) FROM audit_trails WHERE user_id NOT IN (SELECT username FROM users);
```

### 6.2 Cascading Deletes
```bash
# When a user is deleted:
# - Sessions should be deleted (CASCADE)
# - Password history should be deleted (CASCADE)
# - Audit trail entries should be preserved (user_id stored as string)
```

---

## 7. Compliance Checklist Summary

| Requirement | Status | Test File |
|-------------|--------|-----------|
| Unique user IDs | | auth.test.ts |
| Password complexity | | password.test.ts |
| Account lockout | | auth.test.ts |
| Session management | | auth.test.ts |
| RBAC enforcement | | rbac.plugin.test.ts |
| Audit trail hash chain | | audit.test.ts, hash-chain.test.ts |
| Electronic signatures | | (manual verification) |
| Reauth for critical actions | | reauth-check.test.ts |
| Data export capability | | export.test.ts |
| Tamper detection | | hash-chain.test.ts |
| Record retention | | retention.test.ts |

---

## 8. Reporting

After each compliance audit, produce:
1. **Compliance Matrix:** Pass/fail for each §11.xx requirement
2. **Security Findings:** Vulnerabilities found, severity rating
3. **Audit Trail Health:** Hash chain integrity status
4. **Open Items:** Compliance gaps requiring remediation
5. **Sign-off Recommendation:** Release-ready or blocked

---

## 9. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Admin | username: `admin`, password: `Admin@123` |
| Compliance Doc | `documentation/testing/validation/21CFR_PART11_VERIFICATION.md` |
| Bug Log | `documentation/Bug_Resolution_Log.md` |


## Phase 2 Coverage
- Filter management module testing (operations, profiles, cycles, checklists)
- PM scheduling module testing
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

