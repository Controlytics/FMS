import 'dotenv/config';
import Fastify from 'fastify';
import fs from 'node:fs';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSwagger } from './lib/swagger.js';
import authPlugin from './plugins/auth.js';
import rbacPlugin from './plugins/rbac.js';
import superAdminRoutes from "./modules/super-admin/routes.js";
import ldapRoutes from "./modules/ldap/routes.js";
import dashboardRoutes from "./modules/dashboards/routes.js";
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import configRoutes from './modules/config/routes.js';
import { discoverAndRegisterConfigs } from './lib/config-discovery.js';
import dynamicConfigRoutes from './modules/config/dynamic-routes.js';
import auditRoutes from './modules/audit/routes.js';
import uploadRoutes from './modules/uploads/routes.js';
import notificationRoutes from './modules/notifications/routes.js';
import roleRoutes from './modules/roles/routes.js';
import backupRoutes from './modules/backup/routes.js';
import assetRoutes from './modules/assets/index.js';
import mqttAuthRoutes from './transport/mqtt-auth-routes.js';
import mosquittoRefreshRoutes from './transport/mosquitto-refresh-routes.js';
import { isFeatureEnabled, FEATURE_FLAGS } from './lib/feature-flags.js';
import dataIngestionRoutes from './modules/data-ingestion/routes.js';
import unsRoutes from './modules/uns/routes.js';
import queriesModule from './modules/queries/index.js';
import connectivityRoutes from './modules/connectivity/routes.js';
import qrCodeRoutes from './modules/qr-code/routes.js';
import helpRoutes from './modules/help/routes.js';
import systemHealthRoutes, { trackRequest } from './modules/system-health/routes.js';
import debugTraceRoutes from './modules/data-ingestion/debug-trace.routes.js';
import wsHandler from './transport/ws-handler.js';
import { initMqttClient, closeMqttClient } from './transport/mqtt-client.js';
import { closeWsBus } from './transport/ws-handler.js';
import { stopRateLimitCleanup } from './modules/data-ingestion/ingestion.service.js';
import notificationDeliveryRoutes from './modules/notification-delivery/routes.js';
import userGroupRoutes from './modules/user-groups/routes.js';
import notificationRulesRoutes from './modules/notification-rules/routes.js';
import { ingestionTask } from './workers/ingestion.worker.js';
import { notificationTask } from './workers/notification.worker.js';
import {
  dlqCheckTask,
  connectivityCheckTask,
  retentionCleanupTask,
} from './workers/maintenance.worker.js';
import { startJobRunner, stopJobRunner } from '@digilog/queue';
import { getTsdbPool, initTelemetryBatcher, closeTelemetryBatcher } from '@digilog/db';
import { AppError } from './lib/errors.js';
import { OfflineTimeError } from './lib/offline-time-window.js';
import { dispatchNotification } from './modules/notification-delivery/notification-dispatcher.js';
import cleaningProfileRoutes from './modules/cleaning-profiles/routes.js';import checklistProfileRoutes from './modules/checklist-profiles/routes.js';import filterProfileRoutes from './modules/filter-profiles/routes.js';
import pmScheduleRoutes from './modules/pm-schedules/routes.js';import pmExecutionRoutes from './modules/pm-schedules/execution-routes.js';import filterOperationsRoutes from './modules/filter-operations/routes.js';import filterEventsRoutes from './modules/filter-operations/events-routes.js';
import replacementScheduleRoutes from './modules/replacement-schedule/routes.js';
import equipmentGroupRoutes from './modules/equipment-groups/routes.js';
import syncRoutes from './modules/sync/routes.js';
import deploymentCheckRoutes from './modules/deployment-check/routes.js';
import adminRequestRoutes from './modules/admin-requests/routes.js';
import blockChangeRoutes from './modules/block-change-requests/routes.js';
import reportTemplateRoutes from './modules/report-templates/routes.js';
import hierarchyRoutes from './modules/hierarchy/routes.js';
// reportRoutes imported dynamically below

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const httpsOptions = process.env.API_HTTPS === 'true'
  ? {
      key: fs.readFileSync(path.resolve(__dirname, '../../../certs/server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, '../../../certs/server.crt')),
    }
  : null;

// May 16 H2 fix (2026-05-20): trustProxy was unconditionally 1. When the
// API serves browsers DIRECTLY (no reverse proxy in front — the local
// Windows dev setup; some appliance deployments), the "first hop" is the
// attacker's browser, and X-Forwarded-For becomes attacker-controlled.
// Result: audit-trail IP + rate-limit keys both spoofable.
//
// Only trust the X-Forwarded-* family when explicitly behind a known
// reverse proxy (set TRUST_PROXY=1 or TRUST_PROXY=<hop-count> in env).
// Default false → req.ip uses the raw socket address, attacker can't lie.
const trustProxyEnv = process.env.TRUST_PROXY;
const trustProxy = trustProxyEnv
  ? (Number.isFinite(Number(trustProxyEnv)) ? Number(trustProxyEnv) : trustProxyEnv === 'true')
  : false;

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  trustProxy,
  bodyLimit: 10 * 1024 * 1024, // 10 MB for base64 image uploads in checklists
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
  ...(httpsOptions ? { https: httpsOptions } : {}),
});

