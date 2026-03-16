# MQTT Setup

Powered by EMQX broker.

## Connection
- Host: your server IP, Port: 1883 (TCP) / 8883 (TLS)
- Username: entity access token, Password: empty
- WebSocket: 8083 (WS) / 8084 (WSS)

## Topics
- v1/devices/me/telemetry — send telemetry
- v1/devices/me/attributes — update attributes

## QoS
0 (at most once), 1 (at least once, recommended), 2 (exactly once)

## Dashboard
EMQX management at port 18083.
