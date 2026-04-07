# API Reference: Configuration

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/config/registry/manifest | List all 23 config modules with metadata |
| GET | /api/config/dynamic/:moduleKey | Get config for a specific module |
| PUT | /api/config/dynamic/:moduleKey | Update config (audit trail, some require reauth) |

## Config Definitions (23)
action-reauth, alarm-columns, audit-templates, backup, branding, datetime, field-ids, filter-cleaning-reasons, filter-lifecycle-states, filter-pm-schedule, help, login-security, notification-email, notification-logs, notification-rules, notification-slack, notification-sms, notification-telegram, pagination, password-policy, retention, role-privileges, roles, session, sidebar-config, uns, user-id

## Auto-Discovery
All config modules are auto-discovered at startup via the config registry. Each module declares its schema, defaults, and validation rules.

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
