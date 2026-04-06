# User Management

## Roles (6 default hierarchical + custom)
| Role | Level | Description |
|------|-------|-------------|
| SUPER_ADMIN | 6 | Full access |
| ADMIN | 5 | User and config management |
| SUPERVISOR | 4 | Audit, approvals, assets |
| MAINTENANCE | 3 | Audit, asset CRUD |
| OPERATOR | 2 | Audit read, asset view |
| VIEWER | 1 | Read-only audit |

Custom roles can be created via **Config > Roles** with any name, display color, hierarchy level, and permission subset.

## User Lifecycle
Created (with temporary password) > Force password change on first login > Active > Can be Disabled/Locked/Expired

## Features
- Configurable User ID format (prefix, sequential, auto-generate, separator options)
- Password policy enforcement (history, expiration, complexity)
- Account lockout after configurable failed attempts (temporary or permanent)
- Bulk operations (up to 50 users at once)
- Session termination on role/status change
- Password reset request workflow (admin notification)
- Department and email fields for organizational tracking

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List users with pagination and filters |
| GET | `/api/users/stats` | User statistics by role and status |
| POST | `/api/users` | Create user with role assignment |
| PUT | `/api/users/:id` | Update user profile and role |
| DELETE | `/api/users/:id` | Delete user (with re-auth) |
| POST | `/api/users/:id/enable` | Enable disabled account |
| POST | `/api/users/:id/disable` | Disable active account |
| POST | `/api/users/:id/unlock` | Unlock locked account |
| POST | `/api/users/:id/reset-password` | Reset user password |
| DELETE | `/api/users/bulk` | Bulk delete users |

## Phase 2: Filter Management Roles
Filter management permissions (17 total) can be assigned to any role via the Role Privileges configuration page. This allows granular control over who can start cycles, advance stages, bypass with deviations, submit checklists, manage cleaning profiles, and execute PM tasks.
