# API Reference: Export

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/export/telemetry | Export telemetry data |
| POST | /api/export/attributes | Export attribute history |
| POST | /api/export/checklists | Export checklist responses |
| POST | /api/export/alarms | Export alarm history |
| POST | /api/export/audit | Export audit trail |

## Formats
CSV, JSON, PDF (with 21 CFR Part 11 compliant watermark and e-signature section)

## Features
- Configurable columns and time ranges
- Large exports (>1000 rows) run as background jobs via BullMQ
- Configurable limits via SystemConfig (max rows, max date range, max concurrent)
- PDF export uses PDFKit with header, table pagination, and compliance footer
