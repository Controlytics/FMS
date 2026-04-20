# Audit Trail

Tamper-evident log of all system activities with 21 CFR Part 11 compliance.

## What Gets Logged
- **User actions:** Login/logout, password changes, session conflicts, forced logouts
- **Entity operations:** CRUD, status changes, relationship management, identifier management
- **Configuration changes:** All 23 config modules with before/after values
- **Data operations:** Backup/restore, exports, data retention actions
- **Checklist submissions:** Performed/Checked/Verified approval workflow steps
- **Filter operations (Phase 2):** Cycle start/advance/complete, checklist submissions, bypass deviations, stage transitions, PM schedule executions

## Entry Fields
| Field | Description |
|-------|-------------|
| Timestamp | Server-side UTC timestamp |
| User | User ID and full name |
| Role | User's role at time of action |
| Action | 60+ audit action types |
| Target | Entity/resource affected |
| Before/After Value | State change tracking |
| IP Address | Origin of the action |
| User Agent | Browser/client identification |
| Session ID | Active session reference |
| Checksum | SHA-256 hash for tamper detection |

## Integrity
SHA-256 hash-chain -- each entry includes a checksum of key fields. Any modification breaks the chain and is detectable. Audit records are immutable and cannot be deleted through the application.

## Filter Operations Audit (Phase 2)
All filter management operations generate audit-trail-compatible events:
- **CYCLE_STARTED** -- Cleaning cycle initiation with reason
- **STAGE_ADVANCED** -- Stage transition with performer identity
- **CHECKLIST_COMPLETED** -- Checklist answers with timestamps
- **BYPASS_DEVIATION** -- Bypass justification and approver
- **CYCLE_COMPLETED** -- Cycle completion with full event chain
- **PM_EXECUTED** -- Preventive maintenance task execution

Events are stored in the `filter_events` table with SHA-256 checksums and organization scoping for multi-tenant isolation.

## Compliance
Satisfies 21 CFR Part 11 sections 11.10(e), 11.10(k)(2), 11.50, 11.70. Configurable retention period (default: 365 days). Export available in CSV/JSON formats.
