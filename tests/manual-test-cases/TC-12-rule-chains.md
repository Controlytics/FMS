# TC-12: Rule Chains -- Test Cases

## Overview
- **Module**: Rule Chain Engine
- **API Endpoints**: 14 (GET /, GET /node-types, GET /:id, POST /, PUT /:id, DELETE /:id, POST /:id/nodes, PUT /:id/nodes/:nodeId, DELETE /:id/nodes/:nodeId, POST /:id/connections, DELETE /:id/connections/:connectionId, POST /:id/save, GET /:id/debug, DELETE /:id/debug)
- **Frontend Pages**: /rule-chains (list), /rule-chains/:id (editor)
- **Permissions**: RULE_CHAIN_MANAGE (all endpoints)
- **Reauth Actions**: CREATE_RULE_CHAIN, UPDATE_RULE_CHAIN, DELETE_RULE_CHAIN
- **Key Facts**: 77 node types across 8 categories, sandboxed VM execution (1s timeout, no process/require/global), sub-chain delegation with depth tracking. Categories: INPUT, FILTER, ENRICHMENT, TRANSFORM, ACTION, EXTERNAL, FLOW, ANALYTICS.

---

## Positive Test Cases

### TC-12-P01: List Rule Chains with Default Pagination
- **Priority**: High
- **Preconditions**: User has RULE_CHAIN_MANAGE permission. At least one rule chain exists.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/rule-chains.
  2. Verify response: `{ data: [...], total, page: 1, limit: 20, totalPages }`.
  3. Verify each chain has id, name, description, isRoot, isSystem, isActive, currentVersion, _count.
- **Expected Result**: Paginated list of rule chains.

### TC-12-P02: List Rule Chains with Search Filter
- **Priority**: Medium
- **Preconditions**: Rule chains with different names exist.
- **Test Data**: `search=default`
- **Steps**:
  1. Send GET /api/rule-chains?search=default.
  2. Verify all returned chains have names containing "default" (case-insensitive).
- **Expected Result**: Filtered results matching search term.

### TC-12-P03: List Rule Chains Filtered by Active Status
- **Priority**: Medium
- **Preconditions**: Both active and inactive rule chains exist.
- **Test Data**: `isActive=true`
- **Steps**:
  1. Send GET /api/rule-chains?isActive=true.
  2. Verify all returned chains have `isActive: true`.
- **Expected Result**: Only active chains returned.

### TC-12-P04: Get Available Node Types
- **Priority**: High
- **Preconditions**: User has RULE_CHAIN_MANAGE permission.
- **Test Data**: None.
- **Steps**:
  1. Send GET /api/rule-chains/node-types.
  2. Verify response is an array of node type definitions.
  3. Verify each has type, category, name, description, outputs, defaultConfig, configSchema.
- **Expected Result**: Array of 77 node type definitions across 8 categories.

### TC-12-P05: Get Node Types by Category
- **Priority**: Low
- **Preconditions**: User has RULE_CHAIN_MANAGE permission.
- **Test Data**: `category=FILTER`
- **Steps**:
  1. Send GET /api/rule-chains/node-types?category=FILTER.
  2. Verify all returned nodes have `category: "FILTER"`.
- **Expected Result**: Only FILTER category nodes returned.

### TC-12-P06: Create Rule Chain
- **Priority**: High
- **Preconditions**: User has RULE_CHAIN_MANAGE permission.
- **Test Data**: `{"name": "Test Chain", "description": "Test rule chain for QA", "isRoot": false}`
- **Steps**:
  1. Send POST /api/rule-chains with the body (reauth may be required).
  2. Verify response: 201 `{ success: true, data: { id, name, ... } }`.
  3. Verify the chain is audit-logged as RULE_CHAIN_CREATED.
- **Expected Result**: Chain created with auto-generated UUID, currentVersion 0.

### TC-12-P07: Get Single Rule Chain with Full Details
- **Priority**: High
- **Preconditions**: A rule chain exists.
- **Test Data**: Valid rule chain UUID.
- **Steps**:
  1. Send GET /api/rule-chains/{id}.
  2. Verify response includes nodes array, connections array, versions array (up to 10).
- **Expected Result**: Full chain details with all nodes, connections, and recent versions.

### TC-12-P08: Update Rule Chain Metadata
- **Priority**: High
- **Preconditions**: A non-system rule chain exists.
- **Test Data**: `{"name": "Updated Chain Name", "description": "Updated description", "isActive": true}`
- **Steps**:
  1. Send PUT /api/rule-chains/{id} (reauth may be required).
  2. Verify response: `{ success: true, data: { ... } }`.
  3. Verify the chain is audit-logged as RULE_CHAIN_UPDATED.
