# Rule Chain API

The Rule Chain API provides endpoints for managing rule chains, nodes, connections, versions, and debug inspection. Rule chains define the data processing pipeline for telemetry, attributes, and events.

---

## Rule Chains

### GET /api/rule-chains

List rule chains with pagination.

```bash
GET /api/rule-chains?search=telemetry&isActive=true&page=1&limit=20
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Filter by name |
| `isActive` | string | `"true"` or `"false"` |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (default: 20, max: 100) |

**Response (200):**
```json
{
  "data": [
    {
      "id": "chain-uuid",
      "name": "Default Telemetry Pipeline",
      "description": "Processes incoming telemetry data",
      "isRoot": true,
      "isSystem": true,
      "currentVersion": 5,
      "isActive": true,
      "_count": { "nodes": 8, "connections": 12 }
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 20,
  "totalPages": 1
}
```

**Role Required:** `SUPER_ADMIN` or `ADMIN`

---

### GET /api/rule-chains/:id

Get a rule chain with all nodes, connections, and recent version history.

```bash
GET /api/rule-chains/chain-uuid
```

**Response includes:**
- Rule chain metadata
- `nodes[]` — All nodes with type, configuration, and position
- `connections[]` — All connections with fromNodeId, toNodeId, and label
- `versions[]` — Last 10 version snapshots

---

### POST /api/rule-chains

Create a new rule chain.

```bash
curl -X POST "http://your-server/api/rule-chains" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Alarm Pipeline",
    "description": "Process alarm conditions",
    "isRoot": false
  }'
```

---

### PUT /api/rule-chains/:id

Update rule chain metadata.

---

### DELETE /api/rule-chains/:id

Delete a rule chain. System chains (`isSystem=true`) cannot be deleted. Cascades to all nodes and connections.

---

## Nodes

### POST /api/rule-chains/:id/nodes

Add a node to a rule chain.

```bash
curl -X POST "http://your-server/api/rule-chains/CHAIN_UUID/nodes" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "script-filter",
    "name": "Temperature Check",
    "configuration": { "script": "return msg.temperature > 100;" },
    "positionX": 300,
    "positionY": 200
  }'
```

### PUT /api/rule-chains/:id/nodes/:nodeId

Update a node's configuration, position, or debug settings.

### DELETE /api/rule-chains/:id/nodes/:nodeId

Delete a node. Cascades to connections involving this node.

---

## Connections

### POST /api/rule-chains/:id/connections

Create a connection between two nodes.

```bash
curl -X POST "http://your-server/api/rule-chains/CHAIN_UUID/connections" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromNodeId": "NODE_A_UUID",
    "toNodeId": "NODE_B_UUID",
    "label": "True"
  }'
```

### DELETE /api/rule-chains/:id/connections/:connectionId

Delete a connection.

---

## Save Full State

### POST /api/rule-chains/:id/save

Atomically replace all nodes and connections, then create a version snapshot. This is the primary endpoint used by the visual editor.

```bash
curl -X POST "http://your-server/api/rule-chains/CHAIN_UUID/save" \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nodes": [
      { "id": "temp-1", "type": "input", "name": "Input", "positionX": 100, "positionY": 100 },
      { "id": "temp-2", "type": "msg-type-filter", "name": "Type Filter", "configuration": { "messageTypes": ["POST_TELEMETRY"] }, "positionX": 300, "positionY": 100 },
      { "id": "temp-3", "type": "save-timeseries", "name": "Save Data", "positionX": 500, "positionY": 100 }
    ],
    "connections": [
      { "fromNodeId": "temp-1", "toNodeId": "temp-2", "label": "Success" },
      { "fromNodeId": "temp-2", "toNodeId": "temp-3", "label": "True" }
    ],
    "firstRuleNodeId": "temp-1",
    "changeNotes": "Added type filter before save"
  }'
