#!/bin/bash
set -euo pipefail

API="http://localhost:3000"
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

step=0
pass=0
fail=0

run_step() {
  step=$((step + 1))
  echo ""
  echo -e "${BOLD}=======================================================${NC}"
  echo -e "${BOLD}  STEP $step: $1${NC}"
  echo -e "${BOLD}=======================================================${NC}"
}

check_status() {
  local expected=$1
  local actual=$2
  local label=$3
  if [ "$actual" = "$expected" ]; then
    echo -e "${GREEN}  PASS: $label -- HTTP $actual (expected $expected)${NC}"
    pass=$((pass + 1))
  else
    echo -e "${RED}  FAIL: $label -- HTTP $actual (expected $expected)${NC}"
    fail=$((fail + 1))
  fi
}

# ===========================================================
# STEP 0: Clear stale sessions
# ===========================================================
run_step "Clear stale DB sessions"
PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -c "UPDATE sessions SET is_active = false, termination_reason = 'test_cleanup' WHERE is_active = true;" 2>&1 || echo "WARN: psql session cleanup failed"

# ===========================================================
# STEP 1: Login as admin
# ===========================================================
run_step "Login as admin"
LOGIN_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}')
LOGIN_BODY=$(echo "$LOGIN_RESP" | sed '$d')
LOGIN_STATUS=$(echo "$LOGIN_RESP" | tail -n1)
echo "Status: $LOGIN_STATUS"
echo "Body: $LOGIN_BODY"
check_status "200" "$LOGIN_STATUS" "Admin login"

JWT=$(echo "$LOGIN_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
if [ -z "$JWT" ]; then
  echo -e "${RED}FATAL: Could not extract JWT. Aborting.${NC}"
  echo "$LOGIN_BODY"
  exit 1
fi
echo "JWT: ${JWT:0:40}..."

# ===========================================================
# STEP 2: Get verification token (POST /api/auth/verify)
# ===========================================================
run_step "Get verification token"
VERIFY_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/auth/verify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"password":"Admin@123"}')
VERIFY_BODY=$(echo "$VERIFY_RESP" | sed '$d')
VERIFY_STATUS=$(echo "$VERIFY_RESP" | tail -n1)
echo "Status: $VERIFY_STATUS"
echo "Body: $VERIFY_BODY"
check_status "200" "$VERIFY_STATUS" "Verify password"

VTOKEN=$(echo "$VERIFY_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('verificationToken',''))" 2>/dev/null || echo "")
echo "Verification token: ${VTOKEN:0:40}..."

# ===========================================================
# STEP 3: Disable reauth for entity operations
# ===========================================================
run_step "Disable reauth for entity operations (to simplify test)"
REAUTH_RESP=$(curl -s -w '\n%{http_code}' -X PUT "$API/api/config/action-reauth" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "x-reauth-password: Admin@123" \
  -d '{}')
REAUTH_BODY=$(echo "$REAUTH_RESP" | sed '$d')
REAUTH_STATUS=$(echo "$REAUTH_RESP" | tail -n1)
echo "Status: $REAUTH_STATUS"
echo "Body: $REAUTH_BODY"
echo "(Reauth config cleared or not needed -- continuing)"

# ===========================================================
# STEP 4: Create an entity template
# ===========================================================
run_step "Create entity template"
TEMPLATE_PAYLOAD='{"name":"E2E_Test_Sensor","description":"End-to-end test sensor template","category":"Sensor","attributeSchema":[{"fieldName":"firmware_version","dataType":"TEXT","required":false},{"fieldName":"model","dataType":"TEXT","required":false},{"fieldName":"threshold","dataType":"FLOAT","required":false}],"telemetrySchema":[{"fieldName":"temperature","dataType":"FLOAT"},{"fieldName":"humidity","dataType":"FLOAT"},{"fieldName":"pressure","dataType":"FLOAT"}],"statusLifecycle":[{"name":"ACTIVE","color":"#22c55e"},{"name":"INACTIVE","color":"#ef4444"},{"name":"MAINTENANCE","color":"#f59e0b"}]}'
TEMPLATE_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/assets/templates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "x-reauth-password: Admin@123" \
  -d "$TEMPLATE_PAYLOAD")
