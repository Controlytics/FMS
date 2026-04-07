# Integration Expert Agent — Skills & Context

## Identity
**Role:** Build integrity guardian. Ensures backend, frontend, database, data ingestion, and all functional components remain intact and correctly integrated after every code change or build.
**Trigger:** Runs after every build, code merge, or module change.

---

## 1. Core Responsibility

**After every change, verify that nothing is broken across the full stack:**

```
Frontend (React 19) <-> API (Fastify 5) <-> Database (PostgreSQL 18 + Prisma)
                           |                        |
                     MQTT/WebSocket           TimescaleDB (Telemetry)
                           |                        |
                     Rule Engine (77 nodes)    BullMQ (Redis 5)
```

---

## 2. Integration Validation Checklist

### 2.1 Build Integrity
```bash
# Full rebuild
cd /home/ubuntu/21cfrlogbook
rm -rf apps/api/dist
npm run build    # Turborepo builds: shared -> db -> queue -> api -> web

# Restart API
pm2 restart digilog-api
sleep 3
pm2 logs digilog-api --lines 10 --nostream

# Verify API is responding
curl -s http://localhost:3000/api/system-health
```

**Check for:**
- TypeScript compilation errors (tsc)
- Vite build errors (React frontend)
- PM2 restart success (status: online)
- No crash loops (uptime > 5s)

### 2.2 API <-> Database Sync
Verify Prisma schema matches actual database:
```bash
cd /home/ubuntu/21cfrlogbook
npx prisma db pull --print   # Compare with schema.prisma
npx prisma validate          # Schema validation
```

**57 Prisma models, 17 enums** must match the database state.

### 2.3 Backend <-> Frontend Contract
Verify the API responses match what the frontend expects:

| Module | Backend Route | Frontend Consumer | Key Fields |
|--------|--------------|-------------------|------------|
| Auth | `POST /api/auth/login` | `apps/web/src/lib/auth.ts` | token, user.role, requirePasswordChange |
| Users | `GET /api/users` | `apps/web/src/routes/users/list.tsx` | data[], pagination |
| Templates | `GET /api/assets/templates` | `apps/web/src/routes/assets/templates.tsx` | data[], all schema fields |
| Instances | `GET /api/assets/instances` | `apps/web/src/routes/assets/index.tsx` | tree hierarchy |
| Audit | `GET /api/audit` | `apps/web/src/routes/audit/index.tsx` | entries, pagination |
| Config | `GET /api/config/:key` | `apps/web/src/routes/config/*.tsx` | config value |
| Alarms | `GET /api/alarms` | `apps/web/src/routes/alarms/index.tsx` | alarms[], severity |
| Rule Chains | `GET /api/rule-chains` | `apps/web/src/routes/rule-chains/index.tsx` | chains[], nodes |
| Filters | `GET /api/filters/:id/current-state` | `apps/web/src/routes/filter-management/filter-operations.tsx` | state, nextActions |
| Cleaning Profiles | `GET /api/filter-cleaning-profiles` | `apps/web/src/routes/filter-management/cleaning-profile-list.tsx` | data[], versions |
| PM Schedules | `GET /api/pm-schedules` | `apps/web/src/routes/pm-schedules/` | schedules[], entries |

### 2.4 RBAC Integration
Verify permission enforcement is consistent:
- Routes use: `requirePermission('ASSET_TEMPLATE_CREATE')`
- DB stores: `ASSET_TEMPLATE_MANAGE` (parent)
- RBAC plugin resolves: `_MANAGE` implies `_CREATE/_UPDATE/_DELETE/_VIEW/_READ/_EXPORT`
- 52+ permissions across all modules including Phase 2

### 2.5 Data Ingestion Pipeline
```bash
# Check MQTT broker
systemctl status emqx

# Check Redis (for BullMQ)
redis-cli ping

# Check ingestion worker
pm2 logs digilog-api --nostream | grep IngestionWorker
```

10-stage pipeline: normalize -> resolve -> trace -> rule engine -> store

### 2.6 Phase 2 Integration Points
```bash
# Verify filter operations endpoints
curl -s "$BASE/filters/test-id/current-state" -H "Authorization: Bearer $TOKEN"

# Verify cleaning profiles
curl -s "$BASE/filter-cleaning-profiles" -H "Authorization: Bearer $TOKEN"

# Verify checklist profiles
curl -s "$BASE/checklist-profiles" -H "Authorization: Bearer $TOKEN"

# Verify PM schedules
curl -s "$BASE/pm-schedules" -H "Authorization: Bearer $TOKEN"

# Verify equipment groups
curl -s "$BASE/equipment-groups" -H "Authorization: Bearer $TOKEN"
```

---

## 3. Post-Build Smoke Tests

Run these after every build to confirm core functionality:

```bash
BASE="http://localhost:3000/api"

# 1. Health check
curl -s "$BASE/system-health"

# 2. Login
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"Admin@123","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# 3. Core endpoints (should all return 200)
curl -s -o /dev/null -w "Users: %{http_code}\n" "$BASE/users" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "Templates: %{http_code}\n" "$BASE/assets/templates" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "Audit: %{http_code}\n" "$BASE/audit" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "Roles: %{http_code}\n" "$BASE/roles" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "Config: %{http_code}\n" "$BASE/config/password-policy" -H "Authorization: Bearer $TOKEN"

# 4. Phase 2 endpoints
curl -s -o /dev/null -w "CleaningProfiles: %{http_code}\n" "$BASE/filter-cleaning-profiles" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "ChecklistProfiles: %{http_code}\n" "$BASE/checklist-profiles" -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w "PmSchedules: %{http_code}\n" "$BASE/pm-schedules" -H "Authorization: Bearer $TOKEN"
```

---

## 4. Known Integration Points & Fragile Zones

### 4.1 Fastify Response Schema (HIGH RISK)
**Pattern:** `fast-json-stringify` strips fields not declared in route response schema.
**Mitigation:** Every time a Prisma model field is added, the corresponding route response schema MUST be updated.

### 4.2 Fastify Body Schema (HIGH RISK)
**Pattern:** AJV rejects request bodies that don't match schema (null values, wrong types).
**Mitigation:** Nullable fields must use `oneOf: [{type: 'string'}, {type: 'null'}]`.

### 4.3 Permission Name Drift
**Pattern:** `packages/shared/src/types/permissions.ts` defines permission constants. Routes use string literals. DB stores JSON arrays.
**Mitigation:** All three sources must agree. The RBAC plugin supports `_MANAGE` -> granular resolution.

### 4.4 Phase 2 Pipeline Graph Validation
**Pattern:** Cleaning profile pipeline graphs must have valid START/END nodes, connected stages, and valid checklist profile references.
**Mitigation:** Server-side graph validation on save.

---

## 5. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://34.232.224.0` (nginx) |
| Build | `cd /home/ubuntu/21cfrlogbook && rm -rf apps/api/dist && npm run build` |
| Restart | `pm2 restart digilog-api` |
| Default Login | username: `superadmin`, password: `Admin@123` |

## Phase 2 Coverage
- Filter management module integration (operations, profiles, cycles, checklists)
- PM scheduling module integration
- Equipment groups and entity assignments
- Retirement/replacement workflow integration
- Bulk upload integration
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

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
