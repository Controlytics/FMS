# Rule Engine Overview

The Rule Engine is DigiLog's data processing framework. It enables you to build automated workflows that filter, transform, enrich, and route incoming messages — without writing code. Rule chains are configured visually using a drag-and-drop editor.

---

## Core Concepts

### Messages

A **message** is the unit of data flowing through the rule engine. Every incoming telemetry submission, attribute update, or device event is wrapped in a message with:

| Field | Description |
|-------|-------------|
| **type** | Message type: `POST_TELEMETRY`, `POST_ATTRIBUTES`, `CONNECT`, `DISCONNECT`, etc. |
| **originator** | The entity ID that produced this message |
| **metadata** | Context information (entity name, template, UNS path, timestamps) |
| **payload** | The actual data (telemetry values, attributes, event details) |

### Rule Chains

A **rule chain** is a directed graph of processing nodes. Messages enter through the **Input** node and flow through connected nodes based on routing logic. Each node processes the message and routes it to the next node(s).

```
Input → Filter → Transform → Action
                           ↘ External
```

### Rule Nodes

A **rule node** is a single processing step. Each node has:
- **Type** — What kind of processing it performs
- **Configuration** — Node-specific settings
- **Input connections** — Where messages come from
- **Output connections** — Where messages go next (labeled: Success, Failure, True, False, etc.)

---

## Node Categories

### Filter Nodes

Filter nodes route messages based on conditions without modifying them.

| Node | Description |
|------|-------------|
| **Message Type Filter** | Route by message type (telemetry, attributes, events) |
| **Script Filter** | Custom JavaScript condition that returns true/false |
| **Check Relation** | Check if the originator has a specific relation to another entity |
| **Originator Attributes** | Filter based on the originator entity's attributes |

### Enrichment Nodes

Enrichment nodes add context to messages from external sources.

| Node | Description |
|------|-------------|
| **Originator Attributes** | Add the originator entity's attributes to message metadata |
| **Related Attributes** | Add attributes from related entities |
| **Tenant Attributes** | Add system-level configuration values |

### Transformation Nodes

Transformation nodes modify the message payload or metadata.

| Node | Description |
|------|-------------|
| **Script Transform** | Run custom JavaScript to transform the payload |
| **Rename Keys** | Rename telemetry keys |
| **To Email** | Transform message into an email format |
| **Calculate Delta** | Compute difference between consecutive values |

### Action Nodes

Action nodes perform side effects.

| Node | Description |
|------|-------------|
| **Save Telemetry** | Persist telemetry data to the database |
| **Save Attributes** | Persist attributes to the database |
| **Create Alarm** | Create or update an alarm on the originator entity |
| **Clear Alarm** | Clear an existing alarm |
| **Log** | Write a log message for debugging |
| **Assign to Customer** | Assign the originator entity to a customer/owner |
| **RPC Call Reply** | Send a response to an RPC request |

### External Nodes

External nodes integrate with external systems.

| Node | Description |
|------|-------------|
| **REST API Call** | Make HTTP requests to external services |
| **Send Email** | Send email notifications via SMTP |
| **MQTT Publish** | Publish messages to external MQTT brokers |
| **Kafka Publish** | Send messages to Apache Kafka topics |

### Flow Nodes

Flow nodes control message routing logic.

| Node | Description |
|------|-------------|
| **Rule Chain Input** | Entry point for the rule chain |
| **Rule Chain Output** | Forward message to another rule chain |
| **Acknowledge** | Mark message as successfully processed |
| **Checkpoint** | Save processing state for retry on failure |

---

## Message Flow

### Processing Pipeline

```
Device sends telemetry
        │
        ▼
  ┌─────────────┐
  │ API receives │  (HTTP / MQTT / WebSocket)
  │ & validates  │
  └──────┬──────┘
         │
         ▼
  ┌──────────────┐
  │  BullMQ Queue │  (Redis-backed async processing)
  └──────┬───────┘
         │
         ▼
  ┌───────────────┐
  │  Ingestion     │
  │  Worker        │  (Concurrent processing, configurable)
  └──────┬────────┘
         │
         ▼
  ┌───────────────┐
  │  Rule Engine   │  (Matched rule chains execute)
  │  Processing    │
  └──────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
 Storage   Alarms/
           Notifications
```

### Rule Chain Matching

DigiLog evaluates which rule chains should process each message based on:
1. **Root rule chain** — The default chain that processes all messages
2. **Entity-specific chains** — Chains assigned to specific entities or templates
3. **Message type filters** — Chains that only process certain message types

---

## Rule Chain Editor

The Rule Chain Editor provides a visual drag-and-drop interface for building rule chains.

### Using the Editor

1. Navigate to **Rule Chains** from the left sidebar.
2. Click **Create Rule Chain** or select an existing one.
3. The editor opens with a canvas and a node palette.

### Editor Features

| Feature | Description |
|---------|-------------|
| **Node Palette** | Drag nodes from the left panel onto the canvas |
| **Connection Lines** | Click and drag from a node's output to another node's input |
| **Node Configuration** | Double-click a node to edit its settings |
| **Connection Labels** | Connections are labeled (Success, Failure, True, False) |
| **Debug Mode** | Enable debug to see message flow in real time |
| **Save / Activate** | Save the chain and activate it for live processing |
| **Version History** | View and revert to previous chain versions |

### Example: Temperature Alert Rule Chain

```
Input → Message Type Filter (TELEMETRY)
            │ True
            ▼
        Script Filter (temperature > 40)
            │ True              │ False
            ▼                   ▼
      Create Alarm         Save Telemetry
      (HIGH_TEMP)
            │ Success
            ▼
      Send Email
      (alert@company.com)
```

---

## Pipeline Debug Traces

For troubleshooting, DigiLog records pipeline traces that show how each message was processed:

1. Navigate to **Debug Traces** (Admin only).
2. View recent pipeline executions with timing, status, and error details.
3. Filter by entity, message type, or time range.
4. Expand individual traces to see node-by-node execution.

---

## Next Steps

- [Rule Chain Editor](rule-chain-editor.md) — Detailed editor usage guide
- [Rule Nodes](rule-nodes.md) — Complete node reference
- [Alarms](../alarms/alarms.md) — Alarm creation from rule chains
- [Telemetry](../telemetry/telemetry.md) — Data ingestion pipeline
