# Known Issues & Limitations

## Known Bugs

### 1. TelemetryBatcher INSERT Error -- FIXED
- **Error:** `INSERT has more target columns than expressions`
- **Location:** `packages/db/src/telemetry-batcher.ts:146`
- **Status:** FIXED -- Column mismatch resolved; batch inserts now match the schema correctly.

### 2. React Error #300 on Page Load
- **Error:** "Objects are not valid as a React child"
- **Trigger:** Occasionally on SUPER_ADMIN login when stale cache exists
- **Workaround:** Hard refresh (Ctrl+Shift+R) resolves it
- **Status:** Intermittent, likely stale SWR cache

## Limitations

### Performance
- Rule chain editor can lag with >50 nodes (ReactFlow limitation)
- Audit trail queries on large datasets are slow without date range filter
- Cleaning cycle history queries may be slow with many filter events (no pagination on event sub-queries)

### Security
- LDAP bind password stored in SystemConfig JSONB (not encrypted at rest, only masked in API)
- JWT secret in .env file (standard practice but consider vault for production)
- No HTTPS configured (relies on Nginx for TLS termination)

### Scalability
- Single PM2 process in cluster mode (single server deployment)
- TimescaleDB on same host as PostgreSQL (same port 5432)
- No horizontal scaling configured (would need Redis-based session sharing)

### Phase 2 Limitations
- Cleaning profile pipeline editor does not support undo/redo
- Filter bypass does not require electronic signature (deviation is logged but not signed)
- PM schedule does not have automated notification when execution is overdue
- Bulk filter upload supports CSV/Excel but has no template download
- Equipment group instrument assignment is manual only (no auto-discovery from MQTT devices)

## Workarounds

| Issue | Workaround |
|-------|-----------|
| User locked out | Admin can unlock via user edit page |
| LDAP server unreachable | SUPER_ADMIN can always login locally |
| Stale frontend | Hard refresh or clear sessionStorage |
| Org users can't login after org deactivated | Reactivate org or reassign users |
| Filter stuck in cycle | Admin can view cycle events in traceability to diagnose |
| PM execution missed | Manually mark as MISSED and create new execution |

## Pending Fixes
- [x] Fix telemetry batcher column mismatch -- FIXED
- [x] Add pagination to organization list endpoint -- FIXED
- [ ] Add per-organization LDAP configuration -- Feature request: allow each org its own LDAP config
- [ ] Add per-organization rate limiting (aggregate across all devices in an org)
- [ ] Implement automated retention jobs (autoEnabled flag currently has no effect)
- [ ] Add electronic signatures to filter bypass operations
- [ ] Add PM schedule overdue notifications
- [ ] Complete Telegram notification channel implementation
- [ ] Add Slack/Telegram to notification delivery channels (currently only email/SMS)

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
