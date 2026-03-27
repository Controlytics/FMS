# User Management

## Roles (6 hierarchical)
| Role | Level | Description |
|------|-------|-------------|
| SUPER_ADMIN | 6 | Full access |
| ADMIN | 5 | User & config management |
| SUPERVISOR | 4 | Audit, approvals, assets |
| MAINTENANCE | 3 | Audit, asset CRUD |
| OPERATOR | 2 | Audit read, asset view |
| VIEWER | 1 | Read-only audit |

## User Lifecycle
Created (with temporary password) > Force password change > Active > Can be Disabled/Locked/Expired

## Features
- Configurable User ID format (prefix, sequential, etc.)
- Password policy (history, expiration, complexity)
- Account lockout after failed attempts
- Bulk operations (up to 50 users)
- Session termination on role/status change


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
