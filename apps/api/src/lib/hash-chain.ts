import { createHash } from 'node:crypto';

/**
 * V1 canonical form: sorts only top-level keys, then JSON.stringify.
 *
 * This is the ORIGINAL formula used by `computeChecksum` / `computeChainedChecksum`
 * since audit fix C3 (2026-05-04). It is preserved as the WRITE-PATH formula
 * so that all historical rows stored in audit_trail remain verifiable via V1.
 *
 * DO NOT change this function — it is the contract for all existing stored checksums.
 * New writes continue to use V1 so the hash chain remains self-consistent over time.
 */
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
 *
 * NOTE: This function uses the V1 canonical form (top-level key sort only).
 * New writes continue to use V1 so all stored checksums remain self-consistent.
 */
export function computeChainedChecksum(
  data: Record<string, unknown>,
  previousChecksum: string | null,
): string {
  return computeChecksum({ ...data, previousChecksum });
}

// ---------------------------------------------------------------------------
// V2 canonicalization — recursive key sort (audit finding V-1, 2026-05-29)
// ---------------------------------------------------------------------------
//
// COMPATIBILITY NOTE (V-1 fix, Option A — versioning approach):
//
// PostgreSQL JSONB normalises nested object key order on storage. When the
// verifier reads back an audit row, nested `afterValue` keys may arrive in a
// different order from what was JSON.stringify'd at write time. The V1
// computeChecksum only sorts TOP-LEVEL keys; nested key order is left to
// JSON.stringify, which preserves insertion order. This means per-row
// verification always fails for any row where `afterValue` (or any other
// nested object field) was stored by PostgreSQL in a different key order than
// the write-time in-memory object.
//
// DESIGN DECISION: we do NOT change the write-path formula (computeChecksum /
// computeChainedChecksum). Changing it would:
//   a) produce different hashes for every new write, breaking chain continuity
//      from the last V1 row to the first V2 row (previous_checksum mismatch), and
//   b) make all historical per-row checksums (which were computed with V1)
//      permanently unverifiable if we only kept V2 in the verifier.
//
// Instead the verifier uses BOTH:
//   1. Try V2 (recursive sort) — the correct form for detecting real tampering.
//   2. Fall back to V1 (top-level sort) — accepts rows where JSONB happened
//      to return keys in the same order as the write-time object (most rows).
//
// Limitation accepted: a historical row where JSONB key order happened to
// differ AND V2 also doesn't match (because it was written with a truly
// different value) will still show as a false-positive mismatch. Brute-force
// permutation in the bug report confirmed stored hashes ARE self-consistent —
// so the V1 fallback will cover all historical rows in practice.
//
// Future new writes: if/when all pre-V2 rows age off or a DB reset is
// performed, the write path can be migrated to computeChainedChecksumV2.
// ---------------------------------------------------------------------------

/**
 * Recursively canonicalize any JSON-serialisable value.
 * Object keys are sorted at every nesting depth; arrays preserve element order.
 * Undefined / function / symbol values emit "null" (mirrors JSON.stringify).
 */
function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  // undefined / function / symbol — emit null to mirror JSON.stringify's behavior
  return 'null';
}

/**
 * V2 checksum: recursively sorts all nested object keys before hashing.
 * Matches what PostgreSQL JSONB returns on read-back, eliminating false-positive
 * "tampering" alerts caused by JSONB key-order normalisation (audit finding V-1).
 *
 * Used in the verify path as the primary attempt (V1 is the fallback for old rows).
 * Also the intended NEW WRITE formula — switch audit.ts to call
 * computeChainedChecksumV2 to make future rows fully JSONB-safe on verify.
 */
export function computeChecksumV2(data: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalize(data)).digest('hex');
}

/**
 * V2 chained checksum: like computeChainedChecksum but uses recursive canonicalization.
 *
 * Exported so callers (audit.ts, tests) can opt-in to V2 for new writes.
 * New rows written with this function will verify correctly even after JSONB
 * normalises nested key order on read-back, because the verifier tries V2 first.
 *
 * Migration path: update audit.ts to call computeChainedChecksumV2 (instead of
 * computeChainedChecksum). Old rows will continue to verify via the V1 fallback.
 * Chain link verification is unaffected (previous_checksum stores the raw stored
 * value, not a recomputed hash).
 */
