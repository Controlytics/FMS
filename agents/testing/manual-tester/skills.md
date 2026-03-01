# Manual Tester Agent — Skills & Context

## Identity
**Role:** Live platform testing specialist. Performs manual end-to-end testing of data ingestion (MQTT/HTTP), UI verification in the browser, delete operations, connectivity validation, and database state checks against the running DigiLog instance.
**Trigger:** Runs when new data ingestion features ship, UI changes affect entity pages, or before release sign-off.

---

## 1. Core Responsibility

**Validate the live running platform by publishing real data and verifying it flows through the entire pipeline:**

```
Test Data → MQTT/HTTP Ingestion → BullMQ Worker → Rule Engine
  → TimescaleDB (ts_telemetry, ts_attributes)
    → Latest Telemetry (Prisma)
      → Frontend UI (Telemetry/Attributes/Connectivity tabs)
        → Delete operations → Verify removal
```

---

## 2. Prerequisites

Before starting any test:

```bash
ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106

# Verify all services are running
pm2 list                                              # digilog-api: online
redis-cli ping                                        # PONG
curl -s http://localhost:18083/api/v5/status           # emqx is running (MQTT only)
curl -s http://localhost:3000/api/system-health        # API healthy
curl -s -o /dev/null -w "%{http_code}" http://localhost/  # 200 (nginx/frontend)
```

If services are down:
```bash
sudo systemctl start redis-server
sudo systemctl start emqx
pm2 restart digilog-api --update-env
```

Frontend accessible at: `http://3.108.185.106` (port 80, nginx)

---

## 3. Test Entities

### 3.1 Entity Inventory

| Entity | ID | Template | Transport |
|--------|----|----------|-----------|
| Pipeline-Sensor-001 | `f865b8a8-3c6d-4864-bd14-1017ee84b560` | MQTT Pressure Sensor | MQTT |
| FlowMeter-WTP-001 | `e5c629a7-28c6-449f-b182-b0f94bf747fd` | HTTP Flow Meter | HTTP |
| VibSensor-Motor-001 | `f2134b34-a1b0-4bc9-9680-73546a1cc8d6` | WebSocket Vibration Sensor | HTTP* |
| TemperatureSensor | `25f6bcc0-5987-404e-a9d6-07e30c22a000` | Temperature Sensor v2 | MQTT |

*VibSensor template is "WebSocket" but actual ingestion uses HTTP (no WS device ingestion endpoint).

### 3.2 Access Tokens

| Entity | Access Token |
|--------|-------------|
| Pipeline-Sensor-001 | `a25a3b98edbcbf3ceb47e5aa318fae8820b9394883dcee21c551e2eb6b1e01df` |
| FlowMeter-WTP-001 | `bdadb00c06fd4e76a2be212d0e833136148e5a99ee2e1fcce8277780593f69e5` |
| VibSensor-Motor-001 | `96a1101195525160a83e761d33a66a041523b36c319b11e43025599092c95f5d` |
| TemperatureSensor | `Welcome@123` |

### 3.3 UNS Paths & MQTT Topics

| Entity | Telemetry Topic | Attributes Topic |
|--------|-----------------|------------------|
| Pipeline-Sensor-001 | `digilog/v1/pipeline-sensor-001/telemetry` | `digilog/v1/pipeline-sensor-001/attributes` |
| FlowMeter-WTP-001 | `digilog/v1/flowmeter-wtp-001/telemetry` | `digilog/v1/flowmeter-wtp-001/attributes` |
| VibSensor-Motor-001 | `digilog/v1/vibsensor-motor-001/telemetry` | `digilog/v1/vibsensor-motor-001/attributes` |
| TemperatureSensor | `digilog/v1/temperaturesensor/telemetry` | `digilog/v1/temperaturesensor/attributes` |

**CRITICAL:** MQTT topics MUST use UNS format `digilog/v1/<uns-path>/telemetry`, NOT ThingsBoard-style `v1/devices/me/telemetry`.

### 3.4 Telemetry & Attribute Keys

| Entity | Telemetry Keys (units) | Attribute Keys |
|--------|----------------------|----------------|
| Pipeline-Sensor-001 | pressure (PSI), temperature (°C) | serialNumber, maxPressure |
| FlowMeter-WTP-001 | flowRate (L/min), totalVolume (-) | meterModel, calibrationDate |
| VibSensor-Motor-001 | vibrationX (mm/s), vibrationY (mm/s) | motorId, installDate |
| TemperatureSensor | temperature (°C), humidity (%) | firmwareVersion, location |

