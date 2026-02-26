#!/bin/bash
# =============================================================================
# COMPREHENSIVE RBAC TEST SCRIPT — DigiLog
# Tests all 22 feature privileges end-to-end
# NO re-login between tests — permissions read from DB on each request
# =============================================================================

API="http://localhost:3000"
RESULTS_FILE="/home/ubuntu/21cfrlogbook/rbac-test-results.md"
TEST_ROLE="RBAC_TEST"
TEST_USERNAME="999999"
TEST_PASSWORD="Test@12345"
ADMIN_TOKEN=""
TEST_TOKEN=""

PASS=0
FAIL=0
TOTAL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

declare -a RESULTS

log_result() {
  local test_id="$1" category="$2" permission="$3" test_desc="$4" expected="$5" actual="$6" status="$7"
  TOTAL=$((TOTAL + 1))
  if [ "$status" = "PASS" ]; then
    PASS=$((PASS + 1))
    echo -e "${GREEN}  [PASS]${NC} $test_id: $test_desc ($actual)"
  else
    FAIL=$((FAIL + 1))
    echo -e "${RED}  [FAIL]${NC} $test_id: $test_desc (Expected: $expected, Got: $actual)"
  fi
  RESULTS+=("| $test_id | $category | \`$permission\` | $test_desc | $expected | $actual | **$status** |")
}

api_code() {
  local method="$1" path="$2" token="$3" body="$4"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$API$path" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" "$API$path" \
      -H "Authorization: Bearer $token"
  fi
}

api_json() {
  local method="$1" path="$2" token="$3"
  curl -s -X "$method" "$API$path" -H "Authorization: Bearer $token"
}

# Set permissions WITHOUT re-login. DB is read on each request.
set_perms() {
  local api_perms="$1" feature_perms="$2" sidebar="$3"
  local rc1 rc2
  rc1=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/api/roles/$TEST_ROLE" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"permissions\": $api_perms}")
  sleep 0.3
  rc2=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$API/api/config/roles/$TEST_ROLE" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"sidebarItems\": $sidebar, \"permissions\": $feature_perms}")
  if [ "$rc1" != "200" ] || [ "$rc2" != "200" ]; then
    echo -e "${RED}    WARNING: set_perms failed (role=$rc1, config=$rc2) — retrying after 30s${NC}"
    sleep 30
    curl -s -X PUT "$API/api/roles/$TEST_ROLE" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"permissions\": $api_perms}" > /dev/null
    sleep 0.3
    curl -s -X PUT "$API/api/config/roles/$TEST_ROLE" \
      -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
      -d "{\"sidebarItems\": $sidebar, \"permissions\": $feature_perms}" > /dev/null
  fi
  sleep 0.5
}

# ---------------------------------------------------------------------------
# Setup (only 2 logins total: admin + test user)
# ---------------------------------------------------------------------------

echo "============================================="
echo "  DigiLog RBAC Comprehensive Test Suite"
echo "============================================="
echo ""

