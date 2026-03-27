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
| **PostgreSQL** | 16.x or later | Primary database (with TimescaleDB extension for hypertables) |
| **Redis** | 7.x or later | Message queue (BullMQ) and caching |
| **EMQX** | 5.x | MQTT broker (optional, required for MQTT devices) |
| **Nginx** | 1.18+ | Reverse proxy and static file serving |
| **PM2** | 5.x | Process manager for production deployment |

### Build Tools
| Tool | Version | Purpose |
|------|---------|---------|
| **npm** | 10.x+ | Package management |
| **TypeScript** | 5.x | Language compiler |
| **Turborepo** | Latest | Monorepo build orchestration |

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
- Port **80** (or **443** with TLS) — for web interface and API
- Port **1883** (or **8883**) — for MQTT device connections

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

## Next Steps

- [What is DigiLog?](what-is-digilog.md) — Platform overview and architecture
- [Hello World](hello-world.md) — Create your first entity in 15 minutes


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
