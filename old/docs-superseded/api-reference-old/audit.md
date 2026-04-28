# API Reference: Audit

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/audit | List audit entries (filter: action, user, entity, date range) |
| GET | /api/audit/:id | Get audit entry detail |
| POST | /api/export/audit | Export audit trail (CSV/JSON/PDF) |

## Audit Entry Fields
Timestamp, User, Role, Action, Target, Before/After Value, IP, User Agent, Session ID, Checksum (SHA-256 hash-chain)

## Audited Actions
Core operations (login, CRUD, config changes) plus Phase 2 filter operations (cycle start/advance/complete, bypass, checklist submission, PM execution, retirement/replacement).

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