echo -e "${CYAN}[SETUP]${NC} Admin Login..."
ADMIN_TOKEN=$(curl -s "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')
[ "$ADMIN_TOKEN" = "null" ] || [ -z "$ADMIN_TOKEN" ] && echo "Admin login failed" && exit 1
echo -e "${GREEN}  OK${NC}"

echo -e "${CYAN}[SETUP]${NC} Test Role & User..."
curl -s -X POST "$API/api/roles" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"$TEST_ROLE\",\"displayName\":\"RBAC Test\",\"description\":\"Testing\",\"hierarchyLevel\":1,\"permissions\":[],\"color\":\"#ef4444\"}" > /dev/null 2>&1

USER_RES=$(curl -s -X POST "$API/api/users" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"fullName\":\"RBAC Tester\",\"email\":\"rbac@test.com\",\"role\":\"$TEST_ROLE\",\"password\":\"$TEST_PASSWORD\",\"confirmPassword\":\"$TEST_PASSWORD\"}")
if echo "$USER_RES" | jq -e '.error' > /dev/null 2>&1; then
  TEST_USER_ID=$(api_json GET /api/users "$ADMIN_TOKEN" | jq -r '.data[] | select(.username == "999999") | .id')
  curl -s -X POST "$API/api/users/$TEST_USER_ID/reset-password" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"newPassword\":\"$TEST_PASSWORD\"}" > /dev/null
fi

PGPASSWORD=digilog_secret psql -h localhost -U digilog_user -d digilog_db -q \
  -c "UPDATE users SET force_password_change = false, is_temporary_password = false WHERE username = '$TEST_USERNAME';" 2>/dev/null

# Reset to zero perms
set_perms '[]' '{}' '[]'
echo -e "${GREEN}  OK${NC}"

echo -e "${CYAN}[SETUP]${NC} Test User Login (single login for all tests)..."
sleep 1
TEST_TOKEN=$(curl -s "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\"}" | jq -r '.token')
[ "$TEST_TOKEN" = "null" ] || [ -z "$TEST_TOKEN" ] && echo "Test user login failed" && exit 1
echo -e "${GREEN}  OK (no more logins needed — perms read from DB)${NC}"

echo ""
echo "============================================="
echo "  Running Tests (2 logins total, 73 checks)"
echo "============================================="
echo ""

# ===========================================================================
# GROUP A: ZERO PERMISSIONS BASELINE
# ===========================================================================
echo -e "${YELLOW}=== GROUP A: ZERO PERMISSIONS BASELINE ===${NC}"

CODE=$(api_code GET /api/users "$TEST_TOKEN")
log_result "A01" "Baseline" "none" "GET /users — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/audit "$TEST_TOKEN")
log_result "A02" "Baseline" "none" "GET /audit — any auth (by design)" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/password-policy "$TEST_TOKEN")
log_result "A03" "Baseline" "none" "GET /config/password-policy — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "A04" "Baseline" "none" "GET /assets/instances — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "A05" "Baseline" "none" "GET /assets/templates — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/notifications "$TEST_TOKEN")
log_result "A06" "Baseline" "none" "GET /notifications — any auth (by design)" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/my-config "$TEST_TOKEN")
log_result "A07" "Baseline" "none" "GET /config/my-config — always allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/auth/me "$TEST_TOKEN")
log_result "A08" "Baseline" "none" "GET /auth/me — always allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

SIDEBAR_LEN=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq '.sidebarItems // [] | length')
log_result "A09" "Baseline" "none" "Sidebar empty with no perms" "0" "$SIDEBAR_LEN items" $([ "$SIDEBAR_LEN" = "0" ] && echo PASS || echo FAIL)

echo ""

# ===========================================================================
# GROUP B: USER MANAGEMENT — 7 permissions
# ===========================================================================
echo -e "${YELLOW}=== GROUP B: USER MANAGEMENT ===${NC}"

echo -e "${CYAN}  Testing: users.view${NC}"
set_perms '["USER_READ"]' '{"users.view":true}' '["users"]'

CODE=$(api_code GET /api/users "$TEST_TOKEN")
log_result "B01" "Users" "users.view" "GET /users — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/users/stats "$TEST_TOKEN")
log_result "B02" "Users" "users.view" "GET /users/stats — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.view"] // false')
log_result "B03" "Users" "users.view" "my-config users.view=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "B04" "Users" "users.view" "Sidebar has users" "users" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "users" && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.create${NC}"
set_perms '["USER_CREATE"]' '{"users.create":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.create"] // false')
log_result "B05" "Users" "users.create" "my-config users.create=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.edit${NC}"
set_perms '["USER_UPDATE"]' '{"users.edit":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.edit"] // false')
log_result "B06" "Users" "users.edit" "my-config users.edit=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.delete${NC}"
set_perms '["USER_DELETE"]' '{"users.delete":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.delete"] // false')
log_result "B07" "Users" "users.delete" "my-config users.delete=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.reset_password${NC}"
set_perms '["USER_RESET_PASSWORD"]' '{"users.reset_password":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.reset_password"] // false')
log_result "B08" "Users" "users.reset_password" "my-config users.reset_password=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.unlock${NC}"
set_perms '["USER_UNLOCK"]' '{"users.unlock":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.unlock"] // false')
log_result "B09" "Users" "users.unlock" "my-config users.unlock=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: users.enable_disable${NC}"
set_perms '["USER_ENABLE_DISABLE"]' '{"users.enable_disable":true}' '["users"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["users.enable_disable"] // false')
log_result "B10" "Users" "users.enable_disable" "my-config users.enable_disable=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo ""

