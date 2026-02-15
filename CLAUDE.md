# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

## Overview
DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. Phase 1 covers User Management and Asset Management.

## Monorepo Structure
- `apps/api` — Fastify backend (port 3000)
- `apps/web` — React frontend (port 5173)
- `packages/shared` — Zod schemas + TypeScript types shared across apps

## Tech Stack
Turborepo, Fastify 5, React 19, Vite, Tailwind CSS 4, Prisma ORM, PostgreSQL 16 (ltree + pgcrypto), bcrypt, jose (JWT), Zod, SWR

## Quick Start
```bash
docker compose up -d          # Start PostgreSQL
npm install                   # Install all deps
npm run db:migrate            # Run Prisma migrations
npm run db:seed               # Seed default admin + configs
npm run dev                   # Start API + Web
```

## Default Login
- Username: `admin`
- Password: `Admin@123`
- Will force password change on first login

## Key Commands
- `npm run dev` — start all apps in dev mode
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed default data
- `npm run db:studio` — open Prisma Studio

## Environment
All env vars in root `.env` file. See `.env.example` for reference.

## Post-Change Checklist
After making code changes, always update the following:
1. **CHANGELOG.md** — Add entries under the current version for all new features, bug fixes, backend/frontend/shared changes
2. **API_GUIDE.md** — Document any new or modified API endpoints with method, path, request body, response, query params, and errors
3. **Swagger compatibility** — Every new API route MUST include full `schema` definitions (`body`, `params`, `querystring`) using Zod schemas from `@digilog/shared` so they appear in Swagger UI at `/api/docs`
