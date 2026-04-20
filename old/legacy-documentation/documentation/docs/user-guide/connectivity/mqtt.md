# MQTT Setup

Powered by EMQX broker for real-time device connectivity.

## Connection
| Parameter | Value |
|-----------|-------|
| Host | Server IP (e.g., 34.232.224.0) |
| TCP Port | 1883 |
| TLS Port | 8883 |
| WebSocket | 8083 (WS) / 8084 (WSS) |
| Username | Entity access token |
| Password | (empty) |

## Topics
| Topic | Purpose |
|-------|---------|
| `digilog/v1/<uns-path>/telemetry` | Send telemetry data |
| `digilog/v1/<uns-path>/attributes` | Update device attributes |
| `digilog/v1/<uns-path>/events` | Send device events |
| `digilog/v1/<uns-path>/rpc/request` | Receive RPC commands (subscribe) |
| `digilog/v1/<uns-path>/rpc/response` | Send RPC responses (publish) |

## QoS Levels
| QoS | Description | Recommendation |
|-----|-------------|----------------|
| 0 | At most once | Low-priority telemetry |
| 1 | At least once | **Recommended** for most use cases |
| 2 | Exactly once | Critical control messages |

## EMQX Dashboard
Management interface available at port 18083 for:
- Client connection monitoring
- Topic subscription inspection
- Message rate metrics
- ACL rule management

## Authentication Flow
1. Device connects with access token as MQTT username
2. EMQX calls DigiLog's MQTT auth webhook (`/api/mqtt/auth`)
3. Token validated against device credentials database
4. ACL rules applied based on entity UNS path (`/api/mqtt/acl`)

## MQTT + Rule Chain
Incoming MQTT messages are processed through the data ingestion pipeline:
1. EMQX webhook delivers message to DigiLog API
2. BullMQ worker queues the message
3. Rule chain engine evaluates the data against configured rules
4. Actions fire (save to TimescaleDB, create alarms, send notifications)
