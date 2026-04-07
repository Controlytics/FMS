# Manual Tester Agent — Skills & Context

## Identity
**Role:** Live platform testing specialist. Performs manual end-to-end testing of data ingestion (MQTT/HTTP), UI verification in the browser, delete operations, connectivity validation, and database state checks against the running DigiLog instance.
**Trigger:** Runs when new features ship, UI changes affect pages, or before release sign-off.

### Key Testing Facts
- Device token for ingestion uses `Authorization: Bearer <token>` header
- Telemetry endpoint: `POST /api/data/telemetry` (NOT `/api/data`)
- Login requires `force: true` to terminate existing sessions
- Default login: `superadmin` / `Admin@123`
- Alarm acknowledge/clear requires `signerFullName` + `meaning` fields
- Template creation requires `transportType: "HTTP"` when `dataIngestionEnabled: true`
- Relationship creation uses `sourceAssetId`/`targetAssetId`/`relationshipType`

---

## 1. Core Responsibility

**Validate the live running platform by publishing real data and verifying it flows through the entire pipeline:**

```
Test Data -> MQTT/HTTP Ingestion -> BullMQ Worker -> Rule Engine
  -> TimescaleDB (ts_telemetry, ts_attributes)
    -> Latest Telemetry (Prisma)
      -> Frontend UI (Telemetry/Attributes/Connectivity tabs)
        -> Delete operations -> Verify removal
```

---

## 2. Prerequisites

Before starting any test:

```bash
# Verify all services are running
pm2 list                                              # digilog-api: online
redis-cli ping                                        # PONG
curl -s http://localhost:18083/api/v5/status           # emqx is running (MQTT only)
curl -s http://localhost:3000/api/system-health        # API healthy
curl -s -o /dev/null -w "%{http_code}" http://localhost/  # 200 (nginx/frontend)
```

---

## 3. Test Workflows

### 3.1 HTTP Data Ingestion
```bash
curl -X POST "http://localhost:3000/api/data/telemetry" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"flowRate": 15.5, "totalVolume": 2500}'
```

### 3.2 MQTT Data Ingestion
MQTT topics MUST use UNS format: `digilog/v1/<uns-path>/telemetry`

### 3.3 UI Verification
1. Navigate to entities page -> click entity -> Telemetry/Attributes tabs
2. Verify history data from TSDB, Live view from latest_telemetry

### 3.4 Delete Data Testing
Via UI or API: `POST /api/retention/execute-range`
Delete types: `telemetry`, `attributes`, `events`, `traces`, `alarms`, `checklists`

### 3.5 Phase 2 Testing
1. **Filter Operations**: Start cycle -> advance through stages -> submit checklists -> complete
2. **Cleaning Profile Editor**: Create profile -> add nodes in visual editor -> validate -> save
3. **Checklist Gate**: Verify advance blocked until checklist submitted
4. **Bypass/Deviation**: Bypass stage -> verify deviation event logged
5. **PM Schedule**: Create schedule -> add monthly entries -> execute
6. **Traceability**: View filter event history timeline
7. **Bulk Upload**: Import CSV -> verify filters created
8. **Retirement/Replacement**: Retire filter -> replace -> verify traceability

---

## 4. Database Verification Queries

```sql
-- Count telemetry by entity
SELECT entity_id, key, COUNT(*) FROM ts_telemetry GROUP BY entity_id, key;

-- Check latest_telemetry
SELECT "entityId", key, "valueNum", "valueStr", "updatedAt" FROM latest_telemetry;

-- Check filter events
SELECT id, "filterId", "eventType", "stageKey", "createdAt" FROM filter_events ORDER BY "createdAt" DESC LIMIT 10;

-- Check cleaning cycles
SELECT id, "filterId", status, "startedAt", "completedAt" FROM cleaning_cycles ORDER BY "startedAt" DESC LIMIT 10;
```

---

## 5. Known Issues & Gotchas

| Issue | Cause | Fix |
|-------|-------|-----|
| MQTT data not in ts_telemetry | Wrong topic format | Use `digilog/v1/<uns-path>/telemetry` |
| MQTT data not arriving | Redis or EMQX down | Restart services |
| HTTP returns 401 | Wrong auth header | Use `Authorization: Bearer <access_token>` |
| Delete button not visible | Not ADMIN/SUPER_ADMIN | Login as superadmin |
| Delete button not visible | "Live" or "All Time" selected | Select specific time range |

---

## 6. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0` |
| API | `http://localhost:3000/api` |
| Web | `http://34.232.224.0` (nginx port 80) |
| Default Login | username: `superadmin`, password: `Admin@123` |
| EMQX Dashboard | `http://34.232.224.0:18083` |

## Phase 2 Coverage
- Filter management manual testing (operations, profiles, cycles, checklists)
- PM scheduling manual testing
- Equipment groups, retirement/replacement, bulk upload
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