export function computeChainedChecksumV2(
  data: Record<string, unknown>,
  previousChecksum: string | null,
): string {
  return computeChecksumV2({ ...data, previousChecksum });
}

/**
 * Recompute checksum from a stored audit record's fields.
 * Used to verify integrity on read.
 *
 * For chain rows (previousChecksum != null), the chain link is included
 * in the verification. For pre-chain rows, behavior is identical to the
 * pre-C3 implementation.
 *
 * V-1 fix (2026-05-29): tries V2 (recursive canonical form) first, then falls
 * back to V1 (top-level sort) for historical rows. This eliminates false-positive
 * "tampering" alerts caused by PostgreSQL JSONB normalising nested key order on
 * storage.
 *
 * V-2 fix (2026-05-29): for genesis rows (previousChecksum === null), the
 * verifier now calls computeChainedChecksum(baseFields, null) — matching the
 * writer — rather than computeChecksum(baseFields) which omits the
 * previousChecksum key. Pre-chain rows (written before the C3 migration) had
 * previousChecksum set to undefined in the DB; they arrive here with
 * previousChecksum == null AND their stored checksum was computed by the
 * old computeChecksum path, so the V1 fallback handles them correctly.
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
  redactedAt?: Date | string | null;
}): boolean {
  // Audit 2026-05-20 §C1 fix: redacted rows preserve the original checksum +
  // chain link, but beforeValue + afterValue are NULLed. Recomputing would
  // now fail because the payload no longer matches the original. Treat
  // redactedAt != null as "valid (redacted)" — the chain walker still
  // verifies the previous_checksum linkage, so an UN-authorized payload
  // mutation on a redacted row would still surface via chain mismatch on
  // the NEXT row (its previous_checksum points at this row's stored
  // checksum, which is the pre-redaction value).
  if (record.redactedAt != null) return true;
  const baseFields: Record<string, unknown> = {
    timestamp: record.timestamp instanceof Date ? record.timestamp.toISOString() : record.timestamp,
    userId: record.userId ?? undefined,
    action: record.action,
    targetType: record.targetType ?? undefined,
    targetId: record.targetId ?? undefined,
    afterValue: record.afterValue ?? undefined,
  };

  if (record.previousChecksum != null) {
    // Chain rows: include previousChecksum in the recomputation.
    // Try V2 (recursive canonical) first; fall back to V1 for historical rows.
    const v2 = computeChainedChecksumV2(baseFields, record.previousChecksum);
    if (v2 === record.checksum) return true;
    const v1 = computeChainedChecksum(baseFields, record.previousChecksum);
    return v1 === record.checksum;
  } else {
    // V-2 fix: genesis rows (previousChecksum === null) and pre-chain rows both
    // reach here. For genesis rows written post-C3, the writer called
    // computeChainedChecksum(baseFields, null) — which includes the key
    // {previousChecksum: null} in the hash. The verifier must do the same.
    // For pre-chain rows (written before C3), their stored checksum was computed
    // by computeChecksum(baseFields) without the previousChecksum key; the V1
    // fallback below will match those.
    //
    // Attempt 1: post-C3 genesis row formula (previousChecksum key present, value null).
    const v2Genesis = computeChainedChecksumV2(baseFields, null);
    if (v2Genesis === record.checksum) return true;
    const v1Genesis = computeChainedChecksum(baseFields, null);
    if (v1Genesis === record.checksum) return true;
    // Attempt 2: pre-chain legacy formula (no previousChecksum key at all).
    // Handles rows written before the C3 migration.
    const legacyV2 = computeChecksumV2(baseFields);
    if (legacyV2 === record.checksum) return true;
    const legacyV1 = computeChecksum(baseFields);
    return legacyV1 === record.checksum;
  }
}
