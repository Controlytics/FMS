# API Reference: Users

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/users | List users (paginated, filterable by role/status) |
| POST | /api/users | Create user |
| GET | /api/users/:id | Get user detail |
| PUT | /api/users/:id | Update user |
| DELETE | /api/users/:id | Soft delete user |
| POST | /api/users/:id/enable | Enable user |
| POST | /api/users/:id/disable | Disable user |
| POST | /api/users/:id/unlock | Unlock locked user |
| POST | /api/users/:id/reset-password | Reset user password |

## Roles (6 hierarchical)
SUPER_ADMIN (6), ADMIN (5), SUPERVISOR (4), MAINTENANCE (3), OPERATOR (2), VIEWER (1)

## User Status Values
Active, Disabled, Locked, Expired, Pending Password Change

## Features
- Users can only manage users at equal or lower hierarchy levels
- Configurable User ID format via `user-id` config
- Bulk operations (up to 50 users)
- Session termination on role/status change

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
