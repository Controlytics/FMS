# DigiLog Sub-Agents Registry

## Overview
These agents work together to develop, test, and maintain the **DigiLog** platform — a 21 CFR Part 11 compliant digital logbook for pharma/biotech/food manufacturing.

**EC2 Instance:** `3.108.185.106` | **SSH Key:** `/f/claude/21cfrlogbook/21cfrbook.pem` | **User:** `ubuntu`
**Project Root:** `/home/ubuntu/21cfrlogbook`
**Last System Validation:** 2026-03-09 | **Health Score:** 87/100 | **Open Bugs:** 7 (BUG-V001–V007)

---

## Agent Roster

| # | Agent | Role | Scope |
|---|-------|------|-------|
| 1 | **Project Manager** | Advisory & Governance | Full project — 21 CFR, architecture, roadmap, cross-agent coordination |
| 2 | **Integration Expert** | Build Integrity | Backend ↔ Frontend ↔ DB ↔ Ingestion — end-to-end functional validation |
| 3a | **API Tester** | Backend Testing | All 16 API modules, 145+ endpoints, RBAC, validation |
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
  → Integration Expert validates build
    → Testing agents run relevant suites
      → Project Manager reviews compliance
        → Infra Maintenance updates docs & logs
```

## Files
- `agents/project-manager/skills.md`
- `agents/integration-expert/skills.md`
- `agents/testing/api-tester/skills.md`
- `agents/testing/frontend-tester/skills.md`
- `agents/testing/e2e-tester/skills.md`
- `agents/testing/security-compliance-tester/skills.md`
- `agents/testing/manual-tester/skills.md`
- `agents/infra-maintenance/skills.md`


## Phase 2 Testing Coverage

### Filter Management Testing
- Filter operations: start cycle, advance through stages, checklist submission, bypass
- Cleaning profiles: create, edit pipeline, version, validate
- Checklist profiles: create, add questions, delete with usage check
- Filter profiles: assign to filters, block restrictions
- Cleaning cycles: history, timeline, events, performer names
- PM schedules: create, update, execute
- Config pages: lifecycle states, cleaning reasons

