# Device Connectivity

Two protocols supported: MQTT (recommended for real-time streaming) and HTTP (for periodic reporting).

## Access Tokens
Each entity gets a unique token via Connectivity tab > Provision Credential. Tokens authenticate device data submissions for both MQTT and HTTP protocols.

## Status Tracking
| Status | Description |
|--------|-------------|
| ONLINE | Device actively sending data |
| OFFLINE | No data received within timeout |
| UNKNOWN | Initial state before first data |

Tracked with: last activity timestamp, protocol type, source IP address.

## Rate Limiting
Configurable per credential (default: 600 messages/minute). IP allowlists optional for additional security.

## Code Snippets
Auto-generated connection code provided in the Connectivity tab:
- **Python** -- requests library example
- **Node.js** -- fetch API example
- **C** -- libcurl example
- **curl** -- Command-line example

## Supported Protocols

### HTTP
- `POST /api/data/telemetry` -- Send telemetry data
- `POST /api/data/attributes` -- Send device attributes
- `POST /api/data/event` -- Send device events
- `POST /api/data/binary` -- Send binary data

### MQTT (via EMQX)
- TCP: port 1883, TLS: port 8883
- WebSocket: port 8083, WSS: port 8084
- Username: device access token, Password: empty
- Topics: `digilog/v1/<uns-path>/telemetry`, `attributes`, `events`

## Phase 2: Filter Device Integration
Filter entities (asset instances with filter profiles) can also receive telemetry data from IoT sensors (e.g., differential pressure sensors on HEPA filters). This telemetry can trigger rule chain evaluations for automated alerts when filter performance degrades.
