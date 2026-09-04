/**
 * Audit chain verifier — audit 2026-05-04 fix C3.
 *
 * Walks audit_trail in chain_position order and reports any per-row checksum
 * mismatch OR chain-link mismatch. Used by the operator-facing
 * GET /api/audit/verify-chain endpoint and by tests that prove tampering is
 * detected.
 *
 * Pre-chain rows (previous_checksum NULL) are verified by per-row checksum
 * only — they predate the C3 migration and have no chain link.
 *
 * Tamper modes detected:
 *   - row N's per-row checksum doesn't match its current field values
 *     (in-place mutation)
 *   - row N's previous_checksum doesn't match row N-1's checksum (insertion
 *     between N-1 and N, or deletion of N-1)
 *   - row N+1's previous_checksum doesn't match row N's checksum after row N
 *     is mutated (forward propagation — every later row also fails)
 *
 * Tamper modes NOT detected by chain alone (require external counter):
 *   - deletion of the latest row (no successor exists to detect the gap)
 *   - removal of the entire tail. Mitigated by chain_position monotonicity:
 *     verifyChain returns the highest position seen, which an operator can
 *     compare against an out-of-band record (e.g., last known max from a
 *     daily snapshot).
 */
import { prisma } from './prisma.js';
import { verifyAuditChecksum, getAuditChainKeyedFrom, computeChainedChecksum, computeChecksum } from './hash-chain.js';

/**
 * 2026-09-04 investigation of the 3,308 "PER_ROW_CHECKSUM_MISMATCH" rows dated
 * 2026-05-11 .. 2026-05-29 (about half of every day's rows, every action type).
 *
 * They are NOT tampering. Until commit 9014b4c (2026-05-29) the writer hashed the
 * V1 form: top-level keys sorted, nested objects in INSERTION order. Postgres
 * JSONB re-orders object keys on storage (by length, then bytes), so a payload
 * with two or more keys comes back in a different order and the V1 hash can
 * never be rebuilt from the database. Proven on real rows: re-hashing with the
 * keys in the order the code wrote them reproduces the stored checksum byte for
 * byte. Rows with 0 or 1 keys are 0 of 2,076 affected; rows with >= 2 keys are
 * almost all affected. The V2 canonical form (sorted at every level) fixed the
 * write path, which is why nothing after the cut-over is affected.
 *
 * What the verifier does with such a row:
 *   - if the payload has few enough keys, it tries every key order and, on a
 *     match, reports LEGACY_V1_KEY_ORDER (proven, informational);
 *   - if it is too large to try every order, LEGACY_V1_KEY_ORDER_UNVERIFIABLE (the
 *     row's FIELDS cannot be verified; its chain LINK still is, so deletions and
 *     insertions around it remain detectable).
 * Neither flips `intact`, and neither is ever applied to a row written after the
 * cut-over or to a keyed (v3) row - those stay PER_ROW_CHECKSUM_MISMATCH.
 */
export const V2_WRITE_CUTOVER = new Date('2026-05-30T00:00:00Z');
const LEGACY_PERMUTATION_KEY_BUDGET = 6; // 6! = 720 hashes, cheap; 7! is not worth it

function countKeys(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countKeys(x), 0);
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; return Object.keys(o).length + Object.values(o).reduce<number>((n, x) => n + countKeys(x), 0); }
  return 0;
}
function hasReorderableKeys(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasReorderableKeys);
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; return Object.keys(o).length >= 2 || Object.values(o).some(hasReorderableKeys); }
  return false;
}
function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) { yield xs.slice(); return; }
  for (let i = 0; i < xs.length; i++) for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
}
/** Every insertion-order variant of a JSON value (objects at every level). */
function* orderings(v: unknown): Generator<unknown> {
  if (Array.isArray(v)) {
    if (v.length === 0) { yield v; return; }
    const [head, ...tail] = v;
    for (const h of orderings(head)) for (const t of orderings(tail)) yield [h, ...(t as unknown[])];
    return;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>; const keys = Object.keys(o);
    for (const perm of permutations(keys)) {
      const gens = perm.map(k => [...orderings(o[k])]);
      const idx = new Array(perm.length).fill(0);
      while (true) {
        const out: Record<string, unknown> = {};
        perm.forEach((k, i) => { out[k] = gens[i][idx[i]]; });
        yield out;
        let i = perm.length - 1;
        while (i >= 0 && ++idx[i] >= gens[i].length) { idx[i] = 0; i--; }
        if (i < 0) break;
      }
    }
    return;
  }
  yield v;
}