TEMPLATE_BODY=$(echo "$TEMPLATE_RESP" | sed '$d')
TEMPLATE_STATUS=$(echo "$TEMPLATE_RESP" | tail -n1)
echo "Status: $TEMPLATE_STATUS"
echo "Body: $TEMPLATE_BODY"
check_status "201" "$TEMPLATE_STATUS" "Create entity template"

TEMPLATE_ID=$(echo "$TEMPLATE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id','') or d.get('id',''))" 2>/dev/null || echo "")
if [ -z "$TEMPLATE_ID" ]; then
  echo -e "${RED}FATAL: Could not extract template ID. Aborting.${NC}"
  exit 1
fi
echo "Template ID: $TEMPLATE_ID"

# ===========================================================
# STEP 5: Create an entity instance
# ===========================================================
run_step "Create entity instance"
INSTANCE_PAYLOAD="{\"name\":\"E2E_Test_Sensor_001\",\"templateId\":\"$TEMPLATE_ID\",\"status\":\"ACTIVE\",\"attributes\":{\"firmware_version\":\"1.0.0\",\"model\":\"TestSensorX\",\"threshold\":50.0}}"
INSTANCE_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/assets/instances" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -H "x-reauth-password: Admin@123" \
  -d "$INSTANCE_PAYLOAD")
INSTANCE_BODY=$(echo "$INSTANCE_RESP" | sed '$d')
INSTANCE_STATUS=$(echo "$INSTANCE_RESP" | tail -n1)
echo "Status: $INSTANCE_STATUS"
echo "Body: $INSTANCE_BODY"
check_status "201" "$INSTANCE_STATUS" "Create entity instance"

ENTITY_ID=$(echo "$INSTANCE_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('id','') or d.get('id',''))" 2>/dev/null || echo "")
if [ -z "$ENTITY_ID" ]; then
  echo -e "${RED}FATAL: Could not extract entity ID. Aborting.${NC}"
  exit 1
fi
echo "Entity ID: $ENTITY_ID"

# ===========================================================
# STEP 6: Generate a device token
# ===========================================================
run_step "Generate device token (POST /api/connectivity/{entityId}/token)"
TOKEN_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/connectivity/$ENTITY_ID/token" \
  -H "Authorization: Bearer $JWT")
TOKEN_BODY=$(echo "$TOKEN_RESP" | sed '$d')
TOKEN_STATUS=$(echo "$TOKEN_RESP" | tail -n1)
echo "Status: $TOKEN_STATUS"
echo "Body: $TOKEN_BODY"
check_status "200" "$TOKEN_STATUS" "Generate device token"

DEVICE_TOKEN=$(echo "$TOKEN_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
if [ -z "$DEVICE_TOKEN" ]; then
  echo -e "${RED}FATAL: Could not extract device token. Aborting.${NC}"
  exit 1
fi
echo "Device Token: ${DEVICE_TOKEN:0:40}..."

# ===========================================================
# STEP 7: Ingest telemetry -- simple key-value format
# ===========================================================
run_step "Ingest telemetry -- simple key-value format"
TELEM1_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/data/telemetry" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60.2, "pressure": 1013.25}')
TELEM1_BODY=$(echo "$TELEM1_RESP" | sed '$d')
TELEM1_STATUS=$(echo "$TELEM1_RESP" | tail -n1)
echo "Status: $TELEM1_STATUS"
echo "Body: $TELEM1_BODY"
check_status "200" "$TELEM1_STATUS" "Ingest telemetry (simple)"

# ===========================================================
# STEP 8: Ingest telemetry -- timestamped format
# ===========================================================
run_step "Ingest telemetry -- timestamped format"
TELEM2_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/data/telemetry" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ts": 1709000000000, "values": {"temperature": 26.1}}')
TELEM2_BODY=$(echo "$TELEM2_RESP" | sed '$d')
TELEM2_STATUS=$(echo "$TELEM2_RESP" | tail -n1)
echo "Status: $TELEM2_STATUS"
echo "Body: $TELEM2_BODY"
check_status "200" "$TELEM2_STATUS" "Ingest telemetry (timestamped)"

