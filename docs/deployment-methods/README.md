# DigiLog — Deployment Methods Guide

This folder contains detailed analysis of every deployment method evaluated for installing DigiLog on a client Windows Server for production use.

> **2026-04-29 status banner — windows-friendly-rewrite has changed the stack:** the install path that actually ships is now **Method A (Native Windows)** with **Mosquitto 2.0** instead of EMQX (Phase 1), **graphile-worker on Postgres** instead of BullMQ + Redis/Memurai (Phase 2), **`puppeteer-core` + Microsoft Edge + `@napi-rs/canvas`** instead of bundled `puppeteer` + `chartjs-node-canvas` (Phase 3), and **Fastify-direct on `:3000` (HTTPS via mkcert)** instead of a bundled Nginx + PM2 (Phase 4). The tables in this folder still describe the original evaluation matrix as a historical reference; **for the current install runbook refer to root `DEPLOY-WINDOWS.md` and `LOCAL_SETUP_WINDOWS.md`**, not the per-method files in this folder.

## Application Stack (current — 2026-04-29)

| Component | Technology | Port |
|---|---|---|
| Backend API + SPA | Node.js / Fastify (TypeScript), serves SPA + `/api/*` directly | 3000 (HTTPS via mkcert) |
| Primary Database | PostgreSQL 18 (also hosts the graphile-worker queue schema) | 5432 |
| Time-Series Database | TimescaleDB (PostgreSQL extension, `digilog_tsdb`) | 5432 |
| Job Queue | graphile-worker on PostgreSQL (no separate service) | — |
| MQTT Broker | Mosquitto 2.0 (Windows-native service) | 1883 |
| PDF / Charts | `puppeteer-core` + Microsoft Edge + `@napi-rs/canvas` | — |
| Pub/sub (optional) | Memurai / Redis ≥5 — non-queue only (WebSocket events, RPC, tracer, debug recorder) | 6379 |
| Reverse proxy | Optional / customer-choice — not bundled. Customers can add Nginx or IIS in front of Fastify if they want. | 80 / 443 |
| Process manager | None bundled today; NSSM stopgap in `DEPLOY-WINDOWS.md` § 7. Managed Windows-service launcher is Phase 5 of the windows-friendly-rewrite. | — |

## Application Stack (original evaluation — historical)

| Component | Technology | Port |
|---|---|---|
| Backend API | Node.js / Fastify (TypeScript) | 3000 |
| Frontend SPA | React (Vite build, static files) | 80/443 via Nginx |
| Primary Database | PostgreSQL 18 | 5432 |
| Time-Series Database | TimescaleDB (PostgreSQL extension) | 5432 |
| Job Queue / Cache | Redis (Memurai on Windows) | 6379 |
| MQTT Broker | EMQX 5.x | 1883 / 18083 |
| Reverse Proxy | Nginx | 80 / 443 |
| Process Manager | PM2 | — |

## Methods Evaluated

| File | Method | Recommendation |
|---|---|---|
| [method-a-native-windows.md](method-a-native-windows.md) | Native Windows Install | **RECOMMENDED** |
| [method-b-docker-compose.md](method-b-docker-compose.md) | Docker Compose on Windows | Good alternative |
| [method-c-wsl2-linux.md](method-c-wsl2-linux.md) | WSL2 + Native Linux Stack | Not recommended |
| [method-d-hybrid.md](method-d-hybrid.md) | Hybrid (Docker Infra + Native App) | Niche use case |
| [method-e-iis.md](method-e-iis.md) | IIS Instead of Nginx | Only if mandated |
| [method-f-cloud.md](method-f-cloud.md) | Cloud-Managed Services | Not for factories |
| [comparison.md](comparison.md) | Side-by-Side Comparison & Final Verdict | — |

## Quick Decision Tree

```
Is the client a factory with on-premises server?
├── YES → Does their IT team know Docker?
│         ├── YES → Method B (Docker Compose)
│         └── NO  → Method A (Native Windows) ← MOST CLIENTS
└── NO  → Is cloud hosting allowed?
          ├── YES → Method F (Cloud)
          └── NO  → Method A (Native Windows)

Does the client mandate IIS?
├── YES → Method E (IIS)
└── NO  → Stick with Nginx (Methods A/B)
```

## Architecture Diagram

```
┌─────────────── Client Windows Server ───────────────┐
│                                                       │
│  ┌─────────┐   ┌────────┐   ┌────────┐   ┌────────┐  │
│  │ Node 20+│   │Postgres│   │Memurai │   │ EMQX   │  │
│  │ API     │←──│ +Timsc │   │(Redis) │   │ MQTT   │  │
│  │ :3000   │   │:5432   │   │:6379   │   │:1883   │  │
│  └────┬────┘   └────────┘   └────────┘   └────────┘  │
│       │                                               │
│  ┌────┴────────────────────┐                          │
│  │  PM2 keeps API alive    │                          │
│  └─────────────────────────┘                          │
│                                                       │
│  ┌────────────────────────┐                           │
│  │  Nginx :80 :443        │  ← serves the SPA         │
│  │  static files + proxy  │    and proxies /api/* →   │
│  │                        │    https://localhost:3000  │
│  └────────────────────────┘                           │
└───────────────────────────────────────────────────────┘
                    ▲
                    │ https (LAN)
    ┌───────────────┴───────────────┐
    │ Tablets with DigiLog APK      │
    │ (rootCA.pem installed in      │
    │  system cert store)           │
    └───────────────────────────────┘
```
