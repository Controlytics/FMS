# What is DigiLog?

DigiLog is a **21 CFR Part 11 compliant** IoT data logging platform designed for regulated industries (pharmaceuticals, food & beverage, manufacturing). It replaces paper-based logbooks with a digital system that provides:

## Core Capabilities

### Data Collection
- **Real-time telemetry** from IoT devices via MQTT and HTTP
- **Manual data entry** through mobile-friendly checklists with electronic signatures
- **Binary data** support (images, audio, vibration waveforms)

### Data Processing
- **77-node visual rule chain engine** for conditional processing, enrichment, and transformation
- **Automatic alarm generation** with threshold, rate-of-change, and absence detection
- **Multi-channel notifications** (in-app, email, SMS) based on configurable rules

### Compliance
- **Tamper-evident audit trail** with SHA-256 hash-chain integrity
- **Electronic signatures** with re-authentication (21 CFR Part 11 compliant)
- **3-step checklist approval workflow** (Performed → Checked → Verified)
- **Role-based access control** with 6 hierarchical roles and 22+ permissions

### Organization
- **Entity hierarchy** following ISA-95 standard (Enterprise → Site → Area → Line → Equipment → Sensor)
- **Unified Namespace (UNS)** with MQTT wildcard support
- **12 relationship types** between entities with cycle detection
- **QR/RFID/NFC identifiers** for physical equipment tagging

## Architecture

DigiLog uses a modern tech stack:
- **Backend:** Fastify (Node.js/TypeScript) with 27 API modules
- **Frontend:** React + Vite SPA with Tailwind CSS
- **Database:** PostgreSQL + TimescaleDB (time-series)
- **MQTT:** EMQX broker
- **Queue:** Redis + BullMQ


## Digital Filter Management (Phase 2)

DigiLog includes a comprehensive Digital Filter Management System for pharmaceutical cleanroom HEPA filter cleaning lifecycle management.

### Features
- 8-stage cleaning pipeline (To Be Cleaned, Wash In/Out, Dry In/Out, Storage In/Out, Ready For Use)
- Visual pipeline editor for creating cleaning profiles
- Checklist gates between stages with 10 question types
- Real-time filter status tracking with QR/barcode scan
- Cleaning cycle history with full audit trail
- PM scheduling per AHU with tolerance windows
- Configurable cleaning reasons with justification support

### Compliance
All filter operations are recorded as immutable events with SHA-256 checksums, electronic signatures, and deviation tracking per 21 CFR Part 11.