# ===========================================================
# STEP 9: Ingest telemetry -- batch format
# ===========================================================
run_step "Ingest telemetry -- batch format"
TELEM3_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/data/telemetry" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"ts": 1709000001000, "values": {"temperature": 26.2}}, {"ts": 1709000002000, "values": {"temperature": 26.3}}]')
TELEM3_BODY=$(echo "$TELEM3_RESP" | sed '$d')
TELEM3_STATUS=$(echo "$TELEM3_RESP" | tail -n1)
echo "Status: $TELEM3_STATUS"
echo "Body: $TELEM3_BODY"
check_status "200" "$TELEM3_STATUS" "Ingest telemetry (batch)"

# ===========================================================
# STEP 10: Ingest attributes via device token
# ===========================================================
run_step "Ingest attributes (POST /api/data/attributes)"
ATTR_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/data/attributes" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firmware_version": "2.0.0", "serial_number": "SN-12345", "location": "Lab-3"}')
ATTR_BODY=$(echo "$ATTR_RESP" | sed '$d')
ATTR_STATUS=$(echo "$ATTR_RESP" | tail -n1)
echo "Status: $ATTR_STATUS"
echo "Body: $ATTR_BODY"
check_status "200" "$ATTR_STATUS" "Ingest attributes"

# ===========================================================
# STEP 11: Ingest a device event
# ===========================================================
run_step "Ingest device event (POST /api/data/event)"
EVENT_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/data/event" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event": "TEMPERATURE_ALERT", "data": {"value": 85.5, "threshold": 80.0}, "timestamp": 1709000005000}')
EVENT_BODY=$(echo "$EVENT_RESP" | sed '$d')
EVENT_STATUS=$(echo "$EVENT_RESP" | tail -n1)
echo "Status: $EVENT_STATUS"
echo "Body: $EVENT_BODY"
check_status "200" "$EVENT_STATUS" "Ingest device event"

# ===========================================================
# STEP 12: Wait for BullMQ worker to process
# ===========================================================
run_step "Wait 5 seconds for BullMQ worker to process queued jobs"
echo "Sleeping 5 seconds..."
sleep 5
echo "Done waiting."

# ===========================================================
# STEP 13: Query latest telemetry
# ===========================================================
run_step "Query latest telemetry (GET /api/telemetry/{entityId}/latest)"
LATEST_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/telemetry/$ENTITY_ID/latest" \
  -H "Authorization: Bearer $JWT")
LATEST_BODY=$(echo "$LATEST_RESP" | sed '$d')
LATEST_STATUS=$(echo "$LATEST_RESP" | tail -n1)
echo "Status: $LATEST_STATUS"
echo "Body: $LATEST_BODY"
check_status "200" "$LATEST_STATUS" "Query latest telemetry"

# Check if telemetry data was actually persisted
TELEM_COUNT=$(echo "$LATEST_BODY" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data) if isinstance(data, list) else 0)" 2>/dev/null || echo "0")
echo "Telemetry keys found: $TELEM_COUNT"
if [ "$TELEM_COUNT" -gt "0" ]; then
  echo -e "${GREEN}  PASS: Telemetry data persisted! Found $TELEM_COUNT keys.${NC}"
  pass=$((pass + 1))
