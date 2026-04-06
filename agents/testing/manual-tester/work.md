# Manual Tester Agent — Work Log

## Summary
**Test Sessions:** 10+ (S1-S9: 2026-02-27/28, S10: 2026-03-09 system validation)
**Total UI/API Tests:** 234+
**Pages Tested:** 34+
**Entities Tested:** 5+ core entities + 18 validation entities
**Protocols Tested:** MQTT, HTTP
**Data Ingestion:** PASS (HTTP + MQTT telemetry + attributes)
**Delete Operations:** PASS (telemetry + attributes + checklists, DB verified)
**Alarm Lifecycle:** PASS (ACTIVE -> ACKNOWLEDGED -> CLEARED with e-signatures)
**Rule Chain Nodes:** PASS (77 node types validated across 8 categories)
**RBAC:** PASS (all role restrictions verified)
**Bugs Found & Fixed:** 3 (BUG-016, BUG-017, BUG-018) + 7 validation bugs (BUG-V001-V007)
**Code Fixes Applied:** 6 (FIX-001 through FIX-006)

---

## Session 10 — Full System Validation (2026-03-09)

**Scope:** Complete functional, integration, and workflow validation
**Report:** `tasks/system-validation-report.md`

### Key Results
| Metric | Value |
|--------|-------|
| Tests Executed | 102 |
| Pass Rate | 100% |
| Node Types Validated | 77 across 8 categories |
| Rule Chains Created | 6 |
| Templates Created | 6 with data ingestion enabled |
| Entities Created | 18 (3 per template) |
| Performance | 50 msg/2.7s, all APIs <100ms |

### Validation Bugs Found (7)
| Bug | Severity | Description |
|-----|----------|-------------|
| BUG-V001 | Low | 5 shared package tests out of sync |
| BUG-V002 | High | TimescaleDB ts_telemetry not written without save-timeseries node |
| BUG-V003 | Medium | /api/connectivity/stats route conflict |
| BUG-V004 | Medium | /api/alarms/stats route conflict |
| BUG-V005 | Medium | /api/connectivity list endpoint missing |
| BUG-V006 | Low | /api/connectivity/:entityId/snippet 404 |
| BUG-V007 | High | Export endpoint requires undocumented time range params |

---

## Earlier Sessions (S1-S9)

### Session 9 — FIX-006: Login Redirect After QR Code Scan
- Fixed returnUrl parameter flow for checklist QR code scanning
- URL query parameter approach (working)

### Session 8 — FIX-005: Move Checklist History to Entity Detail Panel
- Removed history from standalone QR form
- Upgraded entity detail panel ChecklistHistoryTab

### Session 7 — FIX-004: Checklist Submission History Backend
- Created ts_checklist_responses TSDB table
- Added time-range query endpoint
- Added checklist delete support to retention system

### Session 6 — FIX-003: Standalone Checklist QR Form
- Moved checklist route outside AppLayout
- Fixed schema format normalization
- Fixed submit payload format

### Session 5 — FIX-002: Consolidate maxFailedAttempts
- Merged duplicate config keys into single source
- Verified lockout behavior

### Session 4 — Password Policy & Admin Protection
- 17 API tests + 6 browser tests
- SUPER_ADMIN lockout exemption
- SUPER_ADMIN password expiry exemption

### Session 3 — Rule Chain Node Testing
- All 77 node types across 8 categories validated

### Sessions 1-2 — Initial Platform Testing
- Data ingestion (MQTT + HTTP)
- UI verification
- Delete operations
- Infrastructure issue resolution (5 issues)

---

## Phase 2 Manual Testing

### Filter Operations
- Start cycle with reason selection
- Advance through 8 stage types (WASH_IN/OUT, DRY_IN/OUT, STORAGE_IN/OUT)
- Submit checklists at gate nodes
- Bypass with deviation recording
- Auto-complete on last stage

### Cleaning Profile Editor
- Create profile with visual pipeline editor
- Add START, END, STAGE, CHECKLIST nodes
- Wire connections between nodes
- Validate graph (7 validation checks)
- Save and version

### PM Schedules
- Create annual schedule
- Add monthly entries with tolerance windows
- Execute maintenance

### Equipment Groups
- Create groups for AHU dashboard
- Assign entities to groups

### Additional Phase 2
- Filter traceability timeline
- Retirement/replacement workflows
- Bulk upload with CSV validation
- Quality audit: 43 issues found, 35 fixed
