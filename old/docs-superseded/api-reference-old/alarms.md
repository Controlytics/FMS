# API Reference: Alarms

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/alarms | List alarms (filter: status, severity, entityId, type, assignee) |
| GET | /api/alarms/:id | Get alarm detail |
| POST | /api/alarms/:id/acknowledge | Acknowledge alarm (requires reauth + e-sig) |
| POST | /api/alarms/:id/clear | Clear alarm (requires reauth + e-sig) |

## Alarm Lifecycle
ACTIVE -> ACKNOWLEDGED -> CLEARED (or MANUALLY_CLEARED)

## Severity Levels
WARNING, ALARM, CRITICAL

## Electronic Signatures
Acknowledge and clear operations require re-authentication and create ElectronicSignature records per 21 CFR Part 11 sections 11.50 and 11.70.

## Phase 2 Integration
Filter operations can generate alarms (e.g., PM overdue, bypass deviation). These follow the same alarm lifecycle and appear in the alarm dashboard.

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
