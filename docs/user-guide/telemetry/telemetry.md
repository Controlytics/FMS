# Telemetry

Telemetry is time-series data sent by devices or external systems to DigiLog. Each data point is a timestamped key-value pair associated with an entity. DigiLog stores telemetry in optimized time-series tables and provides APIs for ingestion, querying, and real-time subscriptions.

---

## Core Concepts

### Data Points

A single telemetry **data point** consists of:

| Field | Description |
|-------|-------------|
| **Entity ID** | The entity this data belongs to |
| **Key** | The measurement name (e.g., `temperature`, `pressure`) |
| **Value** | The measured value (number, string, boolean, or JSON) |
| **Timestamp** | When the measurement was taken (auto-generated if not provided) |

### Telemetry vs Attributes

| Aspect | Telemetry | Attributes |
|--------|-----------|------------|
| **Nature** | Time-series (many values over time) | Static/semi-static (latest value only) |
| **Examples** | Temperature readings, pressure, RPM | Firmware version, serial number, location |
| **Storage** | `ts_telemetry` table (optimized for time-range queries) | `ts_attributes` table |
| **Update frequency** | High (seconds to minutes) | Low (days to months) |

---

## Sending Telemetry

### HTTP API

Send telemetry data via HTTP POST using the device access token:

```bash
curl -X POST "http://your-server/api/data/telemetry" \
  -H "Authorization: Bearer DEVICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60, "pressure": 1013.25}'
```

**Response:**
```json
{
  "success": true,
  "entity": "Warehouse-Sensor-01",
  "keysProcessed": 3
}
```

### Multiple Data Points

Send multiple timestamped readings in a single request:

```json
{
  "ts": 1709280000000,
  "values": {
    "temperature": 25.5,
    "humidity": 60
  }
}
```

### MQTT

Publish telemetry to the entity's UNS topic:

```
Topic: digilog/v1/<uns-path>/telemetry
Payload: {"temperature": 25.5, "humidity": 60}
```

See [MQTT Connectivity](../connectivity/mqtt.md) for details.

### WebSocket

Send telemetry over a persistent WebSocket connection for high-frequency data:

```javascript
ws.send(JSON.stringify({
  type: 'telemetry',
  token: 'DEVICE_ACCESS_TOKEN',
  data: { temperature: 25.5, humidity: 60 }
}));
```

See [WebSocket Connectivity](../connectivity/websocket.md) for details.

---

## Data Ingestion Pipeline

When telemetry arrives, DigiLog processes it through a multi-stage pipeline:

```
Device → API/MQTT/WS → Validation → BullMQ Queue → Ingestion Worker → Rule Engine → Storage
```

### Pipeline Stages

1. **Authentication** — Device token is verified against the `device_credentials` table.
2. **Validation** — Payload structure and data types are validated.
3. **Queueing** — Data is queued in Redis via BullMQ for reliable async processing.
4. **Ingestion Worker** — Processes queued messages with configurable concurrency.
5. **Rule Engine** — Matched rule chains process the data (filter, transform, enrich, alert).
6. **Batched Storage** — Telemetry is batched and written to the time-series tables.
7. **Latest Value Update** — The `latest_telemetry` table is updated with the most recent value.
8. **Connectivity Update** — The entity's connectivity status and last activity timestamp are updated.

### Batching

DigiLog batches telemetry writes for performance:
- **Batch size:** 100 data points (configurable)
- **Flush interval:** 1 second (configurable)
- Whichever threshold is reached first triggers a flush.

---

## Querying Telemetry

### Latest Values

Get the most recent value for each telemetry key:

```bash
GET /api/queries/telemetry/latest?entityId=ENTITY_ID
```

Response:
```json
[
  { "key": "temperature", "value": 25.5, "ts": "2026-03-01T08:00:00Z" },
  { "key": "humidity", "value": 60, "ts": "2026-03-01T08:00:00Z" }
]
```

### Historical Data

Query time-series data for a time range:

```bash
GET /api/queries/telemetry/timeseries?entityId=ENTITY_ID&keys=temperature,humidity&startTs=1709280000000&endTs=1709366400000
```

### Aggregation

Query aggregated data (avg, min, max, sum, count) over intervals:

```bash
GET /api/queries/telemetry/timeseries?entityId=ENTITY_ID&keys=temperature&startTs=...&endTs=...&interval=3600000&agg=AVG
```

---

## Real-Time Subscriptions

DigiLog supports real-time telemetry updates via WebSocket. The frontend automatically subscribes to telemetry changes for the entity currently being viewed.

When new telemetry arrives:
1. The ingestion worker publishes an event to Redis.
2. The WebSocket handler broadcasts to subscribed clients.
3. The frontend updates charts and latest values in real time.

---

## Data Retention

Telemetry data retention is configurable per system:

| Setting | Default | Description |
|---------|---------|-------------|
| **Telemetry retention** | 90 days | How long time-series data is kept |
| **Attribute retention** | 365 days | How long attribute history is kept |
| **Event retention** | 30 days | How long device events are kept |

Configure retention in **Configuration** → **Data Retention**.

See [Data Retention](../../administration/configuration/system-configuration.md#data-retention) for details.

---

## Time-Series Tables

DigiLog stores telemetry in dedicated time-series tables:

| Table | Purpose |
|-------|---------|
| `ts_telemetry` | Historical time-series telemetry data |
| `ts_attributes` | Device-reported attributes |
| `ts_device_events` | Connection/disconnection events |
| `ts_pipeline_traces` | Ingestion pipeline debug traces |
| `latest_telemetry` | Latest value per entity per key (fast lookup) |
| `data_streams` | Active data stream definitions per entity |

---

## Next Steps

- [Attributes](attributes.md) — Static key-value properties
- [Device Connectivity](../connectivity/device-connectivity.md) — Connect devices to send telemetry
- [Rule Engine](../rule-engine/overview.md) — Process telemetry through automation rules
- [Alarms](../alarms/alarms.md) — Trigger alerts based on telemetry values
