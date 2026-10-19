/**
 * Windowed audit-chain verification for the perf database, using the APP'S OWN
 * verifier (apps/api/src/lib/audit-verify.ts → verifyAuditChain) — no checksum
 * logic of its own.
 *
 * Why windowed: verifyAuditChain() loads every requested row into memory in one
 * query. At production volume (millions of rows) a single call does not fit, so
 * the chain is walked in row windows that OVERLAP BY ONE ROW: verifyAuditChain
 * treats the first row of each call as a genesis (no link check, no gap check),
 * so window k+1 starts AT the last row of window k — that row's successor link
 * and any position gap after it are then checked inside window k+1.
 *
 * Known app-verifier defect handled here (reported, not hidden):
 *   verifyAuditChain()'s SELECT does not fetch `signature_audit_id`, then passes
 *   `row.signature_audit_id ?? null` (always null) to verifyAuditChecksum.
 *   auditLog() hashes signatureAuditId whenever it is set, so EVERY signed row
 *   (e.g. STAGE_APPROVAL_APPROVED written under a re-auth) is reported as
 *   PER_ROW_CHECKSUM_MISMATCH by the app verifier — on real app-written rows too.
 *   For each such row this script re-reads signature_audit_id and re-runs the
 *   app's verifyAuditChecksum with it filled in. Rows that then verify are
 *   counted as `signedRowFalsePositives`; anything that still fails stays a
 *   real mismatch.
 *
 * Usage (from apps/api):
 *   npx tsx ../../tests/performance/data-generation/verify-perf-chain.ts [--window 200000] [--from-position N]
 */
import { bootstrapPerfEnv, argValue, assertConnectedToPerf } from './perf-env.js';

const { dbName } = bootstrapPerfEnv();

const { prisma } = await import('../../../apps/api/src/lib/prisma.js');
const { verifyAuditChain } = await import('../../../apps/api/src/lib/audit-verify.js');
const { verifyAuditChecksum, getAuditChainKey } = await import('../../../apps/api/src/lib/hash-chain.js');

export interface WindowedVerifyResult {
  database: string;
  totalRows: number;
  windows: number;
  firstPosition: number | null;
  highestPosition: number | null;
  anomaliesByKind: Record<string, number>;
  signedRowFalsePositives: number;
  realAnomalyCount: number;
  realAnomalies: Array<{ position: number; id: string; kind: string; message: string }>;
  intactPerAppVerifier: boolean;
  intactAfterSignedRowCorrection: boolean;
  seconds: number;
}

export async function verifyWindowed(windowSize: number, fromPosition?: number): Promise<WindowedVerifyResult> {
  const t0 = Date.now();
  // Row-based window boundaries (positions may have gaps; a position-based
  // window could start just past a gap and hide it).
  const startRow = await prisma.$queryRaw<Array<{ p: bigint | null }>>`
    SELECT min(chain_position) AS p FROM audit_trail WHERE chain_position >= ${BigInt(fromPosition ?? 0)}`;
  let lo = startRow[0]?.p == null ? null : Number(startRow[0].p);
  const anomaliesByKind: Record<string, number> = {};
  const seen = new Set<string>();
  const realAnomalies: WindowedVerifyResult['realAnomalies'] = [];
  let signedFP = 0;
  let totalRows = 0;
  let windows = 0;
  let highest: number | null = null;
  const first = lo;

  while (lo != null) {
    const hiRow = await prisma.$queryRaw<Array<{ p: bigint }>>`
      SELECT chain_position AS p FROM audit_trail WHERE chain_position >= ${BigInt(lo)}
      ORDER BY chain_position OFFSET ${windowSize - 1} LIMIT 1`;
    const hi = hiRow[0] ? Number(hiRow[0].p) : Number.MAX_SAFE_INTEGER;
    const r = await verifyAuditChain({ fromPosition: lo, toPosition: hi });
    windows++;
    totalRows += r.totalRowsChecked - (windows > 1 ? 1 : 0); // overlap row counted once
    if (r.highestPosition != null) highest = r.highestPosition;

    const mismatchIds = r.anomalies.filter(a => a.kind === 'PER_ROW_CHECKSUM_MISMATCH').map(a => a.id);
    const signed = new Map<string, Record<string, unknown>>();
    if (mismatchIds.length) {
      const rows = await prisma.$queryRaw<Array<Record<string, any>>>`
        SELECT id, timestamp, user_id, user_name, user_role, action, target_type, target_id,
               before_value, after_value, reason, ip_address, user_agent, session_id,
               signature_meaning, signature_audit_id, checksum, previous_checksum,
               redacted_at, checksum_version
        FROM audit_trail WHERE id = ANY(${mismatchIds}::uuid[]) AND signature_audit_id IS NOT NULL`;
      for (const row of rows) signed.set(row.id, row);
    }

    for (const a of r.anomalies) {
      const key = `${a.id}:${a.kind}`;
      if (seen.has(key)) continue;            // overlap row seen in the previous window
      seen.add(key);
      anomaliesByKind[a.kind] = (anomaliesByKind[a.kind] ?? 0) + 1;
      if (a.informational) continue;
      if (a.kind === 'PER_ROW_CHECKSUM_MISMATCH' && signed.has(a.id)) {
        const row = signed.get(a.id)!;
        const ok = verifyAuditChecksum({
          timestamp: row.timestamp, userId: row.user_id, userName: row.user_name, userRole: row.user_role,
          action: row.action, targetType: row.target_type, targetId: row.target_id,
          beforeValue: row.before_value ?? undefined, afterValue: row.after_value ?? undefined,
          reason: row.reason, ipAddress: row.ip_address, userAgent: row.user_agent, sessionId: row.session_id,
          signatureMeaning: row.signature_meaning, signatureAuditId: row.signature_audit_id,
          checksum: row.checksum, previousChecksum: row.previous_checksum,
          redactedAt: row.redacted_at ?? undefined, checksumVersion: row.checksum_version,
        });
        if (ok) { signedFP++; continue; }
      }
      realAnomalies.push({ position: a.position, id: a.id, kind: a.kind, message: a.message });
    }
    if (hi === Number.MAX_SAFE_INTEGER || r.totalRowsChecked < windowSize) break;
    lo = hi; // overlap by one row
  }

  const intactPerApp = Object.entries(anomaliesByKind).every(([k]) => k.startsWith('LEGACY_'));
  return {
    database: dbName, totalRows, windows, firstPosition: first, highestPosition: highest,
    anomaliesByKind, signedRowFalsePositives: signedFP, realAnomalyCount: realAnomalies.length, realAnomalies: realAnomalies.slice(0, 50),
    intactPerAppVerifier: intactPerApp,
    intactAfterSignedRowCorrection: realAnomalies.length === 0,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
  };
}

const isMain = process.argv[1] && /verify-perf-chain\.ts$/.test(process.argv[1]);
if (isMain) {
  try {
    await assertConnectedToPerf(prisma);
    if (!getAuditChainKey()) throw new Error('AUDIT_CHAIN_KEY is not set — keyed (v3) rows cannot be verified.');
    const windowSize = Number(argValue('--window') ?? 200000);
    const from = argValue('--from-position');
    const res = await verifyWindowed(windowSize, from ? Number(from) : undefined);
    console.log(JSON.stringify(res, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
