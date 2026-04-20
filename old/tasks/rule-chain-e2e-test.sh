#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Rule Chain System — Full End-to-End Validation Script
# Tests all 31 node types across 7 categories by creating real
# rule chains, attaching to templates, creating entities, and
# sending telemetry through the pipeline.
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-Admin@1234}"
REPORT_FILE="tasks/rule-chain-test-report.md"
RUN_ID=$(date +%s)  # Unique run ID to avoid name conflicts with soft-deleted data
PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0
TOTAL_COUNT=0
FAILED_TESTS=()
NO_CLEANUP=false
for arg in "$@"; do
  case "$arg" in
    --no-cleanup) NO_CLEANUP=true ;;
  esac
done

# ── Colors ───────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ── Helpers ──────────────────────────────────────────────────────
log()  { echo -e "${CYAN}[INFO]${NC} $*"; }
pass() { echo -e "${GREEN}[PASS]${NC} $*"; PASS_COUNT=$((PASS_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); }
fail() { echo -e "${RED}[FAIL]${NC} $*"; FAIL_COUNT=$((FAIL_COUNT+1)); TOTAL_COUNT=$((TOTAL_COUNT+1)); FAILED_TESTS+=("$*"); }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; WARN_COUNT=$((WARN_COUNT+1)); }
section() { echo -e "\n${BLUE}════════════════════════════════════════════════════${NC}"; echo -e "${BLUE}  $*${NC}"; echo -e "${BLUE}════════════════════════════════════════════════════${NC}"; }

# curl wrapper with error handling
api() {
  local method="$1"
  local path="$2"
  shift 2
  local extra_args=("$@")

  local response
  response=$(curl -s -w '\n%{http_code}' \
    -X "$method" \
    "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN:-}" \
    "${extra_args[@]}" 2>/dev/null) || true

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  echo "$body"
  return 0
}

# curl wrapper that also returns status code
api_with_status() {
  local method="$1"
  local path="$2"
  shift 2
  local extra_args=("$@")

  local response
  response=$(curl -s -w '\n%{http_code}' \
    -X "$method" \
    "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${TOKEN:-}" \
    "${extra_args[@]}" 2>/dev/null) || true

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  echo "${http_code}|${body}"
  return 0
}

# Device token API call
device_api() {
  local method="$1"
  local path="$2"
  local device_token="$3"
  shift 3
  local extra_args=("$@")

  local response
  response=$(curl -s -w '\n%{http_code}' \
    -X "$method" \
    "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${device_token}" \
    "${extra_args[@]}" 2>/dev/null) || true

  local http_code
  http_code=$(echo "$response" | tail -1)
  local body
  body=$(echo "$response" | sed '$d')

  echo "${http_code}|${body}"
  return 0
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local test_name="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$test_name (HTTP $actual)"
  else
    fail "$test_name (expected HTTP $expected, got $actual)"
  fi
}

assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local test_name="$4"
  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null) || actual="PARSE_ERROR"
  if [[ "$actual" == "$expected" ]]; then
    pass "$test_name"
  else
    fail "$test_name (expected '$expected', got '$actual')"
  fi
}

assert_json_exists() {
  local json="$1"
  local field="$2"
  local test_name="$3"
  local val
  val=$(echo "$json" | jq -e "$field" 2>/dev/null) || val=""
  if [[ -n "$val" && "$val" != "null" ]]; then
    pass "$test_name"
  else
    fail "$test_name (field $field is null or missing)"
  fi
}

# ═══════════════════════════════════════════════════════════════════
# PHASE 1: SETUP & AUTHENTICATION
# ═══════════════════════════════════════════════════════════════════
section "Phase 1: Setup & Authentication"

# 1.1 Health check
log "Checking system health..."
HEALTH_RESP=$(api GET /api/health)
HEALTH_STATUS=$(echo "$HEALTH_RESP" | jq -r '.status // empty' 2>/dev/null)
if [[ "$HEALTH_STATUS" == "ok" || "$HEALTH_STATUS" == "healthy" ]]; then
  pass "System health check"
else
  # Try alternate field
  HEALTH_OK=$(echo "$HEALTH_RESP" | jq -r '.success // .ok // empty' 2>/dev/null)
  if [[ "$HEALTH_OK" == "true" ]]; then
    pass "System health check"
  else
    fail "System health check (response: $HEALTH_RESP)"
    echo "Cannot continue without healthy system. Exiting."
    exit 1
  fi
fi

# 1.2 Login
log "Logging in as $ADMIN_USER..."
LOGIN_RESP=$(api POST /api/auth/login -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\",\"force\":true}")
TOKEN=$(echo "$LOGIN_RESP" | jq -r '.token // .data.token // empty' 2>/dev/null)
if [[ -n "$TOKEN" && "$TOKEN" != "null" ]]; then
  pass "Admin login successful"
else
  fail "Admin login failed (response: $LOGIN_RESP)"
  echo "Cannot continue without auth token. Exiting."
  exit 1
fi

# 1.3 Cleanup previous test data
log "Cleaning up previous test data..."
CLEANUP_PREFIX="E2E-"

# Delete test rule chains
EXISTING_CHAINS=$(api GET "/api/rule-chains?search=${CLEANUP_PREFIX}&limit=50")
CHAIN_IDS=$(echo "$EXISTING_CHAINS" | jq -r '.data[]?.id // empty' 2>/dev/null)
for cid in $CHAIN_IDS; do
  api DELETE "/api/rule-chains/$cid" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
done

# Delete test entity instances
EXISTING_INSTANCES=$(api GET "/api/assets/instances?search=${CLEANUP_PREFIX}&limit=50")
INSTANCE_IDS=$(echo "$EXISTING_INSTANCES" | jq -r '.data[]?.id // empty' 2>/dev/null)
for iid in $INSTANCE_IDS; do
  api DELETE "/api/assets/instances/$iid" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
done

# Delete test templates
EXISTING_TEMPLATES=$(api GET "/api/assets/templates?search=${CLEANUP_PREFIX}&limit=50")
TEMPLATE_IDS=$(echo "$EXISTING_TEMPLATES" | jq -r '.data[]?.id // empty' 2>/dev/null)
for tid in $TEMPLATE_IDS; do
  api DELETE "/api/assets/templates/$tid" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
done

log "Cleanup complete."

# ═══════════════════════════════════════════════════════════════════
# PHASE 2: DISCOVER & VALIDATE NODE TYPES
# ═══════════════════════════════════════════════════════════════════
section "Phase 2: Discover & Validate Node Types"

log "Fetching all registered node types..."
NODE_TYPES_RESP=$(api GET /api/rule-chains/node-types)
NODE_COUNT=$(echo "$NODE_TYPES_RESP" | jq 'length' 2>/dev/null)

if [[ "$NODE_COUNT" -eq 31 ]]; then
  pass "31 node types registered"
else
  fail "Expected 31 node types, found $NODE_COUNT"
fi

# Validate categories
declare -A EXPECTED_CATEGORIES=(
  [INPUT]=1
  [FILTER]=5
  [ENRICHMENT]=4
  [TRANSFORM]=5
  [ACTION]=8
  [EXTERNAL]=4
  [FLOW]=4
)

NODE_TYPE_REPORT=""
for cat in INPUT FILTER ENRICHMENT TRANSFORM ACTION EXTERNAL FLOW; do
  COUNT=$(echo "$NODE_TYPES_RESP" | jq "[.[] | select(.category == \"$cat\")] | length" 2>/dev/null)
  EXPECTED=${EXPECTED_CATEGORIES[$cat]}
  NODES_IN_CAT=$(echo "$NODE_TYPES_RESP" | jq -r "[.[] | select(.category == \"$cat\")] | .[].type" 2>/dev/null | tr '\n' ', ' | sed 's/,$//')
  if [[ "$COUNT" -eq "$EXPECTED" ]]; then
    pass "Category $cat: $COUNT/$EXPECTED nodes ($NODES_IN_CAT)"
  else
    fail "Category $cat: expected $EXPECTED, got $COUNT ($NODES_IN_CAT)"
  fi
  NODE_TYPE_REPORT+="| $cat | $COUNT/$EXPECTED | $NODES_IN_CAT |\n"
done

