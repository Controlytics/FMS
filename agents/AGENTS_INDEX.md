# DigiLog Sub-Agents Registry

## Overview
These agents work together to develop, test, and maintain the **DigiLog** platform — a 21 CFR Part 11 compliant digital logbook for pharma/biotech/food manufacturing with Phase 2 Digital Filter Management System.

**EC2 Instance:** `34.232.224.0` (may change on restart) | **SSH Key:** `~/Downloads/21cfrbook.pem` | **User:** `ubuntu`
**Project Root:** `/home/ubuntu/21cfrlogbook`
**Branch:** DigitalFMS (active development)
**Tech Stack:** Fastify 5 + React 19 + PostgreSQL 18 + Prisma + TimescaleDB + BullMQ + Redis 5 + EMQX
**API Modules:** 34 | **Prisma Models:** 57 | **Enums:** 17 | **Rule Chain Nodes:** 77

---

## Agent Roster

| # | Agent | Role | Scope |
|---|-------|------|-------|
| 1 | **Project Manager** | Advisory & Governance | Full project — 21 CFR, architecture, roadmap, cross-agent coordination |
| 2 | **Integration Expert** | Build Integrity | Backend <-> Frontend <-> DB <-> Ingestion — end-to-end functional validation |
| 3a | **API Tester** | Backend Testing | All 34 API modules, 200+ endpoints, RBAC, validation |
| 3b | **Frontend Tester** | UI Testing | 34+ routes, components, hooks, state management |
| 3c | **E2E Tester** | Integration Testing | Full user workflows, cross-module flows, regression |
| 3d | **Security & Compliance Tester** | 21 CFR / Security | Part 11 compliance, auth, audit trail, electronic signatures |
| 3e | **Manual Tester** | Live Platform Testing | Data ingestion (MQTT/HTTP), UI verification, delete ops, DB state checks |
| 4 | **Infra Maintenance** | DevOps & Docs | Git, EC2, PM2, nginx, test scripts, .md files, build pipeline |

---

## Agent Communication Protocol

1. **All agents** consult the Project Manager before making architectural decisions
2. **Integration Expert** runs validation after every build or code change
3. **Testing agents** report results to both Project Manager and Infra Maintenance
4. **Infra Maintenance** keeps all documentation and test scripts in sync

## Handoff Pattern
```
Developer makes changes
  -> Integration Expert validates build
    -> Testing agents run relevant suites
      -> Project Manager reviews compliance
        -> Infra Maintenance updates docs & logs
```

## Files
- `agents/project-manager/skills.md`
- `agents/project-manager/work.md`
- `agents/integration-expert/skills.md`
- `agents/integration-expert/work.md`
- `agents/testing/api-tester/skills.md`
- `agents/testing/api-tester/work.md`
- `agents/testing/frontend-tester/skills.md`
- `agents/testing/frontend-tester/work.md`
- `agents/testing/e2e-tester/skills.md`
- `agents/testing/e2e-tester/work.md`
- `agents/testing/security-compliance-tester/skills.md`
- `agents/testing/security-compliance-tester/work.md`
- `agents/testing/manual-tester/skills.md`
- `agents/testing/manual-tester/work.md`
- `agents/infra-maintenance/skills.md`
- `agents/infra-maintenance/work.md`

## Phase 2 Testing Coverage

### Filter Management Testing
- Filter operations: start cycle, advance through stages, checklist submission, bypass
- Cleaning profiles: create, edit pipeline (visual editor), version, validate graph connectivity
- Checklist profiles: create, add questions, delete with usage check
- Filter profiles: assign cleaning profiles to filters, organization scoping
- Cleaning cycles: history, timeline, events, performer names
- PM schedules: create, update, execute with tolerance windows
- Equipment groups: create, assign entities, AHU dashboard
- Config pages: lifecycle states, cleaning reasons
- Retirement/replacement workflows
- Bulk upload with CSV validation
- Filter traceability and event history
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

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
