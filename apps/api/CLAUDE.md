# DigiLog API — Backend

## Stack
Fastify 5, TypeScript, Prisma ORM, PostgreSQL 16, bcrypt, jose (JWT), Zod validation

## Directory Structure
- `src/app.ts` — Entry point, registers plugins and routes
- `src/plugins/` — Fastify plugins (auth, audit-logger, rbac)
- `src/modules/` — Feature modules (auth, users, config, hierarchy, templates, audit, backup, notifications, roles, uploads)
- `src/lib/` — Shared utilities (prisma client, JWT, password hashing, hash chain, error schemas, reauth, user-id validator, swagger)
- `prisma/schema.prisma` — Database schema
- `prisma/seed.ts` — Seed script for default data

## Running
```bash
npm run dev          # tsx watch src/app.ts
npm run build        # tsc
```

## API Prefix
All routes under `/api/`. Auth on all routes except `/api/auth/login`, `/api/auth/forgot-password`, `/api/config/branding`, `/api/health`, and `/docs`.

## Swagger
Swagger UI available at `/docs`. Auto-generated from route schemas.

## Auth Flow
JWT token in `Authorization: Bearer <token>` header. Sessions stored in DB for invalidation support.

## Roles
Dynamic roles stored in DB. Default: SUPER_ADMIN (no audit), ADMIN, SUPERVISOR, MAINTENANCE, OPERATOR, VIEWER.

## Audit Trail
SHA-256 checksummed entries. SUPER_ADMIN actions are never logged. All other roles are logged for every mutation.

## Route Schema Pattern
All routes with error responses MUST include `...errorResponses` in their schema `response` object (imported from `src/lib/error-schemas.ts`). Without this, Fastify 5's TypeScript types reject `reply.code(400)` etc.

## Performance Notes
- Use SQL queries for aggregate operations (MAX, COUNT) instead of fetching all rows
- Batch-fetch related records with `findMany` + `IN (...)` instead of N+1 loops
- All major tables have indexes (see `prisma/schema.prisma` for `@@index` declarations)
