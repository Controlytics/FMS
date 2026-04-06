# DigiLog - Project Summary

## Overview
DigiLog is an enterprise-grade IoT data logging platform designed for **21 CFR Part 11 compliance**. It enables organizations to manage assets (equipment, sensors, devices), collect telemetry data, automate workflows through rule chains, and maintain FDA-compliant audit trails with electronic signatures. Phase 2 adds a complete **Digital Filter Management System (FMS)** for pharmaceutical cleanroom filter cleaning lifecycle management.

## Purpose
Provide a secure platform for regulated industries (pharmaceutical, manufacturing, food & beverage) to:
- Monitor and control industrial equipment via IoT protocols (MQTT, HTTP, WebSocket)
- Enforce 21 CFR Part 11 compliance with electronic signatures and audit trails
- Automate data processing with a visual rule chain engine (77 node types, 8 categories)
- Manage alarms, notifications, and checklists with approval workflows
- Manage filter cleaning lifecycles with configurable pipelines, checklist gates, and full traceability

## Key Features

### Core Platform (Phase 1)
- **Organization Management** - SUPER_ADMIN > Organization > User hierarchy with data isolation
- **Asset Management** - Templates, instances, relationships, QR code identification
- **Rule Chain Engine** - Visual drag-and-drop automation with 77 node types across 8 categories
- **Data Ingestion** - MQTT, HTTP, WebSocket protocols with 10-stage pipeline and TimescaleDB storage
- **Alarm Management** - Real-time alarms with severity levels and electronic signatures
- **Checklist System** - 3-step approval (Performed/Checked/Verified) with digital signatures
- **LDAP Integration** - Active Directory authentication with auto-provisioning
- **Notification System** - Email, SMS (Twilio/AWS SNS/Vonage/HTTP), in-app delivery channels
- **Audit Trail** - Immutable logs for all mutations with IP tracking and checksums
- **Dashboard System** - Configurable widgets with real-time data
- **Configuration System** - 23 auto-discovered configuration modules

### Digital Filter Management System (Phase 2)
- **Cleaning Profiles** - Visual pipeline editor with 8 stage types (WASH_IN/OUT, DRY_IN/OUT, STORAGE_IN/OUT) + checklist gates
- **Filter Operations** - Cycle start, advance, bypass, checklist submission with server-side enforcement
- **PM Schedules** - Preventive maintenance scheduling with execution tracking
- **Equipment Groups** - AHU grouping with instrument assignments
- **Filter Traceability** - Complete event history timeline per filter
- **Bulk Upload** - CSV/Excel import for filters
- **Retirement/Replacement** - End-of-life filter workflows

### Infrastructure (Phase 3)
- **Mobile Support** - PWA/APK via Capacitor for tablet use
- **Unified Light Theme** - Consistent UI across all pages
- **Windows Local Development** - Batch scripts for local dev environment

## Target Users
- **Super Admin** - Platform-wide management, organization creation
- **Admin** - System-level user/org management
- **Org Admin** - Organization-level management
- **Supervisors** - Monitoring, alarm acknowledgment, filter cycle oversight
- **Maintenance** - Checklist execution, equipment updates, filter cleaning operations
- **Operators** - Day-to-day operations, monitoring, filter cycle advancement
- **Viewers** - Read-only access

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6.1, TailwindCSS v4, ReactFlow, SWR |
| **Backend** | Node.js, Fastify 5.2, TypeScript |
| **Database** | PostgreSQL 18 (Prisma ORM, 57 models, 17 enums), TimescaleDB (time-series) |
| **Message Queue** | Redis 5 + BullMQ |
| **IoT Protocol** | EMQX MQTT Broker |
| **Real-time** | WebSocket (Fastify plugin) |
| **Auth** | JWT + Session-based, LDAP/AD support |
| **Process Manager** | PM2 |
| **Reverse Proxy** | Nginx |
| **Monorepo** | Turborepo with npm workspaces |
| **Mobile** | Capacitor (Android APK/PWA) |

## Scale
- **34 backend API modules**
- **57 Prisma models** with 17 enums
- **77 rule chain node types** across 8 categories
- **23 auto-discovered config definitions**
- **52+ role privileges**
- **40+ help articles** with version history
- **10-stage data ingestion pipeline**
- **4 SMS providers** (Twilio, AWS SNS, Vonage, HTTP Gateway)

## Deployment
- **Production:** AWS EC2 at 34.232.224.0
- **Services:** Nginx (80/443), Fastify (3000), PostgreSQL (5432), EMQX (1883/18083), Redis (6379)
- **Default Login:** superadmin / Admin@123