// Block dangerous HTTP methods early — before any route or plugin (audit S-11)
app.addHook('onRequest', async (req, reply) => {
  if (req.method === 'TRACE' || req.method === 'CONNECT') {
    return reply.code(405).send({ error: 'METHOD_NOT_ALLOWED' });
  }
});

// Swagger API docs (register before routes)
await registerSwagger(app);

// Core middleware
const corsOrigins = process.env.ALLOWED_ORIGINS;
if (!corsOrigins && process.env.NODE_ENV === 'production') {
  throw new Error('FATAL: ALLOWED_ORIGINS env var must be set in production');
}
await app.register(cors, {
  origin: (corsOrigins ?? 'http://localhost:5173,http://localhost:5175,https://localhost,capacitor://localhost,http://localhost').split(','),
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-reauth-password'],
});
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // Swagger UI requires unsafe-inline
      styleSrc: ["'self'", "'unsafe-inline'"],    // Swagger UI requires unsafe-inline
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  strictTransportSecurity: {
    maxAge: 31536000,        // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
});
// Permissions-Policy — restrict browser feature APIs (audit S-10)
app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  return payload;
});
await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1,
  },
});
await app.register(websocket);

// Serve uploaded files
const uploadsDir = path.join(__dirname, '..', 'uploads');
await app.register(fastifyStatic, {
  root: uploadsDir,
  prefix: '/uploads/',
  decorateReply: false,
});

// Plugins
await app.register(authPlugin);
await app.register(rbacPlugin);

// Rate limiter for error notifications (max 1 per minute)
let lastErrorNotification = 0;

// Global error handler — maps AppError to HTTP responses
app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Audit 2026-05-04 fix C2: bounded offlinePerformedAt validator. Map the
  // dedicated error class to a clean 400 with a stable error code so the
  // client knows whether to retry, re-perform the action, or contact admin.
  if (err instanceof OfflineTimeError) {
    return reply.code(400).send({
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Rate limit errors from @fastify/rate-limit
  if (err.statusCode === 429) {
    return reply.code(429).send({ error: 'TOO_MANY_REQUESTS', message: err.message });
  }
  // Body too large (e.g. base64 images in checklist submissions)
  if ((err as any).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    const contentLength = _req.headers['content-length'];
    const sizeMB = contentLength ? (parseInt(contentLength as string) / 1024 / 1024).toFixed(1) : 'unknown';
    app.log.warn({ url: _req.url, contentLength, sizeMB }, 'Request body too large');
    return reply.code(413).send({
      error: 'BODY_TOO_LARGE',
      message: `Request body too large (${sizeMB} MB). Maximum allowed is 10 MB. Try reducing image size or quality.`,
    });
  }
  // Fastify validation errors (body/query/params schema validation)
  if ((err as any).code === 'FST_ERR_VALIDATION' || (err as any).validation) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: err.message,
      ...(err as any).validation ? { details: (err as any).validation } : {},
    });
  }
  // Unsupported Media Type — 415 (audit API-3)
  if ((err as any).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return reply.code(415).send({
      error: 'UNSUPPORTED_MEDIA_TYPE',
      message: err.message || 'Unsupported Media Type',
    });
  }
  // JSON parse errors — 400 (audit API-3)
  if (
    (err as any).code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
    (err as any).code === 'FST_ERR_CTP_EMPTY_JSON_BODY'
  ) {
    return reply.code(400).send({
      error: 'PARSE_ERROR',
      message: 'Request body is not valid JSON',
    });
  }
  // Genuine internal errors
  app.log.error(err);
  // Dispatch SYSTEM_ERROR notification (fire-and-forget, rate-limited to 1 per minute)
  const now = Date.now();
  if (now - lastErrorNotification > 60000) {
    lastErrorNotification = now;
    dispatchNotification({
      eventType: 'SYSTEM_ERROR',
      context: {},
      variables: {
        errorType: err.constructor?.name ?? 'Error',
        errorMessage: err.message ?? 'Unknown error',
        url: _req.url ?? 'N/A',
        timestamp: new Date().toISOString(),
      },
    }).catch((dispatchErr) => {
      // Log but do not rethrow — rethrowing would re-enter the error handler
      // and cause an infinite loop (the SYSTEM_ERROR notification itself
      // failing would generate another SYSTEM_ERROR notification).
      app.log.warn(
        { dispatchErr, originalErr: err.message, url: _req.url },
        'Failed to dispatch SYSTEM_ERROR notification — original error is still returned to the caller.',
      );
    });
  }
  return reply.code(err.statusCode ?? 500).send({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'development' ? (err.message || 'Internal server error').substring(0, 500) : 'Internal server error',
  });
});