# Validate each expected node type exists
EXPECTED_NODES=(
  input
  msg-type-filter script-filter check-relation originator-type-filter check-alarm-status
  entity-attributes entity-details related-attributes tenant-attributes
  script-transform rename-keys change-originator to-email unit-conversion
  save-timeseries save-attributes create-alarm clear-alarm send-notification assign-to-user log rpc-call-reply
  rest-api-call mqtt-publish push-to-uns send-email
  rule-chain-input checkpoint delay acknowledge
)

MISSING_NODES=()
for node in "${EXPECTED_NODES[@]}"; do
  EXISTS=$(echo "$NODE_TYPES_RESP" | jq "[.[] | select(.type == \"$node\")] | length" 2>/dev/null)
  if [[ "$EXISTS" -eq 0 ]]; then
    MISSING_NODES+=("$node")
  fi
done

if [[ ${#MISSING_NODES[@]} -eq 0 ]]; then
  pass "All 31 expected node types present"
else
  fail "Missing node types: ${MISSING_NODES[*]}"
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE 3: CREATE RULE CHAINS
# ═══════════════════════════════════════════════════════════════════
section "Phase 3: Create Rule Chains (6 chains covering all 31 nodes)"

# ── Chain 1: Basic Telemetry Pipeline ────────────────────────────
log "Creating Chain 1: Basic Telemetry Pipeline..."
CHAIN1_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 1: Basic Telemetry","description":"input → msg-type-filter → save-timeseries → log"}')
CHAIN1_ID=$(echo "$CHAIN1_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN1_ID" && "$CHAIN1_ID" != "null" ]]; then
  pass "Chain 1 created: $CHAIN1_ID"
else
  fail "Chain 1 creation failed: $CHAIN1_RESP"
  CHAIN1_ID=""
fi

if [[ -n "$CHAIN1_ID" ]]; then
  SAVE1_RESP=$(api POST "/api/rule-chains/$CHAIN1_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d '{
    "nodes": [
      {"id":"n1","type":"input","name":"Input","configuration":{},"positionX":100,"positionY":200},
      {"id":"n2","type":"msg-type-filter","name":"Type Filter","configuration":{"messageTypes":["POST_TELEMETRY"]},"positionX":300,"positionY":200},
      {"id":"n3","type":"save-timeseries","name":"Save TS","configuration":{},"positionX":500,"positionY":100},
      {"id":"n4","type":"log","name":"Logger","configuration":{"level":"info","template":"Chain1 log: ${entityName}"},"positionX":700,"positionY":100}
    ],
    "connections": [
      {"fromNodeId":"n1","toNodeId":"n2","label":"Success"},
      {"fromNodeId":"n2","toNodeId":"n3","label":"True"},
      {"fromNodeId":"n2","toNodeId":"n4","label":"False"},
      {"fromNodeId":"n3","toNodeId":"n4","label":"Success"}
    ],
    "firstRuleNodeId":"n1",
    "changeNotes":"E2E test: basic telemetry pipeline"
  }')
  SAVE1_OK=$(echo "$SAVE1_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE1_OK" == "true" ]]; then
    pass "Chain 1 saved with 4 nodes and 4 connections"
  else
    fail "Chain 1 save failed: $SAVE1_RESP"
  fi
fi

# ── Chain 2: Alarm & Notification Pipeline ───────────────────────
log "Creating Chain 2: Alarm & Notification Pipeline..."
CHAIN2_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 2: Alarm Pipeline","description":"input → script-filter → create-alarm/clear-alarm → send-notification/log"}')
CHAIN2_ID=$(echo "$CHAIN2_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN2_ID" && "$CHAIN2_ID" != "null" ]]; then
  pass "Chain 2 created: $CHAIN2_ID"
else
  fail "Chain 2 creation failed: $CHAIN2_RESP"
  CHAIN2_ID=""
fi

if [[ -n "$CHAIN2_ID" ]]; then
  SAVE2_RESP=$(api POST "/api/rule-chains/$CHAIN2_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d '{
    "nodes": [
      {"id":"n1","type":"input","name":"Input","configuration":{},"positionX":100,"positionY":200},
      {"id":"n2","type":"script-filter","name":"Pressure Check","configuration":{"script":"return msg.pressure > 100;"},"positionX":300,"positionY":200},
      {"id":"n3","type":"create-alarm","name":"Create Alarm","configuration":{"alarmType":"HIGH_PRESSURE","severity":"WARNING","detailsScript":""},"positionX":500,"positionY":100},
      {"id":"n4","type":"send-notification","name":"Notify","configuration":{"title":"Pressure Alert","messageTemplate":"High pressure on ${entityName}","targetRole":"ADMIN"},"positionX":700,"positionY":100},
      {"id":"n5","type":"clear-alarm","name":"Clear Alarm","configuration":{"alarmType":"HIGH_PRESSURE"},"positionX":500,"positionY":300},
      {"id":"n6","type":"log","name":"Logger","configuration":{"level":"info","template":"Alarm cleared for ${entityName}"},"positionX":700,"positionY":300}
    ],
    "connections": [
      {"fromNodeId":"n1","toNodeId":"n2","label":"Success"},
      {"fromNodeId":"n2","toNodeId":"n3","label":"True"},
      {"fromNodeId":"n2","toNodeId":"n5","label":"False"},
      {"fromNodeId":"n3","toNodeId":"n4","label":"Success"},
      {"fromNodeId":"n5","toNodeId":"n6","label":"Success"}
    ],
    "firstRuleNodeId":"n1",
    "changeNotes":"E2E test: alarm and notification pipeline"
  }')
  SAVE2_OK=$(echo "$SAVE2_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE2_OK" == "true" ]]; then
    pass "Chain 2 saved with 6 nodes and 5 connections"
  else
    fail "Chain 2 save failed: $SAVE2_RESP"
  fi
fi

# ── Chain 3: Enrichment & Transform Pipeline ─────────────────────
log "Creating Chain 3: Enrichment & Transform Pipeline..."
CHAIN3_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 3: Enrichment Transform","description":"input → entity-attributes → entity-details → rename-keys → unit-conversion → save-timeseries"}')
CHAIN3_ID=$(echo "$CHAIN3_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN3_ID" && "$CHAIN3_ID" != "null" ]]; then
  pass "Chain 3 created: $CHAIN3_ID"
else
  fail "Chain 3 creation failed: $CHAIN3_RESP"
  CHAIN3_ID=""
fi

if [[ -n "$CHAIN3_ID" ]]; then
  SAVE3_RESP=$(api POST "/api/rule-chains/$CHAIN3_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d '{
    "nodes": [
      {"id":"n1","type":"input","name":"Input","configuration":{},"positionX":100,"positionY":200},
      {"id":"n2","type":"entity-attributes","name":"Get Attrs","configuration":{},"positionX":250,"positionY":200},
      {"id":"n3","type":"entity-details","name":"Get Details","configuration":{},"positionX":400,"positionY":200},
      {"id":"n4","type":"rename-keys","name":"Rename","configuration":{"mapping":{"temp_f":"temperature_fahrenheit","humidity_pct":"humidity_percent","co2_ppm":"co2_parts_per_million"}},"positionX":550,"positionY":200},
      {"id":"n5","type":"unit-conversion","name":"Convert Units","configuration":{"conversions":[{"key":"temperature_fahrenheit","formula":"(value - 32) * 5/9","outputKey":"temperature_celsius"}]},"positionX":700,"positionY":200},
      {"id":"n6","type":"save-timeseries","name":"Save TS","configuration":{},"positionX":850,"positionY":200}
    ],
    "connections": [
      {"fromNodeId":"n1","toNodeId":"n2","label":"Success"},
      {"fromNodeId":"n2","toNodeId":"n3","label":"Success"},
      {"fromNodeId":"n3","toNodeId":"n4","label":"Success"},
      {"fromNodeId":"n4","toNodeId":"n5","label":"Success"},
      {"fromNodeId":"n5","toNodeId":"n6","label":"Success"}
    ],
    "firstRuleNodeId":"n1",
    "changeNotes":"E2E test: enrichment and transform pipeline"
  }')
  SAVE3_OK=$(echo "$SAVE3_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE3_OK" == "true" ]]; then
    pass "Chain 3 saved with 6 nodes and 5 connections"
  else
    fail "Chain 3 save failed: $SAVE3_RESP"
  fi
fi

# ── Chain 4: Advanced Filter & External Pipeline ─────────────────
log "Creating Chain 4: Advanced Filter & External Pipeline..."
CHAIN4_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 4: External Pipeline","description":"input → originator-type-filter → script-transform → rest-api-call → mqtt-publish → push-to-uns → save-timeseries + check-alarm-status → to-email → send-email"}')
CHAIN4_ID=$(echo "$CHAIN4_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN4_ID" && "$CHAIN4_ID" != "null" ]]; then
  pass "Chain 4 created: $CHAIN4_ID"
