# What is DigiLog?

DigiLog is a **21 CFR Part 11 compliant** IoT data logging platform designed for regulated industries (pharmaceuticals, food & beverage, manufacturing). It replaces paper-based logbooks with a digital system that provides:

## Core Capabilities

### Data Collection
- **Real-time telemetry** from IoT devices via MQTT and HTTP
- **Manual data entry** through mobile-friendly checklists with electronic signatures
- **Binary data** support (images, audio, vibration waveforms)

### Data Processing
- **77-node visual rule chain engine** for conditional processing, enrichment, and transformation across 8 categories
- **Automatic alarm generation** with threshold, rate-of-change, and absence detection
- **Multi-channel notifications** (in-app, email, SMS, Telegram, Slack) based on configurable rules

### Compliance
- **Tamper-evident audit trail** with SHA-256 hash-chain integrity
- **Electronic signatures** with re-authentication (21 CFR Part 11 compliant)
- **3-step checklist approval workflow** (Performed, Checked, Verified)
- **Role-based access control** with 6 default hierarchical roles, custom roles, and 52+ permissions

### Organization
- **Entity hierarchy** following ISA-95 standard (Enterprise, Site, Area, Line, Equipment, Sensor)
- **Unified Namespace (UNS)** with MQTT wildcard support
- **12 relationship types** between entities with cycle detection
- **QR/RFID/NFC identifiers** for physical equipment tagging

## Architecture

DigiLog uses a modern tech stack:
- **Backend:** Fastify (Node.js/TypeScript) with 34 API modules and 57 Prisma models
- **Frontend:** React + Vite SPA with Tailwind CSS
- **Database:** PostgreSQL 18 + Prisma ORM + TimescaleDB (time-series hypertables)
- **MQTT:** EMQX broker
- **Queue:** Redis 5 + BullMQ
- **Config:** 23 definitions with auto-discovery at startup

---

## Digital Filter Management System (Phase 2)

DigiLog includes a comprehensive Digital Filter Management System for pharmaceutical cleanroom HEPA filter cleaning lifecycle management.

### Features
- 8-stage cleaning pipeline (To Be Cleaned, Wash In/Out, Dry In/Out, Storage In/Out, Ready For Use)
- Visual pipeline editor for creating cleaning profiles with drag-and-drop nodes
- Checklist gates between stages with 10 question types (YES_NO, PASS_FAIL, TEXT, NUMERIC, DROPDOWN, MULTI_SELECT, DATE_TIME, PHOTO, SIGNATURE, YES_NO_NA)
- Real-time filter status tracking with QR/barcode scan
- Cleaning cycle history with full audit trail and traceability
- PM scheduling per AHU with tolerance windows
- Configurable cleaning reasons with justification support
- Equipment groups for AHU dashboard views
- Retirement and replacement workflow for end-of-life filters
- Bulk upload of filter data via CSV

### Phase 2 API Endpoints
```
POST /api/filters/:id/start-cycle    -- Start cleaning cycle
POST /api/filters/:id/advance        -- Advance to next stage
POST /api/filters/:id/submit-checklist -- Submit checklist answers
POST /api/filters/:id/bypass         -- Bypass stage (deviation)
GET  /api/filters/:id/current-state  -- Get filter state + next actions
GET  /api/filter/cycles              -- List cleaning cycles
GET  /api/filter/events              -- List filter events
GET  /api/cleaning-profiles          -- Cleaning profile CRUD
GET  /api/filter-profiles            -- Filter profile CRUD
GET  /api/pm-schedules               -- PM schedule CRUD
GET  /api/checklist-profiles         -- Checklist profile CRUD
GET  /api/equipment-groups           -- Equipment group CRUD
```

### Compliance
All filter operations are recorded as immutable events with SHA-256 checksums, electronic signatures, and deviation tracking per 21 CFR Part 11.

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
