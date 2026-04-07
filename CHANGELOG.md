# Changelog

## [2.2.0] — 2026-04-07

### Added — RFID & Offline Sync
- **RFID Scanner Android app** (`rfid_scan_app/`) — KC-series UHF reader via USB-C with 5 screens (Connect, Scan, Read/Write, Settings, UKB)
- **RFID input guard** (`use-rfid-guard.ts`) — global keydown interceptor blocks rapid RFID keyboard input from entering non-RFID fields
- **RFID scan dialogs** — 300ms debounce tag detection, deduplication for repeated scans, Continue/Remove flow
- **Filter details on scan** — after RFID tag detected, looks up and displays filter name + parent AHU
- **Offline cleaning operations** — all stage operations (advance, start-cycle, submit-checklist, equipment) wrapped with `executeOrQueue()` for offline queuing
- **Offline identifier lookup** — identifiers cached to IndexedDB `identifier-map` for RFID lookup without internet
- **"Data Synced" indicator** — mobile header badge shows when all data (instances, templates, reasons, identifiers) is cached and safe to go offline
- **Error popup component** (`components/ui/error-popup.tsx`) — reusable modal for error display, replaces inline banners in entities and filter operations
- **Responsive layout** — sidebar collapses to hamburger menu on mobile/tablet with slide-in overlay

### Changed
- **One identifier per entity** — backend now blocks creating more than one identifier per asset instance
- **Contact Admin roles** — `/api/roles/active` is now public (no auth) so the contact-admin page can populate the role dropdown
- **User creation** — admin users auto-assign new users to their own organization (org dropdown hidden)
- **Filter operations list** — shows all Filter template instances (fixes BY_BLOCK config-based profile assignment)
- **APK HTTP mode** — Capacitor WebView cannot trust self-signed certs for fetch; dev uses HTTP, production will use system cert install

### Fixed
- RFID reader in UKB mode typing tag IDs into random input fields
- Repeated tag scans filling inputs with duplicated EPC values
- Filter not found errors when scanning offline (identifiers now cached separately)
- Cleaning operations failing silently offline (start-cycle, checklist, equipment now queue properly)
- Background error messages not visible to user (now shown as popup dialogs)
- Fixed width sidebar breaking mobile layout

## [2.1.0] — 2026-04-04

### Added — Phase 2 Enhancements
- **Equipment Groups** — Group instruments and filters under AHUs with CRUD endpoints
- **Checklist Profiles** — Standalone checklist profile management with typed questions (YES_NO, PASS_FAIL, NUMERIC, DROPDOWN, MULTI_SELECT, TEXT)
- **Bulk Upload** — CSV-based bulk filter import functionality
- **Filter Retirement & Replacement** — End-of-life management for filters
- **Filter Scan** — QR/barcode scanning for filter identification
- **Mobile PWA** — Progressive Web App support for tablet/mobile filter operations
- **Android APK** — Capacitor-based Android build (JDK 21, apps/android/)
- **Notification Channels** — Telegram and Slack delivery channels added
- **Dashboard Widgets** — Configurable dashboard with widget assignments

### Updated
- Prisma schema expanded to **57 models** with **17 enums**
- API modules expanded to **34 total**
- Frontend routes expanded with equipment management, bulk upload, retirement pages
- All documentation files updated to reflect current application state

## [2.0.0] — 2026-03-27

### Added — Phase 2: Digital Filter Management System
- **Filter Operations page** — 8 cleaning stages (TO_BE_CLEANED through READY_FOR_USE) with block selection, QR scan
- **Cleaning Profile Editor** — Visual pipeline builder with STAGE, CHECKLIST, START, END nodes and wire connections
- **Checklist Profiles** — CRUD for checklist templates with 10 question types (YES_NO, PASS_FAIL, NUMERIC, DROPDOWN, etc.)
- **Filter Profiles** — Assign cleaning profiles to filters, block restrictions, max cycle limits
- **Cleaning Cycles** — Full lifecycle tracking with expandable history, stage timeline, filter names, performer names
- **PM Scheduling** — Per-AHU preventive maintenance schedules with monthly entries and tolerance windows
- **AHU Dashboard** — Filter set visualization with state-colored indicators
- **Filter Traceability** — Per-filter event history, cycle list, deviation tracking
- **Checklist gates in pipeline** — CHECKLIST nodes between stages auto-trigger question dialogs; server-side enforcement
- **Cleaning reason selection** — User selects from 8 configurable reasons when starting a cycle
- **Config pages** — Filter Lifecycle States and Filter Cleaning Reasons management
- **9 new database tables** — pm_schedules, pm_schedule_entries, pm_executions, filter_cleaning_profiles, filter_pipeline_stages, filter_pipeline_connections, filter_profiles, cleaning_cycles, filter_events
- **9 new enums** — CleaningCycleStatus, FilterEventType, PipelineNodeType, FlowMode, BlockRestriction, etc.
- **17 new permissions** across 6 roles
- **3 config definitions** — filter-cleaning-reasons, filter_lifecycle_states, filter-pm-schedule