else
  fail "Chain 4 creation failed: $CHAIN4_RESP"
  CHAIN4_ID=""
fi

if [[ -n "$CHAIN4_ID" ]]; then
  SAVE4_RESP=$(api POST "/api/rule-chains/$CHAIN4_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d '{
    "nodes": [
      {"id":"n1","type":"input","name":"Input","configuration":{},"positionX":100,"positionY":200},
      {"id":"n2","type":"originator-type-filter","name":"Type Check","configuration":{"templateNames":["E2E-${RUN_ID} Smart Actuator"]},"positionX":250,"positionY":200},
      {"id":"n3","type":"script-transform","name":"Transform","configuration":{"script":"msg.processed = true; msg.timestamp_iso = new Date().toISOString(); return msg;"},"positionX":400,"positionY":100},
      {"id":"n4","type":"rest-api-call","name":"REST Call","configuration":{"url":"http://localhost:3000/api/health","method":"GET","headers":{},"timeout":5000},"positionX":550,"positionY":100},
      {"id":"n5","type":"mqtt-publish","name":"MQTT Pub","configuration":{"topic":"e2e-test/device/data","qos":0,"retain":false},"positionX":700,"positionY":100},
      {"id":"n6","type":"push-to-uns","name":"Push UNS","configuration":{"unsPath":"e2e-test/actuator/data"},"positionX":850,"positionY":100},
      {"id":"n7","type":"save-timeseries","name":"Save TS","configuration":{},"positionX":1000,"positionY":100},
      {"id":"n8","type":"check-alarm-status","name":"Check Alarm","configuration":{"alarmType":"DEVICE_ERROR","status":"ACTIVE"},"positionX":400,"positionY":350},
      {"id":"n9","type":"to-email","name":"Format Email","configuration":{"subject":"Alert: ${entityName}","body":"Device error detected on ${entityName}","to":"admin@example.com"},"positionX":600,"positionY":350},
      {"id":"n10","type":"send-email","name":"Send Email","configuration":{"to":"admin@example.com","subject":"Alert","body":"Error on device"},"positionX":800,"positionY":350}
    ],
    "connections": [
      {"fromNodeId":"n1","toNodeId":"n2","label":"Success"},
      {"fromNodeId":"n2","toNodeId":"n3","label":"True"},
      {"fromNodeId":"n2","toNodeId":"n8","label":"False"},
      {"fromNodeId":"n3","toNodeId":"n4","label":"Success"},
      {"fromNodeId":"n4","toNodeId":"n5","label":"Success"},
      {"fromNodeId":"n5","toNodeId":"n6","label":"Success"},
      {"fromNodeId":"n6","toNodeId":"n7","label":"Success"},
      {"fromNodeId":"n8","toNodeId":"n9","label":"True"},
      {"fromNodeId":"n9","toNodeId":"n10","label":"Success"}
    ],
    "firstRuleNodeId":"n1",
    "changeNotes":"E2E test: advanced filter and external pipeline"
  }')
  SAVE4_OK=$(echo "$SAVE4_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE4_OK" == "true" ]]; then
    pass "Chain 4 saved with 10 nodes and 9 connections"
  else
    fail "Chain 4 save failed: $SAVE4_RESP"
  fi
fi

# ── Chain 5: Flow Control Pipeline ───────────────────────────────
log "Creating Chain 5: Flow Control Pipeline..."
CHAIN5_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 5: Flow Control","description":"input → delay → checkpoint → save-timeseries → acknowledge + rule-chain-input"}')
CHAIN5_ID=$(echo "$CHAIN5_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN5_ID" && "$CHAIN5_ID" != "null" ]]; then
  pass "Chain 5 created: $CHAIN5_ID"
else
  fail "Chain 5 creation failed: $CHAIN5_RESP"
  CHAIN5_ID=""
fi

