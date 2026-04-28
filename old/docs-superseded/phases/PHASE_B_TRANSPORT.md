# Phase B: Transport & Protocol Layer (3-4 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07. Phase 2 Digital FMS completed 2026-03-27.
> EMQX MQTT auth/ACL callbacks, HTTP data endpoints, WebSocket handler, message normalizer, and entity resolver all operational. Phase 2 adds filter operation endpoints.

## Prompt for Claude Code

```
You are implementing Phase B (Transport) of DigiLog's Data Ingestion & Integration Layer.

Phase A is complete — Docker Compose is running (PostgreSQL, TimescaleDB, EMQX, Redis), Prisma schema is migrated, BullMQ queues are defined, and SystemConfig is seeded.

This phase connects DigiLog to the outside world — MQTT devices, HTTP clients, and WebSocket dashboards. Every incoming message is authenticated, validated, normalized into a unified envelope, and enqueued to BullMQ for processing (the actual processing happens in Phase C).

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- MQTT messages arrive at EMQX → EMQX calls HTTP auth/ACL callbacks on your API → your API's MQTT client subscribes to `digilog/v1/#` and processes incoming messages
- HTTP data endpoints accept device access tokens in Authorization header
- WebSocket requires JWT authentication within 5 seconds of connection
- ALL incoming messages normalize to IngestionMessage envelope then enqueue to BullMQ "ingestion" queue
- Do NOT build the pipeline processing yet (Phase C) — just enqueue and return 200
- Do NOT build rule chain execution (Phase D)

WHAT TO BUILD:

1. EMQX AUTH CALLBACKS (apps/api/src/transport/mqtt-auth-routes.ts):
   POST /api/internal/mqtt/auth
   - Receives {username, password} from EMQX
   - username = device access token
   - Look up in DeviceCredential table, validate status=ACTIVE
   - Return 200 (allow) or 401 (deny)
   - On first successful auth: set firstConnectedAt if null (first-use activation)

   POST /api/internal/mqtt/acl
   - Receives {username, topic, action} from EMQX
   - action = "publish" or "subscribe"
   - Resolve device's entity → UnsMapping → check topic matches entity's UNS path
   - Publish ACL: device can only publish to its own entity's publish topics:
     digilog/v1/.../EntityName/telemetry
     digilog/v1/.../EntityName/attributes
     digilog/v1/.../EntityName/events
     digilog/v1/.../EntityName/rpc/response
     digilog/v1/.../EntityName/binary/#
   - Subscribe ACL: device can only subscribe to its own entity's subscribe topics:
     digilog/v1/.../EntityName/rpc/request
     digilog/v1/.../EntityName/attributes/shared
     digilog/v1/.../EntityName/config
     digilog/v1/.../EntityName/ota
   - Server MQTT client (special username): can subscribe to digilog/v1/# and publish to any entity
   - Return 200 (allow) or 403 (deny)

   POST /api/internal/mqtt/superuser — always return 403

2. MQTT CLIENT (apps/api/src/transport/mqtt-client.ts):
   - Connect to EMQX as server client (special credentials)
   - Subscribe to digilog/v1/# with QoS 1
   - Persistent session (clean: false, session expiry: 5 min)
   - On message: parse topic → determine message type → hand to mqtt-handler

3. MQTT HANDLER (apps/api/src/transport/mqtt-handler.ts):
   - Parse UNS topic: extract enterprise, site, area, line, cell, entity, suffix
   - Determine message type from suffix (telemetry, attributes, events, rpc/response, binary)
   - Normalize to IngestionMessage envelope (see spec Section 5.4)
   - Enqueue to BullMQ "ingestion" queue with appropriate priority:
     CHECKLIST=1, ALARM=2, ATTRIBUTE=3, TELEMETRY=5, DEVICE_EVENT=7, BINARY=8
   - Process LWT messages ({event: "DISCONNECTED"}) — update ConnectivityStatus to OFFLINE

4. HTTP DATA ENDPOINTS (apps/api/src/modules/data-ingestion/routes.ts):
   POST /api/data/telemetry     — Device Token auth, normalize, enqueue
   POST /api/data/attributes    — Device Token auth, normalize, enqueue
   GET  /api/data/attributes    — Device Token auth, return shared attributes
   POST /api/data/checklist     — User JWT ONLY (never device token), normalize, enqueue
   POST /api/data/binary        — Device Token auth, multipart, size limits per type
   POST /api/data/event         — Device Token auth, normalize, enqueue
   POST /api/data/rpc           — User JWT, publish to device's rpc/request topic via EMQX
   GET  /api/data/rpc/response/:requestId — User JWT, check Redis cache for response

   Device Token auth: extract from Authorization: Bearer <token>, look up DeviceCredential
   All data endpoints: normalize to IngestionMessage → enqueue to BullMQ → return 200

