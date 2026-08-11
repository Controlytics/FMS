import { describe, it, expect, vi } from 'vitest';

// verifyBackupAuditChain is pure over the rows it is handed, but it lives in a
// module whose top-level imports reach for the Prisma client. Stub it so this
// file stays a unit test with no DB.
vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn(), $transaction: vi.fn() },
}));

import { computeChainedChecksumV2 } from '../../../lib/hash-chain.js';
import { verifyBackupAuditChain, describeChainReport } from '../backup.repository.js';

const TS = '2026-08-08T10:00:00.000Z';

/**
 * Build an audit row exactly as `audit.ts` writes it TODAY — i.e. over the
 * EXPANDED field set adopted 2026-07-04 (userName / userRole / beforeValue /
 * reason / ipAddress / userAgent / sessionId / signatureMeaning all inside the
 * checksum envelope), then shaped into the snake_case form a backup file
 * carries.
 */
function makeModernRow(opts: {
  id: string;
  position: number;
  previousChecksum: string | null;
  timestamp?: string;
}) {
  const { id, position, previousChecksum, timestamp = TS } = opts;
  const fields: Record<string, unknown> = {
    timestamp,
    userId: 'user-1',
    userName: 'Priya R',
    userRole: 'SUPER_ADMIN',
    action: 'LOGIN_SUCCESS',
    targetType: 'user',
    targetId: 'user-1',
    beforeValue: undefined,
    afterValue: { ok: true },
    reason: undefined,
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    sessionId: 'sess-1',
    signatureMeaning: 'User authenticated with username and password',
  };
  return {
    id,
    chain_position: String(position),
    timestamp,
    user_id: 'user-1',
    user_name: 'Priya R',
    user_role: 'SUPER_ADMIN',
    action: 'LOGIN_SUCCESS',
    target_type: 'user',
    target_id: 'user-1',
    before_value: null,
    after_value: { ok: true },
    reason: null,
    ip_address: '127.0.0.1',
    user_agent: 'vitest',
    session_id: 'sess-1',
    signature_meaning: 'User authenticated with username and password',
    redacted_at: null,
    checksum_version: null,
    checksum: computeChainedChecksumV2(fields, previousChecksum),
    previous_checksum: previousChecksum,
  };
}

/** A row from BEFORE the field expansion — hashed over the reduced 6-field set. */
function makeLegacyRow(opts: { id: string; position: number; previousChecksum: string | null }) {
  const { id, position, previousChecksum } = opts;
  const reduced: Record<string, unknown> = {
    timestamp: TS,
    userId: 'user-9',
    action: 'ROLE_CREATED',
    targetType: 'role',
    targetId: 'role-1',
    afterValue: { name: 'QA' },
  };
  return {
    id,
    chain_position: String(position),
    timestamp: TS,
    user_id: 'user-9',
    user_name: null,
    user_role: null,
    action: 'ROLE_CREATED',
    target_type: 'role',
    target_id: 'role-1',
    before_value: null,
    after_value: { name: 'QA' },
    reason: null,
    ip_address: null,
    user_agent: null,
    session_id: null,
    signature_meaning: null,
    redacted_at: null,
    checksum_version: null,
    checksum: computeChainedChecksumV2(reduced, previousChecksum),
    previous_checksum: previousChecksum,
  };
}

/** Chain a list of builders together so each row links to its predecessor. */
function chain(builders: Array<(prev: string | null, i: number) => any>) {
  const rows: any[] = [];
  let prev: string | null = null;
  builders.forEach((b, i) => {
    const row = b(prev, i);
    rows.push(row);
    prev = row.checksum;
  });
  return rows;
}

