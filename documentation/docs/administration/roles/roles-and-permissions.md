# Roles & Permissions

DigiLog uses a two-layer permission system: feature privileges (frontend UI gating) synced with API permissions (backend route enforcement).

## Default Roles (6 hierarchical)
| Role | Level | Description |
|------|-------|-------------|
| SUPER_ADMIN | 6 | Full access, bypasses all permission checks |
| ADMIN | 5 | User and config management |
| SUPERVISOR | 4 | Audit, approvals, assets |
| MAINTENANCE | 3 | Audit, asset CRUD |
| OPERATOR | 2 | Audit read, asset view |
| VIEWER | 1 | Read-only audit |

Custom roles can be created with any name, display color, and permission subset via **Config > Roles**.

## Core Permissions (22+ base)

### User Management
USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD

### Configuration
CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE

### Assets
ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_TEMPLATE_MANAGE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE

### Audit & Compliance
AUDIT_READ, AUDIT_EXPORT, APPROVAL_REQUEST, APPROVAL_REVIEW

### Data
UNS_VIEW, RULE_CHAIN_VIEW, RULE_CHAIN_UPDATE, READ_DEBUG_TRACE, NOTIFICATION_MANAGE

## Phase 2: Filter Management Permissions (17 additional)

| Permission | Description |
|------------|-------------|
| FILTER_OPERATE | Start cycles, advance stages, submit checklists |
| FILTER_BYPASS | Bypass stages with deviation logging |
| FCP_READ | View cleaning profiles |
| FCP_CREATE | Create cleaning profiles |
| FCP_UPDATE | Update cleaning profiles |
| FP_READ | View filter profiles |
| FP_CREATE | Create filter profiles |
| FP_UPDATE | Update filter profiles |
| CYCLE_READ | View cleaning cycles |
| EVENT_READ | View filter events |
| CHECKLIST_SUBMIT | Submit checklists |
| PM_READ | View PM schedules |
| PM_CREATE | Create PM schedules |
| PM_UPDATE | Update PM schedules |
| PM_EXECUTE | Execute PM tasks |
| EQG_READ | View equipment groups |
| EQG_MANAGE | Create/update equipment groups |

**Total permissions: 52+** across all modules.

## Hierarchy Rules
- Users can only manage users at equal or lower hierarchy levels
- Custom roles can be created with any permission subset
- Role changes invalidate active sessions immediately
- SUPER_ADMIN bypasses all permission checks (no configuration needed)
- Permission hierarchy: `*_MANAGE` parent permissions grant `*_CREATE`, `*_UPDATE`, `*_DELETE`, `*_VIEW`

## Permission Architecture
```
Frontend (RoleConfig)          Backend (Role)
  permissions: {dotNotation}     permissions: [SNAKE_CASE]
  assets.view = true        -->  ASSET_VIEW
  config.edit = true        -->  CONFIG_UPDATE
```
Feature privileges are synced to API permissions via `FEATURE_TO_PERMISSION_MAP` bridge. Frontend uses `/api/config/my-config` for sidebar and button gating. Backend uses `requirePermission()` middleware on every route.
