import 'dotenv/config';
import Fastify from 'fastify';
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
import auditLoggerPlugin from './plugins/audit-logger.js';
import rbacPlugin from './plugins/rbac.js';
import tenantPlugin from './plugins/tenant.js';
import superAdminRoutes from "./modules/super-admin/routes.js";
import ldapRoutes from "./modules/ldap/routes.js";
import tenantAdminRoutes from "./modules/tenant-admin/routes.js";
import orgDetailRoutes from "./modules/tenant-admin/org-detail-routes.js";
import orgAdminRoutes from "./modules/org-admin/routes.js";
import entityAssignmentRoutes from "./modules/entity-assignments/routes.js";
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
import dataIngestionRoutes from './modules/data-ingestion/routes.js';
import ruleChainRoutes from './modules/rule-chain/routes.js';
import unsRoutes from './modules/uns/routes.js';
import queriesModule from './modules/queries/index.js';
import connectivityRoutes from './modules/connectivity/routes.js';
import qrCodeRoutes from './modules/qr-code/routes.js';
import helpRoutes from './modules/help/routes.js';
import systemHealthRoutes, { trackRequest } from './modules/system-health/routes.js';
import debugTraceRoutes from './modules/data-ingestion/debug-trace.routes.js';
import wsHandler from './transport/ws-handler.js';
import { initMqttClient, closeMqttClient } from './transport/mqtt-client.js';
import { closeWsRedis } from './transport/ws-handler.js';
import { closeRpcRedis } from './modules/data-ingestion/rpc-handler.js';
import { closePipelineRedis } from './modules/data-ingestion/ingestion.service.js';
import { closeTracerRedis } from './modules/data-ingestion/pipeline-tracer.js';
import { closeDebugRedis } from './modules/rule-chain/debug-recorder.js';
import { initializeNodes } from './modules/rule-chain/nodes/index.js';
import notificationDeliveryRoutes from './modules/notification-delivery/routes.js';
import userGroupRoutes from './modules/user-groups/routes.js';
import notificationRulesRoutes from './modules/notification-rules/routes.js';
import { startIngestionWorker, stopIngestionWorker } from './workers/ingestion.worker.js';
import { startMaintenanceWorker, stopMaintenanceWorker } from './workers/maintenance.worker.js';
import { getTsdbPool, initTelemetryBatcher, closeTelemetryBatcher } from '@digilog/db';
import { AppError } from './lib/errors.js';
import { dispatchNotification } from './modules/notification-delivery/notification-dispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
  trustProxy: 1,  // Trust exactly 1 proxy hop (nginx) — prevents X-Forwarded-For spoofing
  bodyLimit: 10 * 1024 * 1024, // 10 MB for base64 image uploads in checklists
  ajv: {
    customOptions: {
      keywords: ['example'],
    },
  },
});

// Swagger API docs (register before routes)
await registerSwagger(app);

// Core middleware
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  credentials: true,
});
await app.register(helmet, {
  contentSecurityPolicy: false,
  strictTransportSecurity: {
    maxAge: 31536000,        // 1 year in seconds
    includeSubDomains: true,
    preload: true,
  },
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
await app.register(auditLoggerPlugin);
await app.register(authPlugin);
await app.register(rbacPlugin);
await app.register(tenantPlugin);

// Global error handler — maps AppError to HTTP responses
app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({
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
  // Genuine internal errors
  app.log.error(err);
  // Dispatch SYSTEM_ERROR notification (fire-and-forget, don't block error response)
  dispatchNotification({
    eventType: 'SYSTEM_ERROR',
    context: {},
    variables: {
      errorType: err.constructor?.name ?? 'Error',
      errorMessage: err.message ?? 'Unknown error',
      url: _req.url ?? 'N/A',
      timestamp: new Date().toISOString(),
    },
  }).catch(() => {}); // Silently ignore dispatch errors to avoid infinite loops
  return reply.code(err.statusCode ?? 500).send({
    error: 'INTERNAL_ERROR',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
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
}, async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

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
await app.register(mqttAuthRoutes, { prefix: '/api/internal/mqtt' });
await app.register(dataIngestionRoutes, { prefix: '/api/data' });
await app.register(ruleChainRoutes, { prefix: '/api/rule-chains' });
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

// Multi-tenant management routes
await app.register(superAdminRoutes, { prefix: "/api/super-admin" });
await app.register(ldapRoutes, { prefix: "/api/ldap" });
await app.register(tenantAdminRoutes, { prefix: "/api/tenant" });
await app.register(orgDetailRoutes, { prefix: "/api/tenant/organizations" });
await app.register(orgAdminRoutes, { prefix: "/api/org" });
await app.register(entityAssignmentRoutes, { prefix: "/api/entity-assignments" });
await app.register(dashboardRoutes, { prefix: "/api/dashboards" });
await app.register(wsHandler);

// Initialize rule chain node registry
initializeNodes();

// Start
const port = parseInt(process.env.PORT ?? '3000', 10);
try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`DigiLog API running on http://localhost:${port}`);
  app.log.info(`Swagger UI: http://localhost:${port}/docs`);

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

  // Start ingestion pipeline worker (Phase C)
  try {
    await startIngestionWorker();
    app.log.info('Ingestion worker started');
  } catch (workerErr) {
    app.log.warn('Ingestion worker failed to start — server continuing without worker');
    app.log.warn(workerErr);
  }

  // Start maintenance worker (Phase C)
  try {
    await startMaintenanceWorker();
    app.log.info('Maintenance worker started');
  } catch (maintErr) {
    app.log.warn('Maintenance worker failed to start — server continuing');
    app.log.warn(maintErr);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await stopIngestionWorker();
    await stopMaintenanceWorker();
    await closeTelemetryBatcher();
    await closeMqttClient();
    await closeWsRedis();
    await closeRpcRedis();
    await closePipelineRedis();
    await closeTracerRedis();
    await closeDebugRedis();
    await app.close();
  } catch (err) {
    app.log.error(err as Error, 'Error during shutdown');
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