```

The save operation:
1. Deletes all existing connections and nodes
2. Creates new nodes (generates real UUIDs, maps from temp IDs)
3. Creates new connections (remaps node IDs)
4. Creates a version snapshot
5. Increments `currentVersion`
6. Invalidates the in-memory chain cache

---

## Debug

### GET /api/rule-chains/:id/debug

Get the in-memory debug buffer showing recent message processing through the chain.

```bash
GET /api/rule-chains/CHAIN_UUID/debug?limit=50
```

**Response (200):**
```json
[
  {
    "nodeId": "node-uuid",
    "nodeType": "script-filter",
    "nodeName": "Temperature Check",
    "inputMsg": { "temperature": 105 },
    "outputMsg": { "temperature": 105 },
    "output": "True",
    "durationMs": 2,
    "timestamp": "2026-03-01T08:00:00Z"
  }
]
```

### DELETE /api/rule-chains/:id/debug

Clear the debug buffer.

---

## Node Types

### GET /api/rule-chains/node-types

List all registered node type definitions, optionally filtered by category.

```bash
GET /api/rule-chains/node-types?category=FILTER
```

**Response (200):**
```json
[
  {
    "type": "msg-type-filter",
    "category": "FILTER",
    "name": "Message Type Filter",
    "description": "Routes messages based on message type",
    "outputs": ["True", "False", "Failure"],
    "defaultConfig": { "messageTypes": ["TELEMETRY"] }
  }
]
```

---

## Available Node Types

### INPUT
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `input` | Input | Entry point for the rule chain | Success |

### FILTER
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `msg-type-filter` | Message Type Filter | Route by message type | True, False, Failure |
| `script-filter` | Script Filter | Custom JavaScript filter | True, False, Failure |
| `check-relation` | Check Relation | Check entity relationships | True, False, Failure |
| `originator-type-filter` | Originator Type Filter | Filter by template name | True, False, Failure |
| `check-alarm-status` | Check Alarm Status | Check existing alarm status | True, False, Failure |

### ENRICHMENT
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `entity-attributes` | Entity Attributes | Attach entity attributes to metadata | Success, Failure |
| `entity-details` | Entity Details | Attach entity name, template, parent info | Success, Failure |
| `related-attributes` | Related Attributes | Fetch attributes from related entities | Success, Failure |
| `tenant-attributes` | Tenant Attributes | Attach system-level settings | Success, Failure |

### TRANSFORM
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `script-transform` | Script Transform | Custom JavaScript transformation | Success, Failure |
| `rename-keys` | Rename Keys | Map telemetry key names | Success, Failure |
| `change-originator` | Change Originator | Switch to parent/related entity | Success, Failure |
| `to-email` | To Email | Transform to email notification format | Success, Failure |
| `unit-conversion` | Unit Conversion | Apply formula-based conversions | Success, Failure |

### ACTION
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `save-timeseries` | Save Timeseries | Save to ts_telemetry | Success, Failure |
| `save-attributes` | Save Attributes | Save to entity attributes | Success, Failure |
| `create-alarm` | Create Alarm | Create/update an alarm | Success, Failure |
| `clear-alarm` | Clear Alarm | Clear an existing alarm | Success, Failure |
| `send-notification` | Send Notification | Enqueue a notification | Success, Failure |
| `assign-to-user` | Assign to User | Set alarm assignee | Success, Failure |
| `log` | Log | Write to server log | Success |
| `rpc-call-reply` | RPC Call Reply | Send RPC response to device | Success, Failure |

### EXTERNAL
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `rest-api-call` | REST API Call | HTTP request to external service | Success, Failure |
| `mqtt-publish` | MQTT Publish | Publish to custom MQTT topic | Success, Failure |
| `push-to-uns` | Push to UNS | Publish data to UNS path | Success, Failure |
| `send-email` | Send Email | Enqueue email notification | Success, Failure |

### FLOW
| Type | Name | Description | Outputs |
|------|------|-------------|---------|
| `rule-chain-input` | Rule Chain Input | Enter another rule chain | Success, Failure |
| `checkpoint` | Checkpoint | Force-save current state | Success, Failure |
| `delay` | Delay | Wait N milliseconds | Success |
| `acknowledge` | Acknowledge | Stop further processing | (none) |

---

## Next Steps

- [Rule Engine Overview](../user-guide/rule-engine/overview.md) — Concepts and visual editor
- [Telemetry API](telemetry.md) — Data ingestion endpoints
- [Debug Traces](debug-traces.md) — Pipeline execution traces
