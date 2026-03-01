# MQTT Connectivity

DigiLog supports MQTT as a primary transport protocol for device-to-platform communication. The platform connects to an EMQX broker and routes messages through the data ingestion pipeline.

---

## Architecture

```
Device ──MQTT──► EMQX Broker ──► DigiLog MQTT Client ──► BullMQ Queue ──► Pipeline Worker
```

1. **Device** publishes to its UNS topic with access token as MQTT password
2. **EMQX Broker** receives the message and routes to subscribed clients
3. **DigiLog MQTT Client** subscribes to `digilog/v1/#` wildcard
4. **BullMQ** queues the message for reliable processing
5. **Pipeline Worker** processes through the 9-stage pipeline

---

## MQTT Topic Format

Topics follow the entity's Unified Namespace (UNS) path:

```
digilog/v1/<enterprise>/<site>/<area>/<line>/<cell>/<entity>/telemetry
```

### Topic Types

| Topic Suffix | Direction | Purpose |
|-------------|-----------|---------|
| `/telemetry` | Device → Platform | Time-series data |
| `/attributes` | Device → Platform | Device properties |
| `/events` | Device → Platform | Device events |
| `/rpc/request` | Platform → Device | Remote commands |
| `/rpc/response` | Device → Platform | Command responses |

### Example Topics

```
digilog/v1/acme/mumbai/packaging/line-1/tp-42/telemetry
digilog/v1/acme/mumbai/packaging/line-1/tp-42/attributes
digilog/v1/acme/mumbai/warehouse/cs-01/events
```

---

## Authentication

MQTT devices authenticate using their **device access token** as the password:

| MQTT Field | Value |
|------------|-------|
| Client ID | Any unique string (e.g., entity name) |
| Username | (empty or any value) |
| Password | Device access token |

### Connection Example (mosquitto_pub)

```bash
mosquitto_pub \
  -h your-server \
  -p 1883 \
  -t "digilog/v1/acme/mumbai/packaging/line-1/tp-42/telemetry" \
  -u "" \
  -P "DEVICE_ACCESS_TOKEN" \
  -m '{"temperature": 25.5, "humidity": 60}'
```

### Connection Example (Python — paho-mqtt)

```python
import paho.mqtt.client as mqtt
import json

client = mqtt.Client(client_id="tp-42")
client.username_pw_set("", "DEVICE_ACCESS_TOKEN")
client.connect("your-server", 1883)

topic = "digilog/v1/acme/mumbai/packaging/line-1/tp-42/telemetry"
payload = json.dumps({"temperature": 25.5, "humidity": 60})
client.publish(topic, payload)
client.disconnect()
```

### Connection Example (Node.js — mqtt)

```javascript
const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://your-server:1883', {
  clientId: 'tp-42',
  password: 'DEVICE_ACCESS_TOKEN'
});

client.on('connect', () => {
  const topic = 'digilog/v1/acme/mumbai/packaging/line-1/tp-42/telemetry';
  client.publish(topic, JSON.stringify({
    temperature: 25.5,
    humidity: 60
  }));
  client.end();
});
```

---

## Payload Formats

### Simple (auto-timestamped)

```json
{"temperature": 25.5, "humidity": 60, "pressure": 1013.25}
```

Server assigns the current UTC timestamp.

### With Explicit Timestamp

```json
{
  "ts": 1709280000000,
  "values": {
    "temperature": 25.5,
    "humidity": 60
  }
}
```

The `ts` field is a Unix timestamp in milliseconds.

### Attributes

```json
{"firmware_version": "1.2.3", "model": "SensorX-200"}
```

### Events

```json
{"event_type": "REBOOT", "details": {"reason": "firmware_update"}}
```

---

## QoS Levels

| QoS | Name | Use Case |
|-----|------|----------|
| 0 | At most once | High-frequency telemetry where occasional loss is acceptable |
| 1 | At least once | **Recommended** — Ensures delivery, may duplicate |
| 2 | Exactly once | Critical events, alarms (higher latency) |

---

## Rate Limiting

Per-device rate limits are configured on the device credential:

| Setting | Description |
|---------|-------------|
| `maxDataRatePerMin` | Maximum messages per minute per device |

Messages exceeding the rate limit are rejected and logged as `RATE_LIMIT_EXCEEDED` in pipeline traces.

---

## EMQX Broker Configuration

The platform connects to EMQX using these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | EMQX broker URL |
| `MQTT_USERNAME` | — | Broker authentication username |
| `MQTT_PASSWORD` | — | Broker authentication password |
| `MQTT_CLIENT_ID` | `digilog-api` | Platform client ID |

---

## Next Steps

- [Device Connectivity](device-connectivity.md) — Token management and status
- [UNS](../uns/uns.md) — Topic path structure
- [Telemetry API](../../api-reference/telemetry.md) — HTTP alternative for data ingestion
