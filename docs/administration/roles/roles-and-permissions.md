# Roles & Permissions

## 22+ Permissions
### User Management
USER_CREATE, USER_READ, USER_UPDATE, USER_DELETE, USER_ENABLE_DISABLE, USER_UNLOCK, USER_RESET_PASSWORD

### Configuration
CONFIG_READ, CONFIG_UPDATE, FIELD_ID_UPDATE, ROLE_MANAGE

### Assets
ASSET_VIEW, ASSET_CREATE, ASSET_UPDATE, ASSET_DELETE, ASSET_TEMPLATE_MANAGE, ASSET_RELATIONSHIP_MANAGE, ASSET_IDENTIFIER_MANAGE

### Audit & Compliance
AUDIT_READ, AUDIT_EXPORT, APPROVAL_REQUEST, APPROVAL_REVIEW

### Data
UNS_VIEW, RULE_CHAIN_VIEW, RULE_CHAIN_UPDATE, READ_DEBUG_TRACE

## Hierarchy Rules
- Users can only manage users at equal or lower hierarchy levels
- Custom roles can be created with any permission subset
- Role changes invalidate active sessions


### Phase 2 Permissions

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
| CHECKLIST_SUBMIT | Submit checklists |
| PM_READ | View PM schedules |
| PM_CREATE | Create PM schedules |
| PM_UPDATE | Update PM schedules |
| PM_EXECUTE | Execute PM tasks |

