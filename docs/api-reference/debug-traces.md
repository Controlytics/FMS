# Debug Traces API

The Debug Traces API provides endpoints for inspecting data ingestion pipeline execution traces. Each trace records the full journey of a message through the pipeline stages, including timing, errors, and warnings.

---

## List Traces

### GET /api/data/debug-traces

Paginated list of pipeline execution traces with optional filters.

```bash
curl "http://your-server/api/data/debug-traces?\
status=FAILED&transport=MQTT&page=1&pageSize=20" \
  -H "Authorization: Bearer USER_TOKEN"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `pageSize` | integer | Items per page (default: 20, max: 100) |
| `status` | string | `SUCCESS`, `SUCCESS_WITH_WARNINGS`, `FAILED`, `DLQ` |
| `transport` | string | `MQTT`, `HTTP`, or `WebSocket` |
| `errorCode` | string | Filter by error code (partial match) |
| `entityId` | string | Filter by entity ID or name (partial match) |
| `from` | ISO 8601 | Start date |
| `to` | ISO 8601 | End date |

**Response (200):**
```json
{
  "data": [
    {
      "id": "trace-uuid",
      "time": "2026-03-01T08:00:00Z",
      "messageId": "msg-uuid",
      "entityId": "entity-uuid",
      "entityName": "Temperature Sensor TP-42",
      "transport": "MQTT",
      "messageType": "POST_TELEMETRY",
      "payloadSize": 128,
      "stages": [
        { "name": "auth", "durationMs": 2, "status": "OK" },
        { "name": "validate", "durationMs": 1, "status": "OK" },
        { "name": "enrich", "durationMs": 5, "status": "OK" },
        { "name": "ruleChain", "durationMs": 12, "status": "OK" },
        { "name": "save", "durationMs": 8, "status": "OK" }
      ],
      "finalStatus": "SUCCESS",
      "totalDurationMs": 28
    }
  ],
  "total": 1523,
  "page": 1,
  "limit": 20,
  "totalPages": 77
}
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`

---

## Trace Detail

### GET /api/data/debug-traces/:id

Get full detail for a single trace including all stage information, warnings, and error details.

```bash
GET /api/data/debug-traces/TRACE_UUID
```

**Failed trace example:**
```json
{
  "id": "trace-uuid",
  "time": "2026-03-01T08:00:05Z",
  "entityName": "Unknown Device",
  "transport": "HTTP",
  "messageType": "POST_TELEMETRY",
  "payloadSize": 256,
  "finalStatus": "FAILED",
  "failedStage": "auth",
  "errorCode": "INVALID_TOKEN",
  "errorMessage": "Device access token not found",
  "totalDurationMs": 3
}
```

---

## Statistics

### GET /api/data/debug-traces/stats

Get pipeline performance statistics.

```bash
GET /api/data/debug-traces/stats
```

**Response (200):**
```json
{
  "successRate1h": 99.5,
  "successRate24h": 98.2,
  "avgDurationMs": 25,
  "topErrors": [
    { "code": "INVALID_TOKEN", "count": 15 },
    { "code": "RATE_LIMIT_EXCEEDED", "count": 3 }
  ],
  "byTransport": {
    "MQTT": { "total": 5230, "failed": 12 },
    "HTTP": { "total": 1420, "failed": 85 }
  }
}
```

---

## Toggle Entity Tracing

### PUT /api/data/debug-traces/entity/:entityId/toggle

Enable or disable detailed pipeline tracing for a specific entity. Useful for debugging data flow issues without enabling traces for all entities.

```bash
curl -X PUT "http://your-server/api/data/debug-traces/entity/ENTITY_UUID/toggle" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Response (200):**
```json
{ "entityId": "entity-uuid", "traceEnabled": true }
```

---

## Pipeline Stages

Each trace records the following pipeline stages:

| Stage | Description |
|-------|-------------|
| `auth` | Device token authentication |
| `validate` | Payload format validation |
| `enrich` | Entity lookup, metadata enrichment |
| `ruleChain` | Rule chain processing |
| `save` | Time-series database write |
| `latestCache` | Latest telemetry cache update |
| `connectivity` | Connectivity status update |

---

## Trace Statuses

| Status | Description |
|--------|-------------|
| `SUCCESS` | All stages completed successfully |
| `SUCCESS_WITH_WARNINGS` | Completed with non-fatal warnings |
| `FAILED` | Processing failed at a specific stage |
| `DLQ` | Message sent to dead letter queue after max retries |

---

## Next Steps

- [Telemetry API](telemetry.md) — Data ingestion endpoints
- [Rule Chain API](rule-chains.md) — Rule chain management
- [Data Retention](retention.md) — Trace retention policies
