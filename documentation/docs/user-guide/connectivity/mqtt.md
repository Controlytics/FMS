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


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
