# EG-12: Rule Chains -- Execution Guide

## Prerequisites
- **App URL**: http://3.108.185.106
- **API Base**: http://localhost:3000/api
- **SUPER_ADMIN Credentials**: admin / Admin@123
- **Permissions Required**: RULE_CHAIN_MANAGE
- **Browser**: Chrome or Firefox for /rule-chains UI

## Setup: Obtain Auth Token

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r '.token')
```

---

## Test Execution

### Test: TC-12-P01 -- List Rule Chains

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/rule-chains \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Browser Steps:**
1. Navigate to http://3.108.185.106/rule-chains.
2. Verify table displays rule chains with Name, Description, Version, Status columns.

**Expected Result:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Default Chain",
      "description": "...",
      "isRoot": true,
      "isSystem": true,
      "currentVersion": 1,
      "isActive": true,
      "_count": { "nodes": 5, "connections": 4 }
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

**Pass/Fail:**
- [ ] Response status 200
- [ ] data is array of chains
- [ ] Each chain has _count with nodes and connections

---

### Test: TC-12-P04 -- Get Available Node Types

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/rule-chains/node-types \
  -H "Authorization: Bearer $TOKEN" | jq '.[].type'
```

**Expected Result:**
- Array of 31 node types including: filter, transform, create-alarm, clear-alarm, send-notification, script, delegate-chain, etc.

**Pass/Fail:**
- [ ] Response is array
- [ ] Each has type, category, name, description, outputs
- [ ] configSchema present for dynamic UI

---

### Test: TC-12-P06 -- Create Rule Chain

**API (curl):**
```bash
curl -s -X POST http://localhost:3000/api/rule-chains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "QA Test Chain", "description": "Created for manual testing", "isRoot": false}' | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "data": {
    "id": "new-uuid",
    "name": "QA Test Chain",
    "description": "Created for manual testing",
    "isRoot": false,
    "isSystem": false,
    "currentVersion": 0,
    "isActive": true
  }
}
```

