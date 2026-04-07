# API Reference: Backup

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/backup/create | Create backup (SUPER_ADMIN) |
| GET | /api/backup/list | List available backups |
| POST | /api/backup/restore | Restore from backup (SUPER_ADMIN, requires reauth) |
| GET | /api/backup/status | Check backup/restore job status |

## Features
- SHA-256 integrity verification on backup files
- Configurable backup settings via `backup` config definition
- Audit trail entry for all backup/restore operations
- Includes both PostgreSQL (57 Prisma models) and TimescaleDB data

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
