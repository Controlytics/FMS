# Rule Chain Engine

Visual DAG-based data processing with 77 built-in node types.

## Categories
- **INPUT** (1): Entry point
- **FILTER** (12): Message Type, Script Filter, Switch, Check Relation, Check Alarm, Entity Type, GPS Geofencing, etc.
- **ENRICHMENT** (10): Entity Attributes/Details, Originator Attributes/Telemetry/Fields, Related/Parent data, Calculate Delta, etc.
- **TRANSFORM** (9): Script Transform, Rename/Copy/Delete Keys, Calculated Fields, Math Function, JSON Path, Unit Conversion, Split Array
- **ACTION** (15+): Save Timeseries/Attributes, Create/Clear Alarm, Send Email/SMS/Notification, Change Status, RPC, Push to UNS
- **EXTERNAL** (9+): REST API Call, MQTT Publish, Kafka, RabbitMQ, AWS SNS/SQS/Lambda, Slack, AI Request
- **FLOW** (6): Delay, Checkpoint, Sub-chain delegation, Generator, Deduplication, Message Count
- **ANALYTICS** (4): Aggregate Latest/Stream, Alarms Count, Entity Count

## Scripting
Custom JavaScript in sandboxed VM (1s timeout). Available: msg, metadata, msgType.

## Debugging
Debug mode records input/output for each node. View traces at Debug > Traces.


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
