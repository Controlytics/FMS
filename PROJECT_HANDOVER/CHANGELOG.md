# Changelog

## Phase 4: Permissions, Themes & Reports (2026-04-14)

### Added
- Granular role-based permissions: 18 new feature toggles across Filters, Checklist, Cleaning Profile, Equipment Group, PM page controls
- 10 configurable color themes: Ocean, Sapphire, Emerald, Amethyst, Sunset, Slate, Ruby, Forest, Midnight, Coral
- Report Settings configuration page with header/footer/layout controls and live preview
- ReportPageWrapper component applied to Audit Trail, Cleaning Cycles, Filter Traceability
- Dynamic bulk upload CSV template generated from Filter entity template attributeSchema
- PM Schedules page redesign: date range filter, summary cards, AHU inline with expandable filters, S.No, pagination
- AHU Type column on filters table
- Public endpoints: /api/config/password-policy/current, /api/config/report-settings/current
- Block change test data (PENDING, APPROVED, REJECTED, EXPIRED)

### Fixed
- SUPER_ADMIN now bypasses all frontend permission checks (was hidden from new features)
- Backup export 403 for non-superadmin (removed hardcoded role check)
- Backup restore failing for SQL/CSV formats (password_hash was stripped)
- Block change requests not visible to approvers (endpoint required wrong permission)
- "Load Error" toast on every page for non-admins (password-policy 403)
- api-client.ts missing .status on thrown errors (SWR couldn't suppress 403 toasts)
- Reauth popup password autofilling from browser saved credentials
- Reauth popup focus jumping to search bar on cancel/confirm
- Reauth popup not opening for checklist and cleaning profile actions
- Filter status update 403 (permission mapping missing backend permission)

### Changed
- Feature privilege mappings now include both frontend visibility and backend route permissions
- Reauth actions: 69 total across 16 categories (removed 8 dead, added 6 missing)
- Permission count: 95 total, 82 feature privileges, 24 config definitions
- SUPER_ADMIN bypass pattern: `isSuperAdmin || perms.includes(...)` on all frontend guards

## Phase 3: RFID & Offline Operations (2026-04-07)

### Added
- **RFID Scanner App** — Native Android app (`rfid_scan_app/`) for KC-series UHF readers
- **RFID Input Guard** — Global keyboard interceptor blocks UKB tag input from non-RFID fields
- **RFID Scan Dialogs** — 300ms debounce tag detection with deduplication, shows filter name + AHU
- **Offline Sync Infrastructure** — IndexedDB store, sync engine, useOffline hook
- **Offline Cleaning Operations** — advance, start-cycle, checklist, equipment all work offline
- **Offline Identifier Lookup** — identifier→filter map cached for RFID scanning without internet
- **Data Synced Indicator** — mobile header badge shows when data is cached
- **Error Popup Component** — reusable modal replaces inline error banners
- **Responsive Layout** — sidebar collapses on mobile with hamburger menu

### Changed
- **One Identifier Per Entity** — backend enforces single identifier per asset
- **Contact Admin Roles** — /api/roles/active is now public (no auth required)
- **User Creation** — admin users auto-assign new users to their organization
- **Filter Operations List** — shows all Filter template instances (BY_BLOCK profile fix)

### Fixed
- RFID UKB mode typing tag IDs into random fields
- Repeated tag scans filling inputs with duplicated values
- Cleaning operations failing silently offline
- Background error messages not visible to user

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

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
