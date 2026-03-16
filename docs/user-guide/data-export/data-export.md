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