Save the chain ID:
```bash
CHAIN_ID="<paste-id-from-response>"
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] success: true
- [ ] currentVersion is 0

---

### Test: TC-12-P07 -- Get Single Rule Chain

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/rule-chains/$CHAIN_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Full chain with nodes (empty initially), connections (empty), versions (empty).

**Pass/Fail:**
- [ ] Chain details returned
- [ ] nodes array present (may be empty)
- [ ] connections array present
- [ ] versions array present

---

### Test: TC-12-P09 -- Add Node to Rule Chain

**API (curl):**
```bash
# Add a filter node
NODE1=$(curl -s -X POST "http://localhost:3000/api/rule-chains/$CHAIN_ID/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "filter", "name": "Temp Filter", "configuration": {"condition": "msg.temperature > 30"}, "positionX": 100, "positionY": 200}')

echo "$NODE1" | jq .
NODE1_ID=$(echo "$NODE1" | jq -r '.data.id')

# Add an action node
NODE2=$(curl -s -X POST "http://localhost:3000/api/rule-chains/$CHAIN_ID/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "create-alarm", "name": "High Temp Alarm", "configuration": {"alarmType": "HIGH_TEMPERATURE", "severity": "CRITICAL"}, "positionX": 300, "positionY": 200}')

echo "$NODE2" | jq .
NODE2_ID=$(echo "$NODE2" | jq -r '.data.id')
```

**Pass/Fail:**
- [ ] Response status 201 for each node
- [ ] Each node has unique UUID
- [ ] Node type and name match input

---

### Test: TC-12-P12 -- Add Connection Between Nodes

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/rule-chains/$CHAIN_ID/connections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fromNodeId\": \"$NODE1_ID\", \"toNodeId\": \"$NODE2_ID\", \"label\": \"True\"}" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "data": {
    "id": "connection-uuid",
    "ruleChainId": "chain-uuid",
    "fromNodeId": "node1-uuid",
    "toNodeId": "node2-uuid",
    "label": "True"
  }
}
```

Save connection ID:
```bash
CONN_ID="<paste-id>"
```

**Pass/Fail:**
- [ ] Response status 201
- [ ] Connection links correct nodes

---

### Test: TC-12-P14 -- Save Full Chain State

**API (curl):**
```bash
curl -s -X POST "http://localhost:3000/api/rule-chains/$CHAIN_ID/save" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"nodes\": [
      {\"id\": \"temp-1\", \"type\": \"filter\", \"name\": \"Temperature Check\", \"configuration\": {\"condition\": \"msg.temperature > 50\"}, \"positionX\": 100, \"positionY\": 100},
      {\"id\": \"temp-2\", \"type\": \"create-alarm\", \"name\": \"Critical Alarm\", \"configuration\": {\"alarmType\": \"OVER_TEMP\", \"severity\": \"CRITICAL\"}, \"positionX\": 300, \"positionY\": 100}
    ],
    \"connections\": [
      {\"fromNodeId\": \"temp-1\", \"toNodeId\": \"temp-2\", \"label\": \"True\"}
    ],
    \"firstRuleNodeId\": \"temp-1\",
    \"changeNotes\": \"QA test save\"
  }" | jq .
```

**Expected Result:**
```json
{
  "success": true,
  "data": { ... },
  "version": 1
}
```

**Pass/Fail:**
- [ ] success: true
- [ ] version incremented (was 0, now 1)
- [ ] Nodes have new DB-generated UUIDs (temp-1/temp-2 remapped)
- [ ] Connection fromNodeId/toNodeId remapped to new UUIDs

---

### Test: TC-12-P15 -- Get Debug Buffer

**API (curl):**
```bash
curl -s -X GET "http://localhost:3000/api/rule-chains/$CHAIN_ID/debug?limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Array of debug records (may be empty if no messages processed)

**Pass/Fail:**
- [ ] Response is array
- [ ] No error returned

---

### Test: TC-12-P17 -- Delete Rule Chain

**API (curl):**
```bash
curl -s -X DELETE "http://localhost:3000/api/rule-chains/$CHAIN_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Verify deleted
curl -s -X GET "http://localhost:3000/api/rule-chains/$CHAIN_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
- Delete: `{ "success": true }`
- GET after: 404

**Pass/Fail:**
- [ ] Delete returns success: true
- [ ] Subsequent GET returns 404

---

### Test: TC-12-N02 -- Get Non-Existent Rule Chain

**API (curl):**
```bash
curl -s -X GET http://localhost:3000/api/rule-chains/00000000-0000-0000-0000-000000000000 \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "error": "NOT_FOUND",
  "message": "Rule chain not found"
}
```

**Pass/Fail:**
- [ ] Response status 404

---

### Test: TC-12-N03 -- Delete System Rule Chain

**API (curl):**
```bash
# Find a system chain
SYSTEM_CHAIN_ID=$(curl -s -X GET http://localhost:3000/api/rule-chains \
  -H "Authorization: Bearer $TOKEN" | jq -r '.data[] | select(.isSystem == true) | .id' | head -1)

echo "System chain: $SYSTEM_CHAIN_ID"

curl -s -X DELETE "http://localhost:3000/api/rule-chains/$SYSTEM_CHAIN_ID" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

**Expected Result:**
```json
{
  "error": "FORBIDDEN",
  "message": "Cannot delete a system rule chain"
}
```

**Pass/Fail:**
- [ ] Response status 403
- [ ] System chain still exists

---

### Test: TC-12-N05 -- Connection with Non-Existent Source Node

**API (curl):**
```bash
# Create a temporary chain first
TEMP_CHAIN=$(curl -s -X POST http://localhost:3000/api/rule-chains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Temp Chain for N05"}' | jq -r '.data.id')

# Add one real node
REAL_NODE=$(curl -s -X POST "http://localhost:3000/api/rule-chains/$TEMP_CHAIN/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "filter", "name": "Real Node"}' | jq -r '.data.id')

# Try connecting from non-existent node
curl -s -X POST "http://localhost:3000/api/rule-chains/$TEMP_CHAIN/connections" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"fromNodeId\": \"00000000-0000-0000-0000-000000000000\", \"toNodeId\": \"$REAL_NODE\", \"label\": \"True\"}" | jq .

# Cleanup
curl -s -X DELETE "http://localhost:3000/api/rule-chains/$TEMP_CHAIN" \
  -H "Authorization: Bearer $TOKEN" > /dev/null
```

**Expected Result:**
```json
{
  "error": "NOT_FOUND",
  "message": "Source node not found in this rule chain"
}
```

**Pass/Fail:**
- [ ] Response status 404
- [ ] Message mentions source node


> **Phase 2 Update (2026-03-27):** Digital Filter Management System added. See documentation/testing/manual/TEST_CASES.md for Phase 2 test cases covering filter operations, cleaning profiles, checklist enforcement, and bypass flows.