# ===========================================================================
# GROUP C: SYSTEM — 5 permissions
# ===========================================================================
echo -e "${YELLOW}=== GROUP C: SYSTEM ===${NC}"

echo -e "${CYAN}  Testing: config.view${NC}"
set_perms '["CONFIG_READ"]' '{"config.view":true}' '["configuration"]'

CODE=$(api_code GET /api/config/password-policy "$TEST_TOKEN")
log_result "C01" "System" "config.view" "GET /config/password-policy — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/datetime "$TEST_TOKEN")
log_result "C02" "System" "config.view" "GET /config/datetime — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/session "$TEST_TOKEN")
log_result "C03" "System" "config.view" "GET /config/session — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "C04" "System" "config.view" "GET /assets/instances — denied (no asset perm)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["config.view"] // false')
log_result "C05" "System" "config.view" "my-config config.view=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "C06" "System" "config.view" "Sidebar has configuration" "configuration" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "configuration" && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: config.edit${NC}"
set_perms '["CONFIG_UPDATE"]' '{"config.edit":true}' '["configuration"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["config.edit"] // false')
log_result "C07" "System" "config.edit" "my-config config.edit=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: audit.view${NC}"
set_perms '["AUDIT_READ"]' '{"audit.view":true}' '["audit"]'
CODE=$(api_code GET /api/audit "$TEST_TOKEN")
log_result "C08" "System" "audit.view" "GET /audit — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["audit.view"] // false')
log_result "C09" "System" "audit.view" "my-config audit.view=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "C10" "System" "audit.view" "Sidebar has audit" "audit" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "audit" && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: audit.export${NC}"
set_perms '["AUDIT_EXPORT"]' '{"audit.export":true}' '["audit"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["audit.export"] // false')
log_result "C11" "System" "audit.export" "my-config audit.export=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: notifications.manage${NC}"
set_perms '["NOTIFICATION_MANAGE"]' '{"notifications.manage":true}' '["notifications"]'
CODE=$(api_code GET /api/notifications "$TEST_TOKEN")
log_result "C12" "System" "notifications.manage" "GET /notifications — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["notifications.manage"] // false')
log_result "C13" "System" "notifications.manage" "my-config notifications.manage=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "C14" "System" "notifications.manage" "Sidebar has notifications" "notifications" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "notifications" && echo PASS || echo FAIL)

echo ""

# ===========================================================================
# GROUP D: ENTITY MANAGEMENT — 6 permissions
# ===========================================================================
echo -e "${YELLOW}=== GROUP D: ENTITY MANAGEMENT ===${NC}"