export type LegacyVerdict = 'PROVEN' | 'UNVERIFIABLE' | null;
/**
 * Pure classifier for a legacy (unkeyed, pre-cut-over) row that failed the
 * per-row check. Returns PROVEN when some insertion order of the payload keys
 * reproduces the stored checksum under the V1 formula, UNVERIFIABLE when the
 * row is in the affected class but too large to prove, null when the row is
 * not in the class - or every order was tried and none matched (a real edit).
 */
export function classifyLegacyKeyOrderRow(row: {
  timestamp: Date | string; checksumVersion?: number | null; checksum: string; previousChecksum?: string | null;
  userId?: string | null; action: string; targetType?: string | null; targetId?: string | null; afterValue?: unknown;
}): LegacyVerdict {
  if (row.checksumVersion != null) return null;
  const ts = row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp);
  if (!(ts < V2_WRITE_CUTOVER)) return null;
  if (!hasReorderableKeys(row.afterValue)) return null;
  if (countKeys(row.afterValue) > LEGACY_PERMUTATION_KEY_BUDGET) return 'UNVERIFIABLE';
  const iso = ts.toISOString();
  for (const av of orderings(row.afterValue)) {
    const fields: Record<string, unknown> = { timestamp: iso, userId: row.userId ?? undefined, action: row.action, targetType: row.targetType ?? undefined, targetId: row.targetId ?? undefined, afterValue: av };
    if (row.previousChecksum != null) {
      if (computeChainedChecksum(fields, row.previousChecksum) === row.checksum) return 'PROVEN';
    } else if (computeChainedChecksum(fields, null) === row.checksum || computeChecksum(fields) === row.checksum) return 'PROVEN';
  }
  // Every order was tried and none reproduces the checksum: the payload itself
  // differs from what was hashed. That IS a real mismatch - leave it as tampering.
  return null;
}

export interface ChainAnomaly {
  position: number;
  id: string;
  kind: 'PER_ROW_CHECKSUM_MISMATCH' | 'CHAIN_LINK_MISMATCH' | 'CHAIN_POSITION_GAP' | 'KEYED_ERA_DOWNGRADE'
      | 'LEGACY_V1_KEY_ORDER' | 'LEGACY_V1_KEY_ORDER_UNVERIFIABLE';
  /** true for the two LEGACY_* kinds: reported, counted, but not tampering and not counted against `intact`. */
  informational?: boolean;
  message: string;
  expected?: string | null;
  actual?: string | null;
}

export interface VerifyChainOptions {
  /** Verify only rows in [fromPosition, toPosition]. Default: full table. */
  fromPosition?: number;
  toPosition?: number;
  /** Stop after N anomalies. Default: no cap - the whole chain is walked (2026-09-04;
   *  the old default of 100 made the endpoint stop at position ~193 and report a
   *  precise-looking number that was a cap). */
  maxAnomalies?: number;
}

export interface VerifyChainResult {
  totalRowsChecked: number;
  preChainRows: number;
  chainedRows: number;
  highestPosition: number | null;
  anomalies: ChainAnomaly[];
  /** Pre-cut-over V1 rows whose payload keys JSONB re-ordered: proven / unprovable. Not tampering. */
  legacyKeyOrderRows: { proven: number; unverifiable: number };
  /** No tampering-class anomaly (the LEGACY_* kinds do not count). */
  intact: boolean;
}

