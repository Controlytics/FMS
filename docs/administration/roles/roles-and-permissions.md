# Roles & Permissions

## 52+ Privileges

### User Management
USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD

### Configuration
CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE

### Assets
ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_TEMPLATE_MANAGE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE

### Audit & Compliance
AUDIT_READ, AUDIT_EXPORT, APPROVAL_REQUEST, APPROVAL_REVIEW

### Data & Integration
UNS_VIEW, UNS_MANAGE, RULE_CHAIN_VIEW, RULE_CHAIN_UPDATE, RULE_CHAIN_MANAGE, READ_DEBUG_TRACE, MANAGE_DEBUG_TRACE
DATA_INGEST, DATA_VIEW, DATA_MANAGE, DATA_EXPORT
ALARM_VIEW, ALARM_MANAGE
QR_CODE_GENERATE, HELP_MANAGE
CHECKLIST_SUBMIT, CHECKLIST_REVIEW, CHECKLIST_APPROVE
RETENTION_MANAGE, SYSTEM_CONFIG_MANAGE

### Phase 2 Filter Management Privileges

| Permission | Description |
|------------|-------------|
| FILTER_OPERATE | Start cycles, advance stages, submit checklists |
| FILTER_BYPASS | Bypass stages with deviation logging |
| FCP_READ | View cleaning profiles |
| FCP_CREATE | Create cleaning profiles |
| FCP_UPDATE | Update cleaning profiles |
| FP_READ | View filter profiles |
| FP_CREATE | Create filter profiles |
| CYCLE_READ | View cleaning cycles |
| EVENT_READ | View filter events |
| CHECKLIST_SUBMIT | Submit checklists (shared with core) |
| PM_READ | View PM schedules |
| PM_CREATE | Create PM schedules |
| PM_UPDATE | Update PM schedules |
| PM_EXECUTE | Execute PM tasks |

## Hierarchy Rules
- Users can only manage users at equal or lower hierarchy levels
- Custom roles can be created with any permission subset
- Role changes invalidate active sessions
- Privileges are managed via the `role-privileges` config definition
