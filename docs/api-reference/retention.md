# Data Retention API

The Data Retention API provides endpoints for configuring retention policies and executing data lifecycle operations including archival and deletion.

---

## Retention Configuration

### GET /api/queries/retention

Get the current data retention policies.

```bash
GET /api/queries/retention
```

**Response (200):**
```json
{
  "telemetry": { "retentionDays": 365, "compressionAfterDays": 7 },
  "attributes": { "retentionDays": 730 },
  "events": { "retentionDays": 365 },
  "traces": { "retentionHours": 48 },
  "checklists": { "retentionDays": 2555 },
  "autoEnabled": false,
  "requiresArchive": true
}
```

**Permission:** `RETENTION_MANAGE`

---

### POST /api/queries/retention

Create or update data retention policies.

```bash
curl -X POST "http://your-server/api/queries/retention" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "telemetry": { "retentionDays": 180, "compressionAfterDays": 7 },
    "attributes": { "retentionDays": 365 },
    "events": { "retentionDays": 180 },
    "traces": { "retentionHours": 24 },
    "checklists": { "retentionDays": 2555 },
    "autoEnabled": true,
    "requiresArchive": false
  }'
```

---

## Data Deletion

### POST /api/queries/retention/execute

Delete data older than a specified number of days. Requires explicit confirmation.

```bash
curl -X POST "http://your-server/api/queries/retention/execute" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "telemetry",
    "olderThanDays": 365,
    "confirmed": true
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataType` | string | Yes | `telemetry`, `attributes`, `events`, `traces`, or `checklists` |
| `olderThanDays` | integer | Yes | Delete data older than N days |
| `confirmed` | boolean | Yes | Must be `true` to execute |

**Response (200):**
```json
{ "deleted": 15420, "dataType": "telemetry", "olderThanDays": 365 }
```

> **Warning:** This operation is **irreversible**. Data is permanently deleted from the time-series database.

---

### POST /api/queries/retention/execute-range

Delete data within a specific time range, optionally scoped to an entity.

```bash
curl -X POST "http://your-server/api/queries/retention/execute-range" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "telemetry",
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-01-31T23:59:59Z",
    "entityId": "ENTITY_UUID",
    "confirmed": true
  }'
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataType` | string | Yes | `telemetry`, `attributes`, `events`, `traces`, `checklists`, or `alarms` |
| `from` | ISO 8601 | Yes | Range start |
| `to` | ISO 8601 | Yes | Range end |
| `entityId` | UUID | No | Scope to specific entity |
| `confirmed` | boolean | Yes | Must be `true` |

> **Note:** The `alarms` data type deletes from the main PostgreSQL database. All other types delete from the time-series database. Checklist deletion also removes corresponding `ChecklistReview` records.

---

## Additional Endpoints

### PUT /api/queries/retention

Update an existing retention policy.

### DELETE /api/queries/retention

Delete a retention policy and revert to defaults.

---

## Data Type → TSDB Table Mapping

| Data Type | Table | Time Column |
|-----------|-------|-------------|
| `telemetry` | `ts_telemetry` | `time` |
| `attributes` | `ts_attributes` | `time` |
| `events` | `ts_device_events` | `time` |
| `traces` | `ts_pipeline_traces` | `time` |
| `checklists` | `ts_checklist_responses` | `time` |
| `alarms` | `alarms` (PostgreSQL) | `createdAt` |

---

## Next Steps

- [Telemetry API](telemetry.md) — Data ingestion and querying
- [Data Export](export.md) — Export before deletion
- [System Configuration](configuration.md) — Retention settings UI
