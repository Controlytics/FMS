import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/forgot-password', '/api/health', '/api/csrf-token', '/api/docs'];

async function authPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.some((p) => req.url.startsWith(p))) return;

    // Read token from Authorization header or HttpOnly cookie
    const header = req.headers.authorization;
    const tokenFromHeader = header?.startsWith('Bearer ') ? header.slice(7) : null;
    const tokenFromCookie = (req.cookies as Record<string, string>)?.token;
    const token = tokenFromHeader ?? tokenFromCookie;

    if (!token) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Missing token' });
    }

    try {
      const payload = await verifyToken(token);
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