### Fixed — Quality Audit (30 issues resolved)
- **CRITICAL:** Path traversal in binary file endpoints + missing auth
- **CRITICAL:** Auth double-throw for expired accounts
- **CRITICAL:** Config pages returning 404 (missing config definitions)
- **HIGH:** Organization scoping added to all filter-operations methods
- **HIGH:** Server-side checklist enforcement in advance() — prevents API bypass
- **HIGH:** bypass() now requires active cycle and validates target state
- **HIGH:** Permission guards on all 13 Phase 2 frontend routes
- **MEDIUM:** Race conditions in startCycle and submitChecklist (transactions + duplicate checks)
- **MEDIUM:** Cleaning profile update wrapped in transaction
- **MEDIUM:** Input sanitization (XSS) for remarks/justification fields
- **MEDIUM:** Pipeline validation (stateKeys, checklist profiles, graph connectivity)
- **MEDIUM:** getCycles performance (events opt-in via query param)
- **LOW:** 28 missing permissions added to ALL_PERMISSIONS
- **LOW:** Auth plugin role scope caching (30s TTL)
- **LOW:** ErrorBoundary dark theme, PM page navigation, node delete confirmation


## [Unreleased] — 2026-03-16

### Added
- Input sanitization (HTML stripping) on all user text fields to prevent XSS
- Data Retention config page with per-table retention settings (telemetry, attributes, events, traces, checklists)
- Help Articles: 28 articles with comprehensive documentation across 8 categories
- Login always redirects to home page (dashboard) instead of returnUrl

### Fixed
- Retention config page crash: backend now merges stored config with defaults
- Department field XSS vulnerability: cleaned existing DB data and added sanitization
- Cleaned up 27 test help articles from database

## [1.0.0] — 2026-03-12

### Added
- Config Registry System with 23 self-registering config definitions
- Field ID expansion to 39 fields across 7 modules
- Real-time auto-refresh across all pages via SWR polling and WebSocket
- Role-based access management page (replaced role privileges)
- Comprehensive manual test cases (25 test suites, 25 execution guides)

### Fixed
- SWR stale data across 23 files (revalidateOnMount + dedupingInterval: 0)
- Role change not persisting after logout (JWT refresh reads DB role)
- SQL/CSV restore fails with missing displayName (50+ column mappings)
- User ID validator prefix check only applies to PREFIX_* formats
- PM2 TSDB_DATABASE env var fixed from digilog_db to digilog_tsdb
- Email IPv4: added family: 4 to nodemailer for smtp.office365.com

## [0.9.0] — 2026-03-01

### Added
- Phase K: Testing & Documentation
- Phase J: Help Articles, UNS Browser, Alarm Dashboard
- Phase I: Checklist Mobile, QR Code Scanning
- Phase H: Connectivity, Device Credentials
- Phase G: Rule Chain Visual Editor (ReactFlow)
- Phase F: Telemetry Queries, Data Export
- Phase E: Unified Namespace (ISA-95)
- Phase D: Rule Chain Engine (77 node types)
- Phase C: Data Ingestion Pipeline (11 stages)
- Phase B: MQTT Transport (EMQX integration)
- Phase A: Infrastructure (PostgreSQL, TimescaleDB, Redis, PM2, Nginx)

### Core Features
- 21 CFR Part 11 compliant audit trail with hash-chain integrity
- Electronic signatures with re-authentication
- 6 hierarchical roles with 22+ permissions
- Entity template system with attribute schemas and alarm rules
- 12 relationship types with cycle detection
- Notification system (in-app, email, SMS)
- Backup and restore with SHA-256 integrity verification

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
