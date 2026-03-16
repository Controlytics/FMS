# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

DigiLog is an IoT data logging platform designed for regulated industries requiring **21 CFR Part 11** compliance. It provides real-time data ingestion, visual rule chain processing, alarm management, and digital checklists with electronic signatures.

## Features

- **Entity Management** — Hierarchical asset/equipment modeling with templates, relationships (12 types), and identifiers (QR/RFID/NFC)
- **Rule Chain Engine** — Visual DAG-based data processing with 77 built-in node types across 8 categories (Filter, Enrichment, Transform, Action, External, Flow, Analytics)
- **Data Ingestion** — MQTT (via EMQX) and HTTP ingestion with rate limiting, IP allowlists, and schema validation
- **Alarm System** — Threshold, rate-of-change, and absence alarms with lifecycle management and electronic signature acknowledgment
- **Unified Namespace (UNS)** — ISA-95 hierarchical topic structure with MQTT wildcard support
- **Digital Checklists** — Mobile-friendly inspection forms with 14 field types, photo capture, and 3-step approval workflow
- **Audit Trail** — Tamper-evident SHA-256 hash-chain audit log with before/after snapshots
- **Notifications** — Multi-channel alerts (in-app, email via SMTP/OAuth2, SMS via AWS SNS/Twilio)
- **Data Retention** — Configurable per-table retention with TimescaleDB compression
- **Backup & Restore** — Full database export (JSON/SQL/CSV) with SHA-256 integrity verification
- **Role-Based Access Control** — 6 hierarchical roles with 22+ granular permissions
- **Help Articles** — Versioned in-app documentation with 28 articles across 8 categories

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Fastify (Node.js/TypeScript) |
| Frontend | React + Vite SPA (TypeScript) |
| Database | PostgreSQL + TimescaleDB |
| MQTT Broker | EMQX |
| Cache/Queue | Redis + BullMQ |
| Process Manager | PM2 |
| Reverse Proxy | Nginx |

## Quick Start

```bash
# Clone and install
git clone https://github.com/pankajexa/21cfrlogbook.git
cd 21cfrlogbook
npm install

# Build shared packages
npx nx build shared
npx nx build db
npx nx build queue

# Setup databases
createdb digilog_db
createdb digilog_tsdb
npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
npx prisma db seed --schema=apps/api/prisma/schema.prisma

# Build and start
cd apps/api && npx tsc && cd ../..
cd apps/web && npx vite build && cd ../..
pm2 start apps/api/dist/server.js --name digilog-api
```

## Default Login

- **Username:** `superadmin`
- **Password:** `Admin@123`

## API Documentation

Interactive Swagger UI available at `/docs` when the server is running.

## Project Structure

```
21cfrlogbook/
├── apps/
│   ├── api/          # Fastify backend (27 route modules)
│   └── web/          # React frontend (Vite SPA)
├── packages/
│   ├── shared/       # Shared types, schemas, constants
│   ├── db/           # TimescaleDB connection pool
│   └── queue/        # BullMQ job queue
├── docs/             # Project documentation
└── tests/            # Manual test cases & execution guides
```

## License

Proprietary — Pankaj Exa Technologies
