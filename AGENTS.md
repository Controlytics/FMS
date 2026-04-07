# DigiLog — Codex Code Review Instructions

## Project Context
DigiLog (21cfrlogbook) — IoT data logging platform with 21 CFR Part 11 compliance.
Monorepo: Fastify API (apps/api), React SPA (apps/web), shared packages.
Branch: DigitalFMS (active development).

## Current Module Count
- **Backend:** 34 API modules
- **Frontend:** 20+ route groups
- **Database:** 57 Prisma models, 17 enums
- **Permissions:** 52+ across 6 roles

## Backend Modules (34)
admin-requests, assets (templates, instances, identifiers, relationships), audit, auth, backup, checklist-profiles, cleaning-profiles, config, connectivity, dashboards, data-ingestion, deployment-check, entity-assignments, equipment-groups, filter-operations, filter-profiles, help, ldap, notification-delivery, notification-rules, notifications, org-admin, pm-schedules, qr-code, queries (telemetry/alarm/retention/export), roles, rule-chain, super-admin, system-health, tenant-admin, uns, uploads, user-groups, users

## Review Focus Areas

### Security (Critical — 21 CFR Part 11)
- All user input must be sanitized (lib/sanitize.ts strips HTML)
- SQL injection: only use Prisma parameterized queries, never raw string interpolation
- Authentication: JWT tokens with role-based access control
- Audit trail: all data mutations must create audit log entries
- No secrets or credentials in code
- Organization scoping: multi-tenant queries must filter by orgId
- Race conditions: use Prisma transactions for concurrent operations

### Backend (apps/api — Fastify + TypeScript)
- Route handlers must validate input with Zod schemas
- Services should use proper error handling with Fastify error codes
- Database queries via Prisma ORM only (TimescaleDB = digilog_tsdb via pg pool)
- Check tenant isolation: multi-tenant queries must filter by orgId/tenantId
- BullMQ jobs must handle failures gracefully
- Filter operations must enforce checklist completion before stage advance
- Pipeline validation: check graph connectivity, stateKeys, checklist profile references

### Frontend (apps/web — React + Vite + Tailwind)
- Light theme only (bg-white, text-slate-800, bg-slate-50 sections)
- No dark mode classes or theme toggles
- Components should handle loading/error states
- API calls via the shared API client with proper error handling
- No inline styles — use Tailwind classes
- Permission guards on all protected routes

### Phase 2: Filter Management
- Cleaning profiles must validate pipeline graph (START->STAGE->...->END)
- Filter operations must enforce sequential stage advancement
- Checklist submission must be validated against question types
- Bypass operations must require BYPASS_ENABLED flow mode
- Events must be immutably recorded (no UPDATE/DELETE)
- Equipment groups must validate instrument references

### General
- TypeScript strict mode — no `any` types without justification
- No console.log in production code (use proper logger)
- Shared types go in packages/shared, not duplicated
- Follow existing patterns in the codebase
- Check for unused imports and dead code
- Input sanitization on all user-facing text fields

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