5. WEBSOCKET HANDLER (apps/api/src/transport/ws-handler.ts):
   - Connection: ws://host/api/ws
   - First message MUST be AUTH with JWT token within 5 seconds
   - Validate JWT → send AUTH_OK or close with 4001
   - Subsequent messages: SUBSCRIBE {entityId, keys, unsPath}, UNSUBSCRIBE
   - Subscribe to Redis pub/sub channel `ws:events` for real-time event broadcasting
   - Max connections per user: read from SystemConfig `websocket.max_connections_per_user`
   - On exceed: close oldest connection

6. MESSAGE NORMALIZER (apps/api/src/modules/data-ingestion/message-normalizer.ts):
   Transform all protocols into unified IngestionMessage:
   {
     messageId: UUID v7, timestamp: ISO 8601, protocol: mqtt|http|websocket|internal,
     entityId, entityName, templateId, unsPath, credentialId, sourceIp,
     messageType: POST_TELEMETRY|POST_ATTRIBUTES|POST_CHECKLIST|POST_BINARY|etc,
     data: {}, metadata: {}, ruleChainId, traceId
   }
   Support all payload formats:
   - Simple: {"temperature": 72.5}
   - Timestamped: {"ts": 1709049600000, "values": {"temperature": 72.5}}
   - Batch: [{"ts": ..., "values": {...}}, ...]

7. ENTITY RESOLVER (apps/api/src/modules/data-ingestion/entity-resolver.ts):
   Token → DeviceCredential → entityId → Entity + Template + UnsMapping
   Validate: entity exists, entity is active, template assigned

8. RPC FLOW:
   POST /api/data/rpc → publish to digilog/v1/.../EntityName/rpc/request via MQTT
   Device subscribes → receives command → publishes response to .../rpc/response
   Server MQTT handler picks up response → cache in Redis (5 min TTL, key: rpc:{requestId})
   GET /api/data/rpc/response/:requestId → check Redis cache → return or 404
   Timeout: read from SystemConfig rpc.timeout_ms (default 30s) → 408 if exceeded

VERIFICATION:
- EMQX auth callback: device with valid token can connect via MQTT
- EMQX ACL: device can only publish/subscribe to its own entity topics
- HTTP: POST /api/data/telemetry with device token → 200, job in BullMQ queue
- WebSocket: connect, send AUTH with JWT → AUTH_OK, subscribe → receives events
- RPC: POST /api/data/rpc → message published to EMQX → device topic
- LWT: disconnect device → ConnectivityStatus updated to OFFLINE
```

## Relevant Spec Sections

- **Section 4.1**: UNS topic structure (ISA-95 hierarchy)
- **Section 4.2a**: MQTT ACL rules (publish + subscribe topics, cross-entity denied)
- **Section 4.2b**: Server → device communication (RPC, config, OTA topics)
- **Section 4.2c**: MQTT QoS policy (telemetry=QoS 0, everything else=QoS 1)
- **Section 5.1**: EMQX configuration, TLS, LWT, persistent sessions, max payload, degradation mode
- **Section 5.2**: HTTP API ingestion
- **Section 5.3**: WebSocket subscriptions
- **Section 5.4**: IngestionMessage envelope (unified format)
- **Section 6.4**: WebSocket authentication flow
- **Section 6.6**: Telemetry payload formats (simple, timestamped, batch)
- **Section 11.1**: Data ingestion endpoint table (8 endpoints with auth types)
- **Section 11.11**: MQTT auth callback endpoints


> **Update (2026-03-27):** Phase 2 Digital FMS completed. Filter operations use HTTP endpoints (POST /api/filters/:id/start-cycle, advance, submit-checklist, bypass). Total system: 34 API modules, 57 Prisma models, 4 notification channels (Email, SMS, Telegram, Slack).


---

## Phase 3 Update (2026-04-07)

**RFID & Offline Operations:**
- RFID Scanner Android app (`rfid_scan_app/`) for KC-series UHF readers
- RFID keyboard guard prevents UKB tag input leaking into random fields
- Offline cleaning operations via IndexedDB queue + sync engine
- Cached identifier→filter map for offline RFID lookup
- "Data Synced" indicator in mobile header
- One identifier per entity (backend-enforced)
- Responsive layout with collapsible sidebar
- Error popups replace inline banners
- User creation auto-assigns org for admins
- `/api/roles/active` public endpoint for contact-admin page

See `CHANGELOG.md` for full details.
