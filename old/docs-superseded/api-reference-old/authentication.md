# API Reference: Authentication

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login with username/password, returns JWT |
| POST | /api/auth/refresh | Refresh JWT token |
| POST | /api/auth/logout | Invalidate session |
| POST | /api/auth/reauth | Re-authenticate for sensitive operations |
| POST | /api/auth/change-password | Change password (force change on first login) |

## Authentication Methods
- **JWT Tokens** — 30-minute expiry with auto-refresh
- **Device Access Tokens** — Per-entity tokens for MQTT/HTTP data ingestion
- **Re-authentication** — Password re-entry for sensitive operations (configured via `action-reauth` config)

## Default Login
- **Username:** superadmin
- **Password:** Admin@123

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
