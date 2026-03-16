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
