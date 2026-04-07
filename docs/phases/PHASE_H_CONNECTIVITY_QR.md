# Phase H: Connectivity & QR Code (3-4 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07. Phase 2 Digital FMS completed 2026-03-27.
> Connectivity indicators, connectivity tab (status, tokens, code snippets in 5 languages, connection test, live message log, history graph), connectivity API (6 endpoints), QR code system (4 endpoints) all operational. QR scan also used for filter identification in Phase 2.

## Prompt for Claude Code

```
You are implementing Phase H (Connectivity & QR Code) of DigiLog's Data Ingestion & Integration Layer.

Phases A-G are complete. The full pipeline and rule chain editor are working. Now you build the connectivity management UI (device status monitoring, connection testing, code snippets) and QR code system (for quick entity access via mobile scanning).

IMPORTANT RULES:
- Master spec: DATA_INGESTION_REQUIREMENTS_v3.md
- Connectivity indicator is a colored dot on every entity in the asset tree
- Code snippets support: Python (paho-mqtt), Node.js (mqtt.js), cURL, Arduino, ESP32
- QR codes contain URLs that deep-link to entity pages (checklist, dashboard)
- QR generation uses qrcode library (backend) and qrcode.react (frontend)
- Token management: generate, revoke, regenerate device access tokens

WHAT TO BUILD:

1. CONNECTIVITY INDICATOR (apps/web/src/components/connectivity/connectivity-indicator.tsx):
   - Small colored dot next to entity name in asset tree and entity header
   - Green = ONLINE (received data within inactivity timeout)
   - Red = OFFLINE (no data beyond inactivity timeout)
   - Gray = NEVER_CONNECTED (token created but never used)
   - Yellow = INACTIVE (connected but no data recently)
   - Tooltip: last seen time, protocol (MQTT/HTTP), source IP
   - Real-time updates via WebSocket subscription

2. CONNECTIVITY TAB (apps/web/src/components/connectivity/connectivity-tab.tsx):
   New tab on entity detail page:

   A. STATUS SECTION:
   - Current status (ONLINE/OFFLINE/NEVER_CONNECTED) with large indicator
   - Last activity: timestamp + "X minutes ago"
   - Protocol: MQTT or HTTP
   - Source IP
   - Connection duration (if MQTT connected)
   - First connected at (first-use activation timestamp)

   B. TOKEN MANAGEMENT:
   - Current token (masked: ****...last4)
   - Copy token button (shows full token once)
   - Regenerate token (requires reauth, revokes old token, audit trail)
   - Token status: ACTIVE / REVOKED / EXPIRED
   - IP allowlist editor (add/remove allowed IPs, CIDR support)
   - Rate limit display (from DeviceCredential.maxDataRatePerMin)

   C. CODE SNIPPETS (apps/web/src/components/connectivity/code-snippet.tsx):
   - Tab selector: Python, Node.js, cURL, Arduino, ESP32
   - Pre-filled with entity's actual token, topic paths, and server URL
   - Copy to clipboard button
   - Python snippet uses paho-mqtt, publishes telemetry JSON
   - Node.js snippet uses mqtt.js
   - cURL shows HTTP POST to /api/data/telemetry
   - Arduino/ESP32 use PubSubClient with WiFi setup

   D. CONNECTION TEST (in-browser):
   - "Test Connection" button
   - Sends HTTP POST /api/data/telemetry with a test payload {test: true, ts: now}
   - Shows result: success (green check) or failure (red X with error message)
   - Option: "Send via MQTT" (uses browser MQTT over WebSocket to EMQX)

   E. LIVE MESSAGE LOG (apps/web/src/components/connectivity/message-log.tsx):
   - Real-time stream of messages from this entity (via WebSocket)
   - Each row: timestamp, message type, payload preview, pipeline status
   - Click to expand full payload JSON
   - Pause/resume button
   - Filter by message type
   - Max 100 messages (ring buffer in frontend)

   F. CONNECTION HISTORY GRAPH:
   - Time series chart (recharts) showing online/offline periods over last 24h/7d/30d
   - Data from ts_device_events (CONNECTION, DISCONNECTION events)
   - Uptime percentage calculation

3. CONNECTIVITY API (apps/api/src/modules/connectivity/routes.ts):
   GET    /api/connectivity/:entityId         — Current status
   POST   /api/connectivity/:entityId/test    — Test connection (send test message)
   GET    /api/connectivity/:entityId/snippets — Code snippets with entity-specific values
   GET    /api/connectivity/:entityId/token   — Token info (masked)
   POST   /api/connectivity/:entityId/token   — Generate new token (reauth required)
   DELETE /api/connectivity/:entityId/token   — Revoke token (reauth required)

4. QR CODE SYSTEM:

   Backend (apps/api/src/modules/qr-code/routes.ts):
   POST /api/qr/:entityId/generate  — Generate QR, store in QrCode table
   GET  /api/qr/:entityId           — Get QR metadata (URL encoded, target page)
   GET  /api/qr/:entityId/image     — QR as PNG image (Content-Type: image/png)
   GET  /api/qr/:entityId/svg       — QR as SVG

   QR URL format: https://{host}/m/{entityId}?action=checklist (or dashboard, history)
   QR data stored: entityId, qrType (checklist|dashboard|history), generatedBy, generatedAt

   Frontend (apps/web/src/components/entity/qr-code-generator.tsx):
   - Generate QR button on entity detail page
   - Options: target page (checklist, dashboard, history), size
   - Preview: rendered QR code
   - Download: PNG or SVG
   - Print: formatted label with entity name + QR

5. TOKEN STATUS BADGE (apps/web/src/components/connectivity/token-status-badge.tsx):
   - Shows on entity cards in asset grid view
   - ACTIVE (green), NEVER_USED (gray), REVOKED (red)
   - Compact badge, works at small sizes

VERIFICATION:
- Entity with active device → green dot in asset tree, connectivity tab shows ONLINE
- Copy Python snippet → run externally → data appears in live message log
- Regenerate token → old token stops working → new token works
- Test connection button → sends test telemetry → success indicator
- Generate QR → scan with phone → opens entity checklist page
- Device disconnects → red dot within inactivity timeout + DISCONNECTION event logged
```

## Relevant Spec Sections

- **Section 9.1**: Connectivity management (status states, indicators)
- **Section 9.2**: Code snippets (all 5 languages with templates)
- **Section 9.3**: Connection testing (HTTP and MQTT browser test)
- **Section 9.4**: Live message log (WebSocket streaming)
- **Section 9.5**: QR code system (generation, URL format, target pages)
- **Section 11.6**: Connectivity API endpoints
- **Section 11.8**: QR code API endpoints
- **Section 13.3**: Connectivity tab UI spec
- **Section 13.4**: QR code UI spec
- **Section 14.2**: Frontend file structure (connectivity, entity components)


> **Update (2026-03-27):** Phase 2 Digital FMS completed. QR/barcode scanning used for filter identification during cleaning operations. Real-time filter status tracking integrates with connectivity status indicators.


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