---

## 4. Test Workflows

### 4.1 HTTP Data Ingestion

```bash
BASE="http://localhost:3000/api"

# Publish telemetry (FlowMeter-WTP-001)
curl -X POST "$BASE/data/telemetry" \
  -H "Authorization: Bearer bdadb00c06fd4e76a2be212d0e833136148e5a99ee2e1fcce8277780593f69e5" \
  -H "Content-Type: application/json" \
  -d '{"flowRate": 15.5, "totalVolume": 2500}'

# Publish attributes (FlowMeter-WTP-001)
curl -X POST "$BASE/data/attributes" \
  -H "Authorization: Bearer bdadb00c06fd4e76a2be212d0e833136148e5a99ee2e1fcce8277780593f69e5" \
  -H "Content-Type: application/json" \
  -d '{"meterModel": "FM-100", "calibrationDate": "2026-01-15"}'

# Publish telemetry (VibSensor-Motor-001)
curl -X POST "$BASE/data/telemetry" \
  -H "Authorization: Bearer 96a1101195525160a83e761d33a66a041523b36c319b11e43025599092c95f5d" \
  -H "Content-Type: application/json" \
  -d '{"vibrationX": 2.3, "vibrationY": 1.8}'
```

**Verify:** HTTP 200 response with `{"success": true}` or similar.

### 4.2 MQTT Data Ingestion

```bash
# Publish telemetry (Pipeline-Sensor-001) via mosquitto_pub
mosquitto_pub -h localhost -p 1883 \
  -u "a25a3b98edbcbf3ceb47e5aa318fae8820b9394883dcee21c551e2eb6b1e01df" \
  -t "digilog/v1/pipeline-sensor-001/telemetry" \
  -m '{"pressure": 100.5, "temperature": 25.3}' -q 1

# Publish telemetry (TemperatureSensor)
mosquitto_pub -h localhost -p 1883 \
  -u "Welcome@123" \
  -t "digilog/v1/temperaturesensor/telemetry" \
  -m '{"temperature": 22.1, "humidity": 65.0}' -q 1
```

For bulk publishing, use Node.js scripts:
- `scripts/publish-http.js` — Bulk HTTP publish for FlowMeter and VibSensor
- `scripts/publish-mqtt.js` — Bulk MQTT publish for Pipeline-Sensor with correct UNS topics

### 4.3 UI Verification (Browser)

1. Navigate to `http://3.108.185.106` → login as admin (Admin@123, force:true)
2. Go to **Entities** page → click target entity in tree
3. **Telemetry tab:**
   - Select time range (Last 1h, Last 6h, etc.)
   - Verify history data from `ts_telemetry` (TSDB) with pagination ("X total points")
   - Switch to **Live** view → verify real-time values from `latest_telemetry` (Prisma)
4. **Attributes tab:**
   - Verify attribute key/value pairs display correctly
   - History data from `ts_attributes` (TSDB)
5. **Connectivity tab:**
   - Status: ONLINE/OFFLINE
   - Protocol, Last Activity, Source IP
   - Access Token (masked), Status (ACTIVE), Rate Limit
   - MQTT Topics section shows correct UNS paths
   - Code Snippets (curl, python, nodejs, arduino) show correct tokens/URLs

### 4.4 Delete Data Testing

**Via UI:**
1. Navigate to entity → Telemetry/Attributes/Alarms tab
2. Select a specific time range (NOT "All Time" or "Live")
3. Click **Delete Data** button (only visible for SUPER_ADMIN/ADMIN)
4. Confirm dialog shows correct from/to dates → click **Delete**
5. Verify table shows "No telemetry data in selected time range"

**Via API:**
```bash
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

curl -X POST "$BASE/retention/execute-range" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataType": "telemetry",
    "from": "2026-01-01T00:00:00Z",
    "to": "2026-12-31T23:59:59Z",
    "entityId": "e5c629a7-28c6-449f-b182-b0f94bf747fd",
    "confirmed": true
  }'
```

**Delete types:** `telemetry`, `attributes`, `events`, `traces`, `alarms`

### 4.5 RBAC Verification for Delete

```bash
# Login as OPERATOR (should NOT have delete permission)
OP_TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" \
  -d '{"username":"RB0001","password":"Test@1234","force":true}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

# Attempt delete → should get 403
curl -s -X POST "$BASE/retention/execute-range" \
  -H "Authorization: Bearer $OP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dataType":"telemetry","from":"2026-01-01T00:00:00Z","to":"2026-12-31T23:59:59Z","entityId":"e5c629a7-28c6-449f-b182-b0f94bf747fd","confirmed":true}'
```

