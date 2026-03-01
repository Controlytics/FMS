# Data Export

DigiLog provides comprehensive data export capabilities for telemetry, attributes, alarms, and checklist data. Exports support CSV and JSON formats with configurable date ranges and filtering.

---

## Export Types

| Data Type | Endpoint | Scope | Source |
|-----------|----------|-------|--------|
| Telemetry | `/api/queries/export/telemetry/:entityId` | Per entity | TSDB `ts_telemetry` |
| Attributes | `/api/queries/export/attributes/:entityId` | Per entity | TSDB `ts_attributes` |
| Alarms | `/api/queries/export/alarms` | Global | PostgreSQL `alarms` |
| Checklists | `/api/queries/export/checklist/:entityId` | Per entity | TSDB + PostgreSQL |

---

## How to Export

### From the Entity Detail Panel

1. Navigate to an entity in the **Entity Explorer**
2. Open the entity detail panel
3. Select the **Telemetry**, **Attributes**, or **Checklists** tab
4. Click the **Export** button
5. Choose date range and format (CSV or JSON)
6. The file downloads automatically

### From the Alarms Page

1. Navigate to **Alarms** in the sidebar
2. Apply filters (status, severity, date range)
3. Click **Export**
4. Choose format and download

### Via API

```bash
# Export telemetry as CSV
curl "http://your-server/api/queries/export/telemetry/ENTITY_UUID?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&format=csv&keys=temperature,humidity" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o telemetry.csv

# Export alarms as JSON
curl "http://your-server/api/queries/export/alarms?\
from=2026-02-01T00:00:00Z&to=2026-03-01T00:00:00Z&format=json&status=CLEARED" \
  -H "Authorization: Bearer USER_TOKEN" \
  -o alarms.json
```

---

## Export Limits

| Setting | Default | Description |
|---------|---------|-------------|
| Maximum date range | 90 days | Configurable via `export.max_range_days` |
| Maximum rows | 1,000,000 | Configurable via `export.max_rows` |
| Truncation header | `X-DigiLog-Truncated: true` | Indicates result was truncated |

---

## CSV Format

Exported CSV files include:
- Header row with column names
- One data point per row
- Proper escaping for commas, quotes, and newlines
- UTF-8 encoding

### Telemetry CSV Columns

| Column | Description |
|--------|-------------|
| `time` | Timestamp (ISO 8601) |
| `entity_id` | Entity UUID |
| `key` | Telemetry key name |
| `value_num` | Numeric value |
| `value_str` | String value |
| `value_bool` | Boolean value |
| `value_json` | JSON value |
| `uns_path` | UNS path |
| `source` | Data source |
| `source_ip` | Source IP address |

---

## Checklist Export

Checklist exports combine data from two sources:
- **TSDB** (`ts_checklist_responses`): Raw answers, hash, timestamps
- **PostgreSQL** (`ChecklistReview`): Review workflow status, checked/verified by

This provides a complete audit trail of checklist submissions and their review status.

---

## Permission

All export endpoints require `ASSET_VIEW` permission.

---

## Next Steps

- [Export API Reference](../../api-reference/export.md) — Full API documentation
- [Data Retention](../../api-reference/retention.md) — Data lifecycle
- [Telemetry](../telemetry/telemetry.md) — Data ingestion
