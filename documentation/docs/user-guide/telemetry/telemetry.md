# Telemetry

Time-series data from devices stored in TimescaleDB.

## Ingestion
- MQTT: topic v1/devices/me/telemetry (via EMQX broker)
- HTTP: POST /api/v1/{token}/telemetry

## Storage
- Full history in digilog_tsdb (TimescaleDB hypertable with compression)
- Latest values in digilog_db (latest_telemetry table)

## Data Types
Numeric (double), String, Boolean, JSON

## Querying
- Latest values: GET /api/queries/telemetry/:entityId
- History: GET /api/queries/telemetry/:entityId/history (with aggregation: MIN, MAX, AVG, SUM, COUNT)
- Time buckets for downsampling

## Retention
Configurable per data type in Config > Retention. Default: 365 days for telemetry.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
