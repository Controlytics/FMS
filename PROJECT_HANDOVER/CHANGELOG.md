# Changelog

## Recent Changes (March 2026)

### LDAP Integration
- Added LDAP/Active Directory authentication support
- Auto-provisioning of LDAP users on first login
- Group-to-role mapping configuration
- Attribute sync on each login (name, email, department)
- LDAP config UI page under Configuration
- Test Connection button
- Added `auth_source` and `ldap_dn` columns to users table

### Multi-Tenant & Organization Improvements
- Removed Tenants sidebar option for all users
- Added Users sidebar option for SUPER_ADMIN
- SUPER_ADMIN can only create TENANT_ADMIN users
- TENANT_ADMIN cannot create TENANT_ADMIN role
- Organization selector added to create/edit user pages
- Tenant selector on edit user page for SUPER_ADMIN
- All organizations visible to all admin roles (not tenant-filtered)

### Organization Management Redesign
- Professional UI with stats cards (Total, Active, Inactive)
- Search and filter bar (All/Active/Inactive)
- Delete organization with user/entity unassignment
- Edit organization dialog
- Tenant name column for SUPER_ADMIN
- Status toggle (activate/deactivate)
- Inactive org blocks user login

### Organization Detail Page Redesign
- Entities tab with gradient headers, search, status badges
- Templates tab with card grid grouped by category
- User Assignments tab with user profile card, source-coded badges
- Icons on tab headers with active state highlighting

### Code Cleanup
- Extracted shared `getTenantId` utility (removed 4 duplicates)
- Removed 20 console.log statements
- Hardened OAuth2 logging (removed secret logging)
- Git baseline created for safe rollback

### Earlier Changes
- Template alarm rule evaluation during telemetry ingestion
- Audit trail UUID migration
- QR scan checklist fix
- Config registry system with auto-discovery
- Real-time auto-refresh via SWR polling and WebSocket
- Data ingestion pipeline (8-stage processing)
- TimescaleDB hypertables for telemetry