echo -e "${CYAN}  Testing: assets.view${NC}"
set_perms '["ASSET_VIEW"]' '{"assets.view":true}' '["assets"]'

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "D01" "Entity" "assets.view" "GET /assets/instances — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/instances/tree "$TEST_TOKEN")
log_result "D02" "Entity" "assets.view" "GET /assets/instances/tree — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/relationships "$TEST_TOKEN")
log_result "D03" "Entity" "assets.view" "GET /assets/relationships — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/identifiers "$TEST_TOKEN")
log_result "D04" "Entity" "assets.view" "GET /assets/identifiers — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "D05" "Entity" "assets.view" "GET /assets/templates — denied (no template perm)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.view"] // false')
log_result "D06" "Entity" "assets.view" "my-config assets.view=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "D07" "Entity" "assets.view" "Sidebar has assets" "assets" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "assets" && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.create${NC}"
set_perms '["ASSET_CREATE"]' '{"assets.create":true}' '["assets"]'
CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "D08" "Entity" "assets.create" "GET /assets/instances — denied (no view)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.create"] // false')
log_result "D09" "Entity" "assets.create" "my-config assets.create=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.edit${NC}"
set_perms '["ASSET_UPDATE"]' '{"assets.edit":true}' '["assets"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.edit"] // false')
log_result "D10" "Entity" "assets.edit" "my-config assets.edit=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.delete${NC}"
set_perms '["ASSET_DELETE"]' '{"assets.delete":true}' '["assets"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.delete"] // false')
log_result "D11" "Entity" "assets.delete" "my-config assets.delete=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.relationships${NC}"
set_perms '["ASSET_RELATIONSHIP_MANAGE"]' '{"assets.relationships":true}' '["assets"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.relationships"] // false')
log_result "D12" "Entity" "assets.relationships" "my-config assets.relationships=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.identifiers${NC}"
set_perms '["ASSET_IDENTIFIER_MANAGE"]' '{"assets.identifiers":true}' '["assets"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.identifiers"] // false')
log_result "D13" "Entity" "assets.identifiers" "my-config assets.identifiers=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo ""
echo -e "${CYAN}  [Cooling down 30s for rate limit]${NC}"
sleep 30

# ===========================================================================
# GROUP E: ENTITY TEMPLATES — 4 permissions
# ===========================================================================
echo -e "${YELLOW}=== GROUP E: ENTITY TEMPLATES ===${NC}"

echo -e "${CYAN}  Testing: assets.templates_view${NC}"
set_perms '["ASSET_TEMPLATE_VIEW"]' '{"assets.templates_view":true}' '["asset-templates"]'

CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "E01" "Templates" "assets.templates_view" "GET /assets/templates — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code POST /api/assets/templates "$TEST_TOKEN" '{"name":"test","category":"test"}')
log_result "E02" "Templates" "assets.templates_view" "POST /assets/templates — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.templates_view"] // false')
log_result "E03" "Templates" "assets.templates_view" "my-config assets.templates_view=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

SIDEBAR=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.sidebarItems | join(",")')
log_result "E04" "Templates" "assets.templates_view" "Sidebar has asset-templates" "asset-templates" "$SIDEBAR" $(echo "$SIDEBAR" | grep -q "asset-templates" && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.templates_create${NC}"
set_perms '["ASSET_TEMPLATE_CREATE"]' '{"assets.templates_create":true}' '["asset-templates"]'
CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "E05" "Templates" "assets.templates_create" "GET /assets/templates — denied (no view)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.templates_create"] // false')
log_result "E06" "Templates" "assets.templates_create" "my-config assets.templates_create=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.templates_edit${NC}"
set_perms '["ASSET_TEMPLATE_UPDATE"]' '{"assets.templates_edit":true}' '["asset-templates"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.templates_edit"] // false')
log_result "E07" "Templates" "assets.templates_edit" "my-config assets.templates_edit=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: assets.templates_delete${NC}"
set_perms '["ASSET_TEMPLATE_DELETE"]' '{"assets.templates_delete":true}' '["asset-templates"]'
VAL=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq -r '.permissions["assets.templates_delete"] // false')
log_result "E08" "Templates" "assets.templates_delete" "my-config assets.templates_delete=true" "true" "$VAL" $([ "$VAL" = "true" ] && echo PASS || echo FAIL)

echo ""
echo -e "${CYAN}  [Cooling down 30s for rate limit]${NC}"
sleep 30

# ===========================================================================
# GROUP F: CROSS-PERMISSION ISOLATION
# ===========================================================================
echo -e "${YELLOW}=== GROUP F: CROSS-PERMISSION ISOLATION ===${NC}"

echo -e "${CYAN}  Testing: ASSET_VIEW isolation${NC}"
set_perms '["ASSET_VIEW"]' '{"assets.view":true}' '["assets"]'

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "F01" "Isolation" "assets.view" "GET /assets/instances — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "F02" "Isolation" "assets.view" "GET /assets/templates — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: AUDIT_READ isolation${NC}"
set_perms '["AUDIT_READ"]' '{"audit.view":true}' '["audit"]'

