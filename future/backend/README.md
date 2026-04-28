# Backend — Quick Tour

**Location:** `apps/api/`
**Tech:** Fastify 5 + TypeScript (ESM, `"type": "module"`), Prisma 6 (PostgreSQL), raw `pg` pool (TimescaleDB), BullMQ + Redis, EMQX/MQTT, Puppeteer for PDF.
**Entry:** `apps/api/src/app.ts`
**Dev:** `cd apps/api && npm run dev` → `tsx watch src/app.ts`
**Build + run:** `npm run build` (tsc) → `node dist/app.js` (PM2 uses this path in production)

## Directory map

```
apps/api/src/
├── app.ts                  Fastify bootstrap, plugin order, route registration
├── lib/                    Cross-cutting utilities (JWT, hash-chain, password, sanitize, errors, swagger, config-discovery, prisma, reauth-check, etc.)
├── plugins/                Fastify plugins (audit-logger, auth, rbac)
├── modules/                Feature modules (see MODULES.md)
├── transport/              MQTT client + handler + WS handler + MQTT auth HTTP routes
├── workers/                BullMQ workers (ingestion, maintenance)
├── e2e/                    Vitest integration tests hitting a real DB
└── types/                  Ambient typings
```

## Request lifecycle

1. **Top-level plugins** (order matters — see `app.ts` lines ~100–135):
   - CORS, Helmet, rate-limit (500 req/min), multipart, static, websocket, Swagger UI.
   - `auditLoggerPlugin` — logs mutation endpoints into the audit table.
   - `authPlugin` — `onRequest` hook that verifies the JWT (skipped for `PUBLIC_PATHS`), caches session config (1 min) and role scope (5 s). Populates `req.user` with a `JwtPayload`.
   - `rbacPlugin` — provides helpers for route-level permission checks.
2. **Route modules** registered under `/api/...` prefixes.
3. **Device-token routes** (`/api/data/telemetry`, etc.) do their own `preHandler` token check — bypass the JWT.
4. **WebSocket** (`/api/ws`) authenticates via the first client message, not the HTTP upgrade headers.

## Public paths (no JWT)

Defined in `plugins/auth.ts`:

- Always public: `/api/auth/login`, `/api/auth/forgot-password`, `/api/auth/beacon-logout`, `/api/health`, `/api/internal/mqtt`, `/api/ws`, `/api/notification-settings/email/oauth2/code`, `/api/data/*` (device token).
- Dev-only public: `/docs`, `/docs/` (Swagger UI — hidden in production).
- `GET`-only public: `/api/config/branding`, `/api/config/datetime/current`, `/uploads/photos/`, `/uploads/branding/`, `/api/roles/active`, `/api/admin-requests/user-lookup`.
- `/api/config/password-policy/current`, `/api/config/report-settings/current`, `/api/config/pagination/current` are marked public inside their own route definitions.

## Key plugins

| Plugin | File | Role |
|---|---|---|
| `authPlugin` | `plugins/auth.ts` | JWT verification + user injection, public-path bypass, session/role caches |
| `rbacPlugin` | `plugins/rbac.ts` | Per-route permission gating via Fastify decorators |
| `auditLoggerPlugin` | `plugins/audit-logger.ts` | Hooks into mutations and writes audit rows (hash-chained) |

## Cross-cutting libs (`src/lib/`)

| File | Purpose |
|---|---|
| `prisma.ts` | Singleton `PrismaClient` |
| `jwt.ts` | Sign/verify JWTs via `jose` |
| `password.ts` + `password-validator.ts` | Hash/verify, policy enforcement |
| `hash-chain.ts` | 21 CFR audit integrity chain |
| `reauth-check.ts` | Re-authentication gate for sensitive actions |
| `sanitize.ts` | Strips HTML from text fields (uses `sanitize-html`) |
| `config-discovery.ts` + `config-registry.ts` | Auto-register config modules that expose `moduleKey` + Zod schema |
| `swagger.ts` | Registers `@fastify/swagger` + `@fastify/swagger-ui` (UI at `/docs`) |
| `errors.ts` + `error-schemas.ts` | `AppError` class + Fastify error schema helpers |
| `build-context.ts`, `uns-path.ts`, `org-scope.ts`, `user-id-validator.ts`, `audit.ts` | Context helpers reused across modules |

## Workers (`src/workers/`)

- **`ingestion.worker.ts`** — consumes the BullMQ `ingestion` queue; validates telemetry, pushes to TimescaleDB via the batcher in `@digilog/db`.
- **`maintenance.worker.ts`** — scheduled/periodic jobs (retention cleanup, PM-due computation, etc.).

Start/stop helpers (`startIngestionWorker`, `startMaintenanceWorker`) are invoked from `app.ts`.

## Transport (`src/transport/`)

- `mqtt-client.ts` — connects the API process to EMQX (outbound and internal pub/sub).
- `mqtt-handler.ts` — routes inbound device messages to the same ingestion pipeline as HTTP.
- `mqtt-auth-routes.ts` — EMQX webhook endpoints (`/api/internal/mqtt/*`) for auth + ACL.
- `ws-handler.ts` — WebSocket multiplex for entity updates; per-entity Redis pub/sub fan-out.

## Env vars (see `.env.example`)

| Group | Keys |
|---|---|
| App DB (Prisma) | `DATABASE_URL` |
| TimescaleDB | `TSDB_HOST`, `TSDB_PORT`, `TSDB_DATABASE`, `TSDB_USER`, `TSDB_PASSWORD`, `TSDB_POOL_MAX` |
| MQTT / EMQX | `MQTT_ENABLED`, `MQTT_BROKER_HOST`, `MQTT_BROKER_PORT`, `MQTT_BROKER_TLS_PORT`, `MQTT_BROKER_WS_PORT`, `MQTT_BROKER_WSS_PORT`, `MQTT_AUTH_CALLBACK_URL`, `EMQX_ADMIN_PASSWORD` |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| UNS | `UNS_ROOT_PREFIX`, `UNS_VERSION` |
| JWT | `JWT_SECRET`, `VERIFICATION_TOKEN_SECRET`, `JWT_EXPIRES_IN` |
| Server | `NODE_ENV`, `API_PORT`, `PORT` (read by `app.ts`), `API_HTTPS` (if `true`, loads `certs/server.{key,crt}`) |
| CORS | `CORS_ORIGIN`, `ALLOWED_ORIGINS` |
| Uploads | `UPLOAD_DIR`, `MAX_FILE_SIZE` |

## Build + deploy cheatsheet

```bash
# local dev
cd apps/api && npm run dev

# compile for PM2
cd /home/ubuntu/21cfrlogbook
npx tsc -p apps/api/tsconfig.json
pm2 restart digilog-api

# run tests
cd apps/api && npm test         # all unit + e2e
vitest run --testPathPattern=e2e # e2e only
```

## Where to read next

- **`MODULES.md`** — every feature module, one paragraph each.
- **`API_ENDPOINTS.md`** — full endpoint list with HTTP verb and intent.
- **`ENV_SETUP.md`** — local dev + EC2 setup steps.
