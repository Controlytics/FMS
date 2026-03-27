# Audit Trail

Tamper-evident log of all system activities.

## What Gets Logged
User actions (login/logout, password changes), entity operations (CRUD, status changes), configuration changes, data operations (backup/restore, exports), checklist submissions and approvals.

## Entry Fields
Timestamp, User, Role, Action, Target, Before/After Value, IP, User Agent, Session ID, Checksum

## Integrity
SHA-256 hash-chain — each entry hashes the previous. Modification breaks the chain and is detectable.

## Compliance
Satisfies 21 CFR Part 11 sections 11.10(e), 11.10(k)(2), 11.50, 11.70.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