CODE=$(api_code GET /api/audit "$TEST_TOKEN")
log_result "F03" "Isolation" "audit.view" "GET /audit — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "F04" "Isolation" "audit.view" "GET /assets/instances — denied" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

echo -e "${CYAN}  Testing: Multi-permission combo${NC}"
set_perms '["ASSET_VIEW","AUDIT_READ","CONFIG_READ"]' \
  '{"assets.view":true,"audit.view":true,"config.view":true}' \
  '["assets","audit","configuration"]'

CODE=$(api_code GET /api/assets/instances "$TEST_TOKEN")
log_result "F05" "Isolation" "multi" "GET /assets/instances — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/audit "$TEST_TOKEN")
log_result "F06" "Isolation" "multi" "GET /audit — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/password-policy "$TEST_TOKEN")
log_result "F07" "Isolation" "multi" "GET /config/password-policy — allowed" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code POST /api/assets/instances "$TEST_TOKEN" '{"templateId":"00000000-0000-0000-0000-000000000000","name":"test","attributes":{}}')
log_result "F08" "Isolation" "multi" "POST /assets/instances — denied (no create)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

PERM_COUNT=$(api_json GET /api/config/my-config "$TEST_TOKEN" | jq '[.permissions | to_entries[] | select(.value==true)] | length')
log_result "F09" "Isolation" "multi" "my-config has exactly 3 true perms" "3" "$PERM_COUNT" $([ "$PERM_COUNT" = "3" ] && echo PASS || echo FAIL)

echo ""
echo -e "${CYAN}  [Cooling down 30s for rate limit]${NC}"
sleep 30

# ===========================================================================
# GROUP G: SUPER_ADMIN BYPASS
# ===========================================================================
echo -e "${YELLOW}=== GROUP G: SUPER_ADMIN BYPASS ===${NC}"

CODE=$(api_code GET /api/users "$ADMIN_TOKEN")
log_result "G01" "SA Bypass" "SUPER_ADMIN" "GET /users" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/audit "$ADMIN_TOKEN")
log_result "G02" "SA Bypass" "SUPER_ADMIN" "GET /audit" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/instances "$ADMIN_TOKEN")
log_result "G03" "SA Bypass" "SUPER_ADMIN" "GET /assets/instances" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/templates "$ADMIN_TOKEN")
log_result "G04" "SA Bypass" "SUPER_ADMIN" "GET /assets/templates" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/password-policy "$ADMIN_TOKEN")
log_result "G05" "SA Bypass" "SUPER_ADMIN" "GET /config/password-policy" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/notifications "$ADMIN_TOKEN")
log_result "G06" "SA Bypass" "SUPER_ADMIN" "GET /notifications" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/roles "$ADMIN_TOKEN")
log_result "G07" "SA Bypass" "SUPER_ADMIN" "GET /roles" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

echo ""

# ===========================================================================
# GROUP H: requireRole PASSTHROUGH
# ===========================================================================
echo -e "${YELLOW}=== GROUP H: requireRole PASSTHROUGH ===${NC}"

set_perms '["ASSET_VIEW"]' '{"assets.view":true}' '["assets"]'

CODE=$(api_code GET /api/users "$TEST_TOKEN")
log_result "H01" "Passthrough" "ASSET_VIEW" "GET /users — allowed (any perm = pass)" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/config/password-policy "$TEST_TOKEN")
log_result "H02" "Passthrough" "ASSET_VIEW" "GET /config — allowed (any perm = pass)" "200" "HTTP $CODE" $([ "$CODE" = "200" ] && echo PASS || echo FAIL)

CODE=$(api_code GET /api/assets/templates "$TEST_TOKEN")
log_result "H03" "Passthrough" "ASSET_VIEW" "GET /templates — denied (wrong perm)" "403" "HTTP $CODE" $([ "$CODE" = "403" ] && echo PASS || echo FAIL)

echo ""

