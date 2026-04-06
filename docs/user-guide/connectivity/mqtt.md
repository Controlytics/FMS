# MQTT Setup

Powered by EMQX broker.

## Connection
- Host: your server IP (production: 34.232.224.0), Port: 1883 (TCP) / 8883 (TLS)
- Username: entity access token, Password: empty
- WebSocket: 8083 (WS) / 8084 (WSS)

## Topics
- v1/devices/me/telemetry — send telemetry
- v1/devices/me/attributes — update attributes
- v1/devices/me/events — send device events

## ACL Rules
- Devices can only publish/subscribe to their own entity topics (enforced via EMQX HTTP auth callbacks)
- Server MQTT client subscribes to `digilog/v1/#` for all entity data

## QoS
0 (at most once), 1 (at least once, recommended), 2 (exactly once)

## LWT (Last Will and Testament)
Device disconnection is detected via LWT messages and ConnectivityStatus is updated to OFFLINE.

## Dashboard
EMQX management at port 18083 (http://34.232.224.0:18083).
