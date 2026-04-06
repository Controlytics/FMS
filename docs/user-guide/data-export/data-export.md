# Data Export

Export telemetry, alarms, audit data, attributes, and checklists to CSV, JSON, or PDF.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/export/telemetry | Export telemetry data |
| POST | /api/export/attributes | Export attribute history |
| POST | /api/export/checklists | Export checklist responses |
| POST | /api/export/alarms | Export alarm history |
| POST | /api/export/audit | Export audit trail |

## Formats
- **CSV** — Standard CSV with headers, ISO 8601 timestamps, metadata row
- **JSON** — Structured JSON with metadata envelope, pretty-print option
- **PDF** — PDFKit-generated with header, table pagination, "21 CFR Part 11 Compliant Export" watermark, e-signature section

## Processing
- Small exports (<1000 rows): returned inline
- Large exports: run as background jobs via BullMQ, returns job ID for polling
- Configurable limits via SystemConfig (max rows, max date range, max concurrent exports)