// Request tracking hook for system health metrics
app.addHook('onRequest', (_req, _reply, done) => {
  trackRequest();
  done();
});

// Health check
app.get('/api/health', {
  schema: {
    tags: ['Health'],
    summary: 'Health check',
    description: 'Returns API health status',
    security: [],
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string', example: 'ok' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
}, async (_req, reply) => {
  try {
    const { prisma } = await import('@digilog/db');
    await prisma.$queryRaw`SELECT 1`;
    const { healthCheck } = await import('@digilog/db');
    const tsdbOk = await healthCheck();
    return { status: 'ok', db: 'connected', tsdb: tsdbOk ? 'connected' : 'error' };
  } catch (err) {
    return reply.code(503 as any).send({ status: 'error', db: 'disconnected' });
  }
});

// Auto-discover config module definitions
await discoverAndRegisterConfigs();

// Routes
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(configRoutes, { prefix: '/api/config' });
await app.register(dynamicConfigRoutes, { prefix: '/api/config' });
await app.register(auditRoutes, { prefix: '/api/audit' });
await app.register(uploadRoutes, { prefix: '/api/uploads' });
await app.register(notificationRoutes, { prefix: '/api/notifications' });
await app.register(roleRoutes, { prefix: '/api/roles' });
await app.register(backupRoutes, { prefix: '/api/backup' });
await app.register(assetRoutes, { prefix: '/api/assets' });

// Data Ingestion & Transport routes
// Phase 1 cut-over: when USE_MOSQUITTO=true, expose Mosquitto's
// dynamic-security refresh endpoint instead of the EMQX auth-webhook
// routes. See docs/plans/2026-04-29-windows-friendly-rewrite.md.
if (isFeatureEnabled(FEATURE_FLAGS.USE_MOSQUITTO)) {
  app.log.info('MQTT broker mode: Mosquitto (USE_MOSQUITTO=true)');
  await app.register(mosquittoRefreshRoutes, { prefix: '/api/internal/mqtt' });
} else {
  app.log.info('MQTT broker mode: EMQX (legacy, USE_MOSQUITTO=false)');
  await app.register(mqttAuthRoutes, { prefix: '/api/internal/mqtt' });
}
await app.register(dataIngestionRoutes, { prefix: '/api/data' });
await app.register(unsRoutes, { prefix: '/api/uns' });
await app.register(queriesModule, { prefix: '/api' });
await app.register(connectivityRoutes, { prefix: '/api/connectivity' });
await app.register(qrCodeRoutes, { prefix: '/api/qr' });
await app.register(helpRoutes, { prefix: '/api/help' });
await app.register(systemHealthRoutes, { prefix: '/api/system-health' });
await app.register(debugTraceRoutes, { prefix: '/api/debug/traces' });
await app.register(notificationDeliveryRoutes, { prefix: '/api/notification-settings' });
await app.register(userGroupRoutes, { prefix: '/api/user-groups' });
await app.register(notificationRulesRoutes, { prefix: '/api/notification-rules' });

// Admin + assignment routes
await app.register(superAdminRoutes, { prefix: "/api/super-admin" });
await app.register(ldapRoutes, { prefix: "/api/ldap" });
await app.register(dashboardRoutes, { prefix: "/api/dashboards" });
await app.register(cleaningProfileRoutes, { prefix: '/api/filter-cleaning-profiles' });await app.register(checklistProfileRoutes, { prefix: '/api/checklist-profiles' });await app.register(filterProfileRoutes, { prefix: '/api/filter-profiles' });
await app.register(pmScheduleRoutes, { prefix: '/api/pm-schedules' });await app.register(pmExecutionRoutes, { prefix: '/api/pm-executions' });await app.register(filterOperationsRoutes, { prefix: '/api/filters' });await app.register(filterEventsRoutes, { prefix: '/api/filters' });
await app.register(equipmentGroupRoutes, { prefix: '/api/equipment-groups' });
await app.register(replacementScheduleRoutes, { prefix: '/api/replacement-schedules' });
await app.register(syncRoutes, { prefix: '/api/sync' });
await app.register(deploymentCheckRoutes, { prefix: '/api/deployment-check' });
await app.register(adminRequestRoutes, { prefix: '/api/admin-requests' });
await app.register(blockChangeRoutes, { prefix: '/api/block-change-requests' });
await app.register(reportTemplateRoutes, { prefix: '/api/report-templates' });
await app.register(hierarchyRoutes, { prefix: '/api/hierarchy' });
await app.register((await import('./modules/reports/routes.js')).default, { prefix: '/api/reports' });
await app.register(wsHandler);

// Start
const port = parseInt(process.env.PORT ?? '3000', 10);
try {
  await app.listen({ port, host: '0.0.0.0' });
  const proto = httpsOptions ? 'https' : 'http';
  app.log.info(`DigiLog API running on ${proto}://localhost:${port}`);
  app.log.info(`Swagger UI: ${proto}://localhost:${port}/docs`);

  // Initialize MQTT client after server is listening
  try {
    await initMqttClient();
    app.log.info('MQTT client initialized');
  } catch (mqttErr) {
    app.log.warn('MQTT client initialization failed — server continuing without MQTT');
    app.log.warn(mqttErr);
  }

  // Initialize telemetry batcher (Phase C)
  try {
    const tsdbPool = getTsdbPool();
    initTelemetryBatcher(tsdbPool, { batchSize: 100, flushIntervalMs: 1000 });
    app.log.info('Telemetry batcher initialized');
  } catch (batchErr) {
    app.log.warn('Telemetry batcher initialization failed — continuing without batching');
    app.log.warn(batchErr);
  }

  // Phase 2 — single graphile-worker Runner registers ALL task identifiers
  // and the maintenance crontab (Task 2.8). The legacy BullMQ path was
  // dropped in Task 2.10; graphile-worker is the only queue backend now.
  try {
    // crontab.txt lives at <repo>/packages/queue/crontab.txt; src/app.ts is
    // at <repo>/apps/api/src/app.ts so the relative hop is 3 dot-dots.
    // Override via MAINTENANCE_CRONTAB_PATH for non-default monorepo layouts.
    const crontabPath =
      process.env.MAINTENANCE_CRONTAB_PATH ??
      path.resolve(__dirname, '../../../packages/queue/crontab.txt');
    await startJobRunner({
      taskList: {
        ingestion: ingestionTask,
        // `notification` task handler — closes the producer/consumer gap
        // flagged in the 2026-05-12 deep review. Before this commit
        // `enqueueNotificationJob` posted to a task name with no handler
        // and jobs leaked into graphile_worker.jobs forever. See
        // apps/api/src/workers/notification.worker.ts for the mapping
        // from queue payload to `dispatchNotification` event types.
        notification: notificationTask,
        dlq_check: dlqCheckTask,
        connectivity_check: connectivityCheckTask,
        retention_cleanup: retentionCleanupTask,
      },
      crontabPath,
    });
    app.log.info('graphile-worker job runner started');
  } catch (runnerErr) {
    app.log.warn('graphile-worker job runner failed to start — server continuing');
    app.log.warn(runnerErr);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  const shutdownTimeout = setTimeout(() => {
    console.error('[SHUTDOWN] Timed out after 15s, forcing exit');
    process.exit(1);
  }, 15000);
  shutdownTimeout.unref();

  try {
    await stopJobRunner();
    await closeTelemetryBatcher();
    await closeMqttClient();
    await closeWsBus();
    await stopRateLimitCleanup();
    await app.close();
    // Close queue + tsdb in their own try blocks so one failure doesn't
    // prevent the next teardown step. Each failure is logged so partial-
    // shutdown state is debuggable (CLAUDE.md "Never swallow exceptions").
    try {
      const { closeProducer } = await import('@digilog/queue');
      await closeProducer();
    } catch (qErr) {
      app.log.error({ err: qErr }, 'Shutdown: closeProducer (graphile-worker) failed');
    }
    try {
      const { closeTsdbPool } = await import('@digilog/db');
      await closeTsdbPool();
    } catch (tErr) {
      app.log.error({ err: tErr }, 'Shutdown: closeTsdbPool (TimescaleDB) failed');
    }
  } catch (err) {
    app.log.error(err as Error, 'Error during shutdown');
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
