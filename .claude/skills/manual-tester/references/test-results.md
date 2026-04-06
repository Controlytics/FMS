# Test Results Log

## Session: 2026-02-27

### Data Ingestion Tests

| Entity | Protocol | Telemetry | Attributes | Status |
|--------|----------|-----------|------------|--------|
| Pipeline-Sensor-001 | MQTT (correct UNS topics) | 100 published, 200 in TSDB | 100 published, 200 in TSDB | PASS |
| FlowMeter-WTP-001 | HTTP | 100 published, 200 in TSDB | 100 published, 200 in TSDB | PASS |
| VibSensor-Motor-001 | HTTP | 100 published, 200 in TSDB | 100 published, 200 in TSDB | PASS |

Note: 200 in TSDB = 100 from first publish run + 100 from second. Each publish sends 2 keys per message = 200 rows.

### Delete Tests (via UI)

| Entity | Tab | Records Before | Records After | Status |
|--------|-----|---------------|---------------|--------|
| FlowMeter-WTP-001 | Telemetry | 200 | 0 | PASS |
| FlowMeter-WTP-001 | Attributes | 200 | 0 | PASS |
| VibSensor-Motor-001 | Telemetry | 200 | 0 | PASS |
| VibSensor-Motor-001 | Attributes | 200 | 0 | PASS |
| Pipeline-Sensor-001 | Telemetry | 200 | 0 | PASS |
| Pipeline-Sensor-001 | Attributes | 200 | 0 | PASS |

### Issues Found & Resolved

1. **MQTT topics**: Original publish script used `v1/devices/me/telemetry` (ThingsBoard style). Fixed to `digilog/v1/<uns-path>/telemetry`.
2. **Redis down**: BullMQ ingestion worker couldn't process MQTT messages. Fixed by restarting Redis.
3. **EMQX down**: API's MQTT client couldn't connect. Fixed by restarting EMQX + PM2.
4. **TSDB tables missing**: `ts_telemetry` and `ts_attributes` didn't exist. Created as regular PostgreSQL tables.
5. **TSDB connection**: Default config pointed to port 5433 / `digilog_tsdb`. Fixed with env vars to point to main DB.

### Not Yet Tested
- Alarms tab delete (need alarm data)
- Custom time range for delete
- Non-admin role delete attempt (should deny)
- TemperatureSensor entity
- Events and traces delete
- Rate limiting on data ingestion
- Large dataset performance


## Session: 2026-03-27 — Phase 2 Digital FMS

### Filter Operations Tests

| Test | Action | Expected | Status |
|------|--------|----------|--------|
| Start cleaning cycle | POST /api/filters/:id/start-cycle | Cycle created, state = WASH_IN | PASS |
| Advance stage | POST /api/filters/:id/advance | State advances to next stage | PASS |
| Checklist gate blocks advance | POST advance without checklist | 400 error, pending checklist | PASS |
| Submit checklist | POST /api/filters/:id/submit-checklist | Checklist recorded, advance unblocked | PASS |
| Bypass stage | POST /api/filters/:id/bypass | Stage skipped with deviation event | PASS |
| Cycle auto-complete | Advance past last stage | Cycle status = COMPLETED | PASS |
| Current state | GET /api/filters/:id/current-state | Returns stage, cycle, next actions | PASS |

### Cleaning Profile Tests

| Test | Action | Expected | Status |
|------|--------|----------|--------|
| Create profile | POST /api/cleaning-profiles | Profile created with stages/connections | PASS |
| Pipeline validation | Create profile with no END node | 400 validation error | PASS |
| Visual editor | Load editor UI | Canvas renders stages and connections | PASS |

### PM Schedule Tests

| Test | Action | Expected | Status |
|------|--------|----------|--------|
| Create schedule | POST /api/pm-schedules | Schedule with entries created | PASS |
| Start execution | POST /api/pm-schedules/:id/executions | Execution IN_PROGRESS | PASS |
| Complete execution | PUT execution status=COMPLETED | Execution marked complete | PASS |

### UI Verification

| Page | Check | Status |
|------|-------|--------|
| Filter Operations | Stage grid shows correct filter counts | PASS |
| Filter Status | All filters with current lifecycle state | PASS |
| Cleaning Profile Editor | Visual pipeline editor renders | PASS |
| Cleaning Cycles History | Completed cycles listed | PASS |
| Cleaning Cycles Timeline | Event timeline renders | PASS |
| PM Schedules | Schedule list with entries | PASS |
| Filter Traceability | Event history per filter | PASS |
| AHU Dashboard | Equipment group overview | PASS |

### Not Yet Tested (Phase 2)
- Concurrent advance() race condition
- Bulk filter upload via CSV
- Filter retirement and replacement flow
- Equipment group CRUD
- Checklist profile management UI

