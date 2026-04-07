---
name: manual-tester
description: This skill should be used when the user asks to "test the app", "publish test data", "test delete functionality", "test telemetry", "test attributes", "test alarms", "test MQTT", "test HTTP ingestion", "verify data in browser", "run manual tests", "test entity pages", or needs to perform end-to-end manual testing of the DigiLog platform including data ingestion, UI verification, and delete operations.
version: 0.1.0
---

# Manual Tester — DigiLog Platform

This skill provides structured workflows for manually testing the DigiLog 21 CFR Part 11 platform. It covers data ingestion via MQTT and HTTP, UI verification in the browser, and data deletion testing.

## Prerequisites

Before starting any test:

1. Verify services are running on EC2:
   ```bash
   ssh -i ~/Downloads/21cfrbook.pem ubuntu@34.232.224.0 \
     "pm2 list && redis-cli ping && curl -s http://localhost:18083/api/v5/status"
   ```
   - PM2 digilog-api: must be `online`
   - Redis: must respond `PONG`
   - EMQX: must respond `emqx is running` (required for MQTT only)

2. If services are down, start them:
   ```bash
   sudo systemctl start redis-server
   sudo systemctl start emqx
   pm2 restart digilog-api --update-env
   ```

3. Access the frontend at `http://34.232.224.0` (port 80, nginx serves the SPA).

4. **Local dev (Windows):** Run `start-digilog.bat` from project root. Frontend at `http://localhost:5175`, API at `http://localhost:3000`.

5. Default login: `superadmin` / `Admin@123`

## Entity Reference

| Entity | Transport | Token | UNS Path |
|--------|-----------|-------|----------|
| Pipeline-Sensor-001 | MQTT | `a25a3b98...01df` | `digilog/v1/pipeline-sensor-001` |
| FlowMeter-WTP-001 | HTTP | `bdadb00c...69e5` | `digilog/v1/flowmeter-wtp-001` |
| VibSensor-Motor-001 | HTTP | `96a11011...95f5d` | `digilog/v1/vibsensor-motor-001` |
| TemperatureSensor | MQTT | `Welcome@123` | `digilog/v1/temperaturesensor` |

Full tokens and details in `references/entities.md`.

## Test Workflow 1: Data Ingestion

### HTTP Ingestion

To publish telemetry via HTTP, send POST requests with Bearer token:

```bash
curl -X POST "http://localhost:3000/api/data/telemetry" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"flowRate": 15.5, "totalVolume": 2500}'
```

To publish attributes via HTTP:
```bash
curl -X POST "http://localhost:3000/api/data/attributes" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"meterModel": "FM-100", "calibrationDate": "2026-01-15"}'
```

For bulk publishing (100+ records), use the Node.js scripts in `scripts/`.

### MQTT Ingestion

MQTT topics MUST use the UNS (Unified Namespace) format — NOT ThingsBoard-style topics:

- **Correct**: `digilog/v1/pipeline-sensor-001/telemetry`
- **WRONG**: `v1/devices/me/telemetry`

To publish via MQTT, authenticate with username=access_token:

```javascript
const client = mqtt.connect('mqtt://localhost:1883', {
  username: '<ACCESS_TOKEN>',
  password: '',
});
client.publish('digilog/v1/<uns-path>/telemetry', JSON.stringify({
  pressure: 100.5, temperature: 25.3
}), { qos: 1 });
```

### WebSocket Ingestion

WebSocket device data ingestion is NOT supported. The `/api/ws` endpoint is for user real-time subscriptions only. Use HTTP for entities with WebSocket transport type.

## Test Workflow 2: UI Verification

To verify data appears in the browser:

1. Navigate to `http://34.232.224.0` (or `http://localhost:5175` for local dev) → Entities page
2. Click the target entity in the tree
3. Click the **Telemetry** or **Attributes** tab
4. Select a time range (Last 1h, Last 6h, etc.) to see history data
5. The **Live** view shows real-time values from `latest_telemetry` (Prisma)
6. History data comes from `ts_telemetry` / `ts_attributes` (TSDB tables)
7. Verify record counts match expected (shown as "X total points" with pagination)

## Test Workflow 3: Delete Data

To test the Delete Data functionality:

1. Navigate to entity → Telemetry/Attributes/Alarms tab
2. Select a time range (must not be "All Time" or "Live")
3. Click **Delete Data** button (visible only for SUPER_ADMIN and ADMIN roles)
4. Confirm the dialog shows correct from/to dates
5. Click **Delete** to confirm
6. Verify the table shows "No telemetry data in selected time range" (or equivalent)
7. Verify in the database:
   ```bash
   PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db \
     -c "SELECT COUNT(*) FROM ts_telemetry; SELECT COUNT(*) FROM ts_attributes;"
   ```

