# Telemetry

Time-series data from devices stored in TimescaleDB hypertables with compression.

## Ingestion
- **MQTT:** Topic `digilog/v1/<uns-path>/telemetry` (via EMQX broker)
- **HTTP:** `POST /api/data/telemetry` (with device access token)
- **Processing:** BullMQ worker queues messages for rule chain evaluation and TimescaleDB storage

## Storage
- **Full history:** `digilog_tsdb` (TimescaleDB hypertables with compression)
- **Latest values:** `digilog_db` (latest_telemetry table for fast lookups)
- **Atomic upsert:** SQL-level atomic telemetry upsert prevents race conditions

> **Important:** The time-series database is `digilog_tsdb`, NOT `digilog_db`.

## Data Types
Numeric (double), String, Boolean, JSON

## Querying
| Endpoint | Description |
|----------|-------------|
| `GET /api/queries/telemetry/latest` | Latest values for an entity |
| `GET /api/queries/telemetry/timeseries` | Historical time-series with aggregation |
| `GET /api/queries/telemetry/keys` | Available telemetry keys for entity |
| `GET /api/queries/telemetry/attributes` | Device attributes |

### Aggregation Functions
MIN, MAX, AVG, SUM, COUNT -- with configurable time buckets for downsampling.

## Real-Time Display
- SWR polling for periodic updates
- WebSocket for live telemetry streaming
- Auto-refresh in Entity Detail > Telemetry tab

## Retention
Configurable per data type in **Config > Retention**. Default: 365 days for telemetry. Archive support for long-term storage.

## Export
Telemetry data can be exported via:
- `GET /api/queries/export/telemetry` -- CSV/JSON export with time range
- Database backup (includes all hypertable data)