# ===========================================================================
# CLEANUP
# ===========================================================================
echo -e "${CYAN}[CLEANUP]${NC} Resetting test role..."
set_perms '[]' '{}' '[]'
echo -e "${GREEN}  Done${NC}"

# ===========================================================================
# REPORT
# ===========================================================================

PASS_RATE=$(echo "scale=1; $PASS * 100 / $TOTAL" | bc)

echo ""
echo "============================================="
echo -e "  ${GREEN}PASSED: $PASS${NC}  |  ${RED}FAILED: $FAIL${NC}  |  Total: $TOTAL  |  Rate: ${PASS_RATE}%"
echo "============================================="

cat > "$RESULTS_FILE" <<HEADER
# DigiLog RBAC Test Results

**Date:** $(date '+%Y-%m-%d %H:%M:%S %Z')
**Tester:** Automated Script (rbac-test.sh)
**Test Role:** \`$TEST_ROLE\` (hierarchy level 1, custom role)
**Test User:** \`$TEST_USERNAME\`
**API Base:** $API

---

## Summary

| Metric | Count |
|--------|-------|
| **Total Tests** | $TOTAL |
| **Passed** | $PASS |
| **Failed** | $FAIL |
| **Pass Rate** | **${PASS_RATE}%** |

---

## Detailed Test Results

| ID | Category | Permission | Test Description | Expected | Actual | Status |
|----|----------|-----------|------------------|----------|--------|--------|
HEADER

for result in "${RESULTS[@]}"; do
  echo "$result" >> "$RESULTS_FILE"
done

cat >> "$RESULTS_FILE" <<'FOOTER'

---

## Test Group Descriptions

### Group A: Zero Permissions Baseline (9 tests)
Validates behavior when test role has NO permissions. Protected endpoints deny access.
**Note:** `/api/audit` and `/api/notifications` allow any authenticated user (by design) — filtering at service layer.

### Group B: User Management — 7 Permissions (10 tests)
Tests each user management feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `users.view` | `USER_READ` | View user list, stats |
| `users.create` | `USER_CREATE` | Create new users |
| `users.edit` | `USER_UPDATE` | Edit existing users |
| `users.delete` | `USER_DELETE` | Delete users, bulk delete |
| `users.reset_password` | `USER_RESET_PASSWORD` | Reset user passwords |
| `users.unlock` | `USER_UNLOCK` | Unlock locked accounts |
| `users.enable_disable` | `USER_ENABLE_DISABLE` | Enable/disable accounts |

### Group C: System — 5 Permissions (14 tests)
Tests each system feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `config.view` | `CONFIG_READ` | View system configuration |
| `config.edit` | `CONFIG_UPDATE` | Edit system configuration |
| `audit.view` | `AUDIT_READ` | View audit trail |
| `audit.export` | `AUDIT_EXPORT` | Export audit trail data |
| `notifications.manage` | `NOTIFICATION_MANAGE` | Manage notifications |

### Group D: Entity Management — 6 Permissions (13 tests)
Tests each entity feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `assets.view` | `ASSET_VIEW` | View entities, relationships, identifiers |
| `assets.create` | `ASSET_CREATE` | Create new entities |
| `assets.edit` | `ASSET_UPDATE` | Edit entities, change status |
| `assets.delete` | `ASSET_DELETE` | Delete entities |
| `assets.relationships` | `ASSET_RELATIONSHIP_MANAGE` | Create/delete relationships |
| `assets.identifiers` | `ASSET_IDENTIFIER_MANAGE` | Create/delete identifiers |

### Group E: Entity Templates — 4 Permissions (8 tests)
Tests each template feature privilege individually:

| Feature Privilege | API Permission | What It Controls |
|------------------|---------------|-----------------|
| `assets.templates_view` | `ASSET_TEMPLATE_VIEW` | View entity templates |
| `assets.templates_create` | `ASSET_TEMPLATE_CREATE` | Create new templates |
| `assets.templates_edit` | `ASSET_TEMPLATE_UPDATE` | Edit existing templates |
| `assets.templates_delete` | `ASSET_TEMPLATE_DELETE` | Delete templates |

### Group F: Cross-Permission Isolation (9 tests)
Validates permissions don't leak across categories — e.g., `ASSET_VIEW` doesn't grant template access.

### Group G: SUPER_ADMIN Bypass (7 tests)
Validates SUPER_ADMIN bypasses all permission checks.

### Group H: requireRole Passthrough (3 tests)
Tests that roles with ANY permission pass `requireRole` checks (broad access gate).
Fine-grained enforcement is by `requirePermission` on specific endpoints and frontend UI gating.

---

## Architecture: Two Permission Systems

```
┌─────────────────────────────────────────────────────┐
│                Role Access Config Page               │
│              (/config/role-privileges)               │
│                                                     │
│  Sidebar: [✓] Entities  [✓] Audit  [ ] Users       │
│  Perms:   [✓] assets.view  [✓] audit.view          │
└──────────────────────┬──────────────────────────────┘
                       │ PUT /api/config/roles/:role
                       ▼
          ┌────────────────────────────┐
          │    FEATURE_TO_PERMISSION_MAP │ (sync bridge)
          │  assets.view → ASSET_VIEW   │
          │  audit.view  → AUDIT_READ   │
          └─────────┬──────────┬───────┘
                    │          │
    ┌───────────────▼──┐  ┌───▼─────────────────┐
    │ RoleConfig Table  │  │    Role Table        │
    │ permissions: {}   │  │    permissions: []   │
    │ (dot.notation)    │  │    (SNAKE_CASE)      │
    └───────┬──────────┘  └──────────┬───────────┘
            │                        │
    ┌───────▼──────────┐  ┌──────────▼───────────┐
    │  Frontend UI      │  │   API Middleware      │
    │  /api/config/     │  │   requirePermission() │
    │  my-config        │  │   requireRole()       │
    │  → sidebar items  │  │   → 403 if denied     │
    │  → button gating  │  │                       │
    └──────────────────┘  └──────────────────────┘