interface AuditRow {
  id: string;
  chain_position: bigint | number | null;
  timestamp: Date;
  user_id: string | null;
  user_name: string | null;
  user_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before_value: unknown;
  after_value: unknown;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  signature_meaning: string | null;
  checksum: string;
  previous_checksum: string | null;
  redacted_at: Date | null;
  checksum_version: number | null;
}

export async function verifyAuditChain(opts: VerifyChainOptions = {}): Promise<VerifyChainResult> {
  const maxAnomalies = opts.maxAnomalies ?? Number.POSITIVE_INFINITY;
  const legacyKeyOrderRows = { proven: 0, unverifiable: 0 };
  const fromPos = opts.fromPosition ?? 0;
  const toPos = opts.toPosition ?? Number.MAX_SAFE_INTEGER;

  // Read in chain_position order. NULL chain_positions land last (NULLS LAST)
  // — those rows wouldn't exist after the migration backfill, but the SQL
  // is defensive.
  const rows = await prisma.$queryRaw<AuditRow[]>`
    SELECT id, chain_position, timestamp, user_id, user_name, user_role, action,
           target_type, target_id, before_value, after_value, reason,
           ip_address, user_agent, session_id, signature_meaning,
           checksum, previous_checksum, redacted_at, checksum_version
    FROM audit_trail
    WHERE chain_position >= ${fromPos}
      AND chain_position <= ${toPos}
    ORDER BY chain_position ASC NULLS LAST
  `;

  const anomalies: ChainAnomaly[] = [];
  let preChainRows = 0;
  let chainedRows = 0;
  let priorChecksum: string | null = null;
  let priorPosition: number | null = null;
  let highestPosition: number | null = null;

  // Keyed-era cutover: any row at/after this position MUST be a v3 (keyed) row.
  // This is the OUT-OF-BAND anchor (AUDIT_CHAIN_KEYED_FROM, held in env next to
  // the key — not in the mutable DB). Without checking it, a DB-level actor could
  // relabel a run of the most-recent v3 rows `checksum_version = NULL`, recompute
  // them with the unkeyed SHA formula and self-consistent links, and pass
  // verification — because each downgraded row verifies via the unkeyed path and,
  // being at the tail, has no trailing v3 row whose chain link would break. The
  // per-row HMAC check alone cannot catch that; the cutover position can.
  const keyedFrom = getAuditChainKeyedFrom();

  for (const row of rows) {
    const position = row.chain_position == null
      ? -1
      : (typeof row.chain_position === 'bigint' ? Number(row.chain_position) : row.chain_position);
    if (position > (highestPosition ?? -1)) highestPosition = position;

    // Keyed-era downgrade detection (see keyedFrom above).
    if (keyedFrom != null && position >= keyedFrom && row.checksum_version !== 3) {
      anomalies.push({
        position,
        id: row.id,
        kind: 'KEYED_ERA_DOWNGRADE',
        message: `Row ${row.id} at chain_position ${position} is in the keyed era (>= ${keyedFrom}) but is not a v3 keyed row (checksum_version=${row.checksum_version ?? 'NULL'}) — downgrade or tampering detected.`,
        expected: '3',
        actual: String(row.checksum_version ?? 'NULL'),
      });
      if (anomalies.length >= maxAnomalies) break;
    }

    // Per-row checksum verification.
    const perRowOk = verifyAuditChecksum({
      timestamp: row.timestamp,
      userId: row.user_id,
      // #audit-3 (2026-07-04): plumb ALL persisted columns so the expanded
      // checksum (audit.ts) verifies for new rows. Omitting any of these would
      // reconstruct the expanded field set with nulls → per-row mismatch on
      // every post-expansion row. Old rows ignore the extras via the reduced
      // fallback in verifyAuditChecksum.
      userName: row.user_name,
      userRole: row.user_role,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      beforeValue: row.before_value ?? undefined,
      afterValue: row.after_value ?? undefined,
      reason: row.reason,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      sessionId: row.session_id,
      signatureMeaning: row.signature_meaning,
      checksum: row.checksum,
      previousChecksum: row.previous_checksum,
      // #audit-2: plumb redacted_at so verifyAuditChecksum's redaction
      // short-circuit (hash-chain.ts) fires during the chain walk. Without
      // this, a chain-preserving REDACT (after_value nulled, checksum kept)
      // false-FAILs verify-chain while GET /api/audit shows the row valid.
      redactedAt: row.redacted_at ?? undefined,
      // Keyed-era (v3) rows must verify against the HMAC; legacy rows (NULL)
      // keep using the unkeyed V1/V2 fallback in verifyAuditChecksum.
      checksumVersion: row.checksum_version,
    });
    if (!perRowOk) {
      const legacy = classifyLegacyKeyOrderRow({
        timestamp: row.timestamp, checksumVersion: row.checksum_version, checksum: row.checksum, previousChecksum: row.previous_checksum,
        userId: row.user_id, action: row.action, targetType: row.target_type, targetId: row.target_id, afterValue: row.after_value ?? undefined,
      });
      if (legacy === 'PROVEN') {
        legacyKeyOrderRows.proven++;
        anomalies.push({ position, id: row.id, kind: 'LEGACY_V1_KEY_ORDER', informational: true,
          message: `Row ${row.id} was written before 2026-05-30 with the V1 formula; its stored checksum is reproduced once the payload keys are put back in insertion order (JSONB re-ordered them). Not tampering.` });
      } else if (legacy === 'UNVERIFIABLE') {
        legacyKeyOrderRows.unverifiable++;
        anomalies.push({ position, id: row.id, kind: 'LEGACY_V1_KEY_ORDER_UNVERIFIABLE', informational: true,
          message: `Row ${row.id} was written before 2026-05-30 with the V1 formula and its payload keys were re-ordered by JSONB; the payload is too large to prove by permutation, so its FIELDS cannot be verified (its chain link still is).` });
      } else {
        anomalies.push({
          position,
          id: row.id,
          kind: 'PER_ROW_CHECKSUM_MISMATCH',
          message: `Row ${row.id} checksum does not match its current field values — in-place tampering detected.`,
        });
      }
      if (anomalies.length >= maxAnomalies) break;
    }

    if (row.previous_checksum != null) {
      chainedRows++;
      // Chain link verification: only meaningful when we have a prior chain row.
      // The genesis row (first chained row written, possibly bridging the
      // pre-chain era) carries previousChecksum == checksum-of-last-pre-chain-row;
      // we don't have that bridge value tracked separately, so we accept any
      // non-null value as "valid genesis" iff it's the first chained row
      // we've encountered in this walk.
      if (priorChecksum != null && row.previous_checksum !== priorChecksum) {
        anomalies.push({
          position,
          id: row.id,
          kind: 'CHAIN_LINK_MISMATCH',
          message: `Row ${row.id} previous_checksum does not match the prior row's checksum — insertion or deletion detected.`,
          expected: priorChecksum,
          actual: row.previous_checksum,
        });
        if (anomalies.length >= maxAnomalies) break;
      }
    } else {
      preChainRows++;
    }

    // Detect chain_position gaps (deletion of an interior row).
    if (priorPosition != null && position - priorPosition > 1) {
      anomalies.push({
        position,
        id: row.id,
        kind: 'CHAIN_POSITION_GAP',
        message: `Gap between chain_position ${priorPosition} and ${position} — interior row deletion detected.`,
        expected: String(priorPosition + 1),
        actual: String(position),
      });
      if (anomalies.length >= maxAnomalies) break;
    }

    priorChecksum = row.checksum;
    priorPosition = position;
  }

  return {
    totalRowsChecked: rows.length,
    preChainRows,
    chainedRows,
    highestPosition,
    anomalies,
    legacyKeyOrderRows,
    intact: anomalies.every(a => a.informational === true),
  };
}
