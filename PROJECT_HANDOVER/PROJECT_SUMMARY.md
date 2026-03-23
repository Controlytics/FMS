# DigiLog - Project Summary

## Overview
DigiLog is an enterprise-grade IoT data logging platform designed for **21 CFR Part 11 compliance**. It enables organizations to manage assets (equipment, sensors, devices), collect telemetry data, automate workflows through rule chains, and maintain FDA-compliant audit trails with electronic signatures.

## Purpose
Provide a secure, multi-tenant platform for regulated industries (pharmaceutical, manufacturing, food & beverage) to:
- Monitor and control industrial equipment via IoT protocols (MQTT, HTTP, WebSocket)
- Enforce 21 CFR Part 11 compliance with electronic signatures and audit trails
- Automate data processing with a visual rule chain engine (77 node types)
- Manage alarms, notifications, and checklists with approval workflows

## Key Features
- **Multi-Tenant Architecture** - Tenant > Organization > User hierarchy with data isolation
- **Asset Management** - Templates, instances, relationships, QR code identification
- **Rule Chain Engine** - Visual drag-and-drop automation with 77 node types
- **Data Ingestion** - MQTT, HTTP, WebSocket protocols with TimescaleDB storage
- **Alarm Management** - Real-time alarms with severity levels and electronic signatures
- **Checklist System** - 3-step approval (Performed/Checked/Verified) with digital signatures
- **LDAP Integration** - Active Directory authentication with auto-provisioning
- **Notification System** - Email, SMS, Telegram, Slack delivery channels
- **Audit Trail** - Immutable logs for all mutations with IP tracking and checksums
- **Dashboard System** - Configurable widgets with real-time data

## Target Users
- **Super Admin** - Platform-wide management, tenant creation
- **Tenant Admin** - Tenant-level user/org management
- **Supervisors** - Monitoring, alarm acknowledgment
- **Maintenance** - Checklist execution, equipment updates
- **Operators** - Day-to-day operations, monitoring
- **Viewers** - Read-only access

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6.1, TailwindCSS v4, ReactFlow, SWR |
| **Backend** | Node.js, Fastify 5.2, TypeScript |
| **Database** | PostgreSQL (Prisma ORM), TimescaleDB (time-series) |
| **Message Queue** | Redis + BullMQ |
| **IoT Protocol** | EMQX MQTT Broker |
| **Real-time** | WebSocket (Fastify plugin) |
| **Auth** | JWT + Session-based, LDAP/AD support |
| **Process Manager** | PM2 |
| **Reverse Proxy** | Nginx |
| **Monorepo** | Turborepo with npm workspaces |
