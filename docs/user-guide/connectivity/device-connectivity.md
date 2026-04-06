# Device Connectivity

Two protocols supported: MQTT (recommended for real-time) and HTTP (for periodic reporting).

## Access Tokens
Each entity gets a unique token via Connectivity tab > Provision Credential. Tokens authenticate device data submissions.

## Status Tracking
- ONLINE — Received data within inactivity timeout
- OFFLINE — No data beyond inactivity timeout
- NEVER_CONNECTED — Token created but never used
- INACTIVE — Connected but no data recently

Status is tracked with last activity timestamp, protocol (MQTT/HTTP), source IP, and connection duration.

## Rate Limiting
Configurable per credential (default 600 messages/minute). IP allowlists optional.

## Code Snippets
Auto-generated connection code in Python (paho-mqtt), Node.js (mqtt.js), cURL, Arduino, and ESP32 — pre-filled with entity-specific token, topic paths, and server URL.

## Connection Testing
In-browser connection test button sends test telemetry via HTTP or MQTT (WebSocket).

## Live Message Log
Real-time stream of messages from the entity via WebSocket. Shows timestamp, message type, payload preview, and pipeline status.
