# DigiLog — 21 CFR Part 11 Compliant Digital Logbook

## Overview
DigiLog is a regulatory-compliant digital logbook for pharma/biotech/food manufacturing. Phase 1 covers User Management and Asset Management.

## Monorepo Structure
- `apps/api` — Fastify backend (port 3000)
- `apps/web` — React frontend (port 5173 dev, port 80 production via nginx)
- `packages/shared` — Zod schemas + TypeScript types shared across apps

## Tech Stack
Turborepo, Fastify 5, React 19, Vite, Tailwind CSS 4, Prisma ORM, PostgreSQL 16 (ltree + pgcrypto), bcrypt, jose (JWT), Zod, SWR

## Production Deployment
- **App URL:** http://43.205.32.23 (port 80 via nginx)
- **API:** PM2 process `digilog-api` on port 3000
- **Swagger UI:** http://43.205.32.23/docs
- **Database:** `digilog_db` on PostgreSQL 5432
- **nginx config:** `/etc/nginx/sites-available/digilog`
- **PM2 ecosystem:** `/home/ubuntu/ecosystem.config.cjs`

### Dual-App Server
This server also runs the User Management app:
- User Management at http://43.205.32.23:5175/ (PM2 process `usermgmt-api` on port 3001)
- nginx config: `/etc/nginx/sites-available/usermgmt`
- Database: `usermgmt_db`

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

## Roles
Dynamic roles stored in DB. Default: SUPER_ADMIN, ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER. Roles have name, displayName, color, hierarchyLevel, permissions, isSystem, isActive fields. All roles (including system) can be deleted. Frontend fetches roles from `/api/roles/active` via SWR (sidebar.tsx, role-privileges.tsx).

## Key Commands
- `npm run dev` — start all apps in dev mode
- `npm run db:migrate` — run Prisma migrations
- `npm run db:seed` — seed default data
- `npm run db:studio` — open Prisma Studio
- `pm2 restart digilog-api` — restart production API
- `sudo systemctl restart nginx` — restart nginx

## Environment
All env vars in root `.env` file. See `.env.example` for reference.
