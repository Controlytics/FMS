# Deployment Verification System - Implementation Plan

## Overview

Create a deployment verification endpoint (GET /api/deployment-check) and companion shell script that validates all infrastructure, seed data, and service dependencies after deploying DigiLog to a new server.

## Files to Create

1. apps/api/src/modules/deployment-check/routes.ts - Main route module
2. deploy/verify-deployment.sh - Shell script for CLI verification

## Files to Modify

1. apps/api/src/app.ts - Add import and register the new route module (after line 216)

---

## Route Module Design

### Imports and Dependencies

- prisma from lib/prisma.js
- getTsdbPool from @digilog/db
- IORedis from ioredis (create temporary connection)
- getMqttClient from transport/mqtt-client.js
- errorResponses from lib/error-schemas.js
- fs, path from node builtins
- Prisma namespace from @prisma/client for DMMF model introspection

### Auth

app.requireSuperAdmin() as preHandler (consistent with system-health pattern)

### Response Structure

- summary: { total, passed, failed, warnings, status: PASS|WARN|FAIL }
- checks: CheckResult[]
- timestamp: ISO string
- serverInfo: { hostname, nodeVersion, uptime }

### CheckResult Shape

- category: string identifier
- name: human-readable description
- status: PASS | FAIL | WARN | SKIPPED
- duration_ms: number
- details: optional metadata object
- subChecks: { name, status, expected?, found?, message? }[]

### Execution Strategy

All 12 check functions run via Promise.allSettled() for isolation.
Each wrapped in timer for duration_ms. Thrown errors caught as FAIL.

---

## 12 Check Categories

### CHECK 1: postgresql
Source: prisma
Sub-checks: Connection (SELECT 1), Migrations (0 pending in _prisma_migrations), Roles (>=6), Admin user (superadmin exists), System configs (>=4), Help articles (>=38), Field ID configs (>=65), Ingestion configs (>=33)

### CHECK 2: timescaledb
Source: getTsdbPool()
Sub-checks: Connection, timescaledb extension, pgcrypto extension, 6 hypertables (ts_telemetry, ts_attributes, ts_checklist_responses, ts_device_events, ts_binary_data, ts_pipeline_traces), 2 continuous aggregates (telemetry_hourly, telemetry_daily), >=6 compression policies

### CHECK 3: redis
Source: new IORedis({ host: REDIS_HOST, port: REDIS_PORT })
Sub-checks: Connection (ping/PONG), Server version, Memory usage
Cleanup: redis.disconnect() after

### CHECK 4: mqtt (optional)
Source: getMqttClient(), MQTT_ENABLED env
Sub-checks: MQTT_ENABLED (SKIPPED if false), Client connected

### CHECK 5: prisma-models
Source: prisma, Prisma.dmmf
Sub-checks: Client generated, Model count >=58, Key models accessible (user, role, systemConfig)

### CHECK 6: api-routes
Source: FastifyInstance (app)
Sub-checks: Route count, Critical routes present (/api/auth, /api/users, /api/config, /api/roles, /api/audit, /api/assets, /api/system-health, /api/data, /api/rule-chains)

### CHECK 7: auth
Source: prisma
Sub-checks: Superadmin exists, ENABLED status, Not locked, SUPER_ADMIN role
Note: No actual login test - shell script proves login works

### CHECK 8: frontend
Source: fs module
Sub-checks: dist/ exists, index.html present, assets/ present, manifest.webmanifest present
Path: resolve relative from api module to apps/web/dist

### CHECK 9: filesystem
Source: fs module
Sub-checks: Uploads dir exists (apps/api/uploads), Uploads dir writable (W_OK)

### CHECK 10: environment
Source: process.env
Sub-checks: JWT_SECRET (>=32 chars, FAIL in prod), VERIFICATION_TOKEN_SECRET, ALLOWED_ORIGINS (WARN if localhost in prod), DATABASE_URL, TSDB_HOST, REDIS_HOST, NODE_ENV

### CHECK 11: role-permissions
Source: prisma.role.findMany()
Sub-checks: SUPER_ADMIN >=55, ADMIN >=55, SUPERVISOR >=10, MAINTENANCE >=10, OPERATOR >=10, VIEWER >=4

### CHECK 12: config-entries
Source: prisma.systemConfig
Sub-checks: password-policy exists, login-security exists, session exists, datetime exists

---

## app.ts Registration

After line 216 (systemHealthRoutes):
- import deploymentCheckRoutes from ./modules/deployment-check/routes.js
- await app.register(deploymentCheckRoutes, { prefix: /api/deployment-check })

---

## Shell Script (deploy/verify-deployment.sh)

Args: --host (default localhost:3000), --username (default superadmin), --password (default Admin@123)
Steps: Login via POST /api/auth/login -> GET /api/deployment-check with Bearer token -> Pretty-print with colors -> Show summary -> Exit 0 (pass) or 1 (fail)
Requires: curl and jq

---

## Key Design Decisions

1. Promise.allSettled for isolation - one check failing cannot block others
2. No actual login test in check 7 - shell script already proves login
3. Minimum thresholds (>=) not exact counts - custom data may exist
4. SKIPPED for optional services (MQTT when disabled)
5. Temporary Redis connection with cleanup - no coupling to app instances
6. FastifyInstance passed for route introspection in check 6
7. No Swagger schema - complex nested shape, admin-only endpoint

## Implementation Sequence

1. Create directory apps/api/src/modules/deployment-check/
2. Create routes.ts with all 12 check functions and route handler
3. Register in apps/api/src/app.ts (1 import + 1 register line)
4. Create deploy/verify-deployment.sh
5. Test locally

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
