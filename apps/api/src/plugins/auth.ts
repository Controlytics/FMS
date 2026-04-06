import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

// Session config cache (1-min TTL) to avoid DB read per request
let sessionConfigCache: { sessionDurationHours: number; cachedAt: number } | null = null;
const SESSION_CONFIG_CACHE_TTL = 60_000; // 1 minute

async function getSessionDurationHours(): Promise<number> {
  const now = Date.now();
  if (sessionConfigCache && (now - sessionConfigCache.cachedAt) < SESSION_CONFIG_CACHE_TTL) {
    return sessionConfigCache.sessionDurationHours;
  }
  const config = await prisma.systemConfig.findFirst({ where: { configKey: 'session' } });
  const hours = (config?.configValue as any)?.sessionDurationHours ?? 8;
  sessionConfigCache = { sessionDurationHours: hours, cachedAt: now };
  return hours;
}

// Role scope cache (30s TTL) to avoid DB query per request
const roleScopeCache = new Map<string, { scope: string; cachedAt: number }>();
const ROLE_SCOPE_CACHE_TTL = 30_000;

async function getRoleScope(roleName: string): Promise<string> {
  const now = Date.now();
  const cached = roleScopeCache.get(roleName);
  if (cached && (now - cached.cachedAt) < ROLE_SCOPE_CACHE_TTL) return cached.scope;
  const roleRecord = await prisma.role.findFirst({ where: { name: roleName }, select: { scope: true } });
  const scope = (roleRecord?.scope as string) ?? 'ORGANIZATION';
  roleScopeCache.set(roleName, { scope, cachedAt: now });
  return scope;
}

const PUBLIC_PATHS = [
  '/api/auth/login', '/api/auth/forgot-password', '/api/auth/beacon-logout',
  '/api/health', '/docs', '/docs/',
  '/api/internal/mqtt',  // EMQX auth callbacks (no JWT)
  '/api/ws',             // WebSocket (authenticates via message flow)
  '/api/notification-settings/email/oauth2/code', // OAuth2 callback (no JWT - redirect from Microsoft/Google)
  '/api/data/telemetry', // Device token auth (handled by route preHandler)
  '/api/data/attributes',// Device token auth (handled by route preHandler)
  '/api/data/binary',    // Device token auth (handled by route preHandler)
  '/api/data/event',     // Device token auth (handled by route preHandler)
];

// Paths that are public only for GET requests
const PUBLIC_GET_PATHS = ['/api/config/branding', '/api/config/datetime/current', '/uploads/photos/', '/uploads/branding/', '/api/roles/active'];

async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Fully public paths (all methods)
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    // Paths that are public only for GET requests
    if (req.method === 'GET' && PUBLIC_GET_PATHS.some((p) => req.url.startsWith(p))) return;

    // POST /api/admin-requests — public submit (but GET/other methods require auth)
    if (req.method === 'POST' && req.url === '/api/admin-requests') return;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing token' });
    }

    try {
      const payload = await verifyToken(header.slice(7));
      req.user = payload;

      const session = await prisma.session.findFirst({
        where: { id: payload.sessionId, isActive: true },
      });

      if (!session) {
        return reply.code(401).send({ error: 'SESSION_INVALID', message: 'Session terminated' });
      }

      if (session.expiresAt < new Date()) {
        await prisma.session.update({
          where: { id: session.id },
          data: { isActive: false, terminationReason: 'expired' },
        });
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: 'Session expired' });
      }

      // Enforce absolute session timeout (max 24h regardless of activity)
      const MAX_ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;
      if (Date.now() - session.createdAt.getTime() > MAX_ABSOLUTE_SESSION_MS) {
        await prisma.session.update({
          where: { id: session.id },
          data: { isActive: false, terminationReason: 'absolute_timeout' },
        });
        return reply.code(401).send({ error: 'SESSION_EXPIRED', message: 'Session exceeded maximum duration. Please log in again.' });
      }

      // Check user status and sync role + tenant from DB
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { role: true, username: true, status: true, organizationId: true, forcePasswordChange: true, passwordExpiresAt: true },
      });
      if (!user || user.status !== 'ENABLED') {
        return reply.code(401).send({ error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
      }

      // Check if user's organization is active
      if (user.organizationId) {
        const org = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { isActive: true } });
        if (org && !org.isActive) {
          return reply.code(403).send({ error: 'ORG_INACTIVE', message: 'Your organization has been deactivated. Contact administrator.' });
        }
      }

      // Lookup role scope from DB
      const roleRecord = { scope: await getRoleScope(user.role) };
      const scope = roleRecord?.scope || (user.role === 'SUPER_ADMIN' ? 'GLOBAL' : 'ORGANIZATION');

      // Patch req.user with authoritative DB values
      req.user = {
        ...req.user,
        role: user.role,
        username: user.username,
        organizationId: user.organizationId || undefined,
        scope,
      };

      // Paths allowed when forcePasswordChange is true
      const PASSWORD_CHANGE_ALLOWED = [
        '/api/auth/change-password',
        '/api/auth/logout',
        '/api/auth/me',
        '/api/config/password-policy',
      ];

      // Check password expiry (server-side enforcement)
      if (user.passwordExpiresAt && user.passwordExpiresAt < new Date() && !user.forcePasswordChange) {
        await prisma.user.update({
          where: { id: payload.sub },
          data: { forcePasswordChange: true },
        });
        user.forcePasswordChange = true;
      }

      // Enforce forcePasswordChange server-side (§11.10(f))
      if (user.forcePasswordChange) {
        const isAllowed = PASSWORD_CHANGE_ALLOWED.some((p) => req.url.startsWith(p));
        if (!isAllowed) {
          const errorCode = user.passwordExpiresAt && user.passwordExpiresAt < new Date()
            ? 'PASSWORD_EXPIRED'
            : 'FORCE_PASSWORD_CHANGE';
          return reply.code(403).send({
            error: errorCode,
            message: errorCode === 'PASSWORD_EXPIRED'
              ? 'Your password has expired. Please change your password.'
              : 'You must change your password before continuing.',
          });
        }
      }

      // Update last active + extend session expiry (sliding window)
      const durationHours = await getSessionDurationHours();
      await prisma.session.update({
        where: { id: session.id },
        data: {
          lastActiveAt: new Date(),
          expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        },
      });
    } catch {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
