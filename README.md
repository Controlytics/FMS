# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

A regulatory-compliant digital logbook for pharmaceutical, biotechnology, food manufacturing, and medical device industries. Replaces paper-based logbooks with a secure, auditable, and configurable digital platform.

## Key Features

- **Template-Based Entity Management** — Configurable entity blueprints with typed attributes, telemetry, checklists (14 question types), alarm rules, and status lifecycles
- **Hierarchical Relationships** — 12 bidirectional relationship types with cycle detection and connection limits
- **Role-Based Access Control** — Dynamic roles with 39+ granular permissions and 10 permission categories
- **Tamper-Evident Audit Trail** — SHA-256 checksummed records with configurable templates (60+ actions)
- **Data Ingestion Pipeline** — HTTP/MQTT/WebSocket ingestion with BullMQ workers, normalizer, DLQ, and connectivity tracking
- **Rule Chain Engine** — 48 node types across 9 categories with sandboxed VM execution, sub-chain delegation, and visual editor
- **Alarm Management** — 7 alarm rule types, 3 severity levels, deduplication, role-based column visibility
- **Unified Namespace (UNS)** — ISA-95 path hierarchy with cascade moves and wildcard search
- **21 CFR Part 11 & ALCOA+ Compliance** — Electronic records, audit trails, access controls, password policies
- **Modular Config Registry** — Self-registering configuration modules with auto-discovery and dynamic UI generation
- **Dynamic Field ID Configuration** — 39 configurable field display names across 7 modules (User Management, Audit Trail, Alarms, Asset Management, Notifications, Telemetry, Attributes)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | Turborepo |
| Backend | Fastify 5, TypeScript, Prisma 6, PostgreSQL 16, TimescaleDB |
| Frontend | React 19, Vite 6, Tailwind CSS 4, SWR, React Hook Form, React Flow |
| Queue | BullMQ, Redis |
| Messaging | MQTT (EMQX), WebSocket |
| Validation | Zod (shared schemas) |
| Auth | jose (JWT), bcrypt |
| CI/CD | GitHub Actions |

## Monorepo Structure

```
21cfrlogbook/
├── apps/
│   ├── api/          # Fastify backend (port 3000)
│   └── web/          # React frontend (port 5173 dev)
├── packages/
│   ├── shared/       # Zod schemas + TypeScript types
│   ├── db/           # Prisma client + TimescaleDB pool
│   └── queue/        # BullMQ queue definitions
├── docker-compose.yml
└── turbo.json
```

## Quick Start

```bash
# Prerequisites: Docker, Node.js 20+
docker compose up -d          # Start PostgreSQL, TimescaleDB, Redis, EMQX
npm install                   # Install all dependencies
npm run db:migrate            # Run Prisma migrations
npm run db:seed               # Seed default admin + configs
npm run dev                   # Start API + Web dev servers
```

**Default Login:** `superadmin` / `Admin@123`

## Metrics

| Metric | Count |
|--------|-------|
| API Endpoints | ~145+ |
| Frontend Pages | 34+ |
| Database Models | 30 (Prisma) |
| Permissions | 39+ |
| Test Suite | 1,344 tests (0 failures) |
| Rule Chain Node Types | 48 |
| TimescaleDB Hypertables | 7 |
| System Health Score | 87/100 |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Codebase overview, endpoints, architecture |
| [PLAN.md](PLAN.md) | Master development plan |
| [CHANGELOG.md](CHANGELOG.md) | Version history and change details |
| [API_GUIDE.md](API_GUIDE.md) | API endpoint reference with examples |
| [BUSINESS_CONTEXT.md](BUSINESS_CONTEXT.md) | Business context, regulatory compliance |
| [CODEBASE_CONTEXT.md](CODEBASE_CONTEXT.md) | Technical architecture reference |
| [SESSION_RESUME.md](SESSION_RESUME.md) | Session resume point and phase status |
| [tasks/system-validation-report.md](tasks/system-validation-report.md) | Full system validation report (87/100 health) |

## Current Status (2026-03-12)

| Item | Status |
|------|--------|
| System Health Score | 87/100 |
| Open Bugs | 7 (2 High, 3 Medium, 2 Low) |
| Last Validation | 2026-03-09 — Full E2E + API + DB + Performance |
| Next Priority | Fix route ordering bugs (BUG-V003/V004), TimescaleDB write gap (BUG-V002) |

## Recent Changes (2026-03-12)

| Change | Description |
|--------|-------------|
| Config Registry | Self-registering config module architecture — add new configs by creating a single definition file |
| Field ID Names | Expanded from 6 to 39 fields across 7 modules with color-coded module tabs, search, and filter |
| Dynamic Config Pages | Auto-generated UI for config modules without custom pages |
| Config Module Count | 23+ config modules managed via registry pattern |

## Production Deployment

- **EC2:** t3.large, Ubuntu 24.04.3 LTS
- **URL:** http://3.108.185.106 (nginx + PM2)
- **Swagger:** http://3.108.185.106/docs
- **EMQX Dashboard:** http://3.108.185.106/emqx/

## License

Proprietary. All rights reserved.
