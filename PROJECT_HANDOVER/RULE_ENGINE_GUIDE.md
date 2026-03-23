# Rule Engine Guide

## Overview
The rule engine processes IoT data through configurable visual pipelines. Each rule chain contains nodes connected by labeled edges, forming a directed graph.

## Node Categories (77 total)

### INPUT (1 node)
- **input** — Entry point for all messages. Passes data unchanged to connected nodes.

### FILTER (8 nodes)
- **msg-type-filter** — Route by message type (TELEMETRY, ATTRIBUTE, EVENT)
- **script-filter** — Custom JavaScript filter (return true/false)
- **check-relation** — Check if entity has specific relationship
- **originator-type-filter** — Filter by template name
- **check-alarm-status** — Check if alarm exists with status
- **entity-type-filter** — Route by template category
- **entity-type-switch** — Multi-way switch by template name
- **template-switch** — Route based on template category

### ENRICHMENT (10+ nodes)
- **change-originator** — Change message source entity
- **calculate** — Numeric operations (add, multiply, scale, round)
- **string-operation** — String transforms (concat, uppercase, substring)
- **http-request** — Outbound HTTP call, merge response into message
- **rest-api-call** — REST API with auth headers
- **save-attributes** — Store as entity attributes
- **save-telemetry** — Store as telemetry data point
- **gps-location** — Extract/transform GPS coordinates

### TRANSFORMATION (12+ nodes)
- **script-transformation** — Custom JavaScript transform
- **split-message** — Split into multiple messages
- **aggregate-stream** — Aggregate over time window (avg, sum, min, max)
- **json-path** — Extract fields via JSONPath
- **geofence** — GPS geofencing (point-in-polygon)
- **deduplicate** — Dedup over configurable window
- **rate-limit** — Rate limit per entity
- **delay** — Delay message by duration
- **timezone-converter** — Convert timestamps

### ACTION (15+ nodes)
- **create-alarm** — Create alarm with severity, type, details
- **clear-alarm** — Clear active alarm by type
- **send-email** — Send via SMTP
- **send-sms** — Send via SMS gateway
- **telegram-notification** — Telegram bot message
- **slack-notification** — Slack webhook
- **create-notification** — In-app notification
- **trigger-webhook** — External webhook call
- **log-to-console** — Debug logging
- **execute-rule-chain** — Invoke another rule chain

### EXTERNAL INTEGRATION (10+ nodes)
- **mqtt-publish** — Publish to MQTT topic
- **kafka-producer** — Kafka message
- **aws-lambda** — Invoke Lambda function
- **gcp-pubsub** — Google Cloud Pub/Sub
- **azure-service-bus** — Azure messaging
- **influxdb-write** — Write to InfluxDB
- **splunk-hec** — Splunk HTTP Event Collector

## Execution Lifecycle

```
1. Telemetry arrives (MQTT/HTTP/WS)
2. Ingestion worker picks up message
3. Find entity's assigned rule chain
4. Start at INPUT node
5. Execute node handler:
   - Receive: { message, config, context }
   - Process data
   - Return: { outputs: { "Success": [...], "Failure": [...] } }
6. For each output label, find connected nodes
7. Pass output messages to connected nodes
8. Repeat until terminal nodes (log, discard, success)
9. If debug mode: record execution trace per node
```

## Message Object
```typescript
{
  // Data payload (varies by message type)
  temperature: 25.5,
  humidity: 60,
  timestamp: "2026-03-23T10:00:00Z",

  // Metadata (added by enrichment)
  _entityId: "uuid",
  _entityName: "Sensor-001",
  _templateId: "uuid",
  _unsPath: "digilog/v1/factory/sensor-001",
  _messageType: "TELEMETRY"
}
```

## Configuration Example

### Temperature Alert Rule Chain
```
[Input] → [Filter: temp > 80°C]
            ├── True  → [Create Alarm: HIGH_TEMP, CRITICAL]
            │              → [Send Email: ops@company.com]
            │              → [Slack Notification: #alerts]
            └── False → [Save Telemetry]
                          → [Log: "Normal reading"]
```

### Node Configuration (Filter Node)
```json
{
  "type": "script-filter",
  "configuration": {
    "script": "return msg.temperature > 80;",
    "timeout": 1000
  }
}
```

## Script Sandbox
- User scripts run in Node.js VM (isolated context)
- 1-second execution timeout
- No access to filesystem, network, or require()
- Available variables: `msg` (message), `metadata` (context)
- Must return a value (boolean for filters, object for transforms)

## Debug Mode
When `debugMode: true` on a node:
- Execution input/output recorded
- Timing captured (ms)
- Errors logged with stack trace
- Viewable at `/debug/traces` in UI
