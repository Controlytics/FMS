# Security & Compliance Tester Agent — Skills & Context

## Identity
**Role:** 21 CFR Part 11 compliance and security testing specialist. Validates that DigiLog meets FDA regulatory requirements, audit trail integrity, electronic signature correctness, and security best practices.
**Authority:** Can block releases that fail compliance checks.

---

## 1. 21 CFR Part 11 Compliance Test Matrix

### 1.1 Subpart B — Electronic Records (S11.10)

| Section | Requirement | How to Verify |
|---------|-------------|---------------|
| S11.10(a) | System validation | Test suite passes |
| S11.10(b) | Accurate and complete copies | Export audit trail as PDF/CSV |
| S11.10(c) | Record protection | Data retention policies |
| S11.10(d) | Limit system access | RBAC with 52+ permissions, 6 default roles |
| S11.10(e) | Audit trail | SHA-256 hash chain integrity |
| S11.10(f) | Operational checks | Workflow sequence enforcement |
| S11.10(g) | Authority checks | `requirePermission()` on every route |
| S11.10(h) | Device checks | Session management, IP tracking |
| S11.10(k) | System access controls | Login, logout, timeout, lockout, password policy |

### 1.2 Subpart B — Electronic Signatures (S11.50, S11.70, S11.100)

| Section | Requirement | Test |
|---------|-------------|------|
| S11.50 | Signature manifestations | e-signature includes name, date/time, meaning |
| S11.70 | Signature/record linking | Signatures permanently linked to records |
| S11.100(b) | Identity verified | Re-authentication required before signing |

### 1.3 Subpart C — Electronic Signatures (S11.200, S11.300)

| Section | Requirement | Test |
|---------|-------------|------|
| S11.200(b) | Two components | Username + password for non-biometric |
| S11.300(a) | Unique user IDs | Enforced at DB level |
| S11.300(d) | ID deactivation | User disable/lock functionality |

---

## 2. Security Tests

### 2.1 Authentication Security
- Brute force protection (account lockout after N attempts)
- Token expiration verification
- Invalid/missing token rejection (401)
- Concurrent session enforcement (force login)
- SUPER_ADMIN lockout exemption

### 2.2 Password Security
- Password policy enforcement (complexity, history, expiry)
- Temporary password forced change
- Password cannot be User ID

### 2.3 Input Validation Security
- SQL injection prevention
- XSS prevention (HTML sanitization via lib/sanitize.ts)
- Path traversal prevention
- IDOR prevention (RBAC enforcement)

### 2.4 Phase 2 Security
- Filter events with SHA-256 checksums (immutable log)
- Server-side checklist enforcement (cannot bypass via API)
- Organization scoping on all filter queries
- Deviation recording on bypass operations

---

## 3. Audit Trail Integrity Tests

### 3.1 Hash Chain Verification
```sql
SELECT id, action, checksum, previous_checksum, created_at
FROM audit_trails ORDER BY created_at DESC LIMIT 20;
```
Verify: first entry has NULL previous_checksum, chain is unbroken, all checksums are valid SHA-256.

### 3.2 Audit Trail Completeness
Every data-mutating operation must create an audit trail entry. Phase 2 adds filter events as an additional immutable log.

---

## 4. Re-authentication Tests

Test that critical actions require password re-entry:
- Template create/update/delete
- User create/update/delete
- Config changes
- Filter operations (start cycle, bypass)

---

## 5. Connection Details

| Resource | Details |
|----------|---------|
| SSH | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| API | `http://localhost:3000/api` |
| Default Login | username: `superadmin`, password: `Admin@123` |

## Phase 2 Coverage
- Filter event immutability (SHA-256 checksums)
- Server-side checklist enforcement
- Organization scoping security
- Deviation audit trail on bypass operations
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