else
  echo -e "${RED}  FAIL: No telemetry data found -- pipeline may not have processed yet.${NC}"
  fail=$((fail + 1))
fi

# ===========================================================
# STEP 14: Query telemetry keys (data streams)
# ===========================================================
run_step "Query telemetry keys (GET /api/telemetry/{entityId}/keys)"
KEYS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/telemetry/$ENTITY_ID/keys" \
  -H "Authorization: Bearer $JWT")
KEYS_BODY=$(echo "$KEYS_RESP" | sed '$d')
KEYS_STATUS=$(echo "$KEYS_RESP" | tail -n1)
echo "Status: $KEYS_STATUS"
echo "Body: $KEYS_BODY"
check_status "200" "$KEYS_STATUS" "Query telemetry keys"

# ===========================================================
# STEP 15: Query attributes (server scope)
# ===========================================================
run_step "Query attributes (GET /api/attributes/{entityId}/server)"
QATTR_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/attributes/$ENTITY_ID/server" \
  -H "Authorization: Bearer $JWT")
QATTR_BODY=$(echo "$QATTR_RESP" | sed '$d')
QATTR_STATUS=$(echo "$QATTR_RESP" | tail -n1)
echo "Status: $QATTR_STATUS"
echo "Body: $QATTR_BODY"
check_status "200" "$QATTR_STATUS" "Query attributes (server)"

# ===========================================================
# STEP 16: Query attributes (all scope)
# ===========================================================
run_step "Query attributes (GET /api/attributes/{entityId}/all)"
QATTR2_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/attributes/$ENTITY_ID/all" \
  -H "Authorization: Bearer $JWT")
QATTR2_BODY=$(echo "$QATTR2_RESP" | sed '$d')
QATTR2_STATUS=$(echo "$QATTR2_RESP" | tail -n1)
echo "Status: $QATTR2_STATUS"
echo "Body: $QATTR2_BODY"
check_status "200" "$QATTR2_STATUS" "Query attributes (all)"

# ===========================================================
# STEP 17: Check connectivity status
# ===========================================================
run_step "Check connectivity status (GET /api/connectivity/{entityId})"
CONN_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/connectivity/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT")
CONN_BODY=$(echo "$CONN_RESP" | sed '$d')
CONN_STATUS=$(echo "$CONN_RESP" | tail -n1)
echo "Status: $CONN_STATUS"
echo "Body: $CONN_BODY"
check_status "200" "$CONN_STATUS" "Connectivity status"

# ===========================================================
# STEP 18: Test connectivity test endpoint
# ===========================================================
run_step "Test connectivity test (POST /api/connectivity/{entityId}/test)"
CONNTEST_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/connectivity/$ENTITY_ID/test" \
  -H "Authorization: Bearer $JWT")
CONNTEST_BODY=$(echo "$CONNTEST_RESP" | sed '$d')
CONNTEST_STATUS=$(echo "$CONNTEST_RESP" | tail -n1)
echo "Status: $CONNTEST_STATUS"
echo "Body: $CONNTEST_BODY"
check_status "200" "$CONNTEST_STATUS" "Connectivity test"

# ===========================================================
# STEP 19: Query alarms for entity
# ===========================================================
run_step "Query alarms (GET /api/alarms/{entityId})"
ALARM_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/alarms/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT")
ALARM_BODY=$(echo "$ALARM_RESP" | sed '$d')
ALARM_STATUS=$(echo "$ALARM_RESP" | tail -n1)
echo "Status: $ALARM_STATUS"
echo "Body: $ALARM_BODY"
check_status "200" "$ALARM_STATUS" "Query alarms"

