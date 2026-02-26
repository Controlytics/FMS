import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

const PUBLIC_PATHS = [
  '/api/auth/login', '/api/auth/forgot-password', '/api/auth/beacon-logout',
  '/api/health', '/docs', '/docs/',
  '/api/internal/mqtt',  // EMQX auth callbacks (no JWT)
  '/api/ws',             // WebSocket (authenticates via message flow)
  '/api/data/telemetry', // Device token auth (handled by route preHandler)
  '/api/data/attributes',// Device token auth (handled by route preHandler)
  '/api/data/binary',    // Device token auth (handled by route preHandler)
  '/api/data/event',     // Device token auth (handled by route preHandler)
];

// Paths that are public only for GET requests
const PUBLIC_GET_PATHS = ['/api/config/branding', '/api/config/datetime/current', '/uploads/'];

async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Fully public paths (all methods)
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    // Paths that are public only for GET requests
    if (req.method === 'GET' && PUBLIC_GET_PATHS.some((p) => req.url.startsWith(p))) return;

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

      // Check user status
      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== 'ENABLED') {
        return reply.code(401).send({ error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
      }

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
          where: { id: user.id },
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

      // Update last active
      await prisma.session.update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      });
    } catch {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
    }
  });
}

export default fp(authPlugin, { name: 'auth' });
