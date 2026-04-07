# API Reference: Telemetry

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Data Ingestion Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/data/telemetry | Device Token | Send telemetry data |
| POST | /api/data/attributes | Device Token | Update attributes |
| GET | /api/data/attributes | Device Token | Get shared attributes |
| POST | /api/data/checklist | User JWT | Submit checklist |
| POST | /api/data/binary | Device Token | Upload binary data |
| POST | /api/data/event | Device Token | Send device event |

## Query Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/telemetry/latest/:entityId | Latest values (from LatestTelemetry cache) |
| GET | /api/telemetry/timeseries/:entityId | Time-series query with aggregation |
| GET | /api/telemetry/keys/:entityId | List all telemetry keys for entity |
| GET | /api/attributes/latest/:entityId | Current attribute values |
| GET | /api/attributes/history/:entityId | Attribute change history |

## Aggregation Options
interval: raw, 1h, 1d | aggregation: avg, min, max, sum, count, last

## Data Types
Numeric (double), String, Boolean, JSON

## MQTT Ingestion
Topic: `v1/devices/me/telemetry` via EMQX broker (port 1883/8883)

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
