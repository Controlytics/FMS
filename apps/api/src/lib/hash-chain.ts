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
 * Audit 2026-05-04 fix C3: chain-aware checksum.
 *
 * When `previousChecksum` is supplied, mix it into the SHA256 input so the
 * row binds to its predecessor. Tampering with row N OR removing/inserting
 * any row before N invalidates row N+1's chain link, surfacing during a
 * verifyChain walk.
 *
 * `previousChecksum === null` is the genesis row (first audit ever, or
 * first audit after the C3 migration in pre-chain DBs). It still binds
 * the per-row fields but has no link.
 *
 * Compatible with the legacy single-row `computeChecksum(data)` — pass
 * the same per-row fields, plus `previousChecksum` for chain rows.
 */
export function computeChainedChecksum(
  data: Record<string, unknown>,
  previousChecksum: string | null,
): string {
  return computeChecksum({ ...data, previousChecksum });
}

/**
 * Recompute checksum from a stored audit record's fields.
 * Used to verify integrity on read.
 *
 * For chain rows (previousChecksum != null), the chain link is included
 * in the verification. For pre-chain rows, behavior is identical to the
 * pre-C3 implementation.
 */
export function verifyAuditChecksum(record: {
  timestamp: Date | string;
  userId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  afterValue?: unknown;
  checksum: string;
  previousChecksum?: string | null;
}): boolean {
  const baseFields = {
    timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
    userId: record.userId ?? undefined,
    action: record.action,
    targetType: record.targetType ?? undefined,
    targetId: record.targetId ?? undefined,
    afterValue: record.afterValue ?? undefined,
  };
  // Pre-chain rows: previousChecksum is undefined/null and the historical
  // checksum was computed without it — verify by the legacy formula.
  // Chain rows: include previousChecksum in the recomputation.
  const recomputed = record.previousChecksum != null
    ? computeChainedChecksum(baseFields, record.previousChecksum)
    : computeChecksum(baseFields);
  return recomputed === record.checksum;
}
