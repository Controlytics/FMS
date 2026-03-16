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
