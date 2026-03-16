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