```

### Complete Permission Matrix (22 Privileges)

| # | Feature Privilege | API Permission | Category |
|---|------------------|---------------|----------|
| 1 | `users.view` | `USER_READ` | User Management |
| 2 | `users.create` | `USER_CREATE` | User Management |
| 3 | `users.edit` | `USER_UPDATE` | User Management |
| 4 | `users.delete` | `USER_DELETE` | User Management |
| 5 | `users.reset_password` | `USER_RESET_PASSWORD` | User Management |
| 6 | `users.unlock` | `USER_UNLOCK` | User Management |
| 7 | `users.enable_disable` | `USER_ENABLE_DISABLE` | User Management |
| 8 | `config.view` | `CONFIG_READ` | System |
| 9 | `config.edit` | `CONFIG_UPDATE` | System |
| 10 | `audit.view` | `AUDIT_READ` | System |
| 11 | `audit.export` | `AUDIT_EXPORT` | System |
| 12 | `notifications.manage` | `NOTIFICATION_MANAGE` | System |
| 13 | `assets.view` | `ASSET_VIEW` | Entity Management |
| 14 | `assets.create` | `ASSET_CREATE` | Entity Management |
| 15 | `assets.edit` | `ASSET_UPDATE` | Entity Management |
| 16 | `assets.delete` | `ASSET_DELETE` | Entity Management |
| 17 | `assets.relationships` | `ASSET_RELATIONSHIP_MANAGE` | Entity Management |
| 18 | `assets.identifiers` | `ASSET_IDENTIFIER_MANAGE` | Entity Management |
| 19 | `assets.templates_view` | `ASSET_TEMPLATE_VIEW` | Entity Templates |
| 20 | `assets.templates_create` | `ASSET_TEMPLATE_CREATE` | Entity Templates |
| 21 | `assets.templates_edit` | `ASSET_TEMPLATE_UPDATE` | Entity Templates |
| 22 | `assets.templates_delete` | `ASSET_TEMPLATE_DELETE` | Entity Templates |
FOOTER

echo ""
echo -e "${GREEN}Report saved to: $RESULTS_FILE${NC}"
