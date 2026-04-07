# System Requirements

This page lists the hardware, software, and network requirements for running DigiLog.

---

## Hardware Requirements

### Minimum (Development / Testing)
| Resource | Requirement |
|----------|------------|
| CPU | 2 vCPUs |
| RAM | 4 GB |
| Storage | 20 GB SSD |
| Network | 100 Mbps |

### Recommended (Production)
| Resource | Requirement |
|----------|------------|
| CPU | 4+ vCPUs |
| RAM | 8+ GB |
| Storage | 50+ GB SSD (depends on telemetry volume) |
| Network | 1 Gbps |

---

## Software Requirements

| Component | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 20.x or later | API server runtime |
| **PostgreSQL** | 18.x (with TimescaleDB extension) | Primary database with time-series hypertables |
| **Redis** | 5.x or later | Message queue (BullMQ) and caching |
| **EMQX** | 5.x | MQTT broker (required for MQTT devices) |
| **Nginx** | 1.18+ | Reverse proxy and static file serving |
| **PM2** | 5.x | Process manager for production deployment |

### Build Tools
| Tool | Version | Purpose |
|------|---------|---------|
| **npm** | 10.x+ | Package management |
| **TypeScript** | 5.x | Language compiler |
| **Prisma** | 6.x | ORM and database migrations |
| **Vite** | 6.x | Frontend build tooling |
| **Turborepo** | Latest | Monorepo build orchestration |

### Windows Local Development
| Tool | Version | Purpose |
|------|---------|---------|
| **tsx** | Latest | TypeScript execution for API (replaces PM2 locally) |
| **Redis for Windows** | 5.x | Windows-compatible Redis build |
| **JDK** | 21 | Required for Android/Capacitor builds |
| **Android SDK** | Latest | Required for APK builds |

---

## Network Requirements

### Ports

| Port | Protocol | Service | Notes |
|------|----------|---------|-------|
| 80 | TCP | Nginx (HTTP) | Frontend + API proxy |
| 443 | TCP | Nginx (HTTPS) | Optional, requires TLS certificate |
| 3000 | TCP | Fastify API | Internal only (proxied by nginx) |
| 5432 | TCP | PostgreSQL | Internal only |
| 6379 | TCP | Redis | Internal only |
| 1883 | TCP | EMQX (MQTT) | Device connections |
| 8083 | TCP | EMQX (WebSocket) | MQTT over WebSocket |
| 8084 | TCP | EMQX (WSS) | MQTT over Secure WebSocket |
| 8883 | TCP | EMQX (MQTTS) | Secure device connections (optional) |
| 18083 | TCP | EMQX Dashboard | Admin UI for MQTT broker |

### Firewall Rules

For a production deployment, expose only:
- Port **80** (or **443** with TLS) -- for web interface and API
- Port **1883** (or **8883**) -- for MQTT device connections

All other ports should be accessible only from localhost or internal network.

---

## Browser Support

| Browser | Minimum Version |
|---------|----------------|
| Chrome | 90+ |
| Firefox | 90+ |
| Safari | 15+ |
| Edge | 90+ |

> **Note:** DigiLog uses modern JavaScript features (ES2022+). Internet Explorer is not supported.

---

## Database Details

| Database | Name | Purpose |
|----------|------|---------|
| PostgreSQL | `digilog_db` | Primary application database (57 Prisma models, 17 enums) |
| TimescaleDB | `digilog_tsdb` | Time-series telemetry data (hypertables with compression) |

> **Important:** The time-series database is `digilog_tsdb`, NOT `digilog_db`.

---

## Next Steps

- [What is DigiLog?](what-is-digilog.md) -- Platform overview and architecture
- [Hello World](hello-world.md) -- Create your first entity in 15 minutes

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
