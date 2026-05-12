# Backend — Quick Tour

**Location:** `apps/api/`
**Tech:** Fastify 5.2 + TypeScript (ESM, `"type": "module"`), Prisma 6.3 (PostgreSQL 18), raw `pg` pool (TimescaleDB), graphile-worker on Postgres for the job queue (Phase 2 of windows-friendly-rewrite swapped from BullMQ + ioredis; commit `7832af1`), Mosquitto 2.0 for MQTT (Phase 1 swapped from EMQX), `puppeteer-core` 24.42 + Microsoft Edge + `@napi-rs/canvas` for PDF reports (Phase 3 swapped from `puppeteer` + `chartjs-node-canvas`), `jose` 6 for JWT, `ldapts` 8.1 for LDAP. Memurai/Redis is **optional** — used only for non-queue pub/sub (WebSocket events, RPC routing, pipeline tracer, debug recorder).
**Entry:** `apps/api/src/app.ts`
**Dev:** `cd apps/api && npm run dev` → `tsx watch src/app.ts`
**Build + run (prod-style local):** `npm run build` (tsc) → `node dist/app.js`. PM2 / EC2 are no longer in scope (removed in commit `251be95`).

## Directory map

```
apps/api/src/
├── app.ts                  Fastify bootstrap, plugin order, route registration
├── lib/                    Cross-cutting utilities (JWT, hash-chain, password, sanitize, errors, swagger, config-discovery, prisma, reauth-check, etc.)
├── plugins/                Fastify plugins (audit-logger, auth, rbac)
├── modules/                Feature modules (see MODULES.md)
├── transport/              MQTT client + handler + WS handler + MQTT auth HTTP routes
├── workers/                graphile-worker tasks (ingestion concurrency:10; maintenance via cron `pg_advisory_lock` leader election)
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
| `authPlugin` | `plugins/auth.ts` | JWT verification + user injection, public-path bypass, session/role caches; maintains `PUBLIC_GET_PATHS` allowlist |
| `rbacPlugin` | `plugins/rbac.ts` | `requirePermission(perm)` (single perm) AND `requireAnyPermission(...perms)` (granular toggle fallback for `FCP_* OR CHECKLIST_*`, `ASSET_* OR EG_*`, etc.); `enforceReauth(action, req, reply)` accepts `string \| string[]` |
| `auditLoggerPlugin` | `plugins/audit-logger.ts` | Hooks into mutations and writes audit rows (SHA-256 hash-chained per-org); applies `audit-templates.ts` so UUIDs don't leak in the audit UI |

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
| `idempotency.ts` | Offline-replay dedup via `x-client-op-id` header — checks `FilterEvent.attributes.clientOpId` for match; returns cached `current-state` on duplicate, so retries never produce duplicate cycles, double advances, or repeat checklist submissions |

## Workers (`src/workers/`)

- **`ingestion.worker.ts`** — consumes the graphile-worker `ingestion` task on Postgres; validates telemetry, pushes to TimescaleDB via the batcher in `@digilog/db`.
- **`maintenance.worker.ts`** — scheduled/periodic jobs (retention cleanup, PM-due computation, etc.).

Start/stop helpers (`startIngestionWorker`, `startMaintenanceWorker`) are invoked from `app.ts`.

## Transport (`src/transport/`)

- `mqtt-client.ts` — connects the API process to Mosquitto 2.0 (outbound + internal pub/sub). Phase 1 of windows-friendly-rewrite swapped from EMQX. Mode-flag `USE_MOSQUITTO=true` selects the new path; legacy EMQX path conditionally available for compatibility.
- `mqtt-handler.ts` — routes inbound device messages to the same ingestion pipeline as HTTP; enqueues via graphile-worker `addJob`.
- `mosquitto-acl-generator.ts` + `mosquitto-refresh-routes.ts` — translate active `DeviceCredential` rows into Mosquitto v2 dynamic-security JSON, exposed via `POST /api/internal/mqtt/refresh-acl` (Bearer-auth via `MOSQUITTO_REFRESH_TOKEN`).
- `mqtt-auth-routes.ts` — legacy EMQX webhook endpoints (`/api/internal/mqtt/auth`, `/acl`); conditionally registered when `USE_MOSQUITTO=false`. Slated for deletion in Phase 4 of the windows-friendly-rewrite.
- `ws-handler.ts` — WebSocket multiplex for entity updates; per-entity Redis pub/sub fan-out.

## Env vars (see `.env.example`)

| Group | Keys |
|---|---|
| App DB (Prisma) | `DATABASE_URL` |
| TimescaleDB | `TSDB_HOST`, `TSDB_PORT`, `TSDB_DATABASE`, `TSDB_USER`, `TSDB_PASSWORD`, `TSDB_POOL_MAX` |
| MQTT / Mosquitto | `MQTT_ENABLED`, `MQTT_BROKER_HOST`, `MQTT_BROKER_PORT`, `USE_MOSQUITTO`, `MOSQUITTO_ADMIN_PASSWORD`, `MOSQUITTO_REFRESH_TOKEN`, `MOSQUITTO_DYNSEC_PATH` (optional). Legacy EMQX vars (`EMQX_ADMIN_PASSWORD`, `MQTT_AUTH_CALLBACK_URL`) only when `USE_MOSQUITTO=false`. |
| Redis (optional, pub/sub only) | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` — queue moved to Postgres in Phase 2 |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| UNS | `UNS_ROOT_PREFIX`, `UNS_VERSION` |
| JWT | `JWT_SECRET`, `VERIFICATION_TOKEN_SECRET`, `JWT_EXPIRES_IN` |
| Server | `NODE_ENV`, `API_PORT`, `PORT` (read by `app.ts`), `API_HTTPS` (if `true`, loads `certs/server.{key,crt}`) |
| CORS | `CORS_ORIGIN`, `ALLOWED_ORIGINS` |
| Uploads | `UPLOAD_DIR`, `MAX_FILE_SIZE` |

## Build + run cheatsheet (local Windows)

```bash
# local dev (auto-reload)
cd apps/api && npm run dev

# prod-style local build
npx tsc -p apps/api/tsconfig.json   # outputs to apps/api/dist/
node apps/api/dist/app.js

# run tests
cd apps/api && npm test                          # all unit + e2e
cd apps/api && vitest run --testPathPattern=e2e  # e2e only

# package for distribution to a target Windows machine
powershell -ExecutionPolicy Bypass -File scripts/package-for-production.ps1
```

## Where to read next

- **`MODULES.md`** — every feature module, one paragraph each, with grep-grounded endpoint counts.
- **`API_ENDPOINTS.md`** — full endpoint list with HTTP verb, auth, and notes.
- **`ENV_SETUP.md`** — local dev setup steps (Windows-only — no EC2).
