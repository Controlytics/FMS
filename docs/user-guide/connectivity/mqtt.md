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