- **Expected Result**: Chain metadata updated.

### TC-12-P09: Add Node to Rule Chain
- **Priority**: High
- **Preconditions**: A rule chain exists.
- **Test Data**: `{"type": "filter", "name": "Temperature Filter", "configuration": {"condition": "msg.temperature > 30"}, "positionX": 100, "positionY": 200}`
- **Steps**:
  1. Send POST /api/rule-chains/{id}/nodes.
  2. Verify response: 201 `{ success: true, data: { id, type, name, ... } }`.
- **Expected Result**: Node created within the chain.

### TC-12-P10: Update Rule Chain Node
- **Priority**: Medium
- **Preconditions**: A rule chain with at least one node exists.
- **Test Data**: `{"name": "Updated Filter", "configuration": {"condition": "msg.temperature > 40"}, "debugEnabled": true}`
- **Steps**:
  1. Send PUT /api/rule-chains/{id}/nodes/{nodeId}.
  2. Verify response: `{ success: true, data: { ... } }`.
  3. Verify debugEnabled is true.
- **Expected Result**: Node updated with new configuration.

### TC-12-P11: Delete Rule Chain Node
- **Priority**: Medium
- **Preconditions**: A rule chain with a node that is not referenced by connections.
- **Test Data**: Valid nodeId.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id}/nodes/{nodeId}.
  2. Verify response: `{ success: true }`.
  3. Verify the node no longer appears in GET /:id.
- **Expected Result**: Node deleted. Cascading connections also deleted.

### TC-12-P12: Add Connection Between Nodes
- **Priority**: High
- **Preconditions**: A rule chain with at least 2 nodes exists.
- **Test Data**: `{"fromNodeId": "<node1-uuid>", "toNodeId": "<node2-uuid>", "label": "True"}`
- **Steps**:
  1. Send POST /api/rule-chains/{id}/connections.
  2. Verify response: 201 `{ success: true, data: { id, fromNodeId, toNodeId, label } }`.
- **Expected Result**: Connection created between the two nodes.

### TC-12-P13: Delete Connection
- **Priority**: Medium
- **Preconditions**: A connection exists.
- **Test Data**: Valid connectionId.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id}/connections/{connectionId}.
  2. Verify response: `{ success: true }`.
- **Expected Result**: Connection deleted.

### TC-12-P14: Save Full Chain State (Atomic Replace + Version)
- **Priority**: High
- **Preconditions**: A rule chain exists.
- **Test Data**: Full chain save body with nodes, connections, and changeNotes.
- **Steps**:
  1. Send POST /api/rule-chains/{id}/save with full state body (reauth required).
  2. Verify response: `{ success: true, data: { ... }, version: N }`.
  3. Verify version incremented.
  4. Verify old nodes/connections replaced with new ones.
  5. Verify a RuleChainVersion snapshot was created.
- **Expected Result**: Chain state atomically replaced, version created.

### TC-12-P15: Get Debug Buffer
- **Priority**: Medium
- **Preconditions**: A rule chain with debugEnabled nodes has processed messages.
- **Test Data**: Valid chain ID, optional `limit=10`.
- **Steps**:
  1. Send GET /api/rule-chains/{id}/debug?limit=10.
  2. Verify response is an array of debug records.
- **Expected Result**: Array of debug records (may be empty if no debug data).

### TC-12-P16: Clear Debug Buffer
- **Priority**: Low
- **Preconditions**: Debug buffer may have entries.
- **Test Data**: Valid chain ID.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id}/debug.
  2. Verify response: `{ success: true }`.
  3. Send GET /api/rule-chains/{id}/debug and verify empty array.
- **Expected Result**: Debug buffer cleared.

### TC-12-P17: Delete Rule Chain
- **Priority**: High
- **Preconditions**: A non-system rule chain exists.
- **Test Data**: Valid chain ID.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id} (reauth required).
  2. Verify response: `{ success: true }`.
  3. Verify the chain is audit-logged as RULE_CHAIN_DELETED.
  4. Verify GET /api/rule-chains/{id} returns 404.
- **Expected Result**: Chain deleted with cascading node/connection cleanup.

---

## Negative Test Cases

### TC-12-N01: Create Rule Chain Without RULE_CHAIN_MANAGE Permission
- **Priority**: High
- **Preconditions**: Authenticated as a user without RULE_CHAIN_MANAGE permission.
- **Test Data**: `{"name": "Unauthorized Chain"}`
- **Steps**:
  1. Send POST /api/rule-chains as unauthorized user.
  2. Verify 403 Forbidden.