---

## 5. Database Verification Queries

```bash
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db
```

```sql
-- Count telemetry by entity
SELECT entity_id, key, COUNT(*) FROM ts_telemetry GROUP BY entity_id, key ORDER BY entity_id;

-- Count attributes by entity
SELECT entity_id, key, COUNT(*) FROM ts_attributes GROUP BY entity_id, key ORDER BY entity_id;

-- Check latest_telemetry (Prisma-managed, powers Live view)
SELECT "entityId", key, "valueNum", "valueStr", "updatedAt"
FROM latest_telemetry ORDER BY "updatedAt" DESC;

-- Entity IDs reference
SELECT id, name FROM asset_instances ORDER BY name;

-- Check device credentials
SELECT id, "entityId", "accessToken", "credentialType"
FROM device_credentials ORDER BY "createdAt" DESC;

-- Check connectivity status
SELECT "entityId", status, protocol, "lastActivityAt"
FROM connectivity_status ORDER BY "lastActivityAt" DESC;

-- Verify delete worked (should return 0)
SELECT COUNT(*) FROM ts_telemetry WHERE entity_id = '<entity-uuid>';
```

---

## 6. Known Issues & Gotchas

| Issue | Cause | Fix |
|-------|-------|-----|
| MQTT data not in ts_telemetry | Wrong topic format | Use `digilog/v1/<uns-path>/telemetry` (NOT `v1/devices/me/telemetry`) |
| MQTT data not arriving | Redis down | `sudo systemctl start redis-server` then `pm2 restart digilog-api` |
| MQTT data not arriving | EMQX down | `sudo systemctl start emqx` then `pm2 restart digilog-api` |
| MQTT data not arriving | API MQTT client disconnected | Restart PM2, check logs for `[MQTT] Connected` |
| HTTP returns 401 | Wrong auth header | Use `Authorization: Bearer <access_token>` (device token, not user JWT) |
| Delete button not visible | Not ADMIN/SUPER_ADMIN | Login as admin |
| Delete button not visible | "Live" or "All Time" selected | Select a specific time range |
| No history data in UI | Data only in latest_telemetry | Ensure TSDB env vars point to `digilog_db` (port 5432, not 5433) |
| WebSocket ingestion fails | No WS device endpoint | Use HTTP for WebSocket-template entities |

---

## 7. Test Results Tracking

After each test session, update results:

| Entity | Protocol | Telemetry | Attributes | Delete | Status |
|--------|----------|-----------|------------|--------|--------|
| Pipeline-Sensor-001 | MQTT | ✓/✗ (count) | ✓/✗ (count) | ✓/✗ | PASS/FAIL |
| FlowMeter-WTP-001 | HTTP | ✓/✗ (count) | ✓/✗ (count) | ✓/✗ | PASS/FAIL |
| VibSensor-Motor-001 | HTTP | ✓/✗ (count) | ✓/✗ (count) | ✓/✗ | PASS/FAIL |
| TemperatureSensor | MQTT | ✓/✗ (count) | ✓/✗ (count) | ✓/✗ | PASS/FAIL |

### Items Not Yet Tested
- Alarms tab delete (need alarm data)
- Custom time range for delete
- Non-admin role delete attempt (should deny)
- Events and traces delete
- Rate limiting on data ingestion
- Large dataset performance (1000+ records)

---

## 8. Reporting

After each manual test run, report:
1. **Service Health:** All services running? Any restarts needed?
2. **Ingestion Results:** Per-entity pass/fail for HTTP and MQTT
3. **UI Verification:** Data visible in browser? Correct values? Pagination working?
4. **Delete Results:** Delete successful? DB confirms removal?
5. **New Issues:** Document in `documentation/Bug_Resolution_Log.md`

---

## 9. Connection Details

| Resource | Details |
|----------|---------|
| EC2 | `ssh -i /f/claude/21cfrlogbook/21cfrbook.pem ubuntu@3.108.185.106` |
| DB | `PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db` |
| API | `http://localhost:3000/api` |
| Web | `http://3.108.185.106` (nginx port 80) |
| Admin | username: `admin`, password: `Admin@123`, force: `true` |
| EMQX Dashboard | `http://localhost:18083` |
| Test Scripts | `scripts/publish-http.js`, `scripts/publish-mqtt.js` |
| Reference Data | `references/entities.md`, `references/test-results.md` |
