# API Reference: UNS (Unified Namespace)

See the interactive Swagger UI at `/docs` for complete endpoint documentation with request/response schemas.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/uns/tree | Full UNS tree (hierarchical view) |
| GET | /api/uns/entity/:entityId | Get entity's UNS mapping |
| PUT | /api/uns/entity/:entityId | Override UNS path (UNS_MANAGE permission) |
| POST | /api/uns/entity/:entityId/move | Initiate move (returns impact report) |
| POST | /api/uns/entity/:entityId/move/confirm | Confirm cascade after review |
| GET | /api/uns/search?path=pattern | Search by wildcard pattern |

## ISA-95 Hierarchy
Enterprise > Site > Area > Line > Cell > Entity

## Path Format
`digilog/v1/{Enterprise}/{Site}/{Area}/{Line}/{Cell}/{EntityName}`

## MQTT Wildcards
- `+` (single level): `Plant/+/Line1/#`
- `#` (multi-level, must be last): `Plant/Area1/#`

## Cascade Move
Moving an entity in the hierarchy triggers cascade updates to all descendant UNS paths. Impact report shows all affected paths before confirmation.

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
