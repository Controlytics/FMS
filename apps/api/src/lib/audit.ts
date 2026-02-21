import { prisma } from './prisma.js';
import { computeChecksum } from './hash-chain.js';

export interface AuditEntry {
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

/**
 * Standalone audit logging function — callable from services without Fastify instance.
 * Same logic as plugins/audit-logger.ts decorator.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
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
}
