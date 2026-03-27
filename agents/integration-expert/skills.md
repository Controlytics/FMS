# Integration Expert Agent — Skills & Context

## Identity
**Role:** Build integrity guardian. Ensures backend, frontend, database, data ingestion, and all functional components remain intact and correctly integrated after every code change or build.
**Trigger:** Runs after every build, code merge, or module change.

---

## 1. Core Responsibility

**After every change, verify that nothing is broken across the full stack:**

```
Frontend (React 19) ←→ API (Fastify 5) ←→ Database (PostgreSQL 16 + Prisma 6)
                           ↕                        ↕
                     MQTT/WebSocket           TimescaleDB (Telemetry)
                           ↕                        ↕
                     Rule Engine              BullMQ (Redis)
```

---

## 2. Integration Validation Checklist

### 2.1 Build Integrity
```bash
# SSH into EC2
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

# Full rebuild
cd /home/ubuntu/21cfrlogbook
rm -rf apps/api/dist
npm run build    # Turborepo builds: shared → db → queue → api → web

# Restart API
pm2 restart digilog-api
sleep 3
pm2 logs digilog-api --lines 10 --nostream

# Verify API is responding
curl -s http://localhost:3000/api/system-health | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"
```

**Check for:**
- TypeScript compilation errors (tsc)
- Vite build errors (React frontend)
- PM2 restart success (status: online)
- No crash loops (uptime > 5s)
- AJV/Fastify schema warnings in stderr (`strict mode: use allowUnionTypes`)

### 2.2 API ↔ Database Sync
Verify Prisma schema matches actual database:
```bash
cd /home/ubuntu/21cfrlogbook
npx prisma db pull --print   # Compare with schema.prisma
npx prisma validate          # Schema validation
```

**Known patterns to watch:**
- Prisma model fields must match route response schemas (Fastify `fast-json-stringify` silently strips undeclared fields — BUG-001/006/007 pattern)
- Nullable fields in Prisma (`String?`) must be `{ type: ['string', 'null'] }` or `oneOf` in Fastify schemas
- New DB fields need matching route response schema declarations

### 2.3 Backend ↔ Frontend Contract
Verify the API responses match what the frontend expects:

| Module | Backend Route | Frontend Consumer | Key Fields |
|--------|--------------|-------------------|------------|
| Auth | `POST /api/auth/login` | `apps/web/src/lib/auth.ts` | token, user.role, requirePasswordChange |
| Users | `GET /api/users` | `apps/web/src/routes/users/list.tsx` | data[], pagination |
| Templates | `GET /api/assets/templates` | `apps/web/src/routes/assets/templates.tsx` | data[], all schema fields |
| Templates (detail) | `GET /api/assets/templates/:id` | `apps/web/src/routes/assets/template-detail.tsx` | ALL fields including data ingestion |
| Instances | `GET /api/assets/instances` | `apps/web/src/routes/assets/index.tsx` | tree hierarchy |
| Audit | `GET /api/audit` | `apps/web/src/routes/audit/index.tsx` | entries, pagination |
| Config | `GET /api/config/:key` | `apps/web/src/routes/config/*.tsx` | config value |
| Notifications | `GET /api/notifications` | `apps/web/src/hooks/use-auth.ts` | notifications[], unreadCount |
| Alarms | `GET /api/alarms` | `apps/web/src/routes/alarms/index.tsx` | alarms[], severity |
| Rule Chains | `GET /api/rule-chains` | `apps/web/src/routes/rule-chains/index.tsx` | chains[], nodes |

### 2.4 RBAC Integration
Verify permission enforcement is consistent:

```bash
# Check: Route permissions match DB role permissions
# Routes use: requirePermission('ASSET_TEMPLATE_CREATE')
# DB stores: ASSET_TEMPLATE_MANAGE (parent)
# RBAC plugin resolves: _MANAGE implies _CREATE/_UPDATE/_DELETE/_VIEW/_READ/_EXPORT
```

**Validation script:**
```bash
# 1. Extract all permissions used in routes
grep -roh "'[A-Z_]*'" apps/api/src/modules/ --include='*.ts' | sort -u | grep -E 'CREATE|UPDATE|DELETE|VIEW|READ|MANAGE'

# 2. Compare with DB permissions
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "SELECT name, permissions FROM roles WHERE is_active = true;"

# 3. Check for mismatches
```

