# Rule Chain Engine

Visual DAG-based data processing with 77 built-in node types across 8 categories.

## Categories

### INPUT (1 node)
Entry point for incoming messages from devices.

### FILTER (12 nodes)
Message Type, Script Filter, Switch, Check Relation, Check Alarm, Entity Type, GPS Geofencing, and more. Route messages based on conditions.

### ENRICHMENT (10 nodes)
Entity Attributes/Details, Originator Attributes/Telemetry/Fields, Related/Parent data, Calculate Delta, and more. Add context to messages.

### TRANSFORM (9 nodes)
Script Transform, Rename/Copy/Delete Keys, Calculated Fields, Math Function, JSON Path, Unit Conversion, Split Array. Modify message content.

### ACTION (15+ nodes)
Save Timeseries/Attributes, Create/Clear Alarm, Send Email/SMS/Notification, Change Status, RPC, Push to UNS. Execute operations.

### EXTERNAL (9+ nodes)
REST API Call, MQTT Publish, Kafka, RabbitMQ, AWS SNS/SQS/Lambda, Slack, Telegram, AI Request. Integrate with external systems.

### FLOW (6 nodes)
Delay, Checkpoint, Sub-chain delegation, Generator, Deduplication, Message Count. Control message flow.

### ANALYTICS (4 nodes)
Aggregate Latest/Stream, Alarms Count, Entity Count. Statistical processing.

## Scripting
Custom JavaScript in sandboxed VM (1-second timeout). Available variables: `msg`, `metadata`, `msgType`. No access to `process`, `require`, `global`, or file system for security.

## Sub-Chain Delegation
Rule chains can delegate processing to other rule chains, enabling modular and reusable data processing pipelines.

## Debugging
Debug mode records input/output for each node execution. View traces at **Debug > Traces** with full message inspection.

## Visual Editor
React Flow-based drag-and-drop editor for building rule chain DAGs:
- Custom node components with connection handles
- Labeled edges (True/False/Other routing)
- Node configuration panels
- Version history and activation/deactivation

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rule-chains` | List rule chains |
| POST | `/api/rule-chains` | Create rule chain |
| PUT | `/api/rule-chains/:id` | Update rule chain |
| DELETE | `/api/rule-chains/:id` | Delete rule chain |
| GET | `/api/rule-chains/:id/nodes` | List nodes in chain |
| POST | `/api/rule-chains/:id/nodes` | Add node to chain |
| POST | `/api/rule-chains/:id/connections` | Create connection |
| POST | `/api/rule-chains/:id/activate` | Activate chain |
| POST | `/api/rule-chains/:id/deactivate` | Deactivate chain |

## Phase 2: Filter Event Processing
Rule chains can process filter-related telemetry (e.g., differential pressure readings from HEPA filters) and trigger alarms when values exceed thresholds, enabling automated filter performance monitoring alongside the manual cleaning lifecycle management.
