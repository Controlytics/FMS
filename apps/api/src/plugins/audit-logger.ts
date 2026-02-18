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
  signatureMeaning?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    auditLog: (entry: AuditEntry) => Promise<void>;
  }
}

async function auditLoggerPlugin(app: FastifyInstance) {
  app.decorate('auditLog', async (entry: AuditEntry) => {
    // SUPER_ADMIN actions should NOT be recorded in audit trail
    if (entry.userRole === 'SUPER_ADMIN') {
      return;
    }

    // Use explicit timestamp for both checksum and storage so verification works
    const timestamp = new Date();
    const afterValueClean = entry.afterValue ? JSON.parse(JSON.stringify(entry.afterValue)) : undefined;

    const checksum = computeChecksum({
      timestamp: timestamp.toISOString(),
      userId: entry.userId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      afterValue: afterValueClean,
    } as Record<string, unknown>);

    await prisma.auditTrail.create({
      data: {
        timestamp,
        userId: entry.userId,
        userName: entry.userName,
        userRole: entry.userRole,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        beforeValue: entry.beforeValue ? JSON.parse(JSON.stringify(entry.beforeValue)) : undefined,
        afterValue: afterValueClean,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        sessionId: entry.sessionId,
        checksum,
        signatureMeaning: entry.signatureMeaning,
      },
    });
  });
}

export default fp(auditLoggerPlugin, { name: 'audit-logger' });
