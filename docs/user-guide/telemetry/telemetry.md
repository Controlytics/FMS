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
