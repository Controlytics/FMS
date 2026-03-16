# DigiLog — CLAUDE.md

## Project
DigiLog (21cfrlogbook) — IoT data logging platform with 21 CFR Part 11 compliance.

## Repository
- **Remote:** github.com/pankajexa/21cfrlogbook.git
- **Branch:** DataIngestion (active development)

## Monorepo Structure
```
apps/api/     — Fastify backend (TypeScript, port 3000, PM2)
apps/web/     — React frontend (Vite SPA, served by Nginx)
packages/shared/ — Shared types, schemas, constants
packages/db/     — TimescaleDB connection pool
packages/queue/  — BullMQ job queue
```

## EC2 Instance
- **IP:** 3.108.185.106 (may change on restart)
- **SSH:** `ssh -i ~/Downloads/21cfrbook.pem ubuntu@3.108.185.106`
- **Services:** Nginx (80/443), Fastify (3000), PostgreSQL (5432), EMQX (1883/18083), Redis (6379)

## Build Commands
```bash
# Backend
cd /home/ubuntu/21cfrlogbook
npx tsc -p apps/api/tsconfig.json && pm2 restart digilog-api

# Frontend
cd apps/web && npx vite build

# Shared packages
npx nx build shared && npx nx build db && npx nx build queue
```

## Default Login
- **Username:** superadmin
- **Password:** Admin@123

## Key URLs
- App: http://3.108.185.106
- Swagger: http://3.108.185.106/docs
- EMQX: http://3.108.185.106:18083

## Important Notes
- Always run `npx tsc` before `pm2 restart` (PM2 runs compiled JS)
- Frontend build output goes to `apps/web/dist/` (served by Nginx)
- TimescaleDB is `digilog_tsdb`, NOT `digilog_db`
- Input sanitization strips HTML from all text fields (lib/sanitize.ts)
- 77 rule chain node types across 8 categories
- 23 config definitions with auto-discovery
- 28 help articles with version history
