# API Reference: Debug Traces

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/debug/traces | List pipeline debug traces |
| GET | /api/debug/traces/:id | Get trace detail with per-stage breakdown |
| PUT | /api/debug/traces/config | Toggle trace enabled per entity/template/globally |

## Trace Data
Each trace records the full pipeline execution with per-stage timing, status, error codes, and warnings. Stored in ts_pipeline_traces (TimescaleDB) with 48-hour retention policy.

## Trace Status Values
- SUCCESS — All stages passed
- SUCCESS_WITH_WARNINGS — All stages passed but with warnings (e.g., timestamp corrected)
- FAILED — One or more stages failed
- DLQ — Failed and routed to dead letter queue

## Real-time Streaming
Traces are published to Redis pub/sub for real-time WebSocket streaming to the debug panel in the rule chain editor.
