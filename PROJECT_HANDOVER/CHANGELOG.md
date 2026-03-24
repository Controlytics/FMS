# Changelog

## [2026-03-24] - Tenant Layer Removal
- Removed tenant/multi-tenant architecture entirely
- SUPER_ADMIN now manages Organizations directly
- Removed TENANT_ADMIN role (migrated to ADMIN)
- Dropped tenants, tenant_configs tables and tenant_id from all tables
- Changed /api/tenant/* routes to /api/organizations/*
- Simplified role hierarchy: 7 roles instead of 8

## Recent Changes (March 2026)

### LDAP Integration
- Added LDAP/Active Directory authentication support
- Auto-provisioning of LDAP users on first login
- Group-to-role mapping configuration
- Attribute sync on each login (name, email, department)
- LDAP config UI page under Configuration
- Test Connection button
- Added `auth_source` and `ldap_dn` columns to users table

### Organization Management Improvements
- Added Users sidebar option for SUPER_ADMIN
- SUPER_ADMIN can create ADMIN users
- Organization selector added to create/edit user pages
- All organizations visible to all admin roles

### Organization Management Redesign
- Professional UI with stats cards (Total, Active, Inactive)
- Search and filter bar (All/Active/Inactive)
- Delete organization with user/entity unassignment
- Edit organization dialog
- Status toggle (activate/deactivate)
- Inactive org blocks user login

### Organization Detail Page Redesign
- Entities tab with gradient headers, search, status badges
- Templates tab with card grid grouped by category
- User Assignments tab with user profile card, source-coded badges
- Icons on tab headers with active state highlighting

### Code Cleanup
- Removed tenant-related utilities and duplicated code
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
