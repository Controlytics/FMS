# DigiLog API — Backend

## Stack
Fastify 5, TypeScript, Prisma ORM, PostgreSQL 16, bcrypt, jose (JWT), Zod validation

## Directory Structure
- `src/app.ts` — Entry point, registers plugins and routes
- `src/plugins/` — Fastify plugins (auth, audit-logger, rbac)
- `src/modules/` — Feature modules (auth, users, config, hierarchy, templates, audit)
- `src/lib/` — Shared utilities (prisma client, JWT, password hashing, hash chain)
- `prisma/schema.prisma` — Database schema
- `prisma/seed.ts` — Seed script for default data

## Running
```bash
npm run dev          # tsx watch src/app.ts
npm run build        # tsc
```

## API Prefix
All routes under `/api/`. Auth on all routes except `/api/auth/login` and `/api/health`.

## Auth Flow
JWT token in `Authorization: Bearer <token>` header. Sessions stored in DB for invalidation support.

## Roles
SUPER_ADMIN (no audit), ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER

## Audit Trail
SHA-256 checksummed entries. SUPER_ADMIN actions are never logged. All other roles are logged for every mutation.
