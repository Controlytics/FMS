import fp from 'fastify-plugin';
import { type FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { computeChecksum } from '../lib/hash-chain.js';

interface AuditEntry {
  userId?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    auditLog: (entry: AuditEntry) => Promise<void>;
  }
}

async function auditLoggerPlugin(app: FastifyInstance) {
  app.decorate('auditLog', async (entry: AuditEntry) => {
    // Skip audit logging for SUPER_ADMIN
    if (entry.userRole === 'SUPER_ADMIN') return;

    const checksum = computeChecksum({
      timestamp: new Date().toISOString(),
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      afterValue: entry.afterValue,
    } as Record<string, unknown>);

    await prisma.auditTrail.create({
      data: {
        userId: entry.userId,
        userName: entry.userName,
        userRole: entry.userRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        beforeValue: entry.beforeValue ? JSON.parse(JSON.stringify(entry.beforeValue)) : undefined,
        afterValue: entry.afterValue ? JSON.parse(JSON.stringify(entry.afterValue)) : undefined,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        sessionId: entry.sessionId,
        checksum,
      },
    });
  });
}

export default fp(auditLoggerPlugin, { name: 'audit-logger' });
