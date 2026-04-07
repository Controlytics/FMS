# API Reference: Entities

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/assets | List entity instances (paginated, filterable) |
| POST | /api/assets | Create entity instance from template |
| GET | /api/assets/:id | Get entity detail |
| PUT | /api/assets/:id | Update entity |
| DELETE | /api/assets/:id | Soft delete entity |
| GET | /api/assets/:id/relationships | Get entity relationships |
| POST | /api/assets/:id/relationships | Create relationship |
| GET | /api/assets/:id/telemetry | Get entity telemetry |
| GET | /api/assets/:id/attributes | Get entity attributes |

## Entity Status Values
Active, Inactive, Under Maintenance, Decommissioned, Quarantine

## Hierarchy (ISA-95)
Enterprise > Site > Area > Line > Equipment > Sensor

## 12 Relationship Types
CONTAINS/CONTAINED_IN, FEEDS/FED_BY, DEPENDS_ON/DEPENDED_ON_BY, MONITORS/MONITORED_BY, BACKS_UP/BACKED_UP_BY, CONNECTED_TO, CUSTOM

## Identifiers
QR Code, RFID, NFC, Barcode, Manual

## Phase 2 Filter Fields
Entity instances designated as filters include: `filter_profile_id`, `current_lifecycle_state`, `current_cycle_id`, `filter_set` (SET_A/SET_B).

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
