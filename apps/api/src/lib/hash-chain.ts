import { createHash } from 'node:crypto';

export function computeChecksum(data: Record<string, unknown>): string {
  // Sort keys for deterministic ordering, then stringify fully
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  const payload = JSON.stringify(sorted);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Recompute checksum from a stored audit record's fields.
 * Used to verify integrity on read.
 */
export function verifyAuditChecksum(record: {
  timestamp: Date | string;
  userId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  afterValue?: unknown;
  checksum: string;
}): boolean {
  const recomputed = computeChecksum({
    timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
    userId: record.userId ?? undefined,
    action: record.action,
    targetType: record.targetType ?? undefined,
    targetId: record.targetId ?? undefined,
    afterValue: record.afterValue ?? undefined,
  });
  return recomputed === record.checksum;
}
