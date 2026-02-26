# Phase F: Queries & Export (3-4 days)

## Prompt for Claude Code

```
You are implementing Phase F (Queries & Export) of DigiLog's Data Ingestion & Integration Layer.

Phases A-E are complete. Data flows in, gets processed, and persists to TimescaleDB. Now you build the READ side — query endpoints for telemetry, attributes, checklists, and alarms, plus data export in CSV/JSON/PDF formats.

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- All queries go to TimescaleDB (time-series) or PostgreSQL (lifecycle) depending on data type
- Telemetry queries use TimescaleDB continuous aggregates (telemetry_hourly, telemetry_daily) for aggregations
- Export limits are configurable via SystemConfig (max rows, max date range, max concurrent exports)
- PDF export uses PDFKit (NOT puppeteer)
- All query endpoints respect multi-tenant isolation (tenant_id filtering)
- Alarm lifecycle: single row, updated in place (ACTIVE → ACKNOWLEDGED → CLEARED)
- Alarm acknowledge/clear require reauth + electronic signature

WHAT TO BUILD:

1. TELEMETRY QUERY ENDPOINTS (apps/api/src/modules/telemetry/routes.ts):
   GET /api/telemetry/latest/:entityId
   - Returns latest values from LatestTelemetry table (PG, not TSDB)
   - Optional ?keys=temp,humidity to filter specific keys

   GET /api/telemetry/timeseries/:entityId
   - Required: startTime, endTime, keys
   - Optional: interval (raw, 1h, 1d), aggregation (avg, min, max, sum, count, last)
   - If interval=raw → query ts_telemetry directly
   - If interval=1h → query telemetry_hourly continuous aggregate
   - If interval=1d → query telemetry_daily continuous aggregate
   - Response: {key: [{ts, value}]} per key
   - Max date range: read from SystemConfig `query.max_date_range_days`

   GET /api/telemetry/keys/:entityId
   - List all telemetry keys ever recorded for entity (from DataStream table)
   - Includes: key name, data type, unit, last value, last updated

2. ATTRIBUTE QUERY ENDPOINTS:
   GET /api/attributes/latest/:entityId
   - Current attribute values (from entity record in PG)

   GET /api/attributes/history/:entityId
   - Attribute change history from ts_attributes
   - Parameters: startTime, endTime, keys
   - Response includes: old value, new value, changed by, timestamp

3. CHECKLIST QUERY ENDPOINTS:
   GET /api/checklists/responses/:entityId
   - List checklist submissions for entity
   - Filter by: templateId, status, dateRange, submittedBy

   GET /api/checklists/responses/:responseId
   - Full response detail including all field values, signatures, review chain

   GET /api/checklists/reviews/:entityId
   - List reviews with approval status (Performed/Checked/Verified)

4. ALARM ENDPOINTS (apps/api/src/modules/alarms/routes.ts):
   GET  /api/alarms               — List alarms (filter: status, severity, entityId, type, assignee)
   GET  /api/alarms/:id           — Get alarm detail
   POST /api/alarms/:id/acknowledge — Acknowledge (requires reauth + e-sig, audit trail)
   POST /api/alarms/:id/clear     — Clear (requires reauth + e-sig, audit trail)

   Alarm lifecycle (single row updates):
   - ACTIVE: created by rule chain, has severity (CRITICAL/MAJOR/MINOR/WARNING), type, details
   - ACKNOWLEDGED: user acknowledges, records acknowledgedBy + acknowledgedAt + signature
   - CLEARED: user clears OR auto-cleared by rule chain, records clearedBy + clearedAt

   Electronic signature on acknowledge/clear:
   - Require password re-entry (reauth)
   - Create ElectronicSignature record (§11.50 compliant)
   - Bind to alarm record (cryptographic hash of alarm data + signature)
   - Audit trail entry

5. DATA EXPORT ENDPOINTS (apps/api/src/modules/export/routes.ts):
   POST /api/export/telemetry     — Export telemetry data
   POST /api/export/attributes    — Export attribute history
   POST /api/export/checklists    — Export checklist responses
   POST /api/export/alarms        — Export alarm history

   All export endpoints:
   - Accept: entityId, startTime, endTime, keys, format (csv|json|pdf)
   - Validate date range against SystemConfig `export.max_date_range_days`
   - Validate row count against SystemConfig `export.max_rows`
   - For large exports: enqueue to BullMQ "export" queue, return job ID
   - For small exports (<1000 rows): return inline
   - Track concurrent exports against SystemConfig `export.max_concurrent`

   CSV Formatter (apps/api/src/modules/export/formatters/csv-formatter.ts):
   - Standard CSV with headers
   - Timestamps in ISO 8601
   - Include metadata row (export date, entity, date range, exported by)

   JSON Formatter:
   - Structured JSON with metadata envelope
   - Pretty-printed option

   PDF Formatter (apps/api/src/modules/export/formatters/pdf-formatter.ts):
   - Use PDFKit (NOT puppeteer)
   - Header: DigiLog logo, entity name, date range, exported by
   - Table format with pagination
   - Footer: page numbers, "21 CFR Part 11 Compliant Export" watermark
   - Electronic signature section at bottom

6. RETENTION MANAGEMENT:
   GET  /api/retention/policies     — List current retention settings per hypertable
   PUT  /api/retention/policies     — Update retention (SUPER_ADMIN, requires RETENTION_MANAGE)
   - Updates TimescaleDB retention policies via SQL
   - Audit trail for compliance

VERIFICATION:
- GET /api/telemetry/timeseries with interval=1h → uses continuous aggregate, returns aggregated data
- GET /api/telemetry/latest → returns from LatestTelemetry (fast, no TSDB query)
- POST /api/alarms/:id/acknowledge → reauth required → e-sig created → audit trail → alarm status=ACKNOWLEDGED
- POST /api/export/telemetry with format=csv → downloads CSV with metadata header
- Large export (>1000 rows) → returns job ID → poll for completion → download
- Date range exceeding max → 422 with error message
```

## Relevant Spec Sections

- **Section 8**: Telemetry query API (latest, timeseries, keys, aggregation)
- **Section 8.5**: Alarm lifecycle (states, transitions, signatures)
- **Section 10**: Data export (formats, limits, large export queueing)
- **Section 10.3**: Retention management API
- **Section 11.2**: Telemetry query endpoints table
- **Section 11.3**: Alarm CRUD endpoints
- **Section 11.5**: Export endpoints
- **Section 3.2**: Continuous aggregates (telemetry_hourly, telemetry_daily)
- **Section 3.3**: Electronic signature schema (§11.50 fields)
