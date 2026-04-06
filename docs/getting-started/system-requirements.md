# System Requirements

## Server (Production — EC2)
- **OS:** Ubuntu 20.04+ (tested on Ubuntu 22.04)
- **CPU:** 2+ cores (t3.large recommended for production)
- **RAM:** 4GB minimum, 8GB recommended
- **Disk:** 20GB+ (depends on data volume)
- **EC2 IP:** 34.232.224.0 (may change on restart)

## Software Dependencies
| Component | Version | Purpose |
|-----------|---------|---------|
| Node.js | 20.x | Application runtime |
| PostgreSQL | 18 | Primary database (Prisma ORM, 57 models, 17 enums) |
| TimescaleDB | 2.x | Time-series extension (database: digilog_tsdb) |
| Redis | 5 | Cache and job queue (BullMQ) |
| EMQX | 5.x | MQTT broker |
| Nginx | 1.18+ | Reverse proxy |
| PM2 | 5.x | Process manager (production) |
| Prisma | Latest | ORM for PostgreSQL |

## Local Development (Windows)
| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20.x | Application runtime |
| PostgreSQL | 18 | Primary database |
| Redis | 5 | Via Redis for Windows or WSL |
| EMQX | 5.x | MQTT broker |
| tsx | Latest | API dev server (replaces PM2 locally) |
| Vite | Latest | Frontend dev server |

## Monorepo Structure
```
apps/api/     — Fastify backend (TypeScript, port 3000)
apps/web/     — React frontend (Vite SPA, Tailwind CSS)
packages/shared/ — Shared types, schemas, constants
packages/db/     — TimescaleDB connection pool
packages/queue/  — BullMQ job queue
```

## Ports
| Port | Service | Required |
|------|---------|----------|
| 80 | Nginx (HTTP) | Yes (production) |
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
- Light theme only (bg-white, text-slate-800) across all pages