describe('verifyBackupAuditChain', () => {
  /**
   * THE REGRESSION. The verifier passed only 6 of the 14 hashed fields, so
   * every row written since the 2026-07-04 expansion failed and restore
   * reported untouched, valid history as "tampered or corrupt". Measured on the
   * dev DB before the fix: 5487 of 17087 rows failed here versus 3308 under the
   * full field set — 2179 genuinely valid rows misreported.
   */
  it('accepts modern rows whose checksum covers the EXPANDED field set', async () => {
    const rows = chain([
      (prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev }),
      (prev) => makeModernRow({ id: 'b', position: 2, previousChecksum: prev, timestamp: '2026-08-08T10:00:01.000Z' }),
      (prev) => makeModernRow({ id: 'c', position: 3, previousChecksum: prev, timestamp: '2026-08-08T10:00:02.000Z' }),
    ]);
    const report = await verifyBackupAuditChain(rows);
    expect(report.checksumFailures).toBe(0);
    expect(report.linkFailures).toBe(0);
    expect(report.totalRows).toBe(3);
  });

  it('still accepts legacy rows hashed over the reduced field set', async () => {
    const rows = chain([
      (prev) => makeLegacyRow({ id: 'a', position: 1, previousChecksum: prev }),
      (prev) => makeLegacyRow({ id: 'b', position: 2, previousChecksum: prev }),
    ]);
    const report = await verifyBackupAuditChain(rows);
    expect(report.checksumFailures).toBe(0);
  });

  it('catches a row whose covered-but-formerly-unhashed field was altered', async () => {
    // reason/ipAddress/userName were OUTSIDE the old 6-field envelope, so this
    // edit used to pass verification untouched.
    const rows = chain([(prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev })]);
    rows[0].ip_address = '10.0.0.9';
    const report = await verifyBackupAuditChain(rows);
    expect(report.checksumFailures).toBe(1);
  });

  it('counts EVERY offender rather than throwing at the first', async () => {
    const rows = chain([
      (prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev }),
      (prev) => makeModernRow({ id: 'b', position: 2, previousChecksum: prev, timestamp: '2026-08-08T10:00:01.000Z' }),
      (prev) => makeModernRow({ id: 'c', position: 3, previousChecksum: prev, timestamp: '2026-08-08T10:00:02.000Z' }),
      (prev) => makeModernRow({ id: 'd', position: 4, previousChecksum: prev, timestamp: '2026-08-08T10:00:03.000Z' }),
    ]);
    rows[0].action = 'TAMPERED';
    rows[2].action = 'TAMPERED';
    const report = await verifyBackupAuditChain(rows);
    // The old implementation reported "row 0" and stopped; the operator could
    // not tell one bad row from a wholly forged file.
    expect(report.checksumFailures).toBe(2);
    expect(report.totalRows).toBe(4);
  });

  it('reports a broken chain link when a row is removed from the middle', async () => {
    const rows = chain([
      (prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev }),
      (prev) => makeModernRow({ id: 'b', position: 2, previousChecksum: prev, timestamp: '2026-08-08T10:00:01.000Z' }),
      (prev) => makeModernRow({ id: 'c', position: 3, previousChecksum: prev, timestamp: '2026-08-08T10:00:02.000Z' }),
    ]);
    const withHole = [rows[0], rows[2]]; // drop the middle row
    const report = await verifyBackupAuditChain(withHole);
    expect(report.linkFailures).toBe(1);
    expect(report.checksumFailures).toBe(0); // the rows themselves are untouched
  });

  it('holds a redacted row to the null-payload invariant instead of recomputing', async () => {
    const rows = chain([(prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev })]);
    rows[0].redacted_at = TS;
    rows[0].before_value = null;
    rows[0].after_value = null;
    const ok = await verifyBackupAuditChain(rows);
    expect(ok.checksumFailures).toBe(0);

    // A "redacted" row whose payload came back is tampered with, whatever its
    // checksum says. The old caller never passed redactedAt at all, so redacted
    // rows took the recompute path and failed outright.
    const resurrected = chain([(prev) => makeModernRow({ id: 'a', position: 1, previousChecksum: prev })]);
    resurrected[0].redacted_at = TS;
    resurrected[0].after_value = { leaked: true };
    const bad = await verifyBackupAuditChain(resurrected);
    expect(bad.checksumFailures).toBe(1);
  });

  it('caps the sample list so a wholly-bad file does not dump 17k offenders', async () => {
    const rows = chain(
      Array.from({ length: 20 }, (_, i) => (prev: string | null) =>
        makeModernRow({ id: `r${i}`, position: i + 1, previousChecksum: prev }),
      ),
    );
    rows.forEach((r) => { r.action = 'TAMPERED'; });
    const report = await verifyBackupAuditChain(rows);
    expect(report.checksumFailures).toBe(20);
    expect(report.samples.length).toBeLessThanOrEqual(5);
  });
});

describe('describeChainReport', () => {
  it('states non-verification as fact without asserting tampering', () => {
    const msg = describeChainReport({
      totalRows: 17087,
      preChainRows: 1,
      chainedRows: 17086,
      checksumFailures: 3308,
      linkFailures: 41,
      samples: [],
    });
    expect(msg).toContain('BACKUP_AUDIT_CHAIN_INVALID');
    expect(msg).toContain('3308');
    expect(msg).toContain('17087');
    expect(msg).toContain('41');
    // The old message asserted "backup is tampered or corrupt" as fact. The
    // common real cause is that source rows already failed at export time, so
    // stating tampering is both unproven and misleading in a §11 context.
    expect(msg).not.toMatch(/is tampered or corrupt/);
  });
});

/**
 * The .sql exporter now emits real Postgres array literals for ARRAY columns.
 * The in-app restore of its OWN .sql parses those back, so the two must be
 * exact inverses — otherwise fixing the export would have broken the import.
 */
describe('PG array literal round-trip (export ↔ in-app restore)', () => {
  const cases: any[][] = [
    ['CHECKLIST_APPROVED', 'CHECKLIST_REJECTED'],
    [],
    ['single'],
    ['has "quotes"'],
    ['back\slash'],
    ["it's"],
    ['comma,inside'],
    ['{braces}'],
  ];

  it.each(cases.map(c => [JSON.stringify(c), c]))('round-trips %s', async (_label, input: any) => {
    const { escapeSqlValue } = await import('../backup.helpers.js');
    const { parsePgArrayLiteral } = await import('../backup.service.js');

    const sql = escapeSqlValue(input, 'text');
    // Undo the outer SQL single-quoting the same way the .sql parser does,
    // then parse the array literal itself.
    const literal = sql.slice(1, sql.indexOf(`'::`)).replace(/''/g, "'");
    expect(parsePgArrayLiteral(literal)).toEqual(input);
  });

  it('treats a bare NULL element as null but the quoted string "NULL" as text', async () => {
    const { parsePgArrayLiteral } = await import('../backup.service.js');
    expect(parsePgArrayLiteral('{NULL,"NULL"}')).toEqual([null, 'NULL']);
  });
});
