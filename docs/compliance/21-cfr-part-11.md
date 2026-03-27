# 21 CFR Part 11 Compliance

DigiLog implements the following 21 CFR Part 11 requirements:

## Subpart B — Electronic Records

### §11.10 Controls for Closed Systems
| Requirement | Implementation |
|------------|----------------|
| (a) System validation | Comprehensive test suites (25 test cases) |
| (b) Generate accurate copies | Backup/restore with SHA-256 integrity, CSV/JSON export |
| (c) Record protection | PostgreSQL with role-based access, encrypted connections |
| (d) System access limits | 6 hierarchical roles, 22+ permissions, session management |
| (e) Audit trail | SHA-256 hash-chain, before/after snapshots, immutable via DB trigger |
| (f) Operational checks | Input validation, schema enforcement, rate limiting |
| (g) Authority checks | Permission-based route guards, re-authentication for sensitive ops |
| (h) Device checks | Device credential validation, IP allowlists, rate limiting |
| (i) Training | Role-based UI, 28 in-app help articles |
| (j) Written policies | Configurable password policy, session timeout, audit retention |
| (k) Documentation | API docs (Swagger), architecture docs, test documentation |

### §11.30 Controls for Open Systems
- HTTPS support via Nginx (self-signed or CA certificates)
- JWT token authentication with 30-minute refresh
- Session idle timeout with configurable warning

## Subpart C — Electronic Signatures

### §11.50 Signature Manifestations
- Each signature includes: signer name, date/time, meaning (Performed By/Checked By/Verified By)
- Displayed with the signed record

### §11.70 Signature/Record Linking
- Electronic signatures linked via SHA-256 hash chains
- recordHash = SHA-256(record data)
- signatureHash = SHA-256(recordHash + userId + timestamp)
- Re-authentication required for each signature

### §11.100 General Requirements
- Unique user IDs (configurable format: prefix, sequential, etc.)
- Password expiration policies (configurable)
- Account lockout after failed attempts

### §11.200 Electronic Signature Components
- Username + password re-authentication for each signature event
- Biometric signatures not currently supported
- Signatures bound to individual records, not reusable


### Filter Operations Compliance
- All filter state transitions recorded as immutable events with SHA-256 checksums
- Checklist answers stored with timestamps and performer identity
- Bypass deviations require justification and are logged as BYPASS_DEVIATION events
- Cleaning cycle lifecycle tracked from start to completion with full event chain
- Organization scoping ensures cross-tenant data isolation



---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