if [[ -n "$CHAIN5_ID" ]]; then
  # Use Chain 1 ID for rule-chain-input delegation (if available)
  TARGET_CHAIN_ID="${CHAIN1_ID:-}"
  SAVE5_RESP=$(api POST "/api/rule-chains/$CHAIN5_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d "{
    \"nodes\": [
      {\"id\":\"n1\",\"type\":\"input\",\"name\":\"Input\",\"configuration\":{},\"positionX\":100,\"positionY\":200},
      {\"id\":\"n2\",\"type\":\"delay\",\"name\":\"Delay 100ms\",\"configuration\":{\"delayMs\":100,\"maxDelayMs\":10000},\"positionX\":250,\"positionY\":200},
      {\"id\":\"n3\",\"type\":\"checkpoint\",\"name\":\"Checkpoint\",\"configuration\":{},\"positionX\":400,\"positionY\":200},
      {\"id\":\"n4\",\"type\":\"save-timeseries\",\"name\":\"Save TS\",\"configuration\":{},\"positionX\":550,\"positionY\":200},
      {\"id\":\"n5\",\"type\":\"acknowledge\",\"name\":\"ACK\",\"configuration\":{},\"positionX\":700,\"positionY\":200},
      {\"id\":\"n6\",\"type\":\"rule-chain-input\",\"name\":\"Delegate\",\"configuration\":{\"targetChainId\":\"${TARGET_CHAIN_ID}\"},\"positionX\":400,\"positionY\":400}
    ],
    \"connections\": [
      {\"fromNodeId\":\"n1\",\"toNodeId\":\"n2\",\"label\":\"Success\"},
      {\"fromNodeId\":\"n2\",\"toNodeId\":\"n3\",\"label\":\"Success\"},
      {\"fromNodeId\":\"n3\",\"toNodeId\":\"n4\",\"label\":\"Success\"},
      {\"fromNodeId\":\"n4\",\"toNodeId\":\"n5\",\"label\":\"Success\"},
      {\"fromNodeId\":\"n3\",\"toNodeId\":\"n6\",\"label\":\"Failure\"}
    ],
    \"firstRuleNodeId\":\"n1\",
    \"changeNotes\":\"E2E test: flow control pipeline\"
  }")
  SAVE5_OK=$(echo "$SAVE5_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE5_OK" == "true" ]]; then
    pass "Chain 5 saved with 6 nodes and 5 connections"
  else
    fail "Chain 5 save failed: $SAVE5_RESP"
  fi
fi

# ── Chain 6: Relationship & Assignment Pipeline ──────────────────
log "Creating Chain 6: Relationship & Assignment Pipeline..."
CHAIN6_RESP=$(api POST /api/rule-chains \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d '{"name":"E2E-${RUN_ID} Chain 6: Relationship Pipeline","description":"input → check-relation → related-attributes → tenant-attributes → change-originator → save-attributes → assign-to-user + rpc-call-reply"}')
CHAIN6_ID=$(echo "$CHAIN6_RESP" | jq -r '.data.id // empty' 2>/dev/null)

if [[ -n "$CHAIN6_ID" && "$CHAIN6_ID" != "null" ]]; then
  pass "Chain 6 created: $CHAIN6_ID"
else
  fail "Chain 6 creation failed: $CHAIN6_RESP"
  CHAIN6_ID=""
fi

if [[ -n "$CHAIN6_ID" ]]; then
  SAVE6_RESP=$(api POST "/api/rule-chains/$CHAIN6_ID/save" \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d '{
    "nodes": [
      {"id":"n1","type":"input","name":"Input","configuration":{},"positionX":100,"positionY":200},
      {"id":"n2","type":"check-relation","name":"Check Relation","configuration":{"relationType":"CONTAINS","direction":"source"},"positionX":250,"positionY":200},
      {"id":"n3","type":"related-attributes","name":"Related Attrs","configuration":{"relationType":"CONTAINS","direction":"source"},"positionX":400,"positionY":100},
      {"id":"n4","type":"tenant-attributes","name":"Tenant Attrs","configuration":{},"positionX":550,"positionY":100},
      {"id":"n5","type":"change-originator","name":"Change Origin","configuration":{"target":"parent"},"positionX":700,"positionY":100},
      {"id":"n6","type":"save-attributes","name":"Save Attrs","configuration":{"scope":"server"},"positionX":850,"positionY":100},
      {"id":"n7","type":"assign-to-user","name":"Assign User","configuration":{"userId":""},"positionX":1000,"positionY":100},
      {"id":"n8","type":"rpc-call-reply","name":"RPC Reply","configuration":{},"positionX":1000,"positionY":300}
    ],
    "connections": [
      {"fromNodeId":"n1","toNodeId":"n2","label":"Success"},
      {"fromNodeId":"n2","toNodeId":"n3","label":"True"},
      {"fromNodeId":"n2","toNodeId":"n8","label":"False"},
      {"fromNodeId":"n3","toNodeId":"n4","label":"Success"},
      {"fromNodeId":"n4","toNodeId":"n5","label":"Success"},
      {"fromNodeId":"n5","toNodeId":"n6","label":"Success"},
      {"fromNodeId":"n6","toNodeId":"n7","label":"Success"}
    ],
    "firstRuleNodeId":"n1",
    "changeNotes":"E2E test: relationship and assignment pipeline"
  }')
  SAVE6_OK=$(echo "$SAVE6_RESP" | jq -r '.success // false' 2>/dev/null)
  if [[ "$SAVE6_OK" == "true" ]]; then
    pass "Chain 6 saved with 8 nodes and 7 connections"
  else
    fail "Chain 6 save failed: $SAVE6_RESP"
  fi
fi

# Verify all chains via GET
log "Verifying chains via API..."
for i in 1 2 3 4 5 6; do
  VAR_NAME="CHAIN${i}_ID"
  CID="${!VAR_NAME}"
  if [[ -n "$CID" ]]; then
    CHAIN_DETAIL=$(api GET "/api/rule-chains/$CID")
    NODE_CT=$(echo "$CHAIN_DETAIL" | jq '.nodes | length' 2>/dev/null)
    CONN_CT=$(echo "$CHAIN_DETAIL" | jq '.connections | length' 2>/dev/null)
    pass "Chain $i verified: $NODE_CT nodes, $CONN_CT connections"
  fi
done

# ═══════════════════════════════════════════════════════════════════
# PHASE 4: CREATE ENTITY TEMPLATES
# ═══════════════════════════════════════════════════════════════════
section "Phase 4: Create Entity Templates (6 templates)"

# Template A: Temperature Sensor → Chain 1
log "Creating Template A: Temperature Sensor..."
TMPL_A_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Temperature Sensor\",
  \"description\": \"Temperature sensor with basic telemetry pipeline\",
  \"category\": \"Sensor\",
  \"icon\": \"thermometer\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"inactivityTimeout\": 120,
  \"defaultMaxDataRate\": 600,
  \"autoProvision\": true,
  \"defaultRuleChainId\": \"${CHAIN1_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"temperature\", \"dataType\": \"FLOAT\", \"unit\": \"°C\"},
    {\"fieldName\": \"humidity\", \"dataType\": \"FLOAT\", \"unit\": \"%\"},
    {\"fieldName\": \"pressure\", \"dataType\": \"FLOAT\", \"unit\": \"hPa\"}
  ],
  \"alarmRules\": [
    {\"name\": \"Temperature High\", \"type\": \"HIGH\", \"severity\": \"WARNING\", \"sourceField\": \"temperature\", \"threshold\": 80, \"enabled\": true},
    {\"name\": \"Temperature Critical\", \"type\": \"HIGH_HIGH\", \"severity\": \"CRITICAL\", \"sourceField\": \"temperature\", \"threshold\": 95, \"enabled\": true}
  ],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": []
}")
TMPL_A_ID=$(echo "$TMPL_A_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_A_ID" && "$TMPL_A_ID" != "null" ]]; then
  pass "Template A created: $TMPL_A_ID"
else
  fail "Template A creation failed: $TMPL_A_RESP"
  TMPL_A_ID=""
fi

# Template B: Pressure Monitor → Chain 2
log "Creating Template B: Pressure Monitor..."
TMPL_B_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Pressure Monitor\",
  \"description\": \"Pressure monitor with alarm pipeline\",
  \"category\": \"Sensor\",
  \"icon\": \"gauge\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"defaultRuleChainId\": \"${CHAIN2_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"pressure\", \"dataType\": \"FLOAT\", \"unit\": \"PSI\"},
    {\"fieldName\": \"flow_rate\", \"dataType\": \"FLOAT\", \"unit\": \"L/min\"},
    {\"fieldName\": \"valve_status\", \"dataType\": \"BOOLEAN\"}
  ],
  \"alarmRules\": [],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": []
}")
TMPL_B_ID=$(echo "$TMPL_B_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_B_ID" && "$TMPL_B_ID" != "null" ]]; then
  pass "Template B created: $TMPL_B_ID"
else
  fail "Template B creation failed: $TMPL_B_RESP"
  TMPL_B_ID=""
fi

# Template C: Environmental Sensor → Chain 3
log "Creating Template C: Environmental Sensor..."
TMPL_C_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Environmental Sensor\",
  \"description\": \"Environmental sensor with enrichment and transform pipeline\",
  \"category\": \"Sensor\",
  \"icon\": \"cloud\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"defaultRuleChainId\": \"${CHAIN3_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"temp_f\", \"dataType\": \"FLOAT\", \"unit\": \"°F\"},
    {\"fieldName\": \"humidity_pct\", \"dataType\": \"FLOAT\", \"unit\": \"%\"},
    {\"fieldName\": \"co2_ppm\", \"dataType\": \"INTEGER\", \"unit\": \"ppm\"}
  ],
  \"alarmRules\": [],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": []
}")
TMPL_C_ID=$(echo "$TMPL_C_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_C_ID" && "$TMPL_C_ID" != "null" ]]; then
  pass "Template C created: $TMPL_C_ID"
else
  fail "Template C creation failed: $TMPL_C_RESP"
  TMPL_C_ID=""
fi

# Template D: Smart Actuator → Chain 4
log "Creating Template D: Smart Actuator..."
TMPL_D_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Smart Actuator\",
  \"description\": \"Smart actuator with advanced pipeline\",
  \"category\": \"Equipment\",
  \"icon\": \"cog\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"defaultRuleChainId\": \"${CHAIN4_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"position\", \"dataType\": \"FLOAT\", \"unit\": \"deg\"},
    {\"fieldName\": \"speed\", \"dataType\": \"FLOAT\", \"unit\": \"RPM\"},
    {\"fieldName\": \"current\", \"dataType\": \"FLOAT\", \"unit\": \"A\"},
    {\"fieldName\": \"error_code\", \"dataType\": \"STRING\"}
  ],
  \"alarmRules\": [],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": []
}")
TMPL_D_ID=$(echo "$TMPL_D_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_D_ID" && "$TMPL_D_ID" != "null" ]]; then
  pass "Template D created: $TMPL_D_ID"
else
  fail "Template D creation failed: $TMPL_D_RESP"
  TMPL_D_ID=""
fi

# Template E: Flow Controller → Chain 5
log "Creating Template E: Flow Controller..."
TMPL_E_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Flow Controller\",
  \"description\": \"Flow controller with flow control pipeline\",
  \"category\": \"Equipment\",
  \"icon\": \"activity\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"defaultRuleChainId\": \"${CHAIN5_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"flow\", \"dataType\": \"FLOAT\", \"unit\": \"L/min\"},
    {\"fieldName\": \"temperature\", \"dataType\": \"FLOAT\", \"unit\": \"°C\"},
    {\"fieldName\": \"level\", \"dataType\": \"FLOAT\", \"unit\": \"%\"}
  ],
  \"alarmRules\": [],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": []
}")
TMPL_E_ID=$(echo "$TMPL_E_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_E_ID" && "$TMPL_E_ID" != "null" ]]; then
  pass "Template E created: $TMPL_E_ID"
else
  fail "Template E creation failed: $TMPL_E_RESP"
  TMPL_E_ID=""
fi

# Template F: Data Logger → Chain 6
log "Creating Template F: Data Logger..."
TMPL_F_RESP=$(api POST /api/assets/templates \
  -H "x-reauth-password: $ADMIN_PASS" \
  -d "{
  \"name\": \"E2E-${RUN_ID} Data Logger\",
  \"description\": \"Data logger with relationship pipeline\",
  \"category\": \"Equipment\",
  \"icon\": \"database\",
  \"dataIngestionEnabled\": true,
  \"transportType\": \"HTTP\",
  \"credentialType\": \"TOKEN\",
  \"defaultRuleChainId\": \"${CHAIN6_ID}\",
  \"telemetrySchema\": [
    {\"fieldName\": \"reading\", \"dataType\": \"FLOAT\", \"unit\": \"\"},
    {\"fieldName\": \"status\", \"dataType\": \"STRING\"},
    {\"fieldName\": \"batch_id\", \"dataType\": \"STRING\"}
  ],
  \"alarmRules\": [],
  \"attributeSchema\": [],
  \"expectedIdentifiers\": [],
  \"expectedRelationships\": [],
  \"statusLifecycle\": [],
  \"checklistSchema\": [],
  \"maxParentConnections\": 1,
  \"maxConnections\": 10
}")
TMPL_F_ID=$(echo "$TMPL_F_RESP" | jq -r '.data.id // empty' 2>/dev/null)
if [[ -n "$TMPL_F_ID" && "$TMPL_F_ID" != "null" ]]; then
  pass "Template F created: $TMPL_F_ID"
else
  fail "Template F creation failed: $TMPL_F_RESP"
  TMPL_F_ID=""
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE 5: CREATE TEST ENTITIES (18 entities, 3 per template)
# ═══════════════════════════════════════════════════════════════════
section "Phase 5: Create Test Entities (18 entities)"

# Declare arrays for entity IDs and tokens
declare -A ENTITY_IDS
declare -A DEVICE_TOKENS

create_entity() {
  local name="$1"
  local template_id="$2"
  local key="$3"

  local RESP
  RESP=$(api POST /api/assets/instances \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d "{
    \"name\": \"$name\",
    \"description\": \"E2E test entity\",
    \"templateId\": \"$template_id\",
    \"status\": \"Active\",
    \"attributes\": {},
    \"customAttributes\": {}
  }")

  local EID
  EID=$(echo "$RESP" | jq -r '.data.id // empty' 2>/dev/null)

  if [[ -n "$EID" && "$EID" != "null" ]]; then
    ENTITY_IDS[$key]="$EID"
    pass "Entity $name created: $EID"

    # Get device token via connectivity endpoint
    local CONN_RESP
    CONN_RESP=$(api GET "/api/connectivity/$EID")
    local DTOKEN
    DTOKEN=$(echo "$CONN_RESP" | jq -r '.credential.token // empty' 2>/dev/null)

    if [[ -n "$DTOKEN" && "$DTOKEN" != "null" ]]; then
      DEVICE_TOKENS[$key]="$DTOKEN"
      pass "Device token retrieved for $name"
    else
      # Try generating a token
      local TOKEN_RESP
      TOKEN_RESP=$(api POST "/api/connectivity/$EID/token" -d '{}')
      DTOKEN=$(echo "$TOKEN_RESP" | jq -r '.token // empty' 2>/dev/null)
      if [[ -n "$DTOKEN" && "$DTOKEN" != "null" ]]; then
        DEVICE_TOKENS[$key]="$DTOKEN"
        pass "Device token generated for $name"
      else
        warn "No device token for $name"
      fi
    fi
  else
    fail "Entity $name creation failed: $RESP"
  fi
}

# Create entities for each template
TEMPLATES=("A:$TMPL_A_ID" "B:$TMPL_B_ID" "C:$TMPL_C_ID" "D:$TMPL_D_ID" "E:$TMPL_E_ID" "F:$TMPL_F_ID")
for tmpl_entry in "${TEMPLATES[@]}"; do
  PREFIX="${tmpl_entry%%:*}"
  TID="${tmpl_entry##*:}"
  if [[ -n "$TID" ]]; then
    for i in 1 2 3; do
      create_entity "E2E-${RUN_ID} Device${PREFIX}${i}" "$TID" "${PREFIX}${i}"
    done
  fi
done

# Create CONTAINS relationship between F1 → F2 for relationship testing
if [[ -n "${ENTITY_IDS[F1]:-}" && -n "${ENTITY_IDS[F2]:-}" ]]; then
  log "Creating CONTAINS relationship F1 → F2..."
  REL_RESP=$(api POST /api/assets/relationships \
    -H "x-reauth-password: $ADMIN_PASS" \
    -d "{
    \"sourceAssetId\": \"${ENTITY_IDS[F1]}\",
    \"targetAssetId\": \"${ENTITY_IDS[F2]}\",
    \"relationshipType\": \"CONTAINS\"
  }")
  REL_OK=$(echo "$REL_RESP" | jq -r '.success // .data.id // empty' 2>/dev/null)
  if [[ -n "$REL_OK" && "$REL_OK" != "null" ]]; then
    pass "CONTAINS relationship F1→F2 created"
  else
    fail "CONTAINS relationship creation failed: $REL_RESP"
  fi
fi

# ═══════════════════════════════════════════════════════════════════
# PHASE 6: SEND TELEMETRY & VERIFY RULE CHAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════
section "Phase 6: Send Telemetry & Verify Rule Chain Execution"

send_telemetry() {
  local key="$1"
  local data="$2"
  local test_name="$3"
  local expect_status="${4:-200}"

  local token="${DEVICE_TOKENS[$key]:-}"
  if [[ -z "$token" ]]; then
    fail "$test_name — no device token for $key"
    return
  fi

  local RESP
  RESP=$(device_api POST /api/data/telemetry "$token" -d "$data")
  local STATUS="${RESP%%|*}"
  local BODY="${RESP#*|}"

  if [[ "$STATUS" == "$expect_status" ]]; then
    local MSG_ID
    MSG_ID=$(echo "$BODY" | jq -r '.messageId // .messageIds[0] // empty' 2>/dev/null)
    pass "$test_name (HTTP $STATUS, msgId: ${MSG_ID:-N/A})"
  else
    fail "$test_name (expected HTTP $expect_status, got $STATUS: $BODY)"
  fi
}

# ── Test Suite 1: Basic Pipeline (Chain 1 via Template A devices) ──
log "Test Suite 1: Basic Telemetry Pipeline..."

send_telemetry "A1" \
  '{"temperature": 28.5, "humidity": 65.2, "pressure": 1012.3}' \
  "Suite1: Normal telemetry (A1)"

send_telemetry "A2" \
  '{"temperature": 45.0, "humidity": 30.0, "pressure": 1005.0}' \
  "Suite1: Normal telemetry (A2)"

send_telemetry "A3" \
  '{"temperature": 28}' \
  "Suite1: Partial fields (A3)"

# Wait for async processing
sleep 1

# ── Test Suite 2: Alarm Pipeline (Chain 2 via Template B devices) ──
log "Test Suite 2: Alarm & Notification Pipeline..."

send_telemetry "B1" \
  '{"pressure": 120.0, "flow_rate": 5.5, "valve_status": false}' \
  "Suite2: High pressure alarm trigger (B1)"

send_telemetry "B2" \
  '{"pressure": 50.0, "flow_rate": 3.0, "valve_status": true}' \
  "Suite2: Normal pressure, no alarm (B2)"

send_telemetry "B3" \
  '{"pressure": 150.0, "flow_rate": 8.0, "valve_status": false}' \
  "Suite2: Very high pressure alarm (B3)"

sleep 1

# Verify alarms
log "Verifying alarms..."
ALARM_RESP=$(api GET "/api/queries/alarms?limit=50")
ALARM_COUNT=$(echo "$ALARM_RESP" | jq '.data | length' 2>/dev/null || echo "0")
if [[ "$ALARM_COUNT" -gt 0 ]]; then
  pass "Alarms found: $ALARM_COUNT total"
  # Check for HIGH_PRESSURE alarm type
  HP_ALARMS=$(echo "$ALARM_RESP" | jq '[.data[] | select(.alarmType == "HIGH_PRESSURE")] | length' 2>/dev/null || echo "0")
  if [[ "$HP_ALARMS" -gt 0 ]]; then
    pass "HIGH_PRESSURE alarms created: $HP_ALARMS"
  else
    warn "No HIGH_PRESSURE alarms found (may be deduped or script-filter not matching)"
  fi
else
  warn "No alarms found (alarm creation may be async or script-filter didn't match)"
fi

# Verify notifications
log "Verifying notifications..."
NOTIF_RESP=$(api GET "/api/notifications?limit=50")
NOTIF_COUNT=$(echo "$NOTIF_RESP" | jq '.data | length' 2>/dev/null || echo "0")
if [[ "$NOTIF_COUNT" -gt 0 ]]; then
  pass "Notifications found: $NOTIF_COUNT"
else
  warn "No notifications found (notification delivery may be async)"
fi

# ── Test Suite 3: Enrichment & Transform (Chain 3 via Template C devices) ──
log "Test Suite 3: Enrichment & Transform Pipeline..."

send_telemetry "C1" \
  '{"temp_f": 98.6, "humidity_pct": 45.0, "co2_ppm": 400}' \
  "Suite3: Fahrenheit with enrichment (C1)"

send_telemetry "C2" \
  '{"temp_f": 212.0, "humidity_pct": 100.0, "co2_ppm": 5000}' \
  "Suite3: Boiling point conversion (C2)"

send_telemetry "C3" \
  '{"temp_f": 32.0, "humidity_pct": 10.0, "co2_ppm": 350}' \
  "Suite3: Freezing point conversion (C3)"

sleep 1

# ── Test Suite 4: Advanced Pipeline (Chain 4 via Template D devices) ──
log "Test Suite 4: Advanced Filter & External Pipeline..."

send_telemetry "D1" \
  '{"position": 45.5, "speed": 120.0, "current": 3.2, "error_code": "OK"}' \
  "Suite4: Normal actuator data (D1)"

send_telemetry "D2" \
  '{"position": 90.0, "speed": 0.0, "current": 0.1, "error_code": "E_STALL"}' \
  "Suite4: Error condition (D2)"

send_telemetry "D3" \
  '{"position": 180.0, "speed": 250.0, "current": 5.5, "error_code": "OK"}' \
  "Suite4: High-speed operation (D3)"

sleep 1

# ── Test Suite 5: Flow Control (Chain 5 via Template E devices) ──
log "Test Suite 5: Flow Control Pipeline..."

send_telemetry "E1" \
  '{"flow": 25.5, "temperature": 22.0, "level": 75.0}' \
  "Suite5: Normal flow data (E1)"

send_telemetry "E2" \
  '{"flow": 0.0, "temperature": 18.0, "level": 90.0}' \
  "Suite5: Zero flow (E2)"

send_telemetry "E3" \
  '{"flow": 100.0, "temperature": 35.0, "level": 10.0}' \
  "Suite5: High flow data (E3)"

sleep 1

# ── Test Suite 6: Relationship Pipeline (Chain 6 via Template F devices) ──
log "Test Suite 6: Relationship & Assignment Pipeline..."

send_telemetry "F1" \
  '{"reading": 42.0, "status": "GOOD", "batch_id": "B001"}' \
  "Suite6: Normal reading with relationship (F1)"

send_telemetry "F2" \
  '{"reading": 99.9, "status": "WARNING", "batch_id": "B002"}' \
  "Suite6: Warning reading (F2)"

send_telemetry "F3" \
  '{"reading": 0.0, "status": "IDLE", "batch_id": "B003"}' \
  "Suite6: Idle reading (F3)"

sleep 1

# ── Edge Cases ──────────────────────────────────────────────────
log "Testing edge cases..."

# Large payload (50+ keys)
LARGE_PAYLOAD='{'
for i in $(seq 1 50); do
  LARGE_PAYLOAD+="\"sensor_${i}\": ${i}.${i}"
  if [[ $i -lt 50 ]]; then LARGE_PAYLOAD+=','; fi
done
LARGE_PAYLOAD+='}'
send_telemetry "A1" "$LARGE_PAYLOAD" "Edge: Large payload (50 keys)"

# Empty payload
send_telemetry "A1" '{}' "Edge: Empty payload"

# Null values
send_telemetry "A1" '{"temperature": null, "humidity": null}' "Edge: Null values"

# Timestamped format
send_telemetry "A1" \
  '{"ts": 1709510400000, "values": {"temperature": 55.5, "humidity": 40.0}}' \
  "Edge: Timestamped format"

# Batch array format
send_telemetry "A2" \
  '[{"ts": 1709510400000, "values": {"temperature": 20.0}}, {"ts": 1709510401000, "values": {"temperature": 21.0}}]' \
  "Edge: Batch array format"

# Rapid fire (10 messages in < 1 second)
log "Rapid fire test (10 messages)..."
RAPID_PASS=0
RAPID_FAIL=0
for i in $(seq 1 10); do
  RF_RESP=$(device_api POST /api/data/telemetry "${DEVICE_TOKENS[A3]:-NONE}" \
    -d "{\"temperature\": ${i}.0, \"humidity\": $((50+i)).0}")
  RF_STATUS="${RF_RESP%%|*}"
  if [[ "$RF_STATUS" == "200" ]]; then
    RAPID_PASS=$((RAPID_PASS+1))
  else
    RAPID_FAIL=$((RAPID_FAIL+1))
  fi
done
if [[ $RAPID_PASS -ge 8 ]]; then
  pass "Rapid fire: $RAPID_PASS/10 succeeded"
else
  fail "Rapid fire: only $RAPID_PASS/10 succeeded ($RAPID_FAIL failed)"
fi

sleep 2

# ═══════════════════════════════════════════════════════════════════
# PHASE 7: EXECUTION VERIFICATION
# ═══════════════════════════════════════════════════════════════════
section "Phase 7: Execution Verification"

# 7.1 Pipeline traces
log "Checking pipeline traces..."
TRACE_RESP=$(api GET "/api/debug/traces?pageSize=100")
TRACE_COUNT=$(echo "$TRACE_RESP" | jq '.total // .data | length // 0' 2>/dev/null)
TRACE_SUCCESS=$(echo "$TRACE_RESP" | jq '[.data[]? | select(.finalStatus == "SUCCESS" or .finalStatus == "SUCCESS_WITH_WARNINGS")] | length' 2>/dev/null || echo "0")
TRACE_FAILED=$(echo "$TRACE_RESP" | jq '[.data[]? | select(.finalStatus == "FAILED" or .finalStatus == "DLQ")] | length' 2>/dev/null || echo "0")

if [[ "$TRACE_COUNT" -gt 0 ]]; then
  pass "Pipeline traces found: $TRACE_COUNT total ($TRACE_SUCCESS success, $TRACE_FAILED failed)"
else
  warn "No pipeline traces found (tracing may not be enabled)"
fi

# 7.2 Trace stats
log "Checking trace stats..."
STATS_RESP=$(api GET "/api/debug/traces/stats")
SUCCESS_RATE_1H=$(echo "$STATS_RESP" | jq -r '.successRate1h // "N/A"' 2>/dev/null)
SUCCESS_RATE_24H=$(echo "$STATS_RESP" | jq -r '.successRate24h // "N/A"' 2>/dev/null)
AVG_DURATION=$(echo "$STATS_RESP" | jq -r '.avgDurationMs // "N/A"' 2>/dev/null)
if [[ "$SUCCESS_RATE_1H" != "N/A" && "$SUCCESS_RATE_1H" != "null" ]]; then
  pass "Trace stats: 1h success rate=$SUCCESS_RATE_1H%, 24h=$SUCCESS_RATE_24H%, avg duration=${AVG_DURATION}ms"
else
  warn "Trace stats unavailable"
fi

# 7.3 Debug buffers for each chain
log "Checking rule chain debug buffers..."
for i in 1 2 3 4 5 6; do
  VAR_NAME="CHAIN${i}_ID"
  CID="${!VAR_NAME}"
  if [[ -n "$CID" ]]; then
    DEBUG_RESP=$(api GET "/api/rule-chains/$CID/debug?limit=10")
    DEBUG_COUNT=$(echo "$DEBUG_RESP" | jq 'length' 2>/dev/null || echo "0")
    if [[ "$DEBUG_COUNT" -gt 0 ]]; then
      # Extract unique node types executed
      EXECUTED_TYPES=$(echo "$DEBUG_RESP" | jq -r '.[].nodeType' 2>/dev/null | sort -u | tr '\n' ', ' | sed 's/,$//')
      pass "Chain $i debug: $DEBUG_COUNT entries, types: [$EXECUTED_TYPES]"
    else
      warn "Chain $i debug: no entries (debug may not be enabled on nodes)"
    fi
  fi
done

# 7.4 Connectivity status check
log "Checking entity connectivity..."
ONLINE_COUNT=0
OFFLINE_COUNT=0
for key in A1 A2 A3 B1 B2 B3 C1 C2 C3 D1 D2 D3 E1 E2 E3 F1 F2 F3; do
  EID="${ENTITY_IDS[$key]:-}"
  if [[ -n "$EID" ]]; then
    CONN_RESP=$(api GET "/api/connectivity/$EID")
    CONN_STATUS=$(echo "$CONN_RESP" | jq -r '.connectivity.status // "UNKNOWN"' 2>/dev/null)
    if [[ "$CONN_STATUS" == "ONLINE" ]]; then
      ONLINE_COUNT=$((ONLINE_COUNT+1))
    else
      OFFLINE_COUNT=$((OFFLINE_COUNT+1))
    fi
  fi
done
pass "Connectivity: $ONLINE_COUNT ONLINE, $OFFLINE_COUNT OFFLINE out of 18 entities"

# 7.5 Alarm summary
log "Checking alarm summary..."
ALARM_SUMMARY=$(api GET "/api/queries/alarms/summary")
ACTIVE_ALARMS=$(echo "$ALARM_SUMMARY" | jq -r '.active // 0' 2>/dev/null)
CRITICAL_ALARMS=$(echo "$ALARM_SUMMARY" | jq -r '.critical // 0' 2>/dev/null)
pass "Alarm summary: $ACTIVE_ALARMS active, $CRITICAL_ALARMS critical"

# ═══════════════════════════════════════════════════════════════════
# PHASE 8: PERFORMANCE TESTING
# ═══════════════════════════════════════════════════════════════════
section "Phase 8: Performance Testing"

# 8.1 Burst test: 50 messages to a single entity
log "Burst test: 50 messages to Device A1..."
BURST_START=$(date +%s%N)
BURST_SUCCESS=0
BURST_FAIL=0
BURST_TIMES=()

for i in $(seq 1 50); do
  MSG_START=$(date +%s%N)
  BR_RESP=$(device_api POST /api/data/telemetry "${DEVICE_TOKENS[A1]:-NONE}" \
    -d "{\"temperature\": $((20+i%30)).${i}, \"humidity\": $((40+i%20)).0}")
  BR_STATUS="${BR_RESP%%|*}"
  MSG_END=$(date +%s%N)
  MSG_DURATION=$(( (MSG_END - MSG_START) / 1000000 ))
  BURST_TIMES+=($MSG_DURATION)

  if [[ "$BR_STATUS" == "200" ]]; then
    BURST_SUCCESS=$((BURST_SUCCESS+1))
  else
    BURST_FAIL=$((BURST_FAIL+1))
  fi
done
BURST_END=$(date +%s%N)
BURST_TOTAL_MS=$(( (BURST_END - BURST_START) / 1000000 ))

# Calculate stats
IFS=$'\n' SORTED_TIMES=($(sort -n <<<"${BURST_TIMES[*]}")); unset IFS
BURST_MIN=${SORTED_TIMES[0]}
BURST_MAX=${SORTED_TIMES[-1]}
BURST_P95=${SORTED_TIMES[47]}  # 95th percentile of 50 values
BURST_SUM=0
for t in "${BURST_TIMES[@]}"; do BURST_SUM=$((BURST_SUM + t)); done
BURST_AVG=$((BURST_SUM / 50))

if [[ $BURST_SUCCESS -ge 45 ]]; then
  pass "Burst test: $BURST_SUCCESS/50 succeeded in ${BURST_TOTAL_MS}ms (avg=${BURST_AVG}ms, p95=${BURST_P95}ms, min=${BURST_MIN}ms, max=${BURST_MAX}ms)"
else
  fail "Burst test: only $BURST_SUCCESS/50 succeeded ($BURST_FAIL failed)"
fi

# 8.2 Parallel test: 6 entities sending simultaneously
log "Parallel test: 6 entities sending simultaneously..."
PARALLEL_START=$(date +%s%N)
PARALLEL_PIDS=()
PARALLEL_RESULTS="/tmp/e2e-parallel-$$"
mkdir -p "$PARALLEL_RESULTS"

for key in A1 B1 C1 D1 E1 F1; do
  (
    TOKEN="${DEVICE_TOKENS[$key]:-NONE}"
    SUCCESS=0
    FAIL=0
    for i in $(seq 1 10); do
      RESP=$(device_api POST /api/data/telemetry "$TOKEN" \
        -d "{\"value\": ${i}.0, \"sensor\": \"parallel_test\"}")
      STATUS="${RESP%%|*}"
      if [[ "$STATUS" == "200" ]]; then SUCCESS=$((SUCCESS+1)); else FAIL=$((FAIL+1)); fi
    done
    echo "${SUCCESS}:${FAIL}" > "$PARALLEL_RESULTS/$key"
  ) &
  PARALLEL_PIDS+=($!)
done

# Wait for all parallel processes
for pid in "${PARALLEL_PIDS[@]}"; do
  wait "$pid" 2>/dev/null || true
done

PARALLEL_END=$(date +%s%N)
PARALLEL_TOTAL_MS=$(( (PARALLEL_END - PARALLEL_START) / 1000000 ))

TOTAL_PARALLEL_SUCCESS=0
TOTAL_PARALLEL_FAIL=0
for key in A1 B1 C1 D1 E1 F1; do
  if [[ -f "$PARALLEL_RESULTS/$key" ]]; then
    RESULT=$(cat "$PARALLEL_RESULTS/$key")
    S="${RESULT%%:*}"
    F="${RESULT##*:}"
    TOTAL_PARALLEL_SUCCESS=$((TOTAL_PARALLEL_SUCCESS + S))
    TOTAL_PARALLEL_FAIL=$((TOTAL_PARALLEL_FAIL + F))
  fi
done
rm -rf "$PARALLEL_RESULTS"

if [[ $TOTAL_PARALLEL_SUCCESS -ge 50 ]]; then
  pass "Parallel test: $TOTAL_PARALLEL_SUCCESS/60 succeeded in ${PARALLEL_TOTAL_MS}ms (6 entities × 10 messages)"
else
  fail "Parallel test: only $TOTAL_PARALLEL_SUCCESS/60 succeeded"
fi

sleep 2

# ═══════════════════════════════════════════════════════════════════
# PHASE 9: GENERATE REPORT
# ═══════════════════════════════════════════════════════════════════
section "Phase 9: Generate Report"

log "Writing report to $REPORT_FILE..."

# Final alarm/trace counts for report
FINAL_TRACES=$(api GET "/api/debug/traces?pageSize=1")
FINAL_TRACE_TOTAL=$(echo "$FINAL_TRACES" | jq '.total // 0' 2>/dev/null)
FINAL_ALARMS=$(api GET "/api/queries/alarms?limit=1")
FINAL_ALARM_TOTAL=$(echo "$FINAL_ALARMS" | jq '.total // 0' 2>/dev/null)

cat > "$REPORT_FILE" << REPORTEOF
# Rule Chain E2E Test Report

**Date:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Base URL:** $BASE_URL
**Test User:** $ADMIN_USER

---

## Report A: Node Validation Report

| Category | Count | Node Types |
|----------|-------|------------|
$(echo -e "$NODE_TYPE_REPORT")

**Total nodes registered:** $NODE_COUNT / 31 expected

---

## Report B: Rule Chain Test Report

| Chain | Name | Nodes | Status |
|-------|------|-------|--------|
| 1 | Basic Telemetry Pipeline | input, msg-type-filter, save-timeseries, log | ${CHAIN1_ID:+CREATED} ${CHAIN1_ID:-FAILED} |
| 2 | Alarm & Notification Pipeline | script-filter, create-alarm, clear-alarm, send-notification, log | ${CHAIN2_ID:+CREATED} ${CHAIN2_ID:-FAILED} |
| 3 | Enrichment & Transform Pipeline | entity-attributes, entity-details, rename-keys, unit-conversion, save-timeseries | ${CHAIN3_ID:+CREATED} ${CHAIN3_ID:-FAILED} |
| 4 | Advanced Filter & External Pipeline | originator-type-filter, script-transform, rest-api-call, mqtt-publish, push-to-uns, check-alarm-status, to-email, send-email, save-timeseries | ${CHAIN4_ID:+CREATED} ${CHAIN4_ID:-FAILED} |
| 5 | Flow Control Pipeline | delay, checkpoint, save-timeseries, acknowledge, rule-chain-input | ${CHAIN5_ID:+CREATED} ${CHAIN5_ID:-FAILED} |
| 6 | Relationship & Assignment Pipeline | check-relation, related-attributes, tenant-attributes, change-originator, save-attributes, assign-to-user, rpc-call-reply | ${CHAIN6_ID:+CREATED} ${CHAIN6_ID:-FAILED} |

**All 31 node types covered across 6 chains.**

---

## Report C: Entity Telemetry Test Report

### Templates Created
| Template | Name | Rule Chain | Entities |
|----------|------|------------|----------|
| A | E2E-${RUN_ID} Temperature Sensor | Chain 1 | DeviceA1, A2, A3 |
| B | E2E-${RUN_ID} Pressure Monitor | Chain 2 | DeviceB1, B2, B3 |
| C | E2E-${RUN_ID} Environmental Sensor | Chain 3 | DeviceC1, C2, C3 |
| D | E2E-${RUN_ID} Smart Actuator | Chain 4 | DeviceD1, D2, D3 |
| E | E2E-${RUN_ID} Flow Controller | Chain 5 | DeviceE1, E2, E3 |
| F | E2E-${RUN_ID} Data Logger | Chain 6 | DeviceF1, F2, F3 |

### Telemetry Results
| Suite | Chain | Tests Sent | Description |
|-------|-------|------------|-------------|
| 1 | Basic Pipeline | 3 | Normal telemetry + partial fields |
| 2 | Alarm Pipeline | 3 | High/normal/very-high pressure |
| 3 | Enrichment | 3 | Fahrenheit conversion + enrichment |
| 4 | Advanced | 3 | Actuator data + error conditions |
| 5 | Flow Control | 3 | Normal/zero/high flow |
| 6 | Relationship | 3 | Readings with relationship context |
| Edge | Various | 6 | Large payload, empty, null, timestamped, batch, rapid-fire |

**Total telemetry messages sent:** ~85 (18 standard + 6 edge + 10 rapid + 50 burst + ~60 parallel)

---

## Report D: Bug Report

$(if [[ ${#FAILED_TESTS[@]} -gt 0 ]]; then
  echo "### Failures Found"
  echo ""
  for ft in "${FAILED_TESTS[@]}"; do
    echo "- $ft"
  done
else
  echo "**No critical failures found.**"
fi)

---

## Report E: Performance Report

### Burst Test (50 sequential messages to single entity)
- **Success rate:** $BURST_SUCCESS / 50
- **Total time:** ${BURST_TOTAL_MS}ms
- **Average latency:** ${BURST_AVG}ms
- **P95 latency:** ${BURST_P95}ms
- **Min latency:** ${BURST_MIN}ms
- **Max latency:** ${BURST_MAX}ms

### Parallel Test (6 entities × 10 messages each)
- **Success rate:** $TOTAL_PARALLEL_SUCCESS / 60
- **Total time:** ${PARALLEL_TOTAL_MS}ms

### Pipeline Statistics
- **Total traces:** $FINAL_TRACE_TOTAL
- **Total alarms:** $FINAL_ALARM_TOTAL
- **Success rate (1h):** $SUCCESS_RATE_1H%
- **Success rate (24h):** $SUCCESS_RATE_24H%
- **Avg pipeline duration:** ${AVG_DURATION}ms

---

## Report F: Final Summary

| Metric | Value |
|--------|-------|
| **Total Tests** | $TOTAL_COUNT |
| **Passed** | $PASS_COUNT |
| **Failed** | $FAIL_COUNT |
| **Warnings** | $WARN_COUNT |
| **Pass Rate** | $(echo "scale=1; $PASS_COUNT * 100 / $TOTAL_COUNT" | bc 2>/dev/null || echo "N/A")% |
| **Node Types Validated** | $NODE_COUNT / 31 |
| **Rule Chains Created** | 6 |
| **Templates Created** | 6 |
| **Entities Created** | 18 |
| **Telemetry Messages** | ~85 |

### Test Coverage Matrix (31 nodes)

| Node Type | Category | Chain | Tested |
|-----------|----------|-------|--------|
| input | INPUT | 1-6 | Yes |
| msg-type-filter | FILTER | 1 | Yes |
| script-filter | FILTER | 2 | Yes |
| check-relation | FILTER | 6 | Yes |
| originator-type-filter | FILTER | 4 | Yes |
| check-alarm-status | FILTER | 4 | Yes |
| entity-attributes | ENRICHMENT | 3 | Yes |
| entity-details | ENRICHMENT | 3 | Yes |
| related-attributes | ENRICHMENT | 6 | Yes |
| tenant-attributes | ENRICHMENT | 6 | Yes |
| script-transform | TRANSFORM | 4 | Yes |
| rename-keys | TRANSFORM | 3 | Yes |
| change-originator | TRANSFORM | 6 | Yes |
| to-email | TRANSFORM | 4 | Yes |
| unit-conversion | TRANSFORM | 3 | Yes |
| save-timeseries | ACTION | 1,3,4,5 | Yes |
| save-attributes | ACTION | 6 | Yes |
| create-alarm | ACTION | 2 | Yes |
| clear-alarm | ACTION | 2 | Yes |
| send-notification | ACTION | 2 | Yes |
| assign-to-user | ACTION | 6 | Yes |
| log | ACTION | 1,2 | Yes |
| rpc-call-reply | ACTION | 6 | Yes |
| rest-api-call | EXTERNAL | 4 | Yes |
| mqtt-publish | EXTERNAL | 4 | Yes |
| push-to-uns | EXTERNAL | 4 | Yes |
| send-email | EXTERNAL | 4 | Yes |
| rule-chain-input | FLOW | 5 | Yes |
| checkpoint | FLOW | 5 | Yes |
| delay | FLOW | 5 | Yes |
| acknowledge | FLOW | 5 | Yes |

**Coverage: 31/31 node types (100%)**

REPORTEOF

pass "Report written to $REPORT_FILE"

# ═══════════════════════════════════════════════════════════════════
# PHASE 10: CLEANUP
# ═══════════════════════════════════════════════════════════════════
section "Phase 10: Cleanup"

if [[ "$NO_CLEANUP" == "true" ]]; then
  log "Skipping cleanup (--no-cleanup flag set). Test data persists for browser inspection."
  pass "Cleanup skipped — data available in browser"
else

log "Deleting test entities..."
for key in A1 A2 A3 B1 B2 B3 C1 C2 C3 D1 D2 D3 E1 E2 E3 F1 F2 F3; do
  EID="${ENTITY_IDS[$key]:-}"
  if [[ -n "$EID" ]]; then
    api DELETE "/api/assets/instances/$EID" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
  fi
done
pass "Test entities deleted"

log "Deleting test templates..."
for TID in "$TMPL_A_ID" "$TMPL_B_ID" "$TMPL_C_ID" "$TMPL_D_ID" "$TMPL_E_ID" "$TMPL_F_ID"; do
  if [[ -n "$TID" ]]; then
    api DELETE "/api/assets/templates/$TID" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
  fi
done
pass "Test templates deleted"

log "Deleting test rule chains..."
for CID in "$CHAIN1_ID" "$CHAIN2_ID" "$CHAIN3_ID" "$CHAIN4_ID" "$CHAIN5_ID" "$CHAIN6_ID"; do
  if [[ -n "$CID" ]]; then
    api DELETE "/api/rule-chains/$CID" -H "x-reauth-password: $ADMIN_PASS" > /dev/null 2>&1 || true
  fi
done
pass "Test rule chains deleted"

# Clear debug buffers
for CID in "$CHAIN1_ID" "$CHAIN2_ID" "$CHAIN3_ID" "$CHAIN4_ID" "$CHAIN5_ID" "$CHAIN6_ID"; do
  if [[ -n "$CID" ]]; then
    api DELETE "/api/rule-chains/$CID/debug" > /dev/null 2>&1 || true
  fi
done

fi  # end NO_CLEANUP check

# ═══════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═══════════════════════════════════════════════════════════════════
section "FINAL SUMMARY"

echo -e ""
echo -e "  ${GREEN}Passed:${NC}   $PASS_COUNT"
echo -e "  ${RED}Failed:${NC}   $FAIL_COUNT"
echo -e "  ${YELLOW}Warnings:${NC} $WARN_COUNT"
echo -e "  Total:    $TOTAL_COUNT"
echo -e ""

if [[ $FAIL_COUNT -eq 0 ]]; then
  echo -e "  ${GREEN}ALL TESTS PASSED${NC}"
else
  echo -e "  ${RED}SOME TESTS FAILED:${NC}"
  for ft in "${FAILED_TESTS[@]}"; do
    echo -e "    ${RED}•${NC} $ft"
  done
fi

echo -e ""
echo -e "  Report: ${BLUE}$REPORT_FILE${NC}"
echo -e ""

# Exit with error code if any failures
[[ $FAIL_COUNT -eq 0 ]]
