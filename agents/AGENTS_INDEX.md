# DigiLog Sub-Agents Registry

## Overview
These agents work together to develop, test, and maintain the **DigiLog** platform — a 21 CFR Part 11 compliant digital logbook for pharma/biotech/food manufacturing.

**EC2 Instance:** `3.108.185.106` | **SSH Key:** `/f/claude/21cfrlogbook/21cfrbook.pem` | **User:** `ubuntu`
**Project Root:** `/home/ubuntu/21cfrlogbook`

---

## Agent Roster

| # | Agent | Role | Scope |
|---|-------|------|-------|
| 1 | **Project Manager** | Advisory & Governance | Full project — 21 CFR, architecture, roadmap, cross-agent coordination |
| 2 | **Integration Expert** | Build Integrity | Backend ↔ Frontend ↔ DB ↔ Ingestion — end-to-end functional validation |
| 3a | **API Tester** | Backend Testing | All 16 API modules, 138+ endpoints, RBAC, validation |
| 3b | **Frontend Tester** | UI Testing | 31 routes, components, hooks, state management |
| 3c | **E2E Tester** | Integration Testing | Full user workflows, cross-module flows, regression |
| 3d | **Security & Compliance Tester** | 21 CFR / Security | Part 11 compliance, auth, audit trail, electronic signatures |
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
- `agents/infra-maintenance/skills.md`
