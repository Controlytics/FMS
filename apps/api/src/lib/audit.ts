import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { computeChainedChecksum } from './hash-chain.js';

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
 * Prisma transaction-client type. Anything that satisfies the Prisma
 * `Prisma.TransactionClient` interface — i.e., the `tx` parameter inside
 * a `prisma.$transaction(async (tx) => { ... })` callback — can be passed
 * to `auditLog` so the audit write joins the caller's transaction.
 */
export type AuditTx = Prisma.TransactionClient;

// Audit 2026-05-04 fix C3: Postgres advisory lock id used to serialize
// audit-trail writes so the hash chain stays monotonic across concurrent
// writers. The numeric id is arbitrary but must be stable. 7421151037n
// (= "AUDITCHN" if you squint at base32) — chosen for traceability + zero
// chance of collision with application-domain advisory locks.
const AUDIT_CHAIN_LOCK_ID = 7421151037n;

/**
 * Standalone audit logging function. Writes a chained audit row.
 *
 * Two modes:
 *   - **Standalone** (no `tx` arg) — opens its own `prisma.$transaction`
 *     and writes inside it. Use this only for ad-hoc / read-side audits
 *     where there's no business transaction to share.
 *   - **Transactional** (audit §1.1, 2026-05-16) — pass the caller's
 *     `tx` from inside `prisma.$transaction(async (tx) => { ... })`. The
 *     audit write joins the same transaction; if the business mutation
 *     rolls back, the audit row rolls back too. **This is the only mode
 *     that satisfies § 11.10(e) for mutation paths** — without it, a
 *     transient failure between the business commit and the standalone
 *     audit commit leaves state changed with no audit record.
 *
 * In both modes:
 *   1. `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_ID)` — serializes audit
 *      writes across all backends. Released on commit/rollback automatically.
 *      Re-entrant: acquiring the same lock twice from the same tx is a
 *      no-op (Postgres tracks per-tx hold count).
 *   2. SELECT the prior chain row's checksum (highest chain_position).
 *   3. Compute this row's checksum INCLUDING previousChecksum.
 *   4. INSERT the new row with both checksum + previous_checksum.
 *
 * Pre-chain rows (written before the C3 migration) carry previous_checksum
 * NULL. The first row written AFTER the migration becomes the chain
 * genesis — its previous_checksum is the checksum of the most recent
 * pre-chain row IF one exists, or NULL otherwise. That single bridge step
 * means a deletion of the last pre-chain row is detectable too.
 */
export async function auditLog(entry: AuditEntry, tx?: AuditTx): Promise<void> {
  const timestamp = new Date();
  const afterValueClean = entry.afterValue ? JSON.parse(JSON.stringify(entry.afterValue)) : undefined;
  const beforeValueClean = entry.beforeValue ? JSON.parse(JSON.stringify(entry.beforeValue)) : undefined;
  const baseFields = {
    timestamp: timestamp.toISOString(),
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    afterValue: afterValueClean,
  } as Record<string, unknown>;

  if (tx) {
    // Transactional mode — write inside caller's tx.
    await writeAuditRow(tx, entry, timestamp, baseFields, beforeValueClean, afterValueClean);
    return;
  }

  // Standalone mode — open our own tx.
  await prisma.$transaction(async (txInner) => {
    await writeAuditRow(txInner, entry, timestamp, baseFields, beforeValueClean, afterValueClean);
  });
}

async function writeAuditRow(
  tx: AuditTx,
  entry: AuditEntry,
  timestamp: Date,
  baseFields: Record<string, unknown>,
  beforeValueClean: unknown,
  afterValueClean: unknown,
): Promise<void> {
  // Acquire the advisory lock. Released automatically on tx commit/rollback.
  // Using $executeRaw because pg_advisory_xact_lock returns void; $queryRaw
  // expects rows and Prisma's deserializer rejects 'void' column type.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_ID})`;

  // Read the latest chain row's checksum to link this row to it.
  const prior = await tx.$queryRaw<Array<{ checksum: string | null }>>`
    SELECT checksum
    FROM audit_trail
    ORDER BY chain_position DESC NULLS LAST
    LIMIT 1
  `;
  const previousChecksum: string | null = prior[0]?.checksum ?? null;
  const checksum = computeChainedChecksum(baseFields, previousChecksum);

  // Insert via raw SQL so we can write the new chain columns without
  // depending on a regenerated Prisma client (the dev server may be
  // holding the engine DLL when migration runs). chain_position is
  // BIGSERIAL so DEFAULT auto-fills it.
  await tx.$executeRaw`
    INSERT INTO audit_trail (
      timestamp, user_id, user_name, user_role, action,
      target_type, target_id, before_value, after_value,
      reason, ip_address, user_agent, session_id,
      checksum, previous_checksum, signature_meaning
    ) VALUES (
      ${timestamp},
      ${entry.userId ?? null},
      ${entry.userName ?? null},
      ${entry.userRole ?? null},
      ${entry.action},
      ${entry.targetType ?? null},
      ${entry.targetId ?? null},
      ${beforeValueClean ? JSON.stringify(beforeValueClean) : null}::jsonb,
      ${afterValueClean ? JSON.stringify(afterValueClean) : null}::jsonb,
      ${entry.reason ?? null},
      ${entry.ipAddress ?? null},
      ${entry.userAgent ?? null},
      ${entry.sessionId ?? null},
      ${checksum},
      ${previousChecksum},
      ${entry.signatureMeaning ?? null}
    )
  `;
}
