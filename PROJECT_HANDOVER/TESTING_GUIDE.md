# Testing Guide

## Test Infrastructure
- **Framework:** Vitest
- **Location:** `apps/api/src/**/__tests__/`
- **Run:** `npm run test` from root

## Manual Test Scenarios

### 1. Login Flow
- [ ] Login with valid credentials -> redirects to dashboard
- [ ] Login with wrong password -> shows error with attempts remaining
- [ ] Login 5 times wrong -> account locks
- [ ] Login from second tab -> session conflict dialog
- [ ] Force login -> terminates old session
- [ ] SUPER_ADMIN login with LDAP enabled -> still uses local auth
- [ ] LDAP user login -> authenticates via LDAP server
- [ ] Expired password -> redirected to change-password

### 2. User Management
- [ ] SUPER_ADMIN creates ADMIN with organization assignment
- [ ] ADMIN creates users (cannot create SUPER_ADMIN or ADMIN)
- [ ] Edit user -> change role, org assignment
- [ ] Disable user -> cannot login
- [ ] Lock user -> unlock with temp password
- [ ] Bulk delete users

### 3. Organization Management
- [ ] Create organization with name + slug
- [ ] Edit organization name/description
- [ ] Deactivate org -> users cannot login
- [ ] Delete org -> users/entities unassigned (not deleted)
- [ ] Org detail -> view users, entities, templates tabs

### 4. Entity/Asset Management
- [ ] Create template with attributes, telemetry keys, alarm rules
- [ ] Create entity from template
- [ ] Assign entity to organization
- [ ] Create entity relationships (parent-child)
- [ ] Generate QR code for entity
- [ ] Scan QR -> opens entity detail

### 5. Rule Chain
- [ ] Create new rule chain
- [ ] Add nodes (filter, transform, action)
- [ ] Connect nodes with edges
- [ ] Configure each node
- [ ] Save and activate
- [ ] Test with sample data -> verify execution path
- [ ] Debug mode -> check execution traces

### 6. Data Ingestion
- [ ] HTTP POST telemetry -> stored in TimescaleDB
- [ ] MQTT publish -> telemetry ingested
- [ ] Invalid device token -> rejected
- [ ] Rate limit exceeded -> throttled
- [ ] Template alarm rule triggers -> alarm created

### 7. Notifications
- [ ] In-app notification -> badge count updates
- [ ] Mark as read -> count decreases
- [ ] Email notification -> delivered to inbox
- [ ] Notification rule triggers on alarm

### 8. LDAP Integration
- [ ] Configure LDAP -> test connection (success/failure)
- [ ] LDAP user first login -> auto-provisioned
- [ ] LDAP group -> role mapping works
- [ ] Disable LDAP -> local auth restored
- [ ] SUPER_ADMIN always local auth

### 9. Filter Cleaning Operations (Phase 2)
- [ ] Assign cleaning profile to filter via filter profile
- [ ] Start cleaning cycle -> cycle created with IN_PROGRESS status
- [ ] Advance through stages -> stage events recorded
- [ ] Checklist gate blocks advance until submitted
- [ ] Submit checklist answers -> gate cleared, can advance
- [ ] Bypass stage -> deviation event recorded with reason
- [ ] Complete cycle (reach END node) -> status changes to COMPLETED
- [ ] View cleaning cycle history -> all cycles listed with status
- [ ] View filter events -> complete event timeline
- [ ] View traceability -> full history per filter

### 10. Cleaning Profile Management (Phase 2)
- [ ] Create cleaning profile with pipeline stages
- [ ] Add WASH_IN, WASH_OUT, DRY_IN, DRY_OUT, STORAGE_IN, STORAGE_OUT stages
- [ ] Add CHECKLIST nodes between stages
- [ ] Connect stages to define flow
- [ ] Edit existing cleaning profile
- [ ] Delete cleaning profile (only if no active cycles)

### 11. PM Schedules (Phase 2)
- [ ] Create PM schedule with entries
- [ ] View PM schedule list
- [ ] Execute PM entry -> status changes
- [ ] Mark execution as COMPLETED
- [ ] View execution history

### 12. Equipment Groups (Phase 2)
- [ ] Create equipment group (AHU)
- [ ] Add instruments to group
- [ ] View AHU dashboard with group status
- [ ] Remove instruments from group
- [ ] Delete equipment group

### 13. Bulk Upload & Lifecycle (Phase 2)
- [ ] Bulk upload filters via CSV/Excel
- [ ] Verify uploaded filters appear in filter profiles
- [ ] Retire a filter -> retirement event recorded
- [ ] Replace a filter -> replacement linked to retired filter
- [ ] Scan filter QR code -> opens filter status

## Edge Cases
- Login with empty username/password
- Create user with duplicate email
- Delete org with active users
- Submit telemetry with invalid JSON
- Rule chain with infinite loop (cycle detection)
- Concurrent sessions from same user
- Password that doesn't meet policy
- File upload exceeding 5MB limit
- Start cycle on filter with no cleaning profile assigned
- Advance past END node (should auto-complete)
- Submit checklist for wrong stage
- Bypass a CHECKLIST node (should it be allowed?)
- Start second cycle while first is IN_PROGRESS
- Bulk upload with duplicate filter identifiers
- Retire filter with active cleaning cycle

## API Testing
Use Swagger UI at `/docs` or:
```bash
# Health check
curl http://localhost:3000/api/health

# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123"}'

# Get filter current state (Phase 2)
curl http://localhost:3000/api/filters/<filter-id>/current-state \
  -H "Authorization: Bearer <token>"

# Start cleaning cycle (Phase 2)
curl -X POST http://localhost:3000/api/filters/<filter-id>/start-cycle \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"filterSet": "SET_A"}'

# List cleaning cycles (Phase 2)
curl "http://localhost:3000/api/filter/cycles?page=1&limit=10" \
  -H "Authorization: Bearer <token>"

# List filter events (Phase 2)
curl "http://localhost:3000/api/filter/events?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

## Important Testing Notes
- Always curl endpoints after backend changes -- compile clean does not mean it works
- The default password is `Admin@123`
- The database is `digilog_tsdb`, NOT `digilog_db`
- Frontend uses light theme only -- verify no dark mode styling appears
- Input sanitization strips HTML -- test with `<script>` tags in text fields

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
