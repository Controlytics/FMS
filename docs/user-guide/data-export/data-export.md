# Data Export

Export telemetry, alarms, and audit data to CSV or JSON.

## Endpoints
- POST /api/export/telemetry — export telemetry data
- POST /api/export/alarms — export alarm data
- POST /api/export/audit — export audit trail

## Format
CSV or JSON with configurable columns and time ranges.

## Background Processing
Large exports run as background jobs via BullMQ.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
