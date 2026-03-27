# Phase A: Infrastructure Setup (3-4 days)

> **STATUS: COMPLETE** -- Deployed to production on 2026-03-07.
> Docker Compose (PostgreSQL, TimescaleDB, EMQX, Redis), Prisma schema (30 models), BullMQ queues, SystemConfig seeded, 7 TimescaleDB hypertables operational.

## Prompt for Claude Code

```
You are implementing Phase A (Infrastructure) of DigiLog's Data Ingestion & Integration Layer.

DigiLog is a 21 CFR Part 11 compliant digital logbook for regulated industries (pharma, biotech). This phase sets up the foundation — databases, message queues, schemas, permissions, and configuration — that all subsequent phases build on.

IMPORTANT RULES:
- The master requirements document is at: DATA_INGESTION_REQUIREMENTS_v3.md — always refer to it as source of truth
- This is an existing Fastify + Prisma + PostgreSQL monorepo (apps/api + apps/web)
- Do NOT build any API endpoints or business logic yet — this phase is infrastructure only
- All TimescaleDB compliance hypertables must have REVOKE UPDATE, DELETE
- ts_pipeline_traces is a debug table (exempt from REVOKE — it has a retention policy)
- Follow the file structure exactly as specified
- Use the exact Prisma model names, field names, and types specified

WHAT TO BUILD:

1. DOCKER COMPOSE (5 services):
   - db: postgres:16 on port 5432 (Prisma — lifecycle data)
   - tsdb: timescale/timescaledb:latest-pg16 on port 5433 (time-series — separate instance)
   - emqx: emqx/emqx:5-elixir with HTTP auth/ACL backend pointing to api:3000
   - redis: redis:7-alpine with AOF persistence, 256mb maxmemory
   - api: the existing Fastify app

2. TIMESCALEDB INIT SCRIPT (init-tsdb.sql):
   Create all hypertables:
   - ts_telemetry (sensor data, indexed on entity_id + time + key)
   - ts_attributes (attribute change history)
   - ts_checklist_responses (immutable submissions)
   - ts_device_events (connection events)
   - ts_binary_data (file metadata)
   - ts_pipeline_traces (debug traces — single `stages` JSONB array, NOT 11 columns)
   Create continuous aggregates: telemetry_hourly, telemetry_daily
   Create compression policies (7d telemetry, 30d others, 1d traces)
   Create retention policy ONLY for ts_pipeline_traces (48h)
   REVOKE UPDATE, DELETE on all compliance tables (NOT ts_pipeline_traces)
   NOTE: Do NOT include CREATE DATABASE — Docker image creates it via POSTGRES_DB env var

3. PRISMA SCHEMA (add to existing schema.prisma):
   New models — copy exact field names, types, defaults, relations, and indexes from the spec:
   - DeviceCredential (per-entity access tokens, IP allowlist, rate limits)
   - RuleChain + RuleChainVersion + RuleNode + RuleNodeConnection
   - Alarm (single-row lifecycle: ACTIVE → ACKNOWLEDGED → CLEARED)
   - ChecklistReview (3-step approval workflow)
   - ElectronicSignature (§11.50 compliant, SHA-256 binding)
   - LatestTelemetry (cache, @@unique on entityId+key)
   - UnsMapping (entity → UNS path)
   - ConnectivityStatus (per-entity)
   - QrCode (per-entity)
   - HelpArticle + HelpArticleVersion
   - DataStream (telemetry key registry)
   - SystemConfig (SUPER_ADMIN settings with hot-reload)

4. PACKAGES (monorepo shared code):
   packages/queue/
   - queues.ts: 5 queue definitions (INGESTION, NOTIFICATION, EXPORT, REPORTS, MAINTENANCE)
   - priorities.ts: Job priority constants (CHECKLIST=1, ALARM=2, ATTRIBUTE=3, TELEMETRY=5, etc.)
   - schemas.ts: Zod schemas for job payloads
   - connection.ts: Redis/ioredis connection factory

   packages/db/
   - prisma.ts: Prisma client singleton
   - tsdb.ts: TimescaleDB pg Pool with TSDB_HOST/PORT/DATABASE env vars
   - repositories/ (empty directory — built in later phases)

   packages/shared/ (extend existing)
   - Add new permissions: DATA_INGEST, DATA_VIEW, DATA_MANAGE, DATA_EXPORT, RULE_CHAIN_VIEW,
     RULE_CHAIN_MANAGE, ALARM_VIEW, ALARM_MANAGE, UNS_VIEW, UNS_MANAGE, QR_CODE_GENERATE,
     HELP_MANAGE, CHECKLIST_SUBMIT, CHECKLIST_REVIEW, CHECKLIST_APPROVE, RETENTION_MANAGE,
     SYSTEM_CONFIG_MANAGE, READ_DEBUG_TRACE, MANAGE_DEBUG_TRACE
   - Add reauth actions: ACKNOWLEDGE_ALARM, CLEAR_ALARM, SUBMIT_CHECKLIST_WITH_SIGNATURE,
     REVIEW_CHECKLIST, APPROVE_CHECKLIST, CREATE_RULE_CHAIN, UPDATE_RULE_CHAIN, etc.
   - Add audit actions: DATA_ATTRIBUTES_UPDATED, DATA_CHECKLIST_SUBMITTED, ALARM_CREATED, etc.

5. SYSTEM CONFIG SEED DATA:
   Seed script that populates SystemConfig table with all 30+ settings from Section 20.3,
   including defaults, min/max, units, categories, and requiresRestart flags.
   Worker concurrency, rate limit, and trace TTL have requiresRestart: true.

6. HELP ARTICLE SEED DATA:
   Seed default help articles from Appendix B.

7. ENVIRONMENT:
   - .env.example with all cold settings (DATABASE_URL, TSDB_*, MQTT_*, REDIS_*, SMTP_*, UNS_*)
   - All operational limits are in SystemConfig (NOT env vars)

8. DEPENDENCIES:
   Backend: mqtt@^5.5.0, isolated-vm@^5.0.0, qrcode@^1.5.4, @fastify/websocket@^10.0.0,
            bullmq@^5.0.0, ioredis@^5.4.0
   Frontend: reactflow@^11.11.0, @monaco-editor/react@^4.6.0, qrcode.react@^4.0.1,
             signature_pad@^5.0.0, recharts@^2.13.0

VERIFICATION:
After building, these should work:
- `docker compose up` starts all 5 services without errors
- `npx prisma migrate dev` succeeds with all new models
- init-tsdb.sql creates all hypertables, aggregates, and policies
- `SELECT * FROM ts_telemetry LIMIT 0` works on tsdb:5433
- Redis connection succeeds from API process
- EMQX dashboard accessible at localhost:18083
```

## Relevant Spec Sections

Reference these sections in DATA_INGESTION_REQUIREMENTS_v3.md:
- **Section 3.2**: TimescaleDB schema (all hypertables, aggregates, compression, REVOKE)
- **Section 3.3**: Electronic Signature schema
- **Section 6.3**: Pipeline trace table (ts_pipeline_traces — uses single `stages` JSONB array)
- **Section 12.1**: Template enhancement (new fields on AssetTemplate)
- **Section 12.2**: All new Prisma models (complete field definitions)
- **Section 12.3**: Permissions list
- **Section 12.4**: Reauth actions list
- **Section 12.5**: Audit actions list
- **Section 17.2**: Environment variables (cold settings only)
- **Section 20.2**: SystemConfig Prisma model
- **Section 20.3**: All hot-reload settings table (30+ rows with defaults, min, max, units)
- **Section 20.4**: Cold settings (env vars)
- **Section 21.1**: Docker Compose for TimescaleDB
- **Section 21.2**: Docker Compose (full 5-service config), queue definitions, priorities, file structure
- **Appendix B**: Default help articles seed data


> **Update (2026-03-27):** Phase 2 Digital Filter Management System has been completed. See CHANGELOG.md for full details.

