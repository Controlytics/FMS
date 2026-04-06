# Changelog

## Phase 2: Digital Filter Management System (2026-03-27)

### New Backend Modules
- **cleaning-profiles**: Pipeline profile CRUD with visual editor support (stages, connections)
- **filter-profiles**: Filter-to-cleaning-profile assignment management
- **filter-operations**: Core operations — cycle start, advance, bypass, checklist submission, events
- **pm-schedules**: Preventive maintenance scheduling with entries and execution tracking
- **checklist-profiles**: Checklist template management with configurable questions
- **equipment-groups**: AHU equipment grouping with instrument assignments

### New Database Models (13 Prisma models)
- FilterCleaningProfile, FilterPipelineStage, FilterPipelineConnection
- FilterProfile, CleaningCycle, FilterEvent
- EquipmentGroup, EquipmentGroupInstrument
- ChecklistProfile, ChecklistQuestion
- PmSchedule, PmScheduleEntry, PmExecution

### New Enums (9)
- PmScheduleStatus, PmExecutionStatus, FilterSetLabel
- PipelineFlowMode, PipelineNodeType, CleaningCycleStatus
- FilterEventType, BlockRestriction, ChecklistQuestionType

### Frontend Pages Added
- Filter operations page (start/advance/bypass/checklist)
- Filter profiles management
- Cleaning cycle history with timeline view
- Cleaning profile editor (visual pipeline builder)
- AHU dashboard
- Filter traceability view
- Filter status/scan pages
- PM schedule management
- Checklist profile management
- Bulk filter upload
- Equipment group management
- Filter retirement and replacement workflows

### Quality Audit
- 43 issues identified, 35 fixed across security, compliance, logic, and UI
- Comprehensive security review of all Phase 2 endpoints
- Input sanitization applied to all filter management text fields

## Phase 3 Enhancements (2026-03 to 2026-04)

### Bulk Upload & Data Management
- Bulk filter upload via CSV/Excel
- Filter retirement and replacement workflows
- Equipment group management with instrument linking

### UI Improvements
- Unified light theme across all pages (bg-white, text-slate-800, no dark theme)
- Filters page redesign with improved status visualization
- Mobile PWA/APK support via Capacitor (apps/android/)

### Infrastructure
- Windows local development setup (start-digilog.bat / stop-digilog.bat)
- Redis 5, EMQX, PostgreSQL 18, API via tsx watch, Frontend via Vite
- Android build support with JDK21 + Android SDK + Capacitor

---

## [2026-03-24] - Tenant Layer Removal
- Removed tenant/multi-tenant architecture entirely
- SUPER_ADMIN now manages Organizations directly
- Removed TENANT_ADMIN role (migrated to ADMIN)
- Dropped tenants, tenant_configs tables and tenant_id from all tables
- Changed /api/tenant/* routes to /api/organizations/*
- Simplified role hierarchy: 7 roles instead of 8

## Earlier Changes (March 2026)

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

### Core Infrastructure
- Template alarm rule evaluation during telemetry ingestion
- Audit trail UUID migration
- QR scan checklist fix
- Config registry system with auto-discovery (23 config definitions)
- Real-time auto-refresh via SWR polling and WebSocket
- Data ingestion pipeline (10-stage processing)
- TimescaleDB hypertables for telemetry
- Notification system: email, SMS (Twilio/AWS SNS/Vonage/HTTP), in-app
- 77 rule chain node types across 8 categories
- Input sanitization for XSS prevention on all text fields