- **Expected Result**: 403 error.

### TC-12-N02: Get Non-Existent Rule Chain
- **Priority**: Medium
- **Preconditions**: Authenticated with RULE_CHAIN_MANAGE.
- **Test Data**: Non-existent UUID.
- **Steps**:
  1. Send GET /api/rule-chains/00000000-0000-0000-0000-000000000000.
  2. Verify 404.
- **Expected Result**: 404 `{ error: "NOT_FOUND", message: "Rule chain not found" }`.

### TC-12-N03: Delete System Rule Chain
- **Priority**: High
- **Preconditions**: A system rule chain exists (isSystem: true).
- **Test Data**: System chain ID.
- **Steps**:
  1. Send DELETE /api/rule-chains/{systemChainId}.
  2. Verify 403 `{ error: "FORBIDDEN", message: "Cannot delete a system rule chain" }`.
- **Expected Result**: 403 Forbidden -- system chains cannot be deleted.

### TC-12-N04: Add Node to Non-Existent Chain
- **Priority**: Medium
- **Preconditions**: Authenticated with RULE_CHAIN_MANAGE.
- **Test Data**: `{"type": "filter", "name": "Test"}`
- **Steps**:
  1. Send POST /api/rule-chains/00000000-0000-0000-0000-000000000000/nodes.
  2. Verify 404.
- **Expected Result**: 404 `{ error: "NOT_FOUND", message: "Rule chain not found" }`.

### TC-12-N05: Create Connection with Non-Existent Source Node
- **Priority**: Medium
- **Preconditions**: A rule chain with at least one node exists.
- **Test Data**: `{"fromNodeId": "00000000-0000-0000-0000-000000000000", "toNodeId": "<valid-node-id>", "label": "True"}`
- **Steps**:
  1. Send POST /api/rule-chains/{id}/connections with invalid fromNodeId.
  2. Verify 404 `{ error: "NOT_FOUND", message: "Source node not found in this rule chain" }`.
- **Expected Result**: 404 error for source node.

### TC-12-N06: Create Connection with Non-Existent Target Node
- **Priority**: Medium
- **Preconditions**: A rule chain with at least one node exists.
- **Test Data**: `{"fromNodeId": "<valid-node-id>", "toNodeId": "00000000-0000-0000-0000-000000000000", "label": "True"}`
- **Steps**:
  1. Send POST /api/rule-chains/{id}/connections with invalid toNodeId.
  2. Verify 404 `{ error: "NOT_FOUND", message: "Target node not found in this rule chain" }`.
- **Expected Result**: 404 error for target node.

### TC-12-N07: Update Non-Existent Node
- **Priority**: Low
- **Preconditions**: A rule chain exists.
- **Test Data**: Non-existent nodeId.
- **Steps**:
  1. Send PUT /api/rule-chains/{id}/nodes/00000000-0000-0000-0000-000000000000.
  2. Verify 404.
- **Expected Result**: 404 `{ error: "NOT_FOUND", message: "Node not found in this rule chain" }`.

### TC-12-N08: Delete Non-Existent Node
- **Priority**: Low
- **Preconditions**: A rule chain exists.
- **Test Data**: Non-existent nodeId.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id}/nodes/00000000-0000-0000-0000-000000000000.
  2. Verify 404.
- **Expected Result**: 404 error.

### TC-12-N09: Delete Non-Existent Connection
- **Priority**: Low
- **Preconditions**: A rule chain exists.
- **Test Data**: Non-existent connectionId.
- **Steps**:
  1. Send DELETE /api/rule-chains/{id}/connections/00000000-0000-0000-0000-000000000000.
  2. Verify 404.
- **Expected Result**: 404 error.

### TC-12-N10: Create Rule Chain Without Required Name Field
- **Priority**: Medium
- **Preconditions**: Authenticated with RULE_CHAIN_MANAGE.
- **Test Data**: `{"description": "No name provided"}`
- **Steps**:
  1. Send POST /api/rule-chains without `name` field.
  2. Verify 400 validation error.
- **Expected Result**: 400 validation error for missing required property.


---

## Phase 2 Notes

- Rule chain engine expanded to 77 node types across 8 categories (from 31 in Phase 1).
- New node category: ANALYTICS for data analysis and aggregation nodes.
- Rule chains can process filter telemetry data (differential pressure, airflow readings) and trigger alarms on filter entities.
- Visual editor supports all 77 node types with configSchema for each.