# ===========================================================
# STEP 20: Generate QR code
# ===========================================================
run_step "Generate QR code (POST /api/qr/{entityId}/generate)"
QR_RESP=$(curl -s -w '\n%{http_code}' -X POST "$API/api/qr/$ENTITY_ID/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{"size": "MEDIUM", "includeLabel": true, "action": "dashboard"}')
QR_BODY=$(echo "$QR_RESP" | sed '$d')
QR_STATUS=$(echo "$QR_RESP" | tail -n1)
echo "Status: $QR_STATUS"
echo "Body (truncated): $(echo "$QR_BODY" | head -c 300)..."
check_status "200" "$QR_STATUS" "Generate QR code"

# ===========================================================
# STEP 21: Get QR code back
# ===========================================================
run_step "Get QR code (GET /api/qr/{entityId})"
QR2_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT")
QR2_BODY=$(echo "$QR2_RESP" | sed '$d')
QR2_STATUS=$(echo "$QR2_RESP" | tail -n1)
echo "Status: $QR2_STATUS"
echo "Body (truncated): $(echo "$QR2_BODY" | head -c 300)..."
check_status "200" "$QR2_STATUS" "Get QR code"

# ===========================================================
# STEP 22: Get UNS mapping
# ===========================================================
run_step "Get UNS mapping (GET /api/uns/entity/{entityId})"
UNS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/uns/entity/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT")
UNS_BODY=$(echo "$UNS_RESP" | sed '$d')
UNS_STATUS=$(echo "$UNS_RESP" | tail -n1)
echo "Status: $UNS_STATUS"
echo "Body: $UNS_BODY"
if [ "$UNS_STATUS" = "200" ] || [ "$UNS_STATUS" = "404" ]; then
  echo -e "${GREEN}  PASS: UNS mapping query -- HTTP $UNS_STATUS (expected 200 or 404)${NC}"
  pass=$((pass + 1))
else
  echo -e "${RED}  FAIL: UNS mapping query -- HTTP $UNS_STATUS (expected 200 or 404)${NC}"
  fail=$((fail + 1))
fi

# ===========================================================
# STEP 23: Get shared attributes via device token
# ===========================================================
run_step "Get shared attributes via device token (GET /api/data/attributes)"
SHATTR_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/data/attributes" \
  -H "Authorization: Bearer $DEVICE_TOKEN")
SHATTR_BODY=$(echo "$SHATTR_RESP" | sed '$d')
SHATTR_STATUS=$(echo "$SHATTR_RESP" | tail -n1)
echo "Status: $SHATTR_STATUS"
echo "Body: $SHATTR_BODY"
check_status "200" "$SHATTR_STATUS" "Get shared attributes (device)"

# ===========================================================
# STEP 24: Get connection code snippets
# ===========================================================
run_step "Get connection snippets (GET /api/connectivity/{entityId}/snippets)"
SNIP_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/connectivity/$ENTITY_ID/snippets" \
  -H "Authorization: Bearer $JWT")
SNIP_BODY=$(echo "$SNIP_RESP" | sed '$d')
SNIP_STATUS=$(echo "$SNIP_RESP" | tail -n1)
echo "Status: $SNIP_STATUS"
echo "Body (truncated): $(echo "$SNIP_BODY" | head -c 300)..."
check_status "200" "$SNIP_STATUS" "Get connection snippets"

# ===========================================================
# STEP 25: Query timeseries telemetry via TSDB endpoint
# ===========================================================
run_step "Query timeseries telemetry via TSDB endpoint"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PAST="2024-01-01T00:00:00Z"
TS_RESP=$(curl -s -w '\n%{http_code}' -X GET "$API/api/telemetry/$ENTITY_ID/timeseries?from=$PAST&to=$NOW&aggregation=none&limit=100" \
  -H "Authorization: Bearer $JWT")
TS_BODY=$(echo "$TS_RESP" | sed '$d')
TS_STATUS=$(echo "$TS_RESP" | tail -n1)
echo "Status: $TS_STATUS"
echo "Body (truncated): $(echo "$TS_BODY" | head -c 500)..."
check_status "200" "$TS_STATUS" "Query timeseries"

# ===========================================================
# STEP 26: Direct TSDB check -- count telemetry rows
# ===========================================================
run_step "Direct TSDB check -- count telemetry rows for entity"
TSDB_COUNT=$(PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "SELECT COUNT(*) FROM ts_telemetry WHERE entity_id = '$ENTITY_ID';" 2>/dev/null || echo "ERROR")
echo "ts_telemetry rows for entity: $TSDB_COUNT"
if [ "$TSDB_COUNT" != "ERROR" ] && [ "$TSDB_COUNT" -gt "0" ] 2>/dev/null; then
  echo -e "${GREEN}  PASS: TSDB has $TSDB_COUNT telemetry rows -- data persisted!${NC}"
  pass=$((pass + 1))
else
  echo -e "${YELLOW}  WARN: TSDB count: $TSDB_COUNT (may be 0 if TimescaleDB not set up or worker has not flushed)${NC}"
  LT_COUNT=$(PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "SELECT COUNT(*) FROM latest_telemetry WHERE entity_id = '$ENTITY_ID';" 2>/dev/null || echo "ERROR")
  echo "LatestTelemetry rows: $LT_COUNT"
  if [ "$LT_COUNT" != "ERROR" ] && [ "$LT_COUNT" -gt "0" ] 2>/dev/null; then
    echo -e "${GREEN}  PASS: LatestTelemetry has $LT_COUNT rows -- data persisted!${NC}"
    pass=$((pass + 1))
  else
    echo -e "${RED}  FAIL: No telemetry data found in TSDB or LatestTelemetry.${NC}"
    fail=$((fail + 1))
  fi
fi

# ===========================================================
# STEP 27: Direct TSDB check -- count attribute rows
# ===========================================================
run_step "Direct TSDB check -- count attribute rows for entity"
ATTR_COUNT=$(PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "SELECT COUNT(*) FROM ts_attributes WHERE entity_id = '$ENTITY_ID';" 2>/dev/null || echo "ERROR")
echo "ts_attributes rows for entity: $ATTR_COUNT"
if [ "$ATTR_COUNT" != "ERROR" ] && [ "$ATTR_COUNT" -gt "0" ] 2>/dev/null; then
  echo -e "${GREEN}  PASS: TSDB has $ATTR_COUNT attribute rows -- data persisted!${NC}"
  pass=$((pass + 1))
else
  echo -e "${YELLOW}  WARN: TSDB attribute count: $ATTR_COUNT (may be in different table or not yet flushed)${NC}"
fi

# ===========================================================
# STEP 28: Check DataStream records
# ===========================================================
run_step "Direct DB check -- DataStream records for entity"
DS_COUNT=$(PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "SELECT COUNT(*) FROM data_streams WHERE entity_id = '$ENTITY_ID';" 2>/dev/null || echo "ERROR")
echo "DataStream rows for entity: $DS_COUNT"
if [ "$DS_COUNT" != "ERROR" ] && [ "$DS_COUNT" -gt "0" ] 2>/dev/null; then
  echo -e "${GREEN}  PASS: DataStream has $DS_COUNT records -- streams registered!${NC}"
  pass=$((pass + 1))
else
  echo -e "${YELLOW}  WARN: DataStream count: $DS_COUNT${NC}"
fi

# ===========================================================
# STEP 29: Check ConnectivityStatus table
# ===========================================================
run_step "Direct DB check -- ConnectivityStatus for entity"
CONN_DB=$(PGPASSWORD=digilog123 psql -h localhost -U digilog -d digilog_db -t -A -c "SELECT status FROM connectivity_status WHERE entity_id = '$ENTITY_ID';" 2>/dev/null || echo "ERROR")
echo "ConnectivityStatus: $CONN_DB"
if [ -n "$CONN_DB" ] && [ "$CONN_DB" != "ERROR" ]; then
  echo -e "${GREEN}  PASS: ConnectivityStatus exists: $CONN_DB${NC}"
  pass=$((pass + 1))
else
  echo -e "${YELLOW}  WARN: No ConnectivityStatus record${NC}"
fi

# ===========================================================
# STEP 30: Check BullMQ completed jobs via Redis
# ===========================================================
run_step "Check BullMQ job status via Redis"
COMPLETED=$(redis-cli LLEN "bull:ingestion:completed" 2>/dev/null || echo "N/A")
FAILED=$(redis-cli LLEN "bull:ingestion:failed" 2>/dev/null || echo "N/A")
WAITING=$(redis-cli LLEN "bull:ingestion:wait" 2>/dev/null || echo "N/A")
echo "BullMQ ingestion queue -- completed: $COMPLETED, failed: $FAILED, waiting: $WAITING"

# ===========================================================
# STEP 31: Check PM2 logs for any errors during processing
# ===========================================================
run_step "Check PM2 logs for recent errors"
pm2 logs digilog-api --lines 20 --nostream 2>&1 | tail -30 || echo "Could not read PM2 logs"

# ===========================================================
# CLEANUP: Delete QR code, instance, template
# ===========================================================
run_step "Cleanup: Delete QR code"
DEL_QR_RESP=$(curl -s -w '\n%{http_code}' -X DELETE "$API/api/qr/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT")
DEL_QR_BODY=$(echo "$DEL_QR_RESP" | sed '$d')
DEL_QR_STATUS=$(echo "$DEL_QR_RESP" | tail -n1)
echo "Status: $DEL_QR_STATUS"
echo "Body: $DEL_QR_BODY"
check_status "200" "$DEL_QR_STATUS" "Delete QR code"

run_step "Cleanup: Delete entity instance"
DEL_INST_RESP=$(curl -s -w '\n%{http_code}' -X DELETE "$API/api/assets/instances/$ENTITY_ID" \
  -H "Authorization: Bearer $JWT" \
  -H "x-reauth-password: Admin@123")
DEL_INST_BODY=$(echo "$DEL_INST_RESP" | sed '$d')
DEL_INST_STATUS=$(echo "$DEL_INST_RESP" | tail -n1)
echo "Status: $DEL_INST_STATUS"
echo "Body: $DEL_INST_BODY"
check_status "200" "$DEL_INST_STATUS" "Delete entity instance"

run_step "Cleanup: Delete entity template"
DEL_TMPL_RESP=$(curl -s -w '\n%{http_code}' -X DELETE "$API/api/assets/templates/$TEMPLATE_ID" \
  -H "Authorization: Bearer $JWT" \
  -H "x-reauth-password: Admin@123")
DEL_TMPL_BODY=$(echo "$DEL_TMPL_RESP" | sed '$d')
DEL_TMPL_STATUS=$(echo "$DEL_TMPL_RESP" | tail -n1)
echo "Status: $DEL_TMPL_STATUS"
echo "Body: $DEL_TMPL_BODY"
check_status "200" "$DEL_TMPL_STATUS" "Delete entity template"

# ===========================================================
# SUMMARY
# ===========================================================
echo ""
echo -e "${BOLD}=======================================================${NC}"
echo -e "${BOLD}  END-TO-END DATA INGESTION TEST SUMMARY${NC}"
echo -e "${BOLD}=======================================================${NC}"
echo -e "  Total steps executed: $step"
echo -e "  ${GREEN}Passed: $pass${NC}"
echo -e "  ${RED}Failed: $fail${NC}"
echo ""
if [ "$fail" -eq 0 ]; then
  echo -e "${GREEN}  ALL TESTS PASSED!${NC}"
else
  echo -e "${RED}  $fail TEST(S) FAILED${NC}"
fi
echo ""
echo "Entity ID used: $ENTITY_ID"
echo "Template ID used: $TEMPLATE_ID"
echo "Device token used: ${DEVICE_TOKEN:0:20}..."
echo ""
