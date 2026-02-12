import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import authPlugin from './plugins/auth.js';
import auditLoggerPlugin from './plugins/audit-logger.js';
import rbacPlugin from './plugins/rbac.js';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import configRoutes from './modules/config/routes.js';
import hierarchyRoutes from './modules/hierarchy/routes.js';
import templateRoutes from './modules/templates/routes.js';
import auditRoutes from './modules/audit/routes.js';

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  },
});

// Core middleware
await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173').split(','),
  credentials: true,
});
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

// Plugins
await app.register(auditLoggerPlugin);
await app.register(authPlugin);
await app.register(rbacPlugin);

// Health check
app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
await app.register(authRoutes, { prefix: '/api/auth' });
await app.register(userRoutes, { prefix: '/api/users' });
await app.register(configRoutes, { prefix: '/api/config' });
await app.register(hierarchyRoutes, { prefix: '/api/hierarchy' });
await app.register(templateRoutes, { prefix: '/api/templates' });
await app.register(auditRoutes, { prefix: '/api/audit' });

// Start
const port = parseInt(process.env.PORT ?? '3000', 10);
try {
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`DigiLog API running on http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
