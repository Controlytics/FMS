---
name: Bug Report
about: Report a bug in DigiLog for structured tracking and resolution
title: "[BUG] "
labels: bug
assignees: ''
---

## Bug Title
<!-- Clear, concise description of the bug -->

## Module
<!-- Which module is affected? -->
- [ ] Authentication
- [ ] User Management
- [ ] Role Management
- [ ] Entity Management — Templates
- [ ] Entity Management — Instances
- [ ] Entity Management — Relationships
- [ ] Entity Management — Identifiers
- [ ] Configuration
- [ ] Audit Trail
- [ ] Notifications
- [ ] Notification Rules/Delivery
- [ ] Data Ingestion (MQTT/HTTP)
- [ ] Rule Chain Engine
- [ ] Connectivity
- [ ] UNS (Unified Namespace)
- [ ] Queries (Telemetry/Alarms/Export)
- [ ] Uploads
- [ ] Backup
- [ ] System Health
- [ ] Help Articles
- [ ] QR Codes
- [ ] Filter Operations (Phase 2)
- [ ] Cleaning Profiles (Phase 2)
- [ ] Checklist Profiles (Phase 2)
- [ ] Filter Profiles (Phase 2)
- [ ] PM Schedules (Phase 2)
- [ ] Equipment Groups (Phase 2)
- [ ] Cleaning Cycles (Phase 2)
- [ ] Filter Traceability (Phase 2)
- [ ] Retirement/Replacement (Phase 2)
- [ ] Bulk Upload (Phase 2)
- [ ] Frontend — UI/UX
- [ ] Other: ___________

## Severity
- [ ] CRITICAL — System unusable, data loss, security vulnerability, compliance breach
- [ ] HIGH — Major feature broken, no workaround
- [ ] MEDIUM — Feature partially broken, workaround exists
- [ ] LOW — Minor issue, cosmetic, edge case

## Description
<!-- Detailed description of the bug -->

## Steps to Reproduce
1.
2.
3.
4.

## Expected Behavior
<!-- What should happen -->

## Actual Behavior
<!-- What actually happens -->

## Root Cause (after analysis)
<!-- Fill this in after investigating the bug -->

## Environment
- **Browser:**
- **OS:**
- **API Version:**
- **Database:** PostgreSQL 18 + Prisma + TimescaleDB
- **Deployment:** EC2 / Local Windows

## Screenshots / Logs
<!-- Attach any relevant screenshots, console errors, or API response logs -->

## Additional Context
<!-- Any other relevant information -->

---

### Resolution Checklist (for the fixer)
- [ ] Root cause identified and documented
- [ ] Fix implemented with no regression
- [ ] Fix has no side effects on other modules
- [ ] Proper validation added/verified
- [ ] Tests added/updated to cover this bug
- [ ] Relevant .md files updated

### Phase 2 Context (if applicable)
<!-- For filter-related bugs, include: -->
- Cleaning profile name/version:
- Pipeline stage/node:
- Cycle status:
- Filter ID:
- Equipment group:
