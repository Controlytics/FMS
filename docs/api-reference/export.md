# Data Export API

The Data Export API provides endpoints for exporting telemetry, attributes, alarms, and checklist data in CSV or JSON format.

---

## Common Parameters

All export endpoints share these parameters:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | ISO 8601 | Yes | Start date |
| `to` | ISO 8601 | Yes | End date |
| `format` | string | No | `csv` (default) or `json` |

**Date Range Limits:**
- Maximum range: Configurable via `export.max_range_days` (default: 90 days)
- Maximum rows: Configurable via `export.max_rows` (default: 1,000,000)
- If the result exceeds the row limit, the response includes an `X-DigiLog-Truncated: true` header

**Permission:** `ASSET_VIEW` (all export endpoints)

---

## Endpoints

### GET /api/queries/export/telemetry/:entityId

Export telemetry time-series data for an entity.

```bash
curl "http://your-server/api/queries/export/telemetry/ENTITY_UUID?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&format=csv&keys=temperature,humidity" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o telemetry.csv
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `keys` | string | Comma-separated telemetry keys to include (optional) |

**CSV columns:** `time`, `entity_id`, `key`, `value_num`, `value_str`, `value_bool`, `value_json`, `uns_path`, `source`, `source_ip`

---

### GET /api/queries/export/attributes/:entityId

Export attribute change history for an entity.

```bash
curl "http://your-server/api/queries/export/attributes/ENTITY_UUID?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&key=firmware_version" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o attributes.csv
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | string | Filter by specific attribute key (optional) |

**CSV columns:** `time`, `entity_id`, `scope`, `key`, `value_num`, `value_str`, `value_bool`, `value_json`, `updated_by`, `uns_path`, `source_ip`

---

### GET /api/queries/export/alarms

Export alarms across all entities.

```bash
curl "http://your-server/api/queries/export/alarms?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&status=CLEARED&format=json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o alarms.json
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `ACTIVE`, `ACKNOWLEDGED`, or `CLEARED` |
| `severity` | string | `CRITICAL`, `MAJOR`, `MINOR`, `WARNING`, or `INFO` |
| `entityId` | UUID | Filter by entity |

---

### GET /api/queries/export/checklist/:entityId

Export checklist submission history for an entity. Combines data from the PostgreSQL review workflow (`ChecklistReview`) and the TSDB response history (`ts_checklist_responses`).

```bash
curl "http://your-server/api/queries/export/checklist/ENTITY_UUID?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o checklists.csv
```

**CSV columns:** `time`, `entity_id`, `template_id`, `checklist_id`, `submitted_by`, `answers`, `answers_hash`, `uns_path`, `source_ip`, `review_status`, `review_sequence`, `checked_by`, `checked_at`, `checked_remarks`

---

## Export Status (Future)

### GET /api/queries/export/status/:jobId

Check the status of an async export job. Currently returns a stub response — async exports will be available in a future update.

---

## Next Steps

- [Telemetry API](telemetry.md) — Data ingestion and querying
- [Alarms API](alarms.md) — Alarm querying
- [Data Retention](retention.md) — Data lifecycle management
