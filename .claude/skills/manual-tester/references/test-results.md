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