### Delete Endpoint

The delete uses `POST /api/retention/execute-range` with body:
```json
{
  "dataType": "telemetry|attributes|events|traces|alarms",
  "from": "ISO-datetime",
  "to": "ISO-datetime",
  "entityId": "uuid",
  "confirmed": true
}
```

## Test Workflow 4: Connectivity Tab

To verify device connectivity information:

1. Navigate to entity → **Connectivity** tab
2. Verify: Status (ONLINE/OFFLINE), Protocol, Last Activity, Source IP
3. Verify: Access Token (masked), Status (ACTIVE), Rate Limit
4. Verify: MQTT Topics section shows correct UNS paths
5. Verify: Code Snippets (curl, python, nodejs, arduino) show correct tokens and URLs

## Database Verification Queries

```sql
-- Count telemetry by entity
SELECT entity_id, key, COUNT(*) FROM ts_telemetry GROUP BY entity_id, key;

-- Count attributes by entity
SELECT entity_id, key, COUNT(*) FROM ts_attributes GROUP BY entity_id, key;

-- Check latest_telemetry (Prisma-managed)
SELECT "entityId", key, "valueNum", "valueStr", "updatedAt" FROM latest_telemetry;

-- Entity IDs
SELECT id, name FROM asset_instances ORDER BY name;
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| MQTT data not in ts_telemetry | Wrong topic format | Use `digilog/v1/<uns-path>/telemetry` |
| MQTT data not in ts_telemetry | Redis down | Start Redis, restart PM2 |
| MQTT data not in ts_telemetry | API MQTT client not connected | Restart PM2 (checks logs for `[MQTT] Connected`) |
| HTTP returns 401 | Wrong auth header | Use `Authorization: Bearer <token>` |
| Delete button not visible | Not ADMIN/SUPER_ADMIN role | Log in as admin |
| Delete button not visible | "Live" or "All Time" selected | Select a specific time range |
| No history data in UI | Data in latest_telemetry only | Ensure TSDB env vars point to digilog_db |

## Additional Resources

### Reference Files
- **`references/entities.md`** — Full entity details, tokens, and UNS paths
- **`references/test-results.md`** — Previous test execution results

### Scripts
- **`scripts/publish-http.js`** — Bulk HTTP publish for FlowMeter and VibSensor
- **`scripts/publish-mqtt.js`** — Bulk MQTT publish for Pipeline-Sensor with correct UNS topics


## Test Workflow 5: Digital Filter Management (Phase 2)

### Filter Operations
```bash
# Start a cleaning cycle
curl -X POST "http://localhost:3000/api/filters/<filterId>/start-cycle" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Scheduled cleaning", "cleaningReasonId": "scheduled"}'

# Advance to next stage
curl -X POST "http://localhost:3000/api/filters/<filterId>/advance" \
  -H "Authorization: Bearer <JWT>"

# Submit checklist answers
curl -X POST "http://localhost:3000/api/filters/<filterId>/submit-checklist" \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"checklistId": "<id>", "answers": {"q1": true, "q2": "Clean"}}'

# Get current filter state
curl "http://localhost:3000/api/filters/<filterId>/current-state" \
  -H "Authorization: Bearer <JWT>"
```

### UI Verification (Filter Management)
1. Navigate to **Filter Management > Operations** — verify stage grid with filter counts
2. Click a filter card → verify current state, stage, and available actions
3. Start a cycle → verify stage advances through WASH_IN → WASH_OUT → DRY_IN → DRY_OUT → STORAGE_IN → STORAGE_OUT
4. Verify checklist gates block advancement until submitted
5. Navigate to **Cleaning Cycles > History** — verify completed cycles appear
6. Navigate to **Cleaning Cycles > Timeline** — verify event timeline
7. Navigate to **PM Schedules** — verify schedule entries and execution tracking

### Database Verification (Phase 2)
```sql
-- Cleaning cycles
SELECT id, status, "startedAt", "completedAt" FROM cleaning_cycles ORDER BY "startedAt" DESC;

-- Filter events
SELECT id, "eventType", "filterId", "createdAt" FROM filter_events ORDER BY "createdAt" DESC;

-- PM executions
SELECT id, status, "completedAt" FROM pm_executions ORDER BY "createdAt" DESC;
```


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
