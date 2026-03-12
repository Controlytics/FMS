# 21 CFR Part 11 Compliance

DigiLog is designed to meet the requirements of **FDA 21 CFR Part 11**, the regulation governing electronic records and electronic signatures in FDA-regulated industries. This page maps DigiLog's features to specific regulatory requirements.

---

## Overview

21 CFR Part 11 establishes criteria for electronic records and electronic signatures to be considered trustworthy, reliable, and equivalent to paper records and handwritten signatures. DigiLog addresses these requirements through:

- **Immutable audit trails** — Complete record of all system actions
- **Electronic signatures** — Password-based signature with signer identification
- **Access controls** — Role-based permissions with six hierarchical levels
- **Session management** — Secure authentication with idle timeout
- **Data integrity** — Before/after value tracking for all changes

---

## Subpart B — Electronic Records

### §11.10 Controls for Closed Systems

| Requirement | DigiLog Implementation |
|-------------|----------------------|
| **(a)** Validation of systems | System is configurable and testable; audit trail validates all operations |
| **(b)** Ability to generate accurate and complete copies of records | Audit trail exports with full before/after values; database backup/restore |
| **(c)** Protection of records for retention period | Configurable data retention policies; immutable audit records |
| **(d)** Limiting system access to authorized individuals | RBAC with 6 default roles (+ dynamic custom roles), 39+ permission types across 10 categories, route-level and API-level enforcement |
| **(e)** Use of secure, computer-generated, time-stamped audit trails | Automatic server-side timestamps on all audit records; before/after values captured |
| **(f)** Use of operational system checks to enforce sequencing | Forced password change on first login; session conflict resolution; password expiry enforcement |
| **(g)** Use of authority checks | Role-based permissions checked on every API request and frontend route |
| **(h)** Use of device checks | Device access tokens with unique credentials per entity |
| **(i)** Determination of persons who developed, maintained, or modified records | User ID, role, IP address, user agent recorded in every audit entry |
| **(j)** Establishment of written policies | Configurable password policy, login security, session settings |
| **(k)** Controls over documentation | Template-based entity management; version-tracked templates |

### §11.10(e) Audit Trails — Detailed Mapping

DigiLog's audit trail records:

| Audit Field | §11.10(e) Requirement |
|-------------|----------------------|
| `timestamp` | Time-stamped |
| `userId` + `userRole` | Who performed the action |
| `action` | What was done |
| `beforeValue` | Previous record state |
| `afterValue` | New record state |
| `reason` | Why the change was made |
| `ipAddress` | Origin of the action |
| `sessionId` | Session context |

Audit records are:
- **Computer-generated** — Created automatically by the system
- **Time-stamped** — Server-side UTC timestamps
- **Independent** — Cannot be modified through the application
- **Retained** — Configurable retention period (default: 365 days)

---

## Subpart C — Electronic Signatures

### §11.50 Signature Manifestations

| Requirement | DigiLog Implementation |
|-------------|----------------------|
| Printed name of the signer | `fullName` recorded in audit trail |
| Date and time of signing | `timestamp` field with server-side UTC time |
| Meaning of the signature | `signatureMeaning` field (e.g., "Alarm acknowledged by operator") |

### §11.70 Signature/Record Linking

Electronic signatures are logically linked to their respective electronic records:
- Each audit record contains the signer's identity, timestamp, and meaning
- The `sessionId` links the signature to the authenticated session
- The `targetId` links the signature to the specific record being signed

### §11.100 General Requirements

| Requirement | DigiLog Implementation |
|-------------|----------------------|
| Unique to one individual | Username is unique; password is personal |
| Not reused or reassigned | Usernames cannot be recycled |
| Verified identity before use | Administrator creates account; user authenticates to log in |

### §11.200 Electronic Signature Components

| Requirement | DigiLog Implementation |
|-------------|----------------------|
| At least two distinct identification components | Username + Password |
| First signing in a session requires both components | Login requires username and password |
| Subsequent signings may use one component | Re-authentication with password only for alarm actions |
| Continuous sessions maintain signing state | JWT session tokens with configurable duration |

### §11.300 Controls for Identification Codes/Passwords

| Requirement | DigiLog Implementation |
|-------------|----------------------|
| Uniqueness of each identification code | Unique username constraint in database |
| Periodic revision of passwords | Configurable password expiry (default: 90 days) |
| Loss management procedures | Password reset request workflow |
| Transaction safeguards to prevent unauthorized use | Account lockout after failed attempts; session management |
| Device and session controls | Single session per user; idle timeout; IP tracking |

---

## Feature-to-Requirement Matrix

| DigiLog Feature | 21 CFR Part 11 Section |
|-----------------|----------------------|
| Audit Trail | §11.10(e), §11.10(i) |
| Electronic Signatures (Alarms) | §11.50, §11.70, §11.100, §11.200 |
| RBAC / Access Control | §11.10(d), §11.10(g) |
| Password Policy | §11.10(j), §11.300 |
| Account Lockout | §11.300 |
| Session Management | §11.10(f), §11.200 |
| Password Expiry | §11.300 |
| Forced Password Change | §11.10(f) |
| Before/After Values | §11.10(e) |
| Data Retention | §11.10(c) |
| Backup & Restore | §11.10(b) |
| Device Credentials | §11.10(h) |

---

## Validation Notes

### System Validation

Organizations using DigiLog in regulated environments should:

1. **Document** the system's intended use and functional requirements
2. **Verify** the installation against documented requirements
3. **Validate** that the system operates as intended in the production environment
4. **Maintain** validation documentation including test protocols and results

### Ongoing Compliance

- Review audit trails regularly for unauthorized access attempts
- Monitor password policy compliance
- Ensure data retention meets regulatory requirements
- Conduct periodic access reviews (who has what permissions)
- Document any system changes and re-validate as needed

---

## Next Steps

- [Audit Trail](../administration/audit/audit-trail.md) — How the audit trail works
- [Security Configuration](../administration/security/security.md) — Password and session policies
- [Roles & Permissions](../administration/roles/roles-and-permissions.md) — Access control configuration
