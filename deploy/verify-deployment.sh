#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# DigiLog — Post-Deployment Verification Script
# Logs in as superadmin and runs all 12 deployment checks
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

# Defaults
HOST="${1:-localhost:3000}"
USERNAME="${2:-superadmin}"
PASSWORD="${3:-Admin@123}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  DigiLog — Deployment Verification${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
echo -e "  Server:   ${CYAN}http://${HOST}${NC}"
echo -e "  Username: ${CYAN}${USERNAME}${NC}"
echo ""

# ── Step 1: Check if API is reachable ──────────────────────────────────
echo -e "${BOLD}[1/3] Checking API availability...${NC}"
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "http://${HOST}/api/health" 2>/dev/null || echo "000")
if [ "$HEALTH" != "200" ]; then
  echo -e "  ${RED}✗ API not reachable at http://${HOST}/api/health (HTTP ${HEALTH})${NC}"
  echo -e "  ${RED}  Is the backend running? Check: pm2 status / npx tsx watch apps/api/src/app.ts${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓ API is reachable${NC}"

# ── Step 2: Login ──────────────────────────────────────────────────────
echo -e "${BOLD}[2/3] Logging in as ${USERNAME}...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "http://${HOST}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\",\"force\":true}" 2>/dev/null)

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo -e "  ${RED}✗ Login failed${NC}"
  echo "$LOGIN_RESPONSE" | head -5
  echo ""
  echo -e "  ${RED}  Possible causes:${NC}"
  echo -e "  ${RED}  - Database not seeded (run: npx prisma db seed)${NC}"
  echo -e "  ${RED}  - Wrong password (default: Admin@123)${NC}"
  echo -e "  ${RED}  - User locked out${NC}"
  exit 1
fi
echo -e "  ${GREEN}✓ Login successful${NC}"

# ── Step 3: Run deployment checks ─────────────────────────────────────
echo -e "${BOLD}[3/3] Running deployment checks...${NC}"
echo ""

RESULT=$(curl -s "http://${HOST}/api/deployment-check" \
  -H "Authorization: Bearer ${TOKEN}" 2>/dev/null)

# Check if we got a valid response
if ! echo "$RESULT" | grep -q '"summary"'; then
  echo -e "  ${RED}✗ Failed to get deployment check results${NC}"
  echo "$RESULT" | head -10
  exit 1
fi

# ── Parse and display results ──────────────────────────────────────────

# Check if jq is available
if command -v jq &> /dev/null; then
  # Pretty output with jq
  TOTAL=$(echo "$RESULT" | jq -r '.summary.total')
  PASSED=$(echo "$RESULT" | jq -r '.summary.passed')
  FAILED=$(echo "$RESULT" | jq -r '.summary.failed')
  WARNINGS=$(echo "$RESULT" | jq -r '.summary.warnings')
  STATUS=$(echo "$RESULT" | jq -r '.summary.status')

  echo "$RESULT" | jq -r '.checks[] | "\(.status)|\(.name)|\(.duration_ms)|\(.subChecks | length)|\(.subChecks | map(select(.status != "PASS")) | map(.name + ": " + (.message // "")) | join(", "))"' | while IFS='|' read -r status name duration subcount issues; do
    case "$status" in
      PASS)    icon="${GREEN}✓${NC}"; color="${GREEN}" ;;
      FAIL)    icon="${RED}✗${NC}"; color="${RED}" ;;
      WARN)    icon="${YELLOW}!${NC}"; color="${YELLOW}" ;;
      SKIPPED) icon="${CYAN}○${NC}"; color="${CYAN}" ;;
      *)       icon="?"; color="${NC}" ;;
    esac
    printf "  ${icon} %-25s ${color}%-7s${NC} %4sms" "$name" "$status" "$duration"
    if [ -n "$issues" ] && [ "$issues" != "" ]; then
      echo ""
      echo -e "     ${color}→ ${issues}${NC}"
    else
      echo ""
    fi
  done

  echo ""
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  case "$STATUS" in
    PASS) echo -e "  ${GREEN}${BOLD}RESULT: ALL CHECKS PASSED ($PASSED/$TOTAL)${NC}" ;;
    WARN) echo -e "  ${YELLOW}${BOLD}RESULT: PASSED WITH WARNINGS ($PASSED passed, $WARNINGS warnings, $FAILED failed)${NC}" ;;
    FAIL) echo -e "  ${RED}${BOLD}RESULT: CHECKS FAILED ($PASSED passed, $WARNINGS warnings, $FAILED failed)${NC}" ;;
  esac
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${NC}"
  echo ""

  if [ "$STATUS" = "FAIL" ]; then
    echo -e "${RED}${BOLD}Failed checks require attention:${NC}"
    echo "$RESULT" | jq -r '.checks[] | select(.status == "FAIL") | "  ✗ \(.name): \(.subChecks | map(select(.status == "FAIL")) | map(.name + " — " + (.message // "")) | join("; "))"'
    echo ""
    exit 1
  fi

else
  # Fallback without jq — just dump JSON
  echo -e "${YELLOW}  (Install jq for pretty output: sudo apt install jq)${NC}"
  echo ""
  echo "$RESULT"
  echo ""

  if echo "$RESULT" | grep -q '"status":"FAIL"'; then
    exit 1
  fi
fi

exit 0
