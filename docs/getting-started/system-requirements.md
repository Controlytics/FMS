# System Requirements

## Server
- **OS:** Ubuntu 20.04+ (tested on Ubuntu 22.04)
- **CPU:** 2+ cores (t3.large recommended for production)
- **RAM:** 4GB minimum, 8GB recommended
- **Disk:** 20GB+ (depends on data volume)

## Software Dependencies
| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20.x | Application runtime |
| PostgreSQL | 15+ | Primary database |
| TimescaleDB | 2.x | Time-series extension |
| Redis | 7+ | Cache and job queue |
| EMQX | 5.x | MQTT broker |
| Nginx | 1.18+ | Reverse proxy |
| PM2 | 5.x | Process manager |

## Ports
| Port | Service | Required |
|------|---------|----------|
| 80 | Nginx (HTTP) | Yes |
| 443 | Nginx (HTTPS) | Optional |
| 3000 | Fastify API | Internal |
| 5432 | PostgreSQL | Internal |
| 6379 | Redis | Internal |
| 1883 | MQTT (TCP) | For devices |
| 8883 | MQTT (TLS) | For devices (secure) |
| 8083 | MQTT (WebSocket) | Optional |
| 18083 | EMQX Dashboard | Optional |

## Browser Support
- Chrome 90+, Firefox 90+, Safari 15+, Edge 90+
- Mobile: iOS Safari 15+, Android Chrome 90+


---

> **Phase 2 Update (2026-03-27):** Digital Filter Management System added to DigiLog. Includes filter cleaning lifecycle management with 8 stages, visual pipeline editor, checklist gates, PM scheduling, and full 21 CFR Part 11 compliance. See CHANGELOG.md and README.md for details.
