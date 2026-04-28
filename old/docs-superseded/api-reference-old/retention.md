# API Reference: Retention

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/retention/policies | List current retention settings per hypertable |
| PUT | /api/retention/policies | Update retention (SUPER_ADMIN, RETENTION_MANAGE permission) |

## Features
- Configurable retention per TimescaleDB hypertable
- Updates TimescaleDB retention policies via SQL
- Audit trail for all retention changes
- Default: 365 days for telemetry, 48 hours for pipeline traces
- Managed via `retention` config definition

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
