/**
 * Redaction evidence (security assessment P1, 2026-10-22).
 *
 * A redacted audit row keeps its checksum and chain link but loses its payload,
 * so its checksum can no longer be recomputed. What CAN still be verified is
 * every other column - and that is what the redaction's own meta row
 * (AUDIT_RECORD_REDACTED / AUDIT_RECORDS_BULK_REDACTED, itself hash-chained)
 * records. This module builds that record at redaction time and turns the meta
 * rows back into per-row evidence for verification (hash-chain.ts
 * `verifyRedactedRow`).
 *
 * Nothing here changes any checksum formula or any stored row: the evidence is
 * the payload of an ordinary audit row, protected by that row's own checksum.
 */
import { prisma } from './prisma.js';
import { checksumCoverage, type AuditChecksumRecord, type RedactionEvidence } from './hash-chain.js';

/** The record of a redaction: the evidence a redacted row is verified against. */
export const REDACTION_META_ACTIONS = ['AUDIT_RECORD_REDACTED', 'AUDIT_RECORDS_BULK_REDACTED'] as const;

/**
 * Every row that records a change to the audit trail itself - an edit, a
 * deletion or a redaction. The same five actions the edit refusal uses
 * (modules/audit/routes.ts PUT /:id): the record of a change to the audit trail
 * must not itself be rewritable. Redacting an AUDIT_RECORD_DELETED row would null
 * the only surviving copy of the row it deleted (its beforeValue); redacting a
 * redaction record would leave the row it masked unverifiable. Operator decision
 * 2026-10-22. The web Audit Trail page reads the same list (a test keeps them equal).
 */
export const AUDIT_META_ACTIONS = [
  'AUDIT_RECORD_UPDATED', 'AUDIT_RECORD_DELETED', 'AUDIT_RECORDS_BULK_DELETED',
  'AUDIT_RECORD_REDACTED', 'AUDIT_RECORDS_BULK_REDACTED',
] as const;

/** Whether redacting a row with this action is refused (409 META_AUDIT_IMMUTABLE): any AUDIT_META_ACTIONS row. */
export const isRedactionMetaAction = (action: string | null | undefined) =>
  !!action && (AUDIT_META_ACTIONS as readonly string[]).includes(action);

const isRedactionRecordAction = (action: string | null | undefined) =>
  !!action && (REDACTION_META_ACTIONS as readonly string[]).includes(action);

/** An audit_trail row as raw SQL / a backup file returns it (snake_case columns). */
export type RawAuditRow = Record<string, any>;

/**
 * The record of a redacted row, written into the redaction meta row
 * (`snapshotVersion: 2`). Every non-payload column, the chain fields and the
 * redaction's own columns - none of the redaction columns is inside any
 * checksum, so this record is the only thing that protects "who redacted it,
 * when, and why". The PAYLOAD is deliberately not copied: removing it is the
 * point of the redaction. Keeps the five keys the pre-2026-10-22 record had
 * (id, action, timestamp, userId, targetType, targetId) so old readers still work.
 */
export function redactionSnapshot(row: RawAuditRow, redaction: { redactedAt: Date; redactedBy: string; redactionReason: string }) {
  return {
    snapshotVersion: 2,
    id: row.id,
    action: row.action,
    timestamp: new Date(row.timestamp).toISOString(),
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    userRole: row.user_role ?? null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    reason: row.reason ?? null,
    ipAddress: row.ip_address ?? null,
    userAgent: row.user_agent ?? null,
    sessionId: row.session_id ?? null,
    signatureMeaning: row.signature_meaning ?? null,
    signatureAuditId: row.signature_audit_id ?? null,
    checksum: row.checksum,
    previousChecksum: row.previous_checksum ?? null,
    chainPosition: row.chain_position == null ? null : String(row.chain_position),
    checksumVersion: row.checksum_version ?? null,
    redactedAt: redaction.redactedAt.toISOString(),
    redactedBy: redaction.redactedBy,
    redactionReason: redaction.redactionReason,
  };
}

