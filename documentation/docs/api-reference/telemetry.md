# Telemetry API

The Telemetry API provides endpoints for data ingestion (sending telemetry and attributes from devices) and data querying (retrieving historical and latest telemetry values).

---

## Data Ingestion

These endpoints use **device access tokens** (not user JWT tokens) for authentication.

### POST /api/data/telemetry

Send telemetry data from a device.

**Request:**
```bash
curl -X POST "http://your-server/api/data/telemetry" \
  -H "Authorization: Bearer DEVICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60, "pressure": 1013.25}'
```

**With explicit timestamp:**
```json
{
  "ts": 1709280000000,
  "values": {
    "temperature": 25.5,
    "humidity": 60
  }
}
```

**Response (200):**
```json
{
  "success": true,
  "entity": "Warehouse-Sensor-01",
  "keysProcessed": 3
}
```

| Parameter | Type | Description |
|-----------|------|-------------|
| Top-level keys | object | Key-value pairs (auto-timestamped with server time) |
| `ts` | number | Unix timestamp in milliseconds (optional) |
| `values` | object | Key-value pairs associated with the timestamp |

### POST /api/data/attributes

Send device attributes (static/semi-static properties).

```bash
curl -X POST "http://your-server/api/data/attributes" \
  -H "Authorization: Bearer DEVICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"firmware_version": "1.2.3", "model": "SensorX-200"}'
```

### POST /api/data/event

Send device events (connection, disconnection, error).

```bash
curl -X POST "http://your-server/api/data/event" \
  -H "Authorization: Bearer DEVICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event_type": "REBOOT", "details": {"reason": "firmware_update"}}'
```

### POST /api/data/binary

Send binary data (firmware uploads, large payloads).

```bash
curl -X POST "http://your-server/api/data/binary" \
  -H "Authorization: Bearer DEVICE_ACCESS_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @firmware.bin
```

---

## Data Querying

These endpoints use **user JWT tokens** for authentication.

### GET /api/queries/telemetry/latest

Get the latest telemetry values for an entity.

```bash
curl "http://your-server/api/queries/telemetry/latest?entityId=ENTITY_ID" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string (UUID) | Yes | Entity to query |
| `keys` | string | No | Comma-separated telemetry keys to filter |

**Response (200):**
```json
[
  {
    "key": "temperature",
    "value": 25.5,
    "ts": "2026-03-01T08:00:00.000Z"
  },
  {
    "key": "humidity",
    "value": 60,
    "ts": "2026-03-01T08:00:00.000Z"
  }
]
```

### GET /api/queries/telemetry/timeseries

Query historical time-series data.

```bash
curl "http://your-server/api/queries/telemetry/timeseries?\
entityId=ENTITY_ID&\
keys=temperature,humidity&\
startTs=1709280000000&\
endTs=1709366400000&\
limit=1000" \
  -H "Authorization: Bearer USER_TOKEN"
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string (UUID) | Yes | Entity to query |
| `keys` | string | Yes | Comma-separated telemetry keys |
| `startTs` | number | Yes | Start time (Unix ms) |
| `endTs` | number | Yes | End time (Unix ms) |
| `limit` | number | No | Max data points (default: 1000) |
| `interval` | number | No | Aggregation interval in ms |
| `agg` | string | No | Aggregation function: AVG, MIN, MAX, SUM, COUNT |
| `orderBy` | string | No | Sort order: ASC or DESC |

**Response (200):**
```json
{
  "temperature": [
    { "ts": 1709280000000, "value": 25.5 },
    { "ts": 1709280060000, "value": 25.7 },
    { "ts": 1709280120000, "value": 25.3 }
  ],
  "humidity": [
    { "ts": 1709280000000, "value": 60 },
    { "ts": 1709280060000, "value": 59 },
    { "ts": 1709280120000, "value": 61 }
  ]
}
```

---

## MQTT Topics

Devices can also send telemetry via MQTT. The topic format follows the entity's UNS path:

| Topic | Purpose |
|-------|---------|
| `digilog/v1/<uns-path>/telemetry` | Send telemetry data |
| `digilog/v1/<uns-path>/attributes` | Send device attributes |
| `digilog/v1/<uns-path>/events` | Send device events |
| `digilog/v1/<uns-path>/rpc/request` | Receive RPC commands (subscribe) |
| `digilog/v1/<uns-path>/rpc/response` | Send RPC responses (publish) |

MQTT authentication uses the device access token as the password.

---

## Rate Limits

| Scope | Limit | Window |
|-------|-------|--------|
| Global (per IP) | 500 requests | 1 minute |
| Per device | Configurable via `maxDataRatePerMin` on credential | Per minute |

---

## Next Steps

- [Device Connectivity](../user-guide/connectivity/device-connectivity.md) — Token management
- [Entity API](entities.md) — Entity CRUD operations
- [Authentication API](authentication.md) — User authentication