### 2.5 Data Ingestion Pipeline
```bash
# Check MQTT broker
systemctl status emqx

# Check MQTT client connection in API logs
pm2 logs digilog-api --nostream | grep MQTT

# Check Redis (for BullMQ)
redis-cli ping

# Check ingestion worker
pm2 logs digilog-api --nostream | grep IngestionWorker

# Check maintenance worker
pm2 logs digilog-api --nostream | grep Maintenance
```

### 2.6 Frontend Build Verification
```bash
# Check nginx is serving frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost/
# Should be 200

# Check static assets are being served
ls -la /home/ubuntu/21cfrlogbook/apps/web/dist/assets/ | wc -l
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
  -d '{"username":"admin","password":"Admin@123","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# 3. Users list
curl -s -o /dev/null -w "Users: %{http_code}\n" "$BASE/users" -H "Authorization: Bearer $TOKEN"

# 4. Templates list
curl -s -o /dev/null -w "Templates: %{http_code}\n" "$BASE/assets/templates" -H "Authorization: Bearer $TOKEN"

# 5. Audit log
curl -s -o /dev/null -w "Audit: %{http_code}\n" "$BASE/audit" -H "Authorization: Bearer $TOKEN"

# 6. Roles
curl -s -o /dev/null -w "Roles: %{http_code}\n" "$BASE/roles" -H "Authorization: Bearer $TOKEN"

# 7. Notifications
curl -s -o /dev/null -w "Notifications: %{http_code}\n" "$BASE/notifications" -H "Authorization: Bearer $TOKEN"

# 8. Config
curl -s -o /dev/null -w "Config: %{http_code}\n" "$BASE/config/password-policy" -H "Authorization: Bearer $TOKEN"
```

All should return HTTP 200. Any non-200 response is a **build regression**.

---

## 4. Known Integration Points & Fragile Zones

### 4.1 Fastify Response Schema (HIGH RISK)
**Pattern:** `fast-json-stringify` strips fields not declared in route response schema.
**Impact:** Frontend receives incomplete data, features break silently.
**Mitigation:** Every time a Prisma model field is added, the corresponding route response schema MUST be updated.

**Files at risk:**
- `apps/api/src/modules/assets/routes/template.routes.ts` (7 data ingestion fields were missing — BUG-007)
- `apps/api/src/modules/assets/routes/instance.routes.ts`
- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/roles/routes.ts`

### 4.2 Fastify Body Schema (HIGH RISK)
**Pattern:** AJV rejects request bodies that don't match schema (null values, wrong types).
**Impact:** Frontend sends valid data but API returns 400/500.
**Mitigation:** Nullable fields must use `oneOf: [{type: 'string'}, {type: 'null'}]` or `type: ['string', 'null']`.

### 4.3 Zod ↔ Fastify Schema Drift
**Pattern:** `packages/shared/src/schemas/` defines Zod schemas. Route schemas are hand-written JSON Schema. They can drift apart.
**Mitigation:** After changing Zod schemas, verify the matching Fastify route schemas.

### 4.4 Permission Name Drift
**Pattern:** `packages/shared/src/types/permissions.ts` defines permission constants. Routes use string literals. DB stores JSON arrays.
**Mitigation:** All three sources must agree. The RBAC plugin supports `_MANAGE` → granular resolution.

---

## 5. Integration Failure Response Protocol

When a failure is detected:

1. **Identify** — Which layer broke? (build, API, DB, frontend, MQTT)
2. **Isolate** — What changed since last known-good state? (`git diff`, `git log`)
3. **Report** — Log the failure with: endpoint, expected vs actual, error message
4. **Notify** — Alert the relevant Testing Agent and Project Manager
5. **Fix** — Apply minimal fix, rebuild, re-run smoke tests
6. **Document** — Update `documentation/Bug_Resolution_Log.md` with new entry

---

## 6. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://3.108.185.106` (nginx) |
| Build | `cd /home/ubuntu/21cfrlogbook && rm -rf apps/api/dist && npm run build` |
| Restart | `pm2 restart digilog-api` |
| Logs | `pm2 logs digilog-api --lines 50 --nostream` |
| Admin | username: `admin`, password: `Admin@123`, force: `true` |


## Phase 2 Coverage
- Filter management module testing (operations, profiles, cycles, checklists)
- PM scheduling module testing
- Quality audit: 43 issues found, 35 fixed (commit 429538f)