/** A snake_case row as the input verifyAuditChecksum / verifyRedactedRow expect. */
export function rawRowToChecksumRecord(row: RawAuditRow): AuditChecksumRecord {
  return {
    timestamp: row.timestamp,
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    userRole: row.user_role ?? null,
    action: row.action,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    beforeValue: row.before_value ?? undefined,
    afterValue: row.after_value ?? undefined,
    reason: row.reason ?? null,
    ipAddress: row.ip_address ?? null,
    userAgent: row.user_agent ?? null,
    sessionId: row.session_id ?? null,
    signatureMeaning: row.signature_meaning ?? null,
    signatureAuditId: row.signature_audit_id ?? null,
    checksum: row.checksum,
    previousChecksum: row.previous_checksum ?? null,
    redactedAt: row.redacted_at ?? null,
    redactedBy: row.redacted_by ?? null,
    redactionReason: row.redaction_reason ?? null,
    chainPosition: row.chain_position ?? null,
    checksumVersion: row.checksum_version ?? null,
  };
}

interface IndexedEvidence extends RedactionEvidence { metaPosition: bigint | null }
export type RedactionIndex = Map<string, IndexedEvidence[]>;

const toPos = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === '') return null;
  try { return BigInt(v as string | number | bigint); } catch { return null; }
};

/**
 * Index every redaction meta row by the id(s) it redacted. Rows whose action is
 * not a redaction are ignored, so a caller may pass a whole table / backup set.
 * Each meta row's OWN checksum is checked here: a record that fails it, or whose
 * checksum does not cover the snapshot (the REDUCED field set of rows written
 * before 2026-07-04 does not include beforeValue), is not trusted as evidence.
 */
export function buildRedactionIndex(rows: Iterable<RawAuditRow>): RedactionIndex {
  const index: RedactionIndex = new Map();
  const add = (id: unknown, snapshot: unknown, meta: RawAuditRow, recordValid: boolean, recordCoversSnapshot: boolean) => {
    if (typeof id !== 'string' || !snapshot || typeof snapshot !== 'object') return;
    const list = index.get(id) ?? [];
    list.push({ snapshot: snapshot as Record<string, unknown>, recordValid, recordCoversSnapshot, metaRowId: String(meta.id), metaPosition: toPos(meta.chain_position) });
    index.set(id, list);
  };
  for (const meta of rows) {
    if (!isRedactionRecordAction(meta.action)) continue;
    // A redacted redaction record carries no snapshot (its payload is gone).
    if (meta.redacted_at != null || meta.before_value == null) continue;
    const coverage = checksumCoverage(rawRowToChecksumRecord(meta));
    const recordValid = coverage !== null;
    const covers = coverage === 'EXPANDED';
    const bv = meta.before_value as Record<string, unknown>;
    if (meta.action === 'AUDIT_RECORD_REDACTED') add(meta.target_id ?? bv.id, bv, meta, recordValid, covers);
    else for (const r of Array.isArray(bv.records) ? bv.records : []) add((r as Record<string, unknown>)?.id, r, meta, recordValid, covers);
  }
  return index;
}

/**
 * The evidence for one redacted row: the LATEST redaction record that comes
 * after the row in the chain (a record cannot predate what it redacts).
 * Deterministic when a pre-fix race left several records for one row.
 */
export function evidenceFor(index: RedactionIndex, rowId: string, rowPosition: unknown): RedactionEvidence | null {
  const pos = toPos(rowPosition);
  const candidates = (index.get(rowId) ?? []).filter((e) => pos == null || e.metaPosition == null || e.metaPosition > pos);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.metaPosition == null ? -1 : b.metaPosition == null ? 1 : a.metaPosition < b.metaPosition ? 1 : -1));
  return candidates[0];
}

/**
 * Every redaction meta row in the table, indexed. Read WITHOUT the audit
 * visibility scope on purpose: the meta rows are SUPER_ADMIN-only to READ, but
 * a lower role's integrity verdict on a redacted row still depends on them.
 * Only the verdict leaves this module, never the rows.
 */
export async function loadRedactionIndex(): Promise<RedactionIndex> {
  const rows = await prisma.$queryRaw<RawAuditRow[]>`
    SELECT id, chain_position, timestamp, user_id, user_name, user_role, action,
           target_type, target_id, before_value, after_value, reason,
           ip_address, user_agent, session_id, signature_meaning, signature_audit_id,
           checksum, previous_checksum, redacted_at, redacted_by, redaction_reason, checksum_version
    FROM audit_trail
    WHERE action IN ('AUDIT_RECORD_REDACTED', 'AUDIT_RECORDS_BULK_REDACTED')
  `;
  return buildRedactionIndex(rows);
}
