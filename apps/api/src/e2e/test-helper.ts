import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from '../plugins/auth.js';
import auditLoggerPlugin from '../plugins/audit-logger.js';
import rbacPlugin from '../plugins/rbac.js';
import authRoutes from '../modules/auth/routes.js';
import userRoutes from '../modules/users/routes.js';
import configRoutes from '../modules/config/routes.js';
import auditRoutes from '../modules/audit/routes.js';
import roleRoutes from '../modules/roles/routes.js';
import notificationRoutes from '../modules/notifications/routes.js';

/** Default admin password used in tests */
export const ADMIN_PASSWORD = 'Admin@123';

/**
 * Build a Fastify instance for integration testing.
 * Uses app.inject() — no actual HTTP server is started.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // quiet during tests
    ajv: {
      customOptions: {
        keywords: ['example'],
      },
    },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

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
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(roleRoutes, { prefix: '/api/roles' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });

  await app.ready();
  return app;
}

/**
 * Login as a user and return the JWT token.
 */
export async function loginAs(
  app: FastifyInstance,
  username = 'admin',
  password = ADMIN_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });

  const body = JSON.parse(res.body);
  if (!body.token) {
    throw new Error(`Login failed for ${username}: ${res.body}`);
  }
  return body.token;
}

/**
 * Make an authenticated GET request.
 */
export async function authGet(app: FastifyInstance, url: string, token: string) {
  return app.inject({
    method: 'GET',
    url,
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Make an authenticated POST request with optional reauth password.
 */
export async function authPost(
  app: FastifyInstance,
  url: string,
  token: string,
  payload?: unknown,
  reauthPassword?: string,
) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (reauthPassword) {
    headers['x-reauth-password'] = reauthPassword;
  }
  return app.inject({
    method: 'POST',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });
}

/**
 * Make an authenticated PUT request with optional reauth password.
 */
export async function authPut(
  app: FastifyInstance,
  url: string,
  token: string,
  payload?: unknown,
  reauthPassword?: string,
) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (reauthPassword) {
    headers['x-reauth-password'] = reauthPassword;
  }
  return app.inject({
    method: 'PUT',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });
}

/**
 * Make an authenticated DELETE request with optional reauth password.
 */
export async function authDelete(
  app: FastifyInstance,
  url: string,
  token: string,
  reauthPassword?: string,
) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (reauthPassword) {
    headers['x-reauth-password'] = reauthPassword;
  }
  return app.inject({
    method: 'DELETE',
    url,
    headers,
  });
}

/**
 * Make an authenticated PATCH request with optional reauth password.
 */
export async function authPatch(
  app: FastifyInstance,
  url: string,
  token: string,
  payload?: unknown,
  reauthPassword?: string,
) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (reauthPassword) {
    headers['x-reauth-password'] = reauthPassword;
  }
  return app.inject({
    method: 'PATCH',
    url,
    headers,
    payload: payload as Record<string, unknown>,
  });
}
