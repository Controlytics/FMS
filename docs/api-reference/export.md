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

---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
