# Device Connectivity

DigiLog supports multiple protocols for device-to-platform communication. Each entity with data ingestion enabled receives a unique access token and connectivity monitoring.

---

## Supported Protocols

| Protocol | Port | Use Case | Credential Types |
|----------|------|----------|-----------------|
| **HTTP** | 80/443 | Request-response, low-frequency data, edge gateways | Access Token |
| **MQTT** | 1883/8883 | Real-time streaming, bidirectional, constrained devices | Access Token, X.509 Certificate |
| **WebSocket** | 80/443 | Browser-based real-time, high-frequency dashboard data | Access Token |

---

## Access Tokens

### Auto-Generated Tokens

When an entity is created from a template with **Data Ingestion Enabled**, DigiLog automatically:
1. Generates a 64-character hex access token
2. Creates a connectivity status record (initial status: `OFFLINE`)
3. Provisions a UNS mapping with allowed MQTT topics

### Token Management

#### Generate New Token

Navigate to the entity's **Connectivity** tab and click **Generate Token**. This creates a new token and revokes the previous one.

You can also provide a custom token (8-128 characters) for integration with existing device provisioning systems.

**Required role:** SUPER_ADMIN or ADMIN

#### Revoke Token

Click **Revoke Token** to disable the current access token. The entity's connectivity status is set to `OFFLINE`.

**Required role:** SUPER_ADMIN or ADMIN

### Token Authentication

Devices authenticate using the access token in the HTTP `Authorization` header:

```
Authorization: Bearer <access_token>
```

For MQTT, the access token is used as the MQTT password (username can be any value).

---

## Connectivity Status

DigiLog monitors each entity's connection status in real time.

### Status Values

| Status | Description |
|--------|-------------|
| **ONLINE** | Device is actively sending data |
| **OFFLINE** | No recent data from device |
| **UNKNOWN** | No connectivity record exists |

### Status Tracking

The connectivity status is updated automatically:
- **On data received** — status set to `ONLINE`, `lastActivityAt` updated
- **On MQTT connect** — `CONNECTED` event recorded, status set to `ONLINE`
- **On MQTT disconnect** — `DISCONNECTED` event recorded, status set to `OFFLINE`
- **On inactivity timeout** — maintenance worker sets status to `OFFLINE`

### Connection History

View connection and disconnection events over time in the **Connectivity** tab → **Connection History** section. Filter by period: 24 hours, 7 days, or 30 days.

---

## Code Snippets

DigiLog auto-generates connection code for each entity. Navigate to the **Connectivity** tab → **Code Snippets** section to get ready-to-use examples in:

### Python
```python
import requests

url = "http://your-server/api/data/telemetry"
headers = {
    "Authorization": "Bearer YOUR_TOKEN",
    "Content-Type": "application/json"
}

data = {"temperature": 25.5, "humidity": 60}
response = requests.post(url, json=data, headers=headers)
```

### Node.js
```javascript
const fetch = require('node-fetch');

const res = await fetch('http://your-server/api/data/telemetry', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer YOUR_TOKEN`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ temperature: 25.5, humidity: 60 }),
});
```

### curl
```bash
curl -X POST "http://your-server/api/data/telemetry" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"temperature": 25.5, "humidity": 60}'
```

### Arduino (ESP32)
```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Setup WiFi and HTTP client
// POST telemetry to /api/data/telemetry with Bearer token
```

The snippets include the entity's actual access token and UNS path, ready for copy-paste.

---

## Connectivity Tab Overview

The Connectivity tab in the Entity Detail Panel shows:

| Section | Description |
|---------|-------------|
| **Status** | Current online/offline status with last activity timestamp |
| **Device Token** | Access token with copy button and regenerate/revoke actions |
| **Allowed Topics** | MQTT topics this entity can publish/subscribe to |
| **Code Snippets** | Auto-generated code examples (Python, Node.js, curl, Arduino) |
| **Connection History** | Timeline of connect/disconnect events |
| **Test Connection** | Button to test if the device is currently reachable |

---

## Allowed Topics

Each entity is assigned MQTT topics based on its UNS path:

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `<unsPath>/telemetry` | Publish | Send telemetry data |
| `<unsPath>/attributes` | Publish | Send device attributes |
| `<unsPath>/events` | Publish | Send device events |
| `<unsPath>/rpc/request` | Subscribe | Receive RPC commands |
| `<unsPath>/rpc/response` | Publish | Send RPC responses |

---

## Next Steps

- [HTTP API](http-api.md) — Detailed HTTP endpoint documentation
- [MQTT](mqtt.md) — MQTT broker configuration and usage
- [WebSocket](websocket.md) — Real-time WebSocket communication
- [Telemetry](../telemetry/telemetry.md) — Data ingestion pipeline details
