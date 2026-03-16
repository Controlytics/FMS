# DigiLog API — CLAUDE.md

## Overview
Fastify backend serving the DigiLog REST API on port 3000. Managed by PM2 as `digilog-api`.

## Build & Deploy
```bash
cd /home/ubuntu/21cfrlogbook
npx tsc -p apps/api/tsconfig.json   # Compile TypeScript
pm2 restart digilog-api              # Restart server
```

## Key Paths
- Source: `apps/api/src/`
- Compiled: `apps/api/dist/`
- Entry: `apps/api/src/server.ts`
- Prisma schema: `apps/api/prisma/schema.prisma`
- Config definitions: `apps/api/src/modules/config/defs/` (23 files)
- Route modules: `apps/api/src/modules/` (27 route files)

## Architecture
- 27 route modules registered via `apps/api/src/modules/*/routes.ts`
- Config auto-discovery at startup via `lib/config-discovery.ts`
- Rule chain node registry: `modules/rule-chain/nodes/index.ts` (77 nodes)
- Input sanitization: `lib/sanitize.ts` (HTML stripping on all text inputs)
- JWT auth with 30-min refresh, session management, re-auth for sensitive ops

## Databases
- **digilog_db** (PostgreSQL via Prisma) — application data
- **digilog_tsdb** (TimescaleDB via pg pool) — time-series data

## Testing
```bash
cd apps/api && npx vitest run   # Run unit tests
```

## Environment
- PM2 env vars: TSDB_DATABASE=digilog_tsdb, PORT=3000
- Redis: localhost:6379
- EMQX: localhost:1883 (MQTT), 18083 (dashboard)
