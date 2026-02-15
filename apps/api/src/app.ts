import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import authPlugin from './plugins/auth.js';
import auditLoggerPlugin from './plugins/audit-logger.js';
import rbacPlugin from './plugins/rbac.js';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import configRoutes from './modules/config/routes.js';
import hierarchyRoutes from './modules/hierarchy/routes.js';
import templateRoutes from './modules/templates/routes.js';
import auditRoutes from './modules/audit/routes.js';
import checklistRoutes from './modules/checklists/routes.js';
import scheduleRoutes from './modules/schedules/routes.js';
import alarmRoutes from './modules/alarms/routes.js';
import privilegeRoutes from './modules/privileges/routes.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

// Zod type provider compilers
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Swagger / OpenAPI
await app.register(swagger, {
  openapi: {
    info: {
      title: 'DigiLog API',
      version: '1.0.0',
      description: '21 CFR Part 11 Compliant Digital Logbook API',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  transform: jsonSchemaTransform,
});
await app.register(swaggerUi, { routePrefix: '/api/docs' });

// Global error handler for Zod validation errors
app.setErrorHandler((error, request, reply) => {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      details: error.validation,
    });
  }

  if (isResponseSerializationError(error)) {
    request.log.error({ err: error }, 'Response serialization error');
    return reply.code(500).send({ error: 'Internal Server Error' });
  }

  // Default error handling
  const err = error as { statusCode?: number; message?: string };
  if (err.statusCode) {
    return reply.code(err.statusCode).send({ error: err.message });
  }

  request.log.error({ err: error }, 'Unhandled error');
  return reply.code(500).send({ error: 'Internal Server Error' });
});

// Core middleware
await app.register(cookie);
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  credentials: true,
});
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(csrf, {
  cookieOpts: { signed: false, httpOnly: true, sameSite: 'strict', path: '/' },
});
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// Plugins
await app.register(auditLoggerPlugin);
await app.register(authPlugin);
await app.register(rbacPlugin);

// Health check
app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// CSRF token endpoint
app.get('/api/csrf-token', async (req, reply) => {
  const token = reply.generateCsrf();
  return { csrfToken: token };
});

// Routes
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(configRoutes, { prefix: '/api/config' });
await app.register(hierarchyRoutes, { prefix: '/api/hierarchy' });
await app.register(templateRoutes, { prefix: '/api/templates' });
await app.register(auditRoutes, { prefix: '/api/audit' });
await app.register(checklistRoutes, { prefix: '/api/checklists' });
await app.register(scheduleRoutes, { prefix: '/api/schedules' });
await app.register(alarmRoutes, { prefix: '/api/alarms' });
await app.register(privilegeRoutes, { prefix: '/api/privileges' });

// Start
const port = parseInt(process.env.PORT ?? '3000', 10);
try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`DigiLog API running on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
